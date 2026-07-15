#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { SentaurusApi } from "./api.js";
import { findRun, interactiveChat, oneShotChat } from "./chat.js";
import { completionScript } from "./completion.js";
import {
  loadStoredConfig,
  maskedToken,
  normalizeApiUrl,
  removeStoredConfigKeys,
  resolveConfig,
  saveStoredConfig,
  updateStoredConfig,
  type ResolvedConfig,
  type StoredConfig
} from "./config.js";
import { cliFeatures, formatFeatureList } from "./features.js";
import { bootstrapLocalHost } from "./host.js";
import { shouldReadStdin } from "./input.js";
import { mergeMessages } from "./messages.js";
import { parseVmAgentModel } from "./models.js";
import { askLine, askSecret } from "./prompt.js";
import { buildReviewPrompt } from "./review.js";
import { selectSession, shouldOpenSessionSelector } from "./session-selector.js";
import { PROVISIONAL_SESSION_TITLE } from "./session-title.js";
import { configureUtf8Terminal, relaunchForWindowsUtf8IfNeeded } from "./terminal.js";
import type { RunSummary, VmSessionOutputCategory } from "./types.js";
import { printError, printFiles, printHistory, printModelCatalog, printRuns, statusLine, style } from "./ui.js";

const VERSION = "0.8.0";
const categories = new Set<VmSessionOutputCategory>([
  "我的输入",
  "仿真结果文件",
  "仿真日志文件",
  "仿真参数文件",
  "其它文件"
]);

const knownCommands = new Set([
  "chat", "ask", "exec", "review", "resume", "status", "connect", "doctor", "new",
  "sessions", "history", "rename", "archive", "unarchive", "delete", "files", "download",
  "artifact", "model", "models", "features", "completion", "login", "logout", "config", "help"
]);

function help(): string {
  return `Sentaurus VM CLI ${VERSION}

Usage:
  vm-agent                              SSH host mode: bootstrap and chat
  vm-agent <command>                    Run any command without exposing a token
  sentaurus-vm                          Start an interactive chat
  sentaurus-vm exec [prompt|-]          Run one turn non-interactively
  sentaurus-vm review [instructions]    Review Sentaurus decks/results
  sentaurus-vm resume [session]         Resume by ID, prefix, or exact title
  sentaurus-vm resume --all             Select from all sessions interactively
  sentaurus-vm new [title]              Create a session; first prompt titles it when omitted
  sentaurus-vm sessions [--all]         List active or all sessions
  sentaurus-vm history [session]        Show session conversation
  sentaurus-vm rename SESSION TITLE     Rename a session
  sentaurus-vm archive SESSION          Hide a session from default lists
  sentaurus-vm unarchive SESSION        Restore an archived session
  sentaurus-vm delete SESSION           Delete Web run data after confirmation
  sentaurus-vm files --session ID       List VM session output files
  sentaurus-vm download PATH            Download a VM session file
  sentaurus-vm artifact RUN_ID PATH     Download a run artifact
  sentaurus-vm status [--json]          Show VM worker status
  sentaurus-vm connect [--json]         Deploy/restart the VM worker over SSH
  sentaurus-vm doctor [--json]          Check HTTP, auth, SSH, worker, and tools
  sentaurus-vm models [--json]          List the allowlisted VM models
  sentaurus-vm model [name]             Show or switch the active VM model
  sentaurus-vm features [--json]        List supported CLI/host/worker features
  sentaurus-vm completion [shell]       Generate shell completion
  sentaurus-vm login | logout           Manage remote API credentials
  sentaurus-vm config [--json]          Show resolved configuration (masked)
  sentaurus-vm local [command]          Use SSH-host bootstrap explicitly

Interactive workflow:
  /goal <objective>                     Set the durable session objective
  /goal pause|resume|block|complete     Update the goal lifecycle
  /plan                                 Enter read-only planning mode
  /plan approve                         Approve the plan; does not start a run
  /plan exit|clear                      Leave or reset planning state
  /help [command]                       Show all interactive slash commands

Interactive editor:
  /                                     Open the live command palette
  Up/Down                               Select a palette item, or browse history
  Tab                                   Complete the selected command or value
  Esc                                   Close the palette until input changes

Options:
  --host                Read the API token only from the host-local Web .env
  --url URL             Remote API origin
  --token TOKEN         Remote API token; prefer SENTAURUS_VM_TOKEN
  --session ID          Session ID, unique prefix, or exact title
  --last                Use the newest active session
  --all                 Include archived sessions; resume opens a TTY selector
  --title TITLE         Title when a new session is needed
  --attach PATH         Upload a file for the next message (repeatable)
  -i, --image PATH      Upload an image for the next message (repeatable)
  --timeout SECONDS     Reply timeout, default 1800
  -o, --output PATH     Final reply or download destination
  -C, --cd DIR          Resolve attachments and outputs from DIR
  --ephemeral           Delete the temporary Web run after exec/review
  --force               Skip delete confirmation
  --category NAME       Session output category for download
  --web-repo PATH       Sentaurus Web Agent repository for host mode
  --task-name NAME      Windows server task name for host mode
  --restart-worker      Redeploy/restart the VM worker in host mode
  --no-history          Do not print recent messages at interactive startup
  --json                Print JSON, or JSONL for exec/review/chat turns
  -h, --help            Show help
  -v, --version         Show version

Environment:
  SENTAURUS_VM_URL, SENTAURUS_VM_TOKEN, SENTAURUS_VM_CONFIG,
  SENTAURUS_WEB_AGENT_REPO, NO_COLOR
`;
}

