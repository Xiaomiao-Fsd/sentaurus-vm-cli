import { access, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import process from "node:process";
import { SentaurusApi } from "./api.js";
import { loadStoredConfig, updateStoredConfig } from "./config.js";
import type {
  RunSummary,
  VmAgentAttachmentRef,
  VmAgentHistoryResponse,
  VmAgentMessage,
  VmAgentMessageAttachment,
  VmAgentStatus,
  VmSessionOutputFile
} from "./types.js";
import { messageTurnId, mergeMessages } from "./messages.js";
import { parseVmAgentModel } from "./models.js";
import { askChatInput } from "./terminal.js";
import {
  JsonlTurnRenderer,
  printBanner,
  printError,
  printFiles,
  printHistory,
  printModelCatalog,
  printRuns,
  type ReplyRenderer,
  shortId,
  statusLine,
  style,
  TurnRenderer
} from "./ui.js";

export type ChatOptions = {
  configPath: string;
  sessionId?: string;
  title?: string;
  timeoutMs?: number;
  showHistory?: boolean;
  attachments?: string[];
  cwd?: string;
  outputMode?: "human" | "jsonl";
  outputLastMessage?: string;
  archivedSessionIds?: string[];
  initialStatus?: VmAgentStatus;
};

export type OneShotChatResult = {
  session: RunSummary;
  finalMessage?: VmAgentMessage;
};

type PendingAttachment = {
  ref: VmAgentAttachmentRef;
  display: VmAgentMessageAttachment;
};

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => signal?.removeEventListener("abort", abort);
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const abort = () => {
      clearTimeout(timer);
      cleanup();
      reject(signal?.reason || new DOMException("Aborted", "AbortError"));
    };
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
  });
}

export function splitCommandLine(value: string): string[] {
  const result: string[] = [];
  let current = "";
  let quote: "'" | '"' | undefined;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (!character) continue;
    if (quote) {
      if (character === quote) quote = undefined;
      else if (character === "\\" && quote === '"' && (value[index + 1] === '"' || value[index + 1] === "\\")) current += value[++index];
      else current += character;
    } else if (character === "'" || character === '"') {
      quote = character;
    } else if (/\s/.test(character)) {
      if (current) {
        result.push(current);
        current = "";
      }
    } else {
      current += character;
    }
  }
  if (quote) throw new Error("Unclosed quote");
  if (current) result.push(current);
  return result;
}

export function findRun(runs: RunSummary[], selector: string): RunSummary {
  const exact = runs.find((run) => run.id === selector);
  if (exact) return exact;
  const normalized = selector.toLocaleLowerCase();
  const exactTitle = runs.filter((run) => run.title.toLocaleLowerCase() === normalized);
  if (exactTitle.length === 1 && exactTitle[0]) return exactTitle[0];
  if (exactTitle.length > 1) throw new Error(`Session title is ambiguous: ${selector}`);
  const matches = runs.filter((run) =>
    run.id.startsWith(selector) || run.title.toLocaleLowerCase().startsWith(normalized)
  );
  if (matches.length === 1 && matches[0]) return matches[0];
  if (matches.length > 1) throw new Error(`Session prefix is ambiguous: ${selector}`);
  throw new Error(`Session not found: ${selector}`);
}

export async function resolveSession(
  api: SentaurusApi,
  selector?: string,
  fallbackId?: string,
  title?: string,
  archivedSessionIds: string[] = []
): Promise<RunSummary> {
  const runs = await api.listRuns();
  if (selector) return findRun(runs, selector);
  const archived = new Set(archivedSessionIds);
  const activeRuns = runs.filter((run) => !archived.has(run.id));
  if (fallbackId && !archived.has(fallbackId)) {
    const existing = activeRuns.find((run) => run.id === fallbackId);
    if (existing) return existing;
  }
  if (activeRuns[0]) return activeRuns[0];
  return api.createRun(title || `CLI session ${new Date().toISOString()}`);
}

