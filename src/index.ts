#!/usr/bin/env node
import { parseArgs } from "node:util";
import process from "node:process";
import { SentaurusApi } from "./api.js";
import { interactiveChat, oneShotChat, resolveSession } from "./chat.js";
import {
  loadStoredConfig,
  maskedToken,
  normalizeApiUrl,
  resolveConfig,
  saveStoredConfig,
  updateStoredConfig,
  type StoredConfig
} from "./config.js";
import { askLine, askSecret } from "./prompt.js";
import type { VmSessionOutputCategory } from "./types.js";
import { printError, printFiles, printRuns, statusLine, style } from "./ui.js";

const VERSION = "0.1.0";
const categories = new Set<VmSessionOutputCategory>([
  "我的输入",
  "仿真结果文件",
  "仿真日志文件",
  "仿真参数文件",
  "其它文件"
]);

function help(): string {
  return `Sentaurus VM CLI ${VERSION}

Usage:
  sentaurus-vm                         Start an interactive chat
  sentaurus-vm chat [message]          Chat interactively or send one message
  sentaurus-vm resume [session]        Resume a session interactively
  sentaurus-vm status [--json]         Show the VM worker status
  sentaurus-vm connect [--json]        Deploy/restart the VM worker over SSH
  sentaurus-vm doctor [--json]         Check HTTP, auth, SSH, worker, and tools
  sentaurus-vm new [title]             Create a session
  sentaurus-vm sessions [--json]       List sessions
  sentaurus-vm files --session ID      List VM session output files
  sentaurus-vm download PATH           Download a VM session file
  sentaurus-vm artifact RUN_ID PATH    Download a run artifact
  sentaurus-vm login                   Save API URL and token
  sentaurus-vm config [--json]         Show resolved configuration (masked)

Options:
  --url URL             API origin, for example http://[2001:db8::1]:5175
  --token TOKEN         API token; prefer SENTAURUS_VM_TOKEN to avoid shell history
  --session ID          Session ID or unique prefix
  --title TITLE         Title when a new session is needed
  --attach PATH         Upload a file for the next message (repeatable)
  --timeout SECONDS     Reply timeout, default 1800
  --output PATH         Download destination
  --category NAME       Session output category for download
  --no-history          Do not print recent messages at interactive startup
  --json                Print machine-readable output
  -h, --help            Show help
  -v, --version         Show version

Environment:
  SENTAURUS_VM_URL, SENTAURUS_VM_TOKEN, SENTAURUS_VM_CONFIG, NO_COLOR
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
  if (!apiUrl) throw new Error("API URL is not configured. Run `sentaurus-vm login` or set SENTAURUS_VM_URL.");
  if (!authToken) throw new Error("API token is not configured. Run `sentaurus-vm login` or set SENTAURUS_VM_TOKEN.");
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
    process.stdout.write(`${style.yellow("warning:")} HTTP sends the bearer token without encryption. Prefer an SSH tunnel or TLS on untrusted networks.\n`);
  }
}

async function main(): Promise<void> {
  const parsed = parseArgs({
    allowPositionals: true,
    strict: true,
    options: {
      url: { type: "string" },
      token: { type: "string" },
      session: { type: "string" },
      title: { type: "string" },
      attach: { type: "string", multiple: true },
      timeout: { type: "string" },
      output: { type: "string", short: "o" },
      category: { type: "string" },
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

  const knownCommands = new Set(["chat", "ask", "resume", "status", "connect", "doctor", "new", "sessions", "files", "download", "artifact", "login", "config", "help"]);
  const first = parsed.positionals[0];
  const command = first && knownCommands.has(first) ? first : "chat";
  const args = command === "chat" && first !== "chat" ? parsed.positionals : parsed.positionals.slice(1);
  const configPath = process.env.SENTAURUS_VM_CONFIG;

  if (command === "help") {
    process.stdout.write(help());
    return;
  }
  if (command === "login") {
    await login(configPath || (await resolveConfig()).path);
    return;
  }

  const overrides: StoredConfig = {};
  if (parsed.values.url) overrides.apiUrl = parsed.values.url;
  if (parsed.values.token) overrides.authToken = parsed.values.token;
  const config = await resolveConfig(overrides, configPath || undefined);

  if (command === "config") {
    const output = {
      configPath: config.path,
      apiUrl: config.apiUrl || null,
      authToken: maskedToken(config.authToken),
      lastSessionId: config.lastSessionId || null,
      environmentOverrides: {
        url: Boolean(process.env.SENTAURUS_VM_URL),
        token: Boolean(process.env.SENTAURUS_VM_TOKEN)
      }
    };
    process.stdout.write(parsed.values.json ? `${JSON.stringify(output, null, 2)}\n` : `Config:  ${output.configPath}\nAPI:     ${output.apiUrl || "<not configured>"}\nToken:   ${output.authToken}\nSession: ${output.lastSessionId || "<none>"}\n`);
    return;
  }

  requireApiConfig(config.apiUrl, config.authToken);
  const api = new SentaurusApi({ baseUrl: config.apiUrl, token: config.authToken });
  const json = parsed.values.json;

  if (command === "doctor") {
    const started = Date.now();
    const [health, vm] = await Promise.all([
      api.health(AbortSignal.timeout(15_000)),
      api.vmStatus(AbortSignal.timeout(45_000))
    ]);
    // The bridge serializes SSH work; keep the full worker probe out of the fast status lane.
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
    const status = await api.status(AbortSignal.timeout(45_000));
    process.stdout.write(json ? `${JSON.stringify(status, null, 2)}\n` : `${statusLine(status)}\n`);
    if (!status.ok) process.exitCode = 1;
    return;
  }

  if (command === "connect") {
    const result = await api.connect(AbortSignal.timeout(90_000));
    process.stdout.write(json ? `${JSON.stringify(result, null, 2)}\n` : `${statusLine(result.status)}\n`);
    if (!result.ok) process.exitCode = 1;
    return;
  }

  if (command === "sessions") {
    const runs = await api.listRuns();
    if (json) process.stdout.write(`${JSON.stringify({ runs }, null, 2)}\n`);
    else printRuns(runs, config.lastSessionId);
    return;
  }

  if (command === "new") {
    const run = await api.createRun(parsed.values.title || args.join(" ") || `CLI session ${new Date().toISOString()}`);
    await updateStoredConfig({ lastSessionId: run.id }, config.path);
    process.stdout.write(json ? `${JSON.stringify({ run }, null, 2)}\n` : `${run.id}  ${run.title}\n`);
    return;
  }

  if (command === "files") {
    const session = await resolveSession(api, parsed.values.session || args[0], config.lastSessionId);
    const response = await api.sessionFiles(session.id);
    if (json) process.stdout.write(`${JSON.stringify({ sessionId: session.id, ...response }, null, 2)}\n`);
    else printFiles(response.files);
    return;
  }

  if (command === "download") {
    const filePath = args[0];
    if (!filePath) throw new Error("Usage: sentaurus-vm download PATH --session ID --category NAME [--output PATH]");
    const session = await resolveSession(api, parsed.values.session, config.lastSessionId);
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

  const chatOptions = {
    configPath: config.path,
    ...(parsed.values.session || (command === "resume" && args[0]) ? { sessionId: parsed.values.session || args[0] } : {}),
    ...(parsed.values.title ? { title: parsed.values.title } : {}),
    timeoutMs: timeoutMs(parsed.values.timeout),
    showHistory: !parsed.values["no-history"],
    attachments: parsed.values.attach || []
  };
  const messageArgs = command === "resume" ? [] : args;
  if (messageArgs.length) {
    await oneShotChat(api, messageArgs.join(" "), chatOptions, config.lastSessionId);
  } else {
    await interactiveChat(api, chatOptions, config.lastSessionId);
  }
}

main().catch((error) => {
  printError(error);
  process.exitCode = 1;
});
