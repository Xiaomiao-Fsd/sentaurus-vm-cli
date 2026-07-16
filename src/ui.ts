import process from "node:process";
import type {
  RunSummary,
  VmAgentMessage,
  VmAgentMessageAttachment,
  VmAgentModelsResponse,
  VmAgentStatus,
  VmAgentWorkflow,
  VmSessionOutputFile
} from "./types.js";
import { MarkdownStream, renderMarkdown, sanitizeTerminalText } from "./markdown.js";
import { TurnEventReducer, type CliEvent } from "./events.js";
import { ReasoningSummaryBuffer, reasoningSummarySeparator } from "./reasoning-summary.js";
import {
  isReasoningSummary,
  isReasoningSummaryDelta,
  isStreamDelta,
  isStreamingDraft,
  isWorklogMessage
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

function terminalInline(value: unknown): string {
  return sanitizeTerminalText(String(value ?? "")).replace(/\s+/gu, " ").trim();
}

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
  const reasoning = status.llmReasoningEffort ? ` ${status.llmReasoningEffort}` : "";
  const context = status.llmContextWindowTokens ? ` | context ${Math.round(status.llmContextWindowTokens / 1000)}k` : "";
  return `${connection} | ${worker} | ${model}${reasoning}${context} | queue ${status.queueDepth ?? "?"}`;
}

export function printModelCatalog(response: VmAgentModelsResponse): void {
  process.stdout.write(`Current  ${response.currentModel} | reasoning ${response.reasoningEffort} | context ${Math.round(response.contextWindowTokens / 1000)}k\n`);
  for (const model of response.models) {
    const current = model.id === response.currentModel ? "*" : " ";
    process.stdout.write(`${current} ${model.id.padEnd(16)} ${Math.round(model.contextWindowTokens / 1000)}k\n`);
  }
}

export function printBanner(apiUrl: string, session: RunSummary, status: VmAgentStatus, workflow?: VmAgentWorkflow): void {
  process.stdout.write(`\n${style.bold("Sentaurus VM CLI")}\n`);
  process.stdout.write(`${style.dim("API")}      ${terminalInline(apiUrl)}\n`);
  process.stdout.write(`${style.dim("Session")}  ${terminalInline(session.id)} (${terminalInline(session.title)})\n`);
  process.stdout.write(`${style.dim("VM")}       ${statusLine(status)}\n`);
  if (workflow?.goal) {
    const objective = terminalInline(workflow.goal.objective);
    process.stdout.write(`${style.dim("Goal")}     ${workflow.goal.status} | ${objective}\n`);
  }
  if (workflow?.plan.mode === "plan") process.stdout.write(`${style.yellow("Plan")}     read-only planning mode | revision ${workflow.revision}\n`);
  process.stdout.write(`${style.dim("Hint")}     Type / for commands; Up/Down selects; Tab completes; /goal and /plan manage workflow.\n\n`);
}

export function printRuns(runs: RunSummary[], currentId?: string, archivedIds: ReadonlySet<string> = new Set()): void {
  if (!runs.length) {
    process.stdout.write("No sessions.\n");
    return;
  }
  for (const run of runs) {
    const current = run.id === currentId ? "*" : " ";
    const archived = archivedIds.has(run.id) ? "A" : " ";
    process.stdout.write(`${current}${archived} ${terminalInline(run.id)}  ${terminalInline(run.status).padEnd(12)}  ${terminalInline(run.title)}\n`);
  }
}

export function printFiles(files: VmSessionOutputFile[]): void {
  if (!files.length) {
    process.stdout.write("No VM session files.\n");
    return;
  }
  files.forEach((file, index) => {
    process.stdout.write(`${String(index + 1).padStart(3)}  ${formatBytes(file.size).padStart(10)}  ${terminalInline(file.category)}  ${terminalInline(file.path)}\n`);
  });
}

export function printHistory(messages: VmAgentMessage[], limit = 16): void {
  const visible = messages.filter((message) =>
    (message.role === "user" || message.role === "agent")
    && !isWorklogMessage(message)
    && !isReasoningSummary(message)
    && !isReasoningSummaryDelta(message)
    && !isStreamDelta(message)
    && !isStreamingDraft(message)
  ).slice(-limit);
  if (!visible.length) return;
  process.stdout.write(`${style.dim("Recent conversation")}\n`);
  for (const message of visible) {
    const label = message.role === "user" ? style.cyan("you") : style.green("sentaurus");
    process.stdout.write(`${label}\n${renderMarkdown(message.content.trim())}\n`);
  }
}

type Writer = (value: string) => void;

export type ReplyRenderer = {
  render(messages: VmAgentMessage[], sessionId: string, turnId?: string): boolean;
  finalMessage(): VmAgentMessage | undefined;
  finish?(sessionId: string, turnId?: string): void;
};

function attachmentLine(attachment: Partial<VmAgentMessageAttachment>, index: number): string {
  const kind = attachment.kind === "image" ? "image" : "file";
  const name = terminalInline(attachment.name || attachment.path || attachment.id || `attachment-${index + 1}`);
  const path = terminalInline(attachment.path || "");
  const location = path && path !== name ? ` | ${path}` : "";
  const size = typeof attachment.size === "number" && Number.isFinite(attachment.size) && attachment.size >= 0
    ? ` | ${formatBytes(attachment.size)}`
    : "";
  return `  ${String(index + 1).padStart(2)}  [${kind}] ${name}${location}${size}`;
}

