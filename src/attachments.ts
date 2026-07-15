import { access } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { SentaurusApi } from "./api.js";
import type { VmAgentAttachmentRef, VmAgentMessageAttachment, VmSessionOutputFile } from "./types.js";
import { style } from "./ui.js";

export type PendingAttachment = {
  ref: VmAgentAttachmentRef;
  display: VmAgentMessageAttachment;
};

export async function uploadAttachments(
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

export function matchingFile(files: VmSessionOutputFile[], selector: string): VmSessionOutputFile {
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
