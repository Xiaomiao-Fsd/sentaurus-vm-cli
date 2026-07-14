import process from "node:process";
import type { RunSummary, VmAgentMessage, VmAgentStatus, VmSessionOutputFile } from "./types.js";
import {
  belongsToTurn,
  isFinalReply,
  isStreamDelta,
  isStreamDone,
  isStreamingDraft,
  isWorklogMessage,
  messageKind,
  streamTargetId
} from "./messages.js";

const colorEnabled = Boolean(process.stdout.isTTY && !process.env.NO_COLOR);
const ansi = (code: number, value: string) => colorEnabled ? `\u001b[${code}m${value}\u001b[0m` : value;

export const style = {
  bold: (value: string) => ansi(1, value),
  dim: (value: string) => ansi(2, value),
  red: (value: string) => ansi(31, value),
  green: (value: string) => ansi(32, value),
  yellow: (value: string) => ansi(33, value),
  cyan: (value: string) => ansi(36, value)
};

export function shortId(value: string): string {
  return value.length > 20 ? `${value.slice(0, 12)}...${value.slice(-6)}` : value;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

export function statusLine(status: VmAgentStatus): string {
  const connection = status.connected ? style.green("connected") : style.red("disconnected");
  const worker = status.workerRunning ? style.green("worker running") : style.yellow("worker stopped");
  const model = status.llmConfigured ? status.llmModel || "configured" : style.yellow("LLM not configured");
  return `${connection} | ${worker} | ${model} | queue ${status.queueDepth ?? "?"}`;
}

export function printBanner(apiUrl: string, session: RunSummary, status: VmAgentStatus): void {
  process.stdout.write(`\n${style.bold("Sentaurus VM CLI")}\n`);
  process.stdout.write(`${style.dim("API")}      ${apiUrl}\n`);
  process.stdout.write(`${style.dim("Session")}  ${session.id} (${session.title})\n`);
  process.stdout.write(`${style.dim("VM")}       ${statusLine(status)}\n`);
  process.stdout.write(`${style.dim("Hint")}     /help shows local commands; VM commands such as /goal and /side pass through.\n\n`);
}

export function printRuns(runs: RunSummary[], currentId?: string): void {
  if (!runs.length) {
    process.stdout.write("No sessions.\n");
    return;
  }
  for (const run of runs) {
    const current = run.id === currentId ? "*" : " ";
    process.stdout.write(`${current} ${run.id}  ${run.status.padEnd(12)}  ${run.title}\n`);
  }
}

export function printFiles(files: VmSessionOutputFile[]): void {
  if (!files.length) {
    process.stdout.write("No VM session files.\n");
    return;
  }
  files.forEach((file, index) => {
    process.stdout.write(`${String(index + 1).padStart(3)}  ${formatBytes(file.size).padStart(10)}  ${file.category}  ${file.path}\n`);
  });
}

export function printHistory(messages: VmAgentMessage[], limit = 16): void {
  const visible = messages.filter((message) =>
    (message.role === "user" || message.role === "agent")
    && !isWorklogMessage(message)
    && !isStreamDelta(message)
    && !isStreamingDraft(message)
  ).slice(-limit);
  if (!visible.length) return;
  process.stdout.write(`${style.dim("Recent conversation")}\n`);
  for (const message of visible) {
    const label = message.role === "user" ? style.cyan("you") : style.green("sentaurus");
    process.stdout.write(`${label}\n${message.content.trim()}\n\n`);
  }
}

type Writer = (value: string) => void;

export class TurnRenderer {
  private readonly seen = new Set<string>();
  private readonly streamContent = new Map<string, string>();
  private streamOpen = false;
  private readonly write: Writer;

  constructor(write: Writer = (value) => process.stdout.write(value)) {
    this.write = write;
  }

  render(messages: VmAgentMessage[], sessionId: string, turnId?: string): boolean {
    let complete = false;
    for (const message of messages) {
      if (!belongsToTurn(message, sessionId, turnId)) continue;
      if (this.seen.has(message.id) && !streamTargetId(message)) continue;
      this.seen.add(message.id);

      if (message.role === "user") continue;
      if (isWorklogMessage(message)) {
        const phase = String(message.meta?.phase || message.meta?.status || messageKind(message) || "work");
        const content = message.content.trim();
        if (content) this.write(`${style.dim(`[${phase}] ${content}`)}\n`);
        continue;
      }

      const target = streamTargetId(message);
      if (target) {
        const previous = this.streamContent.get(target) || "";
        const append = isStreamDelta(message) || message.meta?.append === true;
        const next = append ? `${previous}${message.content}` : message.content || previous;
        let suffix = next;
        if (next.startsWith(previous)) suffix = next.slice(previous.length);
        if (!this.streamOpen) {
          this.write(`${style.green("sentaurus")}\n`);
          this.streamOpen = true;
        }
        if (suffix) this.write(suffix);
        this.streamContent.set(target, next);
        if (isStreamDone(message)) {
          this.write("\n\n");
          this.streamOpen = false;
          complete = true;
        }
        continue;
      }

      if (message.content.trim()) {
        if (this.streamOpen) {
          this.write("\n\n");
          this.streamOpen = false;
        }
        const label = message.role === "system" ? style.red("system") : style.green("sentaurus");
        this.write(`${label}\n${message.content.trim()}\n\n`);
      }
      if (isFinalReply(message)) complete = true;
    }
    return complete;
  }
}

export function printError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${style.red("error:")} ${message}\n`);
}
