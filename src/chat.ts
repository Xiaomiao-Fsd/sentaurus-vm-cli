import { writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { SentaurusApi } from "./api.js";
import { uploadAttachments } from "./attachments.js";
import type { ChatOptions, OneShotChatResult } from "./chat-options.js";
import { ReplApp } from "./repl.js";
import { resolveSession } from "./session-controller.js";
import { applyProvisionalSessionTitle } from "./session-title.js";
import { sendTurn } from "./turn-controller.js";
import { JsonlTurnRenderer, printBanner, style, TurnRenderer } from "./ui.js";
import { updateStoredConfig } from "./config.js";

export type { ChatOptions, OneShotChatResult } from "./chat-options.js";
export { splitCommandLine } from "./commands.js";
export { findRun, resolveSession } from "./session-controller.js";
export { sendTurn, waitForReply } from "./turn-controller.js";

export async function oneShotChat(
  api: SentaurusApi,
  message: string,
  options: ChatOptions,
  fallbackSessionId?: string
): Promise<OneShotChatResult> {
  let session = await resolveSession(
    api,
    options.sessionId,
    fallbackSessionId,
    options.title,
    options.archivedSessionIds
  );
  await updateStoredConfig({ lastSessionId: session.id }, options.configPath);
  const status = options.initialStatus || await api.status();
  const workflow = status.capabilities?.includes("session_workflow_v1")
    ? await api.workflow(session.id).then((result) => result.workflow).catch(() => undefined)
    : undefined;
  if (options.outputMode === "jsonl") {
    process.stdout.write(`${JSON.stringify({ type: "session.started", session, status, workflow: workflow || null })}\n`);
  } else {
    printBanner(api.baseUrl, session, status, workflow);
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
    renderer,
    async () => {
      try {
        session = await applyProvisionalSessionTitle(api, session, message);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        process.stderr.write(`${style.dim(`Could not update the session title (${detail}).`)}\n`);
      }
    }
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
  await new ReplApp(api, options, fallbackSessionId).run();
}
