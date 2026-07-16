import process from "node:process";
import { sanitizeTerminalText } from "./markdown.js";

export type ReasoningSummaryBufferOptions = {
  minChars?: number;
  maxChars?: number;
};

const segmenter = new Intl.Segmenter("zh-CN", { granularity: "grapheme" });

function graphemes(value: string): string[] {
  return [...segmenter.segment(value)].map((part) => part.segment);
}

export function reasoningSummaryLength(value: string): number {
  return graphemes(value).filter((part) => !/^\s$/u.test(part)).length;
}

export function normalizeReasoningSummary(value: string): string {
  return sanitizeTerminalText(value)
    .replace(/^\s*reasoning summary(?:\s+[^\n/]+\s*\/\s*[^\n]+)?\s*/iu, "")
    .replace(/^\s*#{1,6}\s*/gmu, "")
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gmu, "")
    .replace(/\*\*/gu, "")
    .replace(/\s+/gu, " ")
    .replace(/\s*([，。；：！？])\s*/gu, "$1")
    .trim();
}

function splitBlock(value: string, minChars: number, maxChars: number): [string, string] {
  const parts = graphemes(value);
  if (parts.length <= maxChars) return [value.trim(), ""];
  let splitAt = maxChars;
  for (let index = maxChars - 1; index >= minChars - 1; index -= 1) {
    if (/[。！？；.!?]/u.test(parts[index] || "")) {
      splitAt = index + 1;
      break;
    }
  }
  return [parts.slice(0, splitAt).join("").trim(), parts.slice(splitAt).join("").trim()];
}

export class ReasoningSummaryBuffer {
  private readonly minChars: number;
  private readonly maxChars: number;
  private readonly seen = new Set<string>();
  private pending = "";

  constructor(options: ReasoningSummaryBufferOptions = {}) {
    this.minChars = Math.max(40, Math.floor(options.minChars || 100));
    this.maxChars = Math.max(this.minChars, Math.floor(options.maxChars || 200));
  }

  push(value: string): string[] {
    const normalized = normalizeReasoningSummary(value);
    if (!normalized) return [];
    const key = normalized.toLocaleLowerCase();
    if (this.seen.has(key)) return [];
    this.seen.add(key);
    const separator = this.pending && !/[。！？；.!?]$/u.test(this.pending) ? "；" : " ";
    this.pending = `${this.pending}${separator}${normalized}`.trim();
    return this.drain(false);
  }

  flush(): string[] {
    return this.drain(true);
  }

  private drain(flush: boolean): string[] {
    const blocks: string[] = [];
    while (reasoningSummaryLength(this.pending) > this.maxChars) {
      const [block, rest] = splitBlock(this.pending, this.minChars, this.maxChars);
      if (block) blocks.push(block);
      this.pending = rest;
    }
    if (this.pending && (flush || reasoningSummaryLength(this.pending) >= this.minChars)) {
      blocks.push(this.pending);
      this.pending = "";
    }
    return blocks;
  }
}

export function reasoningSummarySeparator(columns = process.stdout.columns): string {
  const terminalColumns = Math.max(20, Math.floor(columns || 80));
  return "─".repeat(Math.max(16, Math.min(100, terminalColumns - 1)));
}