function turnIdFrom(messages: VmAgentMessage[], sessionId: string): string | undefined {
  return messages.map((message) => messageTurnId(message))
    .find((value, index) => value && messages[index]?.meta?.sessionId === sessionId);
}

async function pollForReply(
  api: SentaurusApi,
  cursor: number,
  sessionId: string,
  turnId: string | undefined,
  renderer: ReplyRenderer,
  signal: AbortSignal
): Promise<void> {
  let nextCursor = cursor;
  while (!signal.aborted) {
    const result = await api.messages(nextCursor, { limit: 100, sessionId, signal });
    nextCursor = result.cursor;
    if (renderer.render(result.messages, sessionId, turnId)) return;
    await delay(900, signal);
  }
}

export async function waitForReply(
  api: SentaurusApi,
  initial: VmAgentHistoryResponse,
  sessionId: string,
  renderer: ReplyRenderer,
  options: { timeoutMs: number; signal?: AbortSignal }
): Promise<VmAgentMessage | undefined> {
  const turnId = turnIdFrom(initial.messages, sessionId);
  if (renderer.render(initial.messages, sessionId, turnId)) return renderer.finalMessage();

  const streamController = new AbortController();
  const timeoutController = new AbortController();
  const timeout = setTimeout(() => timeoutController.abort(new Error(`Timed out after ${Math.round(options.timeoutMs / 1000)} seconds`)), options.timeoutMs);
  const signals = [streamController.signal, timeoutController.signal];
  if (options.signal) signals.push(options.signal);
  const signal = AbortSignal.any(signals);
  let complete = false;
  let cursor = initial.cursor;
  let streamFailure: Error | undefined;

  try {
    try {
      await api.streamMessages(cursor, (event) => {
        if (event.event === "error") {
          const data = event.data as { message?: unknown };
          streamFailure = new Error(typeof data?.message === "string" ? data.message : "SSE bridge error");
          streamController.abort();
          return;
        }
        if (event.event !== "messages" || !event.data || typeof event.data !== "object") return;
        const result = event.data as VmAgentHistoryResponse;
        if (typeof result.cursor === "number") cursor = result.cursor;
        if (renderer.render(result.messages || [], sessionId, turnId)) {
          complete = true;
          streamController.abort();
        }
      }, signal);
    } catch (error) {
      if (complete) return renderer.finalMessage();
      if (options.signal?.aborted) throw options.signal.reason || error;
      if (timeoutController.signal.aborted) throw timeoutController.signal.reason || error;
      if (!streamController.signal.aborted && error instanceof Error) streamFailure = error;
    }
    if (complete) return renderer.finalMessage();
    if (streamFailure) process.stderr.write(`${style.dim(`Streaming unavailable (${streamFailure.message}); polling instead.`)}\n`);
    const pollSignals = options.signal ? [timeoutController.signal, options.signal] : [timeoutController.signal];
    await pollForReply(api, cursor, sessionId, turnId, renderer, AbortSignal.any(pollSignals));
    return renderer.finalMessage();
  } finally {
    clearTimeout(timeout);
    streamController.abort();
  }
}

export async function sendTurn(
  api: SentaurusApi,
  sessionId: string,
  text: string,
  pending: PendingAttachment[],
  timeoutMs: number,
  signal?: AbortSignal,
  renderer: ReplyRenderer = new TurnRenderer()
): Promise<VmAgentMessage | undefined> {
  const names = pending.map((item) => item.ref.name);
  const attachmentLine = names.length ? `\n\nAttachments available to the VM agent: ${names.join(", ")}.` : "";
  const visibleText = text.trim() || `Attached ${names.length} file${names.length === 1 ? "" : "s"}.`;
  const response = await api.sendMessage(
    `${visibleText}${attachmentLine}`,
    sessionId,
    pending.map((item) => item.ref),
    pending.map((item) => item.display),
    signal
  );
  return await waitForReply(api, response, sessionId, renderer, { timeoutMs, ...(signal ? { signal } : {}) });
}

