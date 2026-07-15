import stringWidth from "string-width";
import type { SentaurusApi } from "./api.js";
import type { RunSummary } from "./types.js";

export const PROVISIONAL_SESSION_TITLE = "New session";

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function singleLine(value: string): string {
  return value
    .replace(/```[\s\S]*?```/gu, " ")
    .replace(/[`*_>#]/gu, " ")
    .replace(/[\u0000-\u001f\u007f-\u009f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function removePreamble(value: string): string {
  let result = value;
  const prefixes = [
    /^(?:你好|您好)[,，。!！?？\s]*/u,
    /^(?:我想(?:请)?(?:你)?|麻烦(?:你)?|请(?:你)?|能不能|能否|可以(?:请你)?)(?:帮我|帮忙|协助我)?(?:看看|看一下|分析一下|检查一下|处理一下)?[,，:：\s]*/u,
    /^(?:帮我|帮忙|协助我)(?:看看|看一下|分析一下|检查一下|处理一下)?[,，:：\s]*/u,
    /^(?:hi|hello|hey)[,!?.\s]*/iu,
    /^(?:(?:could|can|would)\s+you\s+(?:please\s+)?|please\s+)(?:help\s+me\s+)?/iu,
    /^(?:help\s+me\s+)?(?:take\s+a\s+look\s+at|look\s+into|check|analyze)\s+/iu
  ];
  let changed = true;
  while (changed && result) {
    changed = false;
    for (const prefix of prefixes) {
      const next = result.replace(prefix, "");
      if (next !== result) {
        result = next.trimStart();
        changed = true;
      }
    }
  }
  return result;
}

function redactSecrets(value: string): string {
  return value
    .replace(/\bBearer\s+\S+/giu, "Bearer [secret]")
    .replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|ghp_[A-Za-z0-9]{12,}|github_pat_[A-Za-z0-9_]{12,})\b/gu, "[secret]");
}

function truncateWidth(value: string, maxWidth: number): string {
  if (stringWidth(value) <= maxWidth) return value;
  const suffix = "...";
  let result = "";
  for (const part of segmenter.segment(value)) {
    if (stringWidth(result) + stringWidth(part.segment) + suffix.length > maxWidth) break;
    result += part.segment;
  }
  return `${result.trimEnd()}${suffix}`;
}

export function isProvisionalSessionTitle(title: string): boolean {
  return title.trim() === PROVISIONAL_SESSION_TITLE;
}

export function sessionTitleFromFirstPrompt(prompt: string, maxWidth = 48): string | undefined {
  const normalized = singleLine(prompt);
  if (!normalized) return /```/u.test(prompt) ? "Code task" : undefined;
  if (normalized.startsWith("/")) return undefined;
  let title = redactSecrets(removePreamble(normalized))
    .replace(/^为什么(?:这个|这段|我的)?\s*/u, "排查 ")
    .replace(/[。.!！?？,，;；:：\s]+$/gu, "")
    .trim();
  if (!title) title = PROVISIONAL_SESSION_TITLE;
  return truncateWidth(title, Math.max(16, maxWidth));
}

export async function applyProvisionalSessionTitle(
  api: SentaurusApi,
  session: RunSummary,
  prompt: string
): Promise<RunSummary> {
  if (!isProvisionalSessionTitle(session.title)) return session;
  const title = sessionTitleFromFirstPrompt(prompt);
  if (!title || title === session.title) return session;
  return api.updateRunTitle(session.id, title, AbortSignal.timeout(10_000));
}
