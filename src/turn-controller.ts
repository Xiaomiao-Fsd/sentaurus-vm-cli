import process from "node:process";
import { SentaurusApi } from "./api.js";
import type { PendingAttachment } from "./attachments.js";
import type { VmAgentHistoryResponse, VmAgentMessage } from "./types.js";
import { messageKind, messageTurnId } from "./messages.js";
import { style, TurnRenderer, type ReplyRenderer } from "./ui.js";

const RUN_FINAL_SETTLE_MS = 1_250;

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

function turnIdFrom(messages: VmAgentMessage[], sessionId: string): string | undefined {
  return messages.map((message) => messageTurnId(message))
    .find((value, index) => value && messages[index]?.meta?.sessionId === sessionId);
}

function needsRunFinalSettle(renderer: ReplyRenderer): boolean {
  const message = renderer.finalMessage();
  return Boolean(message && messageKind(message) === "run_final");
}

function finishRenderer(renderer: ReplyRenderer, sessionId: string, turnId?: string): void {
  renderer.finish?.(sessionId, turnId);
}

async function collectTrailingRunMessages(
  api: SentaurusApi,
  cursor: number,
  sessionId: string,
  turnId: string | undefined,
  renderer: ReplyRenderer,
  signal: AbortSignal,
  settleMs: number
): Promise<void> {
  if (!needsRunFinalSettle(renderer)) return;
  await delay(settleMs, signal);
  try {
    const trailing = await api.messages(cursor, { limit: 100, sessionId, signal });
    renderer.render(trailing.messages, sessionId, turnId);
  } catch (error) {
    if (signal.aborted) throw signal.reason || error;
    const detail = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${style.dim(`Could not collect trailing run artifacts (${detail}).`)}\n`);
  }
}

async function pollForReply(
  api: SentaurusApi,
  cursor: number,
  sessionId: string,
  turnId: string | undefined,
  renderer: ReplyRenderer,
  signal: AbortSignal,
  runFinalSettleMs: number
): Promise<void> {
  let nextCursor = cursor;
  while (!signal.aborted) {
    const result = await api.messages(nextCursor, { limit: 100, sessionId, signal });
    nextCursor = result.cursor;
    if (renderer.render(result.messages, sessionId, turnId)) {
      await collectTrailingRunMessages(api, nextCursor, sessionId, turnId, renderer, signal, runFinalSettleMs);
      return;
    }
    await delay(900, signal);
  }
}

export async function waitForReply(
  api: SentaurusApi,
  initial: VmAgentHistoryResponse,
  sessionId: string,
  renderer: ReplyRenderer,
  options: { timeoutMs: number; signal?: AbortSignal; runFinalSettleMs?: number }
): Promise<VmAgentMessage | undefined> {
  const turnId = turnIdFrom(initial.messages, sessionId);
  const runFinalSettleMs = Math.max(0, options.runFinalSettleMs ?? RUN_FINAL_SETTLE_MS);
  if (renderer.render(initial.messages, sessionId, turnId)) {
    const initialSignal = options.signal || new AbortController().signal;
    await collectTrailingRunMessages(api, initial.cursor, sessionId, turnId, renderer, initialSignal, runFinalSettleMs);
    finishRenderer(renderer, sessionId, turnId);
    return renderer.finalMessage();
  }

  const streamController = new AbortController();
  const timeoutController = new AbortController();
  const timeout = setTimeout(
    () => timeoutController.abort(new Error(`Timed out after ${Math.round(options.timeoutMs / 1000)} seconds`)),
    options.timeoutMs
  );
  const signals = [streamController.signal, timeoutController.signal];
  if (options.signal) signals.push(options.signal);
  const signal = AbortSignal.any(signals);
  let complete = false;
  let cursor = initial.cursor;
  let streamFailure: Error | undefined;
  let settleTimer: ReturnType<typeof setTimeout> | undefined;

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
          if (!complete) {
            complete = true;
            if (needsRunFinalSettle(renderer)) {
              settleTimer = setTimeout(() => streamController.abort(), runFinalSettleMs);
            } else {
              streamController.abort();
            }
          }
        }
      }, signal);
    } catch (error) {
      if (complete) {
        finishRenderer(renderer, sessionId, turnId);
        return renderer.finalMessage();
      }
      if (options.signal?.aborted) throw options.signal.reason || error;
      if (timeoutController.signal.aborted) throw timeoutController.signal.reason || error;
      if (!streamController.signal.aborted && error instanceof Error) streamFailure = error;
    }
    if (complete) {
      finishRenderer(renderer, sessionId, turnId);
      return renderer.finalMessage();
    }
    if (streamFailure) process.stderr.write(`${style.dim(`Streaming unavailable (${streamFailure.message}); polling instead.`)}\n`);
    const pollSignals = options.signal ? [timeoutController.signal, options.signal] : [timeoutController.signal];
    await pollForReply(api, cursor, sessionId, turnId, renderer, AbortSignal.any(pollSignals), runFinalSettleMs);
    finishRenderer(renderer, sessionId, turnId);
    return renderer.finalMessage();
  } finally {
    clearTimeout(timeout);
    if (settleTimer) clearTimeout(settleTimer);
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
  renderer: ReplyRenderer = new TurnRenderer(),
  onSubmitted?: () => void | Promise<void>
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
  const metadataUpdate = onSubmitted ? Promise.resolve(onSubmitted()) : Promise.resolve();
  const [finalMessage] = await Promise.all([
    waitForReply(api, response, sessionId, renderer, { timeoutMs, ...(signal ? { signal } : {}) }),
    metadataUpdate
  ]);
  return finalMessage;
}

export type TurnRunOptions = {
  renderer?: ReplyRenderer;
  onSubmitted?: () => void | Promise<void>;
};

export class TurnController {
  private active: AbortController | undefined;

  constructor(private readonly api: SentaurusApi, private readonly timeoutMs: number) {}

  get running(): boolean {
    return Boolean(this.active);
  }

  cancel(reason = "Turn cancelled"): boolean {
    if (!this.active) return false;
    this.active.abort(new Error(reason));
    return true;
  }

  async run(
    sessionId: string,
    text: string,
    pending: PendingAttachment[],
    options: TurnRunOptions = {}
  ): Promise<VmAgentMessage | undefined> {
    if (this.active) throw new Error("A turn is already running");
    const controller = new AbortController();
    this.active = controller;
    try {
      return await sendTurn(
        this.api,
        sessionId,
        text,
        pending,
        this.timeoutMs,
        controller.signal,
        options.renderer || new TurnRenderer(),
        options.onSubmitted
      );
    } finally {
      if (this.active === controller) this.active = undefined;
    }
  }
}