async function uploadAttachments(
  api: SentaurusApi,
  sessionId: string,
  paths: string[],
  options: { cwd?: string; outputMode?: "human" | "jsonl" } = {}
): Promise<PendingAttachment[]> {
  const result: PendingAttachment[] = [];
  for (const localPath of paths) {
    const resolved = path.resolve(options.cwd || process.cwd(), localPath);
    await access(resolved);
    if (options.outputMode !== "jsonl") process.stdout.write(`${style.dim(`Uploading ${resolved}...`)}\n`);
    const uploaded = await api.uploadFile(sessionId, resolved);
    result.push({ ref: uploaded.ref, display: uploaded.display });
    const sync = uploaded.response.vmSync.ok ? "VM synced" : "inline fallback";
    if (options.outputMode === "jsonl") {
      process.stdout.write(`${JSON.stringify({ type: "attachment.completed", sessionId, attachment: uploaded.ref, sync })}\n`);
    } else {
      process.stdout.write(`${style.green("attached")} ${uploaded.ref.name} (${sync})\n`);
    }
  }
  return result;
}

function printLocalHelp(): void {
  process.stdout.write(`
Local commands:
  /new [title]                  Create and switch to a session
  /resume <id-prefix|title>     Switch to an existing session
  /rename <title>               Rename the current session
  /archive                      Archive the current session locally
  /sessions [--all]             List active or all sessions
  /session                      Show the current session
  /history                      Reload recent conversation
  /attach <path> [...]          Upload files for the next message
  /attachments                  List pending attachments
  /detach <number|all>          Remove pending attachments
  /files                        List VM session output files
  /download <number|path> [out] Download a listed session file
  /artifact <run-id> <path> [out] Download a run artifact
  /connect                      Deploy/restart the VM worker over SSH
  /model [list|set <name>|name] Show or switch the allowlisted VM model
  /doctor                       Show API and VM bridge status
  /clear                        Clear the terminal
  /exit                         Exit the CLI

Other slash commands are sent to the VM worker, including /goal, /side,
/status, /tools, /instances, and /sentaurus-status.

`);
}

function matchingFile(files: VmSessionOutputFile[], selector: string): VmSessionOutputFile {
  const index = Number.parseInt(selector, 10);
  const indexed = files[index - 1];
  if (Number.isInteger(index) && String(index) === selector && indexed) return indexed;
  const exact = files.find((file) => file.path === selector);
  if (exact) return exact;
  const matches = files.filter((file) => file.path.endsWith(selector));
  if (matches.length === 1 && matches[0]) return matches[0];
  if (matches.length > 1) throw new Error(`File selector is ambiguous: ${selector}`);
  throw new Error(`File not found: ${selector}`);
}

export async function oneShotChat(
  api: SentaurusApi,
  message: string,
  options: ChatOptions,
  fallbackSessionId?: string
): Promise<OneShotChatResult> {
  const session = await resolveSession(
    api,
    options.sessionId,
    fallbackSessionId,
    options.title,
    options.archivedSessionIds
  );
  await updateStoredConfig({ lastSessionId: session.id }, options.configPath);
  const status = options.initialStatus || await api.status();
  if (options.outputMode === "jsonl") {
    process.stdout.write(`${JSON.stringify({ type: "session.started", session, status })}\n`);
  } else {
    printBanner(api.baseUrl, session, status);
  }
  const pending = await uploadAttachments(api, session.id, options.attachments || [], options);
  if (options.outputMode === "jsonl") {
    process.stdout.write(`${JSON.stringify({ type: "turn.started", sessionId: session.id })}\n`);
  }
  const renderer = options.outputMode === "jsonl" ? new JsonlTurnRenderer() : new TurnRenderer();
  const finalMessage = await sendTurn(
    api,
    session.id,
    message,
    pending,
    options.timeoutMs || 30 * 60_000,
    undefined,
    renderer
  );
  if (options.outputLastMessage) {
    const destination = path.resolve(options.cwd || process.cwd(), options.outputLastMessage);
    await writeFile(destination, finalMessage?.content || "", "utf8");
  }
  return { session, ...(finalMessage ? { finalMessage } : {}) };
}

