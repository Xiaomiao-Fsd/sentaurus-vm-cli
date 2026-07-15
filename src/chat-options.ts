import type { RunSummary, VmAgentMessage, VmAgentStatus } from "./types.js";

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