function timeoutMs(value: string | undefined): number {
  if (!value) return 30 * 60_000;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 1 || seconds > 24 * 60 * 60) {
    throw new Error("--timeout must be between 1 and 86400 seconds");
  }
  return Math.round(seconds * 1000);
}

function requireApiConfig(apiUrl: string, authToken: string): void {
  if (!apiUrl) throw new Error("API URL is not configured. Run `sentaurus-vm login` or use `vm-agent` on the SSH host.");
  if (!authToken) throw new Error("API token is not configured. Run `sentaurus-vm login` or use `vm-agent` on the SSH host.");
}

async function login(configPath: string): Promise<void> {
  const current = await loadStoredConfig(configPath);
  const envUrl = process.env.SENTAURUS_VM_URL;
  const apiUrl = normalizeApiUrl(await askLine("Sentaurus API URL", envUrl || current.apiUrl || "http://[::1]:5175"));
  const authToken = (await askSecret("AUTH_TOKEN (hidden)")).trim();
  if (!authToken) throw new Error("AUTH_TOKEN cannot be empty");
  const api = new SentaurusApi({ baseUrl: apiUrl, token: authToken });
  const health = await api.health(AbortSignal.timeout(15_000));
  const status = await api.status(AbortSignal.timeout(30_000));
  await saveStoredConfig({ ...current, apiUrl, authToken }, configPath);
  process.stdout.write(`${style.green("saved")} ${configPath}\n`);
  process.stdout.write(`API ${health.ok ? "ok" : "failed"} | ${statusLine(status)}\n`);
  if (apiUrl.startsWith("http://") && !apiUrl.includes("[::1]") && !apiUrl.includes("127.0.0.1")) {
    process.stdout.write(`${style.yellow("warning:")} HTTP sends the bearer token without encryption. Prefer SSH host mode or TLS.\n`);
  }
}

async function readStdin(): Promise<string> {
  let value = "";
  for await (const chunk of process.stdin) value += chunk.toString();
  return value.trim();
}

