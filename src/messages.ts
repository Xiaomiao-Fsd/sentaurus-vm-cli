import type { VmAgentMessage } from "./types.js";

const worklogKinds = new Set([
  "worklog_summary",
  "file_operation",
  "tool_run",
  "run_progress",
  "run_diagnostic",
  "progress",
  "agent_thinking",
  "agent_reasoning_summary"
]);

export function messageKind(message: VmAgentMessage): string {
  return typeof message.meta?.kind === "string" ? message.meta.kind : "";
}

export function messageSessionId(message: VmAgentMessage): string | undefined {
  return typeof message.meta?.sessionId === "string" && message.meta.sessionId ? message.meta.sessionId : undefined;
}

export function messageTurnId(message: VmAgentMessage): string | undefined {
  const value = message.meta?.turnId || message.meta?.groupId;
  return typeof value === "string" && value ? value : undefined;
}

export function isWorklogMessage(message: VmAgentMessage): boolean {
  return worklogKinds.has(messageKind(message)) || message.meta?.foldable === true;
}

export function isReasoningSummary(message: VmAgentMessage): boolean {
  return messageKind(message) === "agent_reasoning_summary";
}

export function isAttachmentMessage(message: VmAgentMessage): boolean {
  return messageKind(message) === "vm_agent_attachments";
}

function streamState(message: VmAgentMessage): string {
  const value = message.meta?.streamState ?? message.meta?.status;
  return typeof value === "string" ? value.toLowerCase() : "";
}

export function isStreamDelta(message: VmAgentMessage): boolean {
  return message.role === "agent" && (messageKind(message) === "agent_response_delta" || message.meta?.delta === true);
}

export function isStreamDone(message: VmAgentMessage): boolean {
  if (message.role !== "agent") return false;
  const state = streamState(message);
  const kind = messageKind(message);
  return kind === "agent_response_done"
    || kind === "agent_response_error"
    || message.meta?.done === true
    || state === "done"
    || state === "completed"
    || state === "final"
    || state === "error";
}

export function isStreamingDraft(message: VmAgentMessage): boolean {
  if (message.role !== "agent") return false;
  if (isStreamDelta(message)) return true;
  if (isStreamDone(message)) return false;
  const state = streamState(message);
  return messageKind(message) === "agent_response_stream"
    || message.meta?.done === false
    || state === "queued"
    || state === "running"
    || state === "streaming";
}

export function streamTargetId(message: VmAgentMessage): string | undefined {
  if (!isStreamDelta(message) && !isStreamingDraft(message) && !isStreamDone(message)) return undefined;
  const value = message.meta?.targetMessageId || message.meta?.messageId || message.meta?.streamId || message.id;
  return typeof value === "string" && value ? value : undefined;
}

export function belongsToTurn(message: VmAgentMessage, sessionId: string, turnId?: string): boolean {
  const messageSession = messageSessionId(message);
  const messageTurn = messageTurnId(message);
  if (messageSession && messageSession !== sessionId) return false;
  if (!messageSession && (!turnId || messageTurn !== turnId)) return false;
  if (turnId && messageTurn && messageTurn !== turnId) return false;
  return true;
}

export function isFinalReply(message: VmAgentMessage): boolean {
  if (message.role === "system") {
    const kind = messageKind(message);
    return kind === "llm_error" || kind === "worker_error";
  }
  if (message.role !== "agent" || isWorklogMessage(message) || isStreamingDraft(message)) return false;
  const kind = messageKind(message);
  if (kind === "vm_agent_attachments" || kind === "agent_trace" || kind === "worker_ready") return false;
  return true;
}

function timeValue(message: VmAgentMessage): number {
  const value = Date.parse(message.createdAt);
  return Number.isFinite(value) ? value : 0;
}

export function mergeMessages(previous: VmAgentMessage[], incoming: VmAgentMessage[]): VmAgentMessage[] {
  const byId = new Map(previous.map((message) => [message.id, message]));
  for (const message of incoming) {
    const target = streamTargetId(message);
    if (target) {
      const existing = byId.get(target);
      const append = isStreamDelta(message) || message.meta?.append === true;
      const content = existing && append ? `${existing.content}${message.content}` : message.content || existing?.content || "";
      byId.set(target, {
        ...existing,
        ...message,
        id: target,
        role: "agent",
        content,
        createdAt: existing?.createdAt || message.createdAt,
        meta: {
          ...existing?.meta,
          ...message.meta,
          kind: isStreamDone(message) ? messageKind(message) || "agent_response_done" : "agent_response_stream",
          done: isStreamDone(message)
        }
      });
      continue;
    }
    const existing = byId.get(message.id);
    byId.set(message.id, existing ? { ...existing, ...message, meta: { ...existing.meta, ...message.meta } } : message);
  }
  return [...byId.values()].sort((left, right) => {
    if (left.sequence !== undefined && right.sequence !== undefined && left.sequence !== right.sequence) {
      return left.sequence - right.sequence;
    }
    return timeValue(left) - timeValue(right);
  });
}