export class TurnRenderer {
  private readonly reducer = new TurnEventReducer();
  private readonly markdown = new MarkdownStream();
  private readonly reasoning = new ReasoningSummaryBuffer();
  private reasoningBlockCount = 0;
  private streamOpen = false;
  private readonly write: Writer;

  constructor(write: Writer = (value) => process.stdout.write(value)) {
    this.write = write;
  }

  render(messages: VmAgentMessage[], sessionId: string, turnId?: string): boolean {
    const batch = this.reducer.consume(messages, sessionId, turnId);
    for (const event of batch.events) this.renderEvent(event);
    if (batch.complete) this.flushReasoning();
    return batch.complete;
  }

  finalMessage(): VmAgentMessage | undefined {
    return this.reducer.finalMessage();
  }

  finish(): void {
    this.flushReasoning();
  }

  private renderReasoningBlocks(blocks: readonly string[]): void {
    for (const block of blocks) {
      if (this.reasoningBlockCount > 0) {
        this.write(`${style.dim(reasoningSummarySeparator())}\n\n`);
      }
      this.write(`${renderMarkdown(block).trimEnd()}\n\n`);
      this.reasoningBlockCount += 1;
    }
  }

  private flushReasoning(): void {
    this.renderReasoningBlocks(this.reasoning.flush());
  }

  private renderEvent(event: CliEvent): void {
    if (event.type === "reasoning.summary.delta") {
      return;
    }
    if (event.type === "reasoning.summary") {
      this.renderReasoningBlocks(this.reasoning.push(event.text));
      return;
    }
    if (event.type === "worklog") {
      this.write(`${style.dim(`[${event.phase}] ${sanitizeTerminalText(event.text)}`)}\n`);
      return;
    }
    if (event.type === "attachments") {
      this.flushReasoning();
      const run = event.runId ? ` ${style.dim(shortId(event.runId))}` : "";
      this.write(`${style.cyan("artifacts")}${run}\n`);
      if (event.attachments.length) {
        event.attachments.forEach((attachment, index) => this.write(`${attachmentLine(attachment, index)}\n`));
      } else if (event.text) {
        this.write(`${sanitizeTerminalText(event.text)}\n`);
      } else {
        this.write(`${style.dim("  No published attachment metadata.")}\n`);
      }
      this.write("\n");
      return;
    }
    if (event.type === "response.delta") {
      this.flushReasoning();
      if (!this.streamOpen) {
        this.write(`${style.green("sentaurus")}\n`);
        this.streamOpen = true;
      }
      const rendered = this.markdown.push(event.text);
      if (rendered) this.write(rendered);
      return;
    }
    if (event.type === "response.completed" && event.streamed) {
      this.flushReasoning();
      const rendered = this.markdown.flush();
      if (rendered) this.write(rendered);
      this.streamOpen = false;
      return;
    }
    if (this.streamOpen) {
      const rendered = this.markdown.flush();
      if (rendered) this.write(rendered);
      this.write("\n");
      this.streamOpen = false;
    }
    this.flushReasoning();
    const label = event.type === "error" ? style.red("system") : style.green("sentaurus");
    this.write(`${label}\n${renderMarkdown(event.text).trimEnd()}\n\n`);
  }
}

export class JsonlTurnRenderer implements ReplyRenderer {
  private readonly reducer = new TurnEventReducer();
  private readonly write: Writer;
  private completed = false;
  private completionEmitted = false;
  private readonly reasoningSummaries: Array<{ stage: string; status: string; text: string; messageId: string }> = [];
  private readonly publishedAttachments = new Map<string, Partial<VmAgentMessageAttachment>>();

  constructor(write: Writer = (value) => process.stdout.write(value)) {
    this.write = write;
  }

  private event(value: unknown): void {
    this.write(`${JSON.stringify(value)}\n`);
  }

  render(messages: VmAgentMessage[], sessionId: string, turnId?: string): boolean {
    const batch = this.reducer.consume(messages, sessionId, turnId);
    for (const event of batch.events) {
      if (event.type === "reasoning.summary") {
        this.reasoningSummaries.push({
          stage: event.stage,
          status: event.status,
          text: event.text,
          messageId: event.message.id
        });
      } else if (event.type === "attachments") {
        for (const [index, attachment] of event.attachments.entries()) {
          const key = attachment.id || `${attachment.runId || event.runId || "run"}:${attachment.path || attachment.name || index}`;
          this.publishedAttachments.set(key, attachment);
        }
      }
      this.event(this.reducer.eventEnvelope(event, sessionId, turnId));
    }
    if (batch.complete) this.completed = true;
    return this.completed;
  }

  finish(sessionId: string, turnId?: string): void {
    if (!this.completed || this.completionEmitted) return;
    this.completionEmitted = true;
    const finalMessage = this.reducer.finalMessage();
    this.event({
      type: "turn.completed",
      sessionId,
      turnId: turnId || finalMessage?.meta?.turnId || finalMessage?.meta?.groupId || null,
      finalResponse: finalMessage?.content || "",
      finalMessageId: finalMessage?.id || null,
      runId: finalMessage?.meta?.runId || null,
      runStatus: finalMessage?.meta?.runStatus || null,
      reasoningSummaries: this.reasoningSummaries,
      attachments: [...this.publishedAttachments.values()]
    });
  }

  finalMessage(): VmAgentMessage | undefined {
    return this.reducer.finalMessage();
  }
}

export function printError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${style.red("error:")} ${terminalInline(message)}\n`);
}