async function promptFrom(args: string[], required: boolean): Promise<string> {
  const dashIndex = args.indexOf("-");
  const explicitStdin = dashIndex >= 0;
  const argumentText = args.filter((_, index) => index !== dashIndex).join(" ").trim();
  const stdinText = shouldReadStdin(args, Boolean(process.stdin.isTTY)) ? await readStdin() : "";
  const prompt = explicitStdin && !argumentText
    ? stdinText
    : argumentText && stdinText
      ? `${argumentText}\n\n<stdin>\n${stdinText}\n</stdin>`
      : argumentText || stdinText;
  if (required && !prompt) throw new Error("A prompt is required. Pass text or use `-` to read stdin.");
  return prompt;
}

function activeRuns(runs: RunSummary[], archivedSessionIds: string[]): RunSummary[] {
  const archived = new Set(archivedSessionIds);
  return runs.filter((run) => !archived.has(run.id));
}

async function existingSession(
  api: SentaurusApi,
  selector: string | undefined,
  fallbackId: string | undefined,
  archivedSessionIds: string[],
  newest = false
): Promise<RunSummary> {
  const runs = await api.listRuns();
  if (selector) return findRun(runs, selector);
  const active = activeRuns(runs, archivedSessionIds);
  if (!newest && fallbackId) {
    const fallback = active.find((run) => run.id === fallbackId);
    if (fallback) return fallback;
  }
  if (active[0]) return active[0];
  throw new Error("No active sessions. Create one with `sentaurus-vm new`.");
}

function configOutput(config: ResolvedConfig): Record<string, unknown> {
  return {
    configPath: config.path,
    apiUrl: config.apiUrl || null,
    authToken: maskedToken(config.authToken),
    lastSessionId: config.lastSessionId || null,
    archivedSessionIds: config.archivedSessionIds,
    environmentOverrides: {
      url: Boolean(process.env.SENTAURUS_VM_URL),
      token: Boolean(process.env.SENTAURUS_VM_TOKEN)
    }
  };
}

async function saveSessionMetadata(
  stored: StoredConfig,
  configPath: string,
  archivedSessionIds: string[],
  lastSessionId?: string
): Promise<void> {
  const next: StoredConfig = { ...stored, archivedSessionIds };
  if (lastSessionId) next.lastSessionId = lastSessionId;
  else delete next.lastSessionId;
  await saveStoredConfig(next, configPath);
}