export async function interactiveChat(
  api: SentaurusApi,
  options: ChatOptions,
  fallbackSessionId?: string
): Promise<void> {
  let session = await resolveSession(
    api,
    options.sessionId,
    fallbackSessionId,
    options.title,
    options.archivedSessionIds
  );
  await updateStoredConfig({ lastSessionId: session.id }, options.configPath);
  let status = options.initialStatus || await api.status();
  let files: VmSessionOutputFile[] = [];
  let pending = await uploadAttachments(api, session.id, options.attachments || [], options);
  printBanner(api.baseUrl, session, status);

  if (options.showHistory !== false) {
    const history = await api.messages(0, { limit: 200, sessionId: session.id });
    printHistory(mergeMessages([], history.messages));
  }

  const readline = createInterface({ input: process.stdin, output: process.stdout, terminal: true, historySize: 100 });
  let activeController: AbortController | undefined;
  let exiting = false;
  const onSigint = () => {
    if (activeController) {
      activeController.abort(new Error("Turn cancelled"));
      process.stdout.write("\n");
    } else {
      exiting = true;
      readline.close();
    }
  };
  process.on("SIGINT", onSigint);

  try {
    while (!exiting) {
      let input: string;
      try {
        input = (await askChatInput(readline)).trim();
      } catch {
        break;
      }
      if (!input) continue;

      try {
        const parts = input.startsWith("/") ? splitCommandLine(input) : [];
        const command = parts[0]?.toLowerCase();
        if (command === "/exit" || command === "/quit") break;
        if (command === "/help") {
          printLocalHelp();
          continue;
        }
        if (command === "/clear") {
          process.stdout.write("\u001bc");
          continue;
        }
        if (command === "/session") {
          process.stdout.write(`${session.id}  ${session.status}  ${session.title}\n`);
          continue;
        }
        if (command === "/sessions") {
          const archived = new Set((await loadStoredConfig(options.configPath)).archivedSessionIds || []);
          const runs = await api.listRuns();
          printRuns(parts[1] === "--all" ? runs : runs.filter((run) => !archived.has(run.id)), session.id, archived);
          continue;
        }
        if (command === "/new") {
          session = await api.createRun(parts.slice(1).join(" ") || `CLI session ${new Date().toISOString()}`);
          pending = [];
          files = [];
          await updateStoredConfig({ lastSessionId: session.id }, options.configPath);
          process.stdout.write(`${style.green("session created")} ${session.id}\n`);
          continue;
        }
        if (command === "/resume") {
          if (!parts[1]) throw new Error("Usage: /resume <session-id-or-prefix>");
          session = findRun(await api.listRuns(), parts[1]);
          pending = [];
          files = [];
          await updateStoredConfig({ lastSessionId: session.id }, options.configPath);
          const history = await api.messages(0, { limit: 200, sessionId: session.id });
          process.stdout.write(`${style.green("resumed")} ${session.id}\n\n`);
          printHistory(mergeMessages([], history.messages));
          continue;
        }
        if (command === "/rename") {
          const title = parts.slice(1).join(" ").trim();
          if (!title) throw new Error("Usage: /rename <title>");
          session = await api.updateRunTitle(session.id, title);
          process.stdout.write(`${style.green("renamed")} ${session.id}  ${session.title}\n`);
          continue;
        }
        if (command === "/archive") {
          const stored = await loadStoredConfig(options.configPath);
          const archived = [...new Set([...(stored.archivedSessionIds || []), session.id])];
          await updateStoredConfig({ archivedSessionIds: archived }, options.configPath);
          const next = (await api.listRuns()).find((run) => !archived.includes(run.id));
          session = next || await api.createRun(`CLI session ${new Date().toISOString()}`);
          pending = [];
          files = [];
          await updateStoredConfig({ lastSessionId: session.id }, options.configPath);
          process.stdout.write(`${style.green("archived")} switched to ${session.id}\n`);
          continue;
        }
        if (command === "/history") {
          const history = await api.messages(0, { limit: 200, sessionId: session.id });
          printHistory(mergeMessages([], history.messages), 30);
          continue;
        }
        if (command === "/attach") {
          if (parts.length < 2) throw new Error("Usage: /attach <path> [...]");
          pending.push(...await uploadAttachments(api, session.id, parts.slice(1), options));
          continue;
        }
        if (command === "/attachments") {
          if (!pending.length) process.stdout.write("No pending attachments.\n");
          pending.forEach((item, index) => process.stdout.write(`${index + 1}  ${item.ref.name}  ${item.ref.source}\n`));
          continue;
        }
        if (command === "/detach") {
          if (!parts[1]) throw new Error("Usage: /detach <number|all>");
          if (parts[1].toLowerCase() === "all") pending = [];
          else {
            const index = Number.parseInt(parts[1], 10) - 1;
            if (!pending[index]) throw new Error(`Attachment not found: ${parts[1]}`);
            pending.splice(index, 1);
          }
          continue;
        }
        if (command === "/files") {
          files = (await api.sessionFiles(session.id)).files;
          printFiles(files);
          continue;
        }
        if (command === "/download") {
          if (!parts[1]) throw new Error("Usage: /download <number|path> [output]");
          if (!files.length) files = (await api.sessionFiles(session.id)).files;
          const file = matchingFile(files, parts[1]);
          const destination = await api.downloadSessionFile(session.id, file.category, file.path, parts[2]);
          process.stdout.write(`${style.green("downloaded")} ${destination}\n`);
          continue;
        }
        if (command === "/artifact") {
          if (!parts[1] || !parts[2]) throw new Error("Usage: /artifact <run-id> <path> [output]");
          const destination = await api.downloadArtifact(parts[1], parts[2], parts[3]);
          process.stdout.write(`${style.green("downloaded")} ${destination}\n`);
          continue;
        }
        if (command === "/connect") {
          process.stdout.write(`${style.dim("Deploying and restarting the VM worker...")}\n`);
          const connected = await api.connect();
          status = connected.status;
          process.stdout.write(`${statusLine(status)}\n`);
          continue;
        }
        if (command === "/model" || command === "/models") {
          const action = parts[1]?.toLowerCase();
          if (!action || action === "list" || action === "status" || action === "current") {
            printModelCatalog(await api.models());
            continue;
          }
          const selected = parseVmAgentModel(action === "set" ? parts[2] : parts[1]);
          const changed = await api.setModel(selected, AbortSignal.timeout(180_000));
          status = changed.status;
          printModelCatalog(changed);
          continue;
        }
        if (command === "/doctor") {
          const health = await api.health();
          status = await api.status();
          process.stdout.write(`API ${health.ok ? "ok" : "failed"} | ${statusLine(status)}\n`);
          continue;
        }

        activeController = new AbortController();
        const sent = pending;
        pending = [];
        try {
          process.stdout.write(`${style.dim(`session ${shortId(session.id)} - working`)}\n`);
          await sendTurn(api, session.id, input, sent, options.timeoutMs || 30 * 60_000, activeController.signal);
        } catch (error) {
          pending.unshift(...sent);
          throw error;
        } finally {
          activeController = undefined;
        }
      } catch (error) {
        printError(error);
      }
    }
  } finally {
    process.off("SIGINT", onSigint);
    readline.close();
  }
}
