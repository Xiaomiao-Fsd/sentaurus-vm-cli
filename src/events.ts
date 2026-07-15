import type { VmAgentMessage, VmAgentMessageAttachment } from "./types.js";
import {
  belongsToTurn,
  isAttachmentMessage,
  isFinalReply,
  isReasoningSummary,
  isStreamDelta,
  isStreamDone,
  isWorklogMessage,
  mergeMessages,
  messageKind,
  messageTurnId,
  streamTargetId
} from "./messages.js";

export type CliEvent =
  | { type: "worklog"; phase: string; text: string; message: VmAgentMessage }
  | { type: "reasoning.summary"; stage: string; status: string; text: string; message: VmAgentMessage }
  | {
      type: "attachments";
      runId?: string;
      attachments: Array<Partial<VmAgentMessageAttachment>>;
      text: string;
      message: VmAgentMessage;
    }
  | { type: "response.delta"; text: string; message: VmAgentMessage }
  | { type: "response.completed"; text: string; streamed: boolean; message: VmAgentMessage }
  | { type: "error"; text: string; message: VmAgentMessage }
  | { type: "notice"; text: string; message: VmAgentMessage };

export type TurnEventBatch = {
  events: CliEvent[];
  complete: boolean;
  finalMessage?: VmAgentMessage;
};

export class TurnEventReducer {
  private readonly seen = new Set<string>();
  private readonly streamContent = new Map<string, string>();
  private merged: VmAgentMessage[] = [];

  consume(messages: VmAgentMessage[], sessionId: string, turnId?: string): TurnEventBatch {
    const accepted = messages.filter((message) => belongsToTurn(message, sessionId, turnId));
    this.merged = mergeMessages(this.merged, accepted);
    const events: CliEvent[] = [];
    let complete = false;

    for (const message of accepted) {
      const fingerprint = [
        message.id,
        messageKind(message),
        message.content,
        message.meta?.done,
        message.meta?.streamState
      ].join("\u0000");
      if (this.seen.has(fingerprint)) continue;
      this.seen.add(fingerprint);
      if (message.role === "user") continue;

      if (isReasoningSummary(message)) {
        const text = message.content.trim();
        if (text) {
          events.push({
            type: "reasoning.summary",
            stage: String(message.meta?.thinkingStage || message.meta?.phase || "summary"),
            status: String(message.meta?.thinkingStatus || message.meta?.status || "completed"),
            text,
            message
          });
        }
        continue;
      }

      if (isWorklogMessage(message)) {
        const text = message.content.trim();
        if (text) {
          events.push({
            type: "worklog",
            phase: String(message.meta?.phase || message.meta?.status || messageKind(message) || "work"),
            text,
            message
          });
        }
        continue;
      }

      if (isAttachmentMessage(message)) {
        events.push({
          type: "attachments",
          ...(typeof message.meta?.runId === "string" && message.meta.runId ? { runId: message.meta.runId } : {}),
          attachments: Array.isArray(message.attachments) ? message.attachments : [],
          text: message.content.trim(),
          message
        });
        continue;
      }

      const target = streamTargetId(message);
      if (target) {
        const previous = this.streamContent.get(target) || "";
        const append = isStreamDelta(message) || message.meta?.append === true;
        const next = append ? `${previous}${message.content}` : message.content || previous;
        const suffix = next.startsWith(previous) ? next.slice(previous.length) : next;
        if (suffix) events.push({ type: "response.delta", text: suffix, message });
        this.streamContent.set(target, next);
        if (isStreamDone(message)) {
          const merged = this.merged.find((item) => item.id === target) || message;
          events.push({ type: "response.completed", text: next, streamed: true, message: merged });
          complete = true;
        }
        continue;
      }

      const text = message.content.trim();
      if (message.role === "system") {
        if (text) events.push({ type: "error", text, message });
      } else if (isFinalReply(message)) {
        if (text) events.push({ type: "response.completed", text, streamed: false, message });
      } else if (text) {
        events.push({ type: "notice", text, message });
      }
      if (isFinalReply(message)) complete = true;
    }

    const finalMessage = this.finalMessage();
    return { events, complete, ...(finalMessage ? { finalMessage } : {}) };
  }

  finalMessage(): VmAgentMessage | undefined {
    return [...this.merged].reverse().find((message) => isFinalReply(message));
  }

  eventEnvelope(event: CliEvent, sessionId: string, turnId?: string): Record<string, unknown> {
    return {
      type: event.type,
      sessionId,
      turnId: turnId || messageTurnId(event.message) || null,
      ...(event.type === "worklog" ? { phase: event.phase } : {}),
      ...(event.type === "reasoning.summary" ? { stage: event.stage, status: event.status } : {}),
      ...(event.type === "attachments" ? {
        runId: event.runId || null,
        attachments: event.attachments
      } : {}),
      text: event.text,
      message: event.message
    };
  }
}