export async function runCli(argv = process.argv.slice(2)): Promise<void> {
  configureUtf8Terminal();
  const parsed = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      url: { type: "string" },
      token: { type: "string" },
      session: { type: "string" },
      title: { type: "string" },
      attach: { type: "string", multiple: true },
      image: { type: "string", short: "i", multiple: true },
      timeout: { type: "string" },
      output: { type: "string", short: "o" },
      category: { type: "string" },
      cd: { type: "string", short: "C" },
      "web-repo": { type: "string" },
      "task-name": { type: "string" },
      host: { type: "boolean", default: false },
      last: { type: "boolean", default: false },
      all: { type: "boolean", default: false },
      force: { type: "boolean", default: false },
      ephemeral: { type: "boolean", default: false },
      "restart-worker": { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      "no-history": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
      version: { type: "boolean", short: "v", default: false }
    }
  });

  if (parsed.values.help) {
    process.stdout.write(help());
    return;
  }
  if (parsed.values.version) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  if (parsed.values.cd) process.chdir(path.resolve(parsed.values.cd));

  const positionals = [...parsed.positionals];
  const explicitLocal = positionals[0] === "local";
  if (explicitLocal) positionals.shift();
  const hostMode = parsed.values.host || explicitLocal;
  const first = positionals[0];
  const command = first && knownCommands.has(first) ? positionals.shift()! : "chat";
  const args = positionals;
  const configPath = process.env.SENTAURUS_VM_CONFIG;
  const json = parsed.values.json;

  if (command === "help") {
    process.stdout.write(help());
    return;
  }
  if (command === "completion") {
    const shell = args[0] || (process.platform === "win32" ? "powershell" : "bash");
    process.stdout.write(completionScript(shell));
    return;
  }
  if (command === "features") {
    const result = { features: cliFeatures };
    process.stdout.write(json ? `${JSON.stringify(result, null, 2)}\n` : formatFeatureList());
    return;
  }
  if (command === "login") {
    await login(configPath || (await resolveConfig()).path);
    return;
  }
  if (command === "logout") {
    const target = configPath || (await resolveConfig()).path;
    await removeStoredConfigKeys(["authToken"], target);
    process.stdout.write(json ? `${JSON.stringify({ ok: true, configPath: target })}\n` : `${style.green("logged out")} ${target}\n`);
    return;
  }

  const overrides: StoredConfig = {};
  if (parsed.values.url) overrides.apiUrl = parsed.values.url;
  if (parsed.values.token) overrides.authToken = parsed.values.token;

  if (command === "config") {
    const config = await resolveConfig(overrides, configPath || undefined);
    const output = configOutput(config);
    process.stdout.write(json
      ? `${JSON.stringify(output, null, 2)}\n`
      : `Config:   ${output.configPath}\nAPI:      ${output.apiUrl || "<not configured>"}\nToken:    ${output.authToken}\nSession:  ${output.lastSessionId || "<none>"}\nArchived: ${(output.archivedSessionIds as string[]).length}\n`);
    return;
  }

  let api: SentaurusApi;
  let config: ResolvedConfig;
  let hostStatus: Awaited<ReturnType<typeof bootstrapLocalHost>>["status"] | undefined;
  if (hostMode) {
    const host = await bootstrapLocalHost({
      ...(parsed.values["web-repo"] ? { webRepository: parsed.values["web-repo"] } : {}),
      ...(parsed.values["task-name"] ? { taskName: parsed.values["task-name"] } : {}),
      restartWorker: parsed.values["restart-worker"] || command === "connect",
      quiet: json,
      ...(configPath ? { configPath } : {})
    });
    const stored = await loadStoredConfig(host.configPath);
    api = host.api;
    hostStatus = host.status;
    config = {
      apiUrl: host.apiUrl,
      authToken: "",
      ...(stored.lastSessionId ? { lastSessionId: stored.lastSessionId } : {}),
      archivedSessionIds: stored.archivedSessionIds || [],
      path: host.configPath
    };
  } else {
    config = await resolveConfig(overrides, configPath || undefined);
    requireApiConfig(config.apiUrl, config.authToken);
    api = new SentaurusApi({ baseUrl: config.apiUrl, token: config.authToken });
  }

  if (command === "doctor") {
    const started = Date.now();
    const [health, vm] = await Promise.all([
      api.health(AbortSignal.timeout(15_000)),
      api.vmStatus(AbortSignal.timeout(45_000))
    ]);
    const status = await api.status(AbortSignal.timeout(45_000));
    const result = {
      ok: health.ok && vm.ok && status.ok && status.connected && status.workerRunning === true,
      apiUrl: api.baseUrl,
      latencyMs: Date.now() - started,
      health,
      vm,
      status
    };
    if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    else {
      process.stdout.write(`API      ${health.ok ? style.green("ok") : style.red("failed")} (${result.latencyMs} ms total)\n`);
      process.stdout.write(`Bridge   ${statusLine(status)}\n`);
      process.stdout.write(`SSH      ${vm.sshTarget}${vm.hostname ? ` -> ${vm.user || "?"}@${vm.hostname}` : ""}\n`);
      const tools = Object.entries(vm.tools || status.sentaurusTools || {});
      process.stdout.write(`Tools    ${tools.map(([name, value]) => `${name}:${value ? "ok" : "missing"}`).join(" ") || "unknown"}\n`);
      if (vm.error || status.error) process.stdout.write(`${style.red("Error")}    ${vm.error || status.error}\n`);
    }
    if (!result.ok) process.exitCode = 1;
    return;
  }

  if (command === "status") {
    const status = hostStatus || await api.status(AbortSignal.timeout(45_000));
    process.stdout.write(json ? `${JSON.stringify(status, null, 2)}\n` : `${statusLine(status)}\n`);
    if (!status.ok) process.exitCode = 1;
    return;
  }

  if (command === "connect") {
    const result = hostMode && hostStatus
      ? { ok: hostStatus.ok, status: hostStatus }
      : await api.connect(AbortSignal.timeout(120_000));
    process.stdout.write(json ? `${JSON.stringify(result, null, 2)}\n` : `${statusLine(result.status)}\n`);
    if (!result.ok) process.exitCode = 1;
    return;
  }

  if (command === "model" || command === "models") {
    const action = args[0]?.toLowerCase();
    const listOnly = command === "models" || !action || action === "list" || action === "status" || action === "current";
    if (listOnly) {
      const result = await api.models(AbortSignal.timeout(45_000));
      process.stdout.write(json ? `${JSON.stringify(result, null, 2)}\n` : "");
      if (!json) printModelCatalog(result);
      return;
    }
    const model = parseVmAgentModel(action === "set" ? args[1] : args[0]);
    const result = await api.setModel(model, AbortSignal.timeout(180_000));
    process.stdout.write(json ? `${JSON.stringify(result, null, 2)}\n` : "");
    if (!json) printModelCatalog(result);
    return;
  }

  if (command === "sessions") {
    const runs = await api.listRuns();
    const archived = new Set(config.archivedSessionIds);
    const visible = parsed.values.all ? runs : runs.filter((run) => !archived.has(run.id));
    if (json) {
      process.stdout.write(`${JSON.stringify({ runs: visible.map((run) => ({ ...run, archived: archived.has(run.id) })) }, null, 2)}\n`);
    } else {
      printRuns(visible, config.lastSessionId, archived);
    }
    return;
  }

  if (command === "new") {
    const run = await api.createRun(parsed.values.title || args.join(" ") || PROVISIONAL_SESSION_TITLE);
    await updateStoredConfig({ lastSessionId: run.id }, config.path);
    process.stdout.write(json ? `${JSON.stringify({ run }, null, 2)}\n` : `${run.id}  ${run.title}\n`);
    return;
  }

  if (command === "history") {
    const selector = parsed.values.session || args[0];
    const session = await existingSession(api, selector, config.lastSessionId, config.archivedSessionIds);
    const response = await api.messages(0, { limit: 500, sessionId: session.id });
    const messages = mergeMessages([], response.messages);
    if (json) process.stdout.write(`${JSON.stringify({ session, messages, cursor: response.cursor }, null, 2)}\n`);
    else printHistory(messages, 200);
    return;
  }

  if (command === "rename") {
    const selector = parsed.values.session || args[0];
    const title = (parsed.values.session ? args : args.slice(1)).join(" ").trim();
    if (!selector || !title) throw new Error("Usage: sentaurus-vm rename SESSION TITLE");
    const session = await existingSession(api, selector, undefined, config.archivedSessionIds);
    const run = await api.updateRunTitle(session.id, title);
    process.stdout.write(json ? `${JSON.stringify({ run }, null, 2)}\n` : `${style.green("renamed")} ${run.id}  ${run.title}\n`);
    return;
  }

  if (command === "archive" || command === "unarchive") {
    const selector = parsed.values.session || args[0];
    if (!selector) throw new Error(`Usage: sentaurus-vm ${command} SESSION`);
    const session = await existingSession(api, selector, undefined, config.archivedSessionIds);
    const archived = new Set(config.archivedSessionIds);
    if (command === "archive") archived.add(session.id);
    else archived.delete(session.id);
    const nextLast = command === "archive" && config.lastSessionId === session.id
      ? activeRuns(await api.listRuns(), [...archived])[0]?.id
      : config.lastSessionId;
    await saveSessionMetadata(await loadStoredConfig(config.path), config.path, [...archived], nextLast);
    const result = { ok: true, sessionId: session.id, archived: command === "archive" };
    process.stdout.write(json ? `${JSON.stringify(result)}\n` : `${style.green(command === "archive" ? "archived" : "unarchived")} ${session.id}\n`);
    return;
  }

  if (command === "delete") {
    const selector = parsed.values.session || args[0];
    if (!selector) throw new Error("Usage: sentaurus-vm delete SESSION [--force]");
    const session = await existingSession(api, selector, undefined, config.archivedSessionIds);
    if (!parsed.values.force) {
      if (!process.stdin.isTTY) throw new Error("Refusing non-interactive deletion without --force");
      const confirmation = await askLine(`Type ${session.id} to delete Web run data`);
      if (confirmation !== session.id) {
        process.stdout.write("Cancelled.\n");
        return;
      }
    }
    await api.deleteRun(session.id);
    const archived = config.archivedSessionIds.filter((id) => id !== session.id);
    const nextLast = config.lastSessionId === session.id
      ? activeRuns(await api.listRuns(), archived)[0]?.id
      : config.lastSessionId;
    await saveSessionMetadata(await loadStoredConfig(config.path), config.path, archived, nextLast);
    process.stdout.write(json ? `${JSON.stringify({ ok: true, sessionId: session.id })}\n` : `${style.green("deleted")} ${session.id}\n`);
    return;
  }

  if (command === "files") {
    const session = await existingSession(api, parsed.values.session || args[0], config.lastSessionId, config.archivedSessionIds);
    const response = await api.sessionFiles(session.id);
    if (json) process.stdout.write(`${JSON.stringify({ sessionId: session.id, ...response }, null, 2)}\n`);
    else printFiles(response.files);
    return;
  }

  if (command === "download") {
    const filePath = args[0];
    if (!filePath) throw new Error("Usage: sentaurus-vm download PATH --session ID --category NAME [--output PATH]");
    const session = await existingSession(api, parsed.values.session, config.lastSessionId, config.archivedSessionIds);
    let category = parsed.values.category as VmSessionOutputCategory | undefined;
    if (category && !categories.has(category)) throw new Error(`Unknown category: ${category}`);
    if (!category) {
      const files = (await api.sessionFiles(session.id)).files.filter((file) => file.path === filePath || file.path.endsWith(filePath));
      if (files.length !== 1 || !files[0]) throw new Error("File category could not be inferred uniquely; pass --category");
      category = files[0].category;
    }
    const destination = await api.downloadSessionFile(session.id, category, filePath, parsed.values.output);
    process.stdout.write(json ? `${JSON.stringify({ destination })}\n` : `${destination}\n`);
    return;
  }

  if (command === "artifact") {
    const [runId, artifactPath] = args;
    if (!runId || !artifactPath) throw new Error("Usage: sentaurus-vm artifact RUN_ID PATH [--output PATH]");
    const destination = await api.downloadArtifact(runId, artifactPath, parsed.values.output);
    process.stdout.write(json ? `${JSON.stringify({ destination })}\n` : `${destination}\n`);
    return;
  }

  const invokedExec = command === "exec";
  let chatCommand = command;
  let chatArgs = [...args];
  let resumeSelector = parsed.values.session;
  if (chatCommand === "exec" && chatArgs[0] === "resume") {
    chatCommand = "resume";
    chatArgs.shift();
  } else if (chatCommand === "exec" && chatArgs[0] === "review") {
    chatCommand = "review";
    chatArgs.shift();
  }

  if (chatCommand === "resume") {
    if (shouldOpenSessionSelector({
      includeAll: parsed.values.all,
      ...(resumeSelector ? { selector: resumeSelector } : {}),
      useLast: parsed.values.last,
      remainingArgs: chatArgs,
      interactiveCommand: !invokedExec,
      json,
      inputIsTty: Boolean(process.stdin.isTTY),
      outputIsTty: Boolean(process.stdout.isTTY)
    })) {
      const selected = await selectSession(await api.listRuns(), {
        archivedIds: new Set(config.archivedSessionIds),
        ...(config.lastSessionId ? { currentId: config.lastSessionId } : {})
      });
      if (!selected) {
        process.stdout.write("Cancelled.\n");
        return;
      }
      resumeSelector = selected.id;
    } else {
      if (!resumeSelector && !parsed.values.last && chatArgs[0]) resumeSelector = chatArgs.shift();
      const session = await existingSession(
        api,
        resumeSelector,
        config.lastSessionId,
        config.archivedSessionIds,
        parsed.values.last
      );
      resumeSelector = session.id;
    }
  }

  const attachments = [...(parsed.values.attach || []), ...(parsed.values.image || [])];
  const outputMode = json ? "jsonl" as const : "human" as const;
  const chatOptions = {
    configPath: config.path,
    ...(resumeSelector || parsed.values.session ? { sessionId: resumeSelector || parsed.values.session } : {}),
    ...(parsed.values.title ? { title: parsed.values.title } : {}),
    timeoutMs: timeoutMs(parsed.values.timeout),
    showHistory: !parsed.values["no-history"],
    attachments,
    cwd: process.cwd(),
    outputMode,
    ...(parsed.values.output ? { outputLastMessage: parsed.values.output } : {}),
    archivedSessionIds: config.archivedSessionIds,
    ...(hostStatus ? { initialStatus: hostStatus } : {})
  };

  const explicitOneShot = invokedExec || chatCommand === "ask" || chatCommand === "review";
  const hasPromptInput = chatArgs.length > 0 || !process.stdin.isTTY;
  if (!explicitOneShot && !hasPromptInput) {
    if (json) throw new Error("--json requires a one-shot prompt; use `exec` for automation.");
    await interactiveChat(api, chatOptions, config.lastSessionId);
    return;
  }

  const prompt = await promptFrom(chatArgs, explicitOneShot && chatCommand !== "review");
  const message = chatCommand === "review" ? buildReviewPrompt(prompt) : prompt;
  if (!message) {
    await interactiveChat(api, chatOptions, config.lastSessionId);
    return;
  }

  let ephemeralSession: RunSummary | undefined;
  const previousLastSessionId = config.lastSessionId;
  if (parsed.values.ephemeral) {
    ephemeralSession = await api.createRun(parsed.values.title || `Ephemeral CLI ${new Date().toISOString()}`);
    chatOptions.sessionId = ephemeralSession.id;
  }
  try {
    await oneShotChat(api, message, chatOptions, config.lastSessionId);
  } finally {
    if (ephemeralSession) {
      try {
        await api.deleteRun(ephemeralSession.id);
        const stored = await loadStoredConfig(config.path);
        await saveSessionMetadata(stored, config.path, stored.archivedSessionIds || [], previousLastSessionId);
        if (json) process.stdout.write(`${JSON.stringify({ type: "session.deleted", sessionId: ephemeralSession.id, ephemeral: true })}\n`);
      } catch (error) {
        process.stderr.write(`${style.yellow("warning:")} could not delete ephemeral Web run: ${error instanceof Error ? error.message : String(error)}\n`);
      }
    }
  }
}

export function executeCli(argv = process.argv.slice(2)): void {
  if (relaunchForWindowsUtf8IfNeeded()) return;
  runCli(argv).catch((error) => {
    if (argv.includes("--json")) {
      process.stdout.write(`${JSON.stringify({ type: "error", message: error instanceof Error ? error.message : String(error) })}\n`);
    } else {
      printError(error);
    }
    process.exitCode = 1;
  });
}

const directPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
const modulePath = path.resolve(fileURLToPath(import.meta.url));
const directlyExecuted = process.platform === "win32"
  ? directPath.toLowerCase() === modulePath.toLowerCase()
  : directPath === modulePath;
if (directlyExecuted) executeCli();
