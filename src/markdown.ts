import { Marked, type MarkedExtension } from "marked";
import { markedTerminal } from "marked-terminal";

function terminalWidth(columns?: number): number {
  const width = Number.isFinite(columns) && columns! > 0 ? Math.floor(columns!) : 100;
  return Math.max(16, Math.min(140, width - 2));
}

export function sanitizeTerminalText(value: string): string {
  return value
    .replace(/\r\n?/gu, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/gu, "");
}

export function renderMarkdown(markdown: string, columns = process.stdout.columns): string {
  const parser = new Marked(markedTerminal({
    emoji: false,
    reflowText: true,
    showSectionPrefix: false,
    tab: 2,
    width: terminalWidth(columns)
  }) as unknown as MarkedExtension);
  return String(parser.parse(sanitizeTerminalText(markdown), { async: false })).replace(/\n{3,}$/u, "\n\n");
}

type Fence = { character: "`" | "~"; length: number };

function fenceOpener(line: string): Fence | undefined {
  const indent = line.match(/^ */u)?.[0].length || 0;
  if (indent > 3) return undefined;
  const rest = line.slice(indent);
  const character = rest[0];
  if (character !== "`" && character !== "~") return undefined;
  let length = 0;
  while (rest[length] === character) length += 1;
  if (length < 3) return undefined;
  return { character, length };
}

function closesFence(line: string, opener: Fence): boolean {
  const indent = line.match(/^ */u)?.[0].length || 0;
  if (indent > 3) return false;
  const rest = line.slice(indent);
  let markerLength = 0;
  while (rest[markerLength] === opener.character) markerLength += 1;
  return markerLength >= opener.length && rest.slice(markerLength).trim() === "";
}

export function streamSafeBoundary(markdown: string): number | undefined {
  let openFence: Fence | undefined;
  let offset = 0;
  let boundary: number | undefined;
  for (const line of markdown.match(/.*(?:\n|$)/gu) || []) {
    if (!line) continue;
    const withoutNewline = line.replace(/\n$/u, "");
    if (openFence) {
      if (closesFence(withoutNewline, openFence)) {
        openFence = undefined;
        boundary = offset + line.length;
      }
    } else {
      const opener = fenceOpener(withoutNewline);
      if (opener) openFence = opener;
      else if (withoutNewline.trim() === "") boundary = offset + line.length;
    }
    offset += line.length;
  }
  return boundary;
}

export class MarkdownStream {
  private pending = "";

  push(delta: string, columns = process.stdout.columns): string {
    this.pending += delta;
    const boundary = streamSafeBoundary(this.pending);
    if (boundary === undefined || boundary <= 0) return "";
    const ready = this.pending.slice(0, boundary);
    this.pending = this.pending.slice(boundary);
    return renderMarkdown(ready, columns);
  }

  flush(columns = process.stdout.columns): string {
    if (!this.pending.trim()) {
      this.pending = "";
      return "";
    }
    const ready = this.pending;
    this.pending = "";
    return renderMarkdown(ready, columns);
  }
}
