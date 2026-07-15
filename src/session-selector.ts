import { emitKeypressEvents } from "node:readline";
import process from "node:process";
import stringWidth from "string-width";
import type { RunSummary } from "./types.js";

type Key = {
  name?: string;
  ctrl?: boolean;
};

export type SessionSelectorInvocation = {
  includeAll: boolean;
  selector?: string;
  useLast: boolean;
  remainingArgs: readonly string[];
  interactiveCommand: boolean;
  json: boolean;
  inputIsTty: boolean;
  outputIsTty: boolean;
};

export type SessionSelectorLayout = {
  rows: string[];
  selectedRow: number;
  visibleStart: number;
  visibleCount: number;
};

export type SessionSelectorOptions = {
  archivedIds?: ReadonlySet<string>;
  currentId?: string;
  input?: NodeJS.ReadStream;
  output?: NodeJS.WriteStream;
  now?: Date;
  maxVisible?: number;
};

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function singleLine(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f-\u009f]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function truncateWidth(value: string, width: number): string {
  if (width <= 0) return "";
  const normalized = singleLine(value);
  if (stringWidth(normalized) <= width) return normalized;
  if (width <= 3) return ".".repeat(width);
  let result = "";
  for (const part of segmenter.segment(normalized)) {
    if (stringWidth(result) + stringWidth(part.segment) + 3 > width) break;
    result += part.segment;
  }
  return `${result}...`;
}

function padWidth(value: string, width: number): string {
  return `${value}${" ".repeat(Math.max(0, width - stringWidth(value)))}`;
}

function framedLine(value: string, panelWidth: number): string {
  const innerWidth = panelWidth - 2;
  return `|${padWidth(truncateWidth(value, innerWidth), innerWidth)}|`;
}

function border(label: string, panelWidth: number): string {
  const prefix = `+- ${label} `;
  if (stringWidth(prefix) + 1 > panelWidth) return `+${"-".repeat(panelWidth - 2)}+`;
  return `${prefix}${"-".repeat(panelWidth - stringWidth(prefix) - 1)}+`;
}

function shortSessionId(value: string): string {
  if (value.length <= 16) return value;
  return `${value.slice(0, 8)}...${value.slice(-5)}`;
}

export function formatSessionAge(value: string, now = new Date()): string {
  const updated = Date.parse(value);
  if (!Number.isFinite(updated)) return "unknown";
  const seconds = Math.max(0, Math.floor((now.getTime() - updated) / 1000));
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(updated).toISOString().slice(0, 10);
}

export function orderSessions(runs: readonly RunSummary[]): RunSummary[] {
  return runs.map((run, index) => ({ run, index })).sort((left, right) => {
    const leftTime = Date.parse(left.run.updatedAt) || Date.parse(left.run.createdAt) || 0;
    const rightTime = Date.parse(right.run.updatedAt) || Date.parse(right.run.createdAt) || 0;
    return rightTime - leftTime || left.index - right.index;
  }).map((item) => item.run);
}

export function shouldOpenSessionSelector(invocation: SessionSelectorInvocation): boolean {
  return invocation.includeAll
    && !invocation.selector
    && !invocation.useLast
    && invocation.remainingArgs.length === 0
    && invocation.interactiveCommand
    && !invocation.json
    && invocation.inputIsTty
    && invocation.outputIsTty;
}

export function layoutSessionSelector(
  runs: readonly RunSummary[],
  selectedIndex: number,
  archivedIds: ReadonlySet<string> = new Set(),
  columns = 80,
  maxVisible = 10,
  now = new Date()
): SessionSelectorLayout {
  if (!runs.length || maxVisible <= 0) {
    return { rows: [], selectedRow: -1, visibleStart: 0, visibleCount: 0 };
  }
  const terminalColumns = Math.max(20, Math.floor(columns || 80));
  const panelWidth = terminalColumns - 1;
  const innerWidth = panelWidth - 2;
  const selected = Math.max(0, Math.min(selectedIndex, runs.length - 1));
  const visibleCount = Math.min(Math.max(1, maxVisible), runs.length);
  const centered = selected - Math.floor(visibleCount / 2);
  const visibleStart = Math.max(0, Math.min(centered, runs.length - visibleCount));
  const visible = runs.slice(visibleStart, visibleStart + visibleCount);
  const titleCounts = new Map<string, number>();
  for (const run of runs) {
    const key = singleLine(run.title).toLocaleLowerCase();
    titleCounts.set(key, (titleCounts.get(key) || 0) + 1);
  }
  const rows = [border(`Select a session (${runs.length})`, panelWidth)];

  visible.forEach((run, index) => {
    const absoluteIndex = visibleStart + index;
    const marker = absoluteIndex === selected ? "> " : "  ";
    const archive = archivedIds.has(run.id) ? "A " : "  ";
    const age = formatSessionAge(run.updatedAt, now);
    const duplicateTitle = (titleCounts.get(singleLine(run.title).toLocaleLowerCase()) || 0) > 1;
    let metadata = duplicateTitle && innerWidth >= 38
      ? `${shortSessionId(run.id)}  ${age}`
      : innerWidth >= 94
      ? `${run.status}  ${age}  ${shortSessionId(run.id)}`
      : innerWidth >= 58
        ? `${run.status}  ${age}`
        : innerWidth >= 38
          ? age
          : "";
    const fixedWidth = stringWidth(marker) + stringWidth(archive);
    let titleWidth = innerWidth - fixedWidth;
    if (metadata) titleWidth -= stringWidth(metadata) + 2;
    if (titleWidth < 10) {
      metadata = "";
      titleWidth = innerWidth - fixedWidth;
    }
    const title = padWidth(truncateWidth(run.title || "Untitled session", titleWidth), titleWidth);
    const content = `${marker}${archive}${title}${metadata ? `  ${metadata}` : ""}`;
    rows.push(framedLine(content, panelWidth));
  });

  const range = runs.length > visibleCount
    ? `${visibleStart + 1}-${visibleStart + visibleCount}/${runs.length} | `
    : "";
  rows.push(framedLine(`${range}Up/Down select | Enter resume | Esc cancel`, panelWidth));
  rows.push(`+${"-".repeat(panelWidth - 2)}+`);
  return {
    rows,
    selectedRow: 1 + selected - visibleStart,
    visibleStart,
    visibleCount
  };
}

export function selectSession(
  runs: readonly RunSummary[],
  options: SessionSelectorOptions = {}
): Promise<RunSummary | undefined> {
  const input = options.input || process.stdin;
  const output = options.output || process.stdout;
  if (!input.isTTY || !output.isTTY) throw new Error("Session selection requires an interactive terminal");
  const ordered = orderSessions(runs);
  if (!ordered.length) throw new Error("No sessions. Create one with `vm-agent new`.");
  let selectedIndex = Math.max(0, ordered.findIndex((run) => run.id === options.currentId));

  return new Promise((resolve, reject) => {
    let layout: SessionSelectorLayout | undefined;
    let finished = false;
    const wasRaw = Boolean(input.isRaw);
    emitKeypressEvents(input);
    input.setRawMode?.(true);
    input.resume();
    output.write("\u001b[?25l");

    const clearRendered = () => {
      if (!layout?.rows.length) return;
      if (layout.rows.length > 1) output.write(`\u001b[${layout.rows.length - 1}A`);
      output.write("\r");
      layout.rows.forEach((_row, index) => {
        output.write("\u001b[2K");
        if (index + 1 < layout!.rows.length) output.write("\u001b[1B\r");
      });
      if (layout.rows.length > 1) output.write(`\u001b[${layout.rows.length - 1}A`);
      output.write("\r");
    };
    const render = () => {
      clearRendered();
      const terminalRows = typeof output.rows === "number" ? output.rows : 24;
      const maxVisible = Math.max(1, Math.min(options.maxVisible || 10, terminalRows - 5));
      layout = layoutSessionSelector(
        ordered,
        selectedIndex,
        options.archivedIds,
        output.columns || 80,
        maxVisible,
        options.now
      );
      const inverse = !process.env.NO_COLOR;
      output.write(layout.rows.map((row, index) =>
        inverse && index === layout!.selectedRow ? `\u001b[7m${row}\u001b[0m` : row
      ).join("\n"));
    };
    const cleanup = () => {
      input.off("keypress", onKeypress);
      output.off("resize", onResize);
      input.setRawMode?.(wasRaw);
      if (!wasRaw) input.pause();
      output.write("\u001b[?25h");
    };
    const finish = (session?: RunSummary) => {
      if (finished) return;
      finished = true;
      clearRendered();
      layout = undefined;
      cleanup();
      resolve(session);
    };
    const onResize = () => render();
    const onKeypress = (_text: string, key: Key) => {
      try {
        if (key.name === "up") selectedIndex = Math.max(0, selectedIndex - 1);
        else if (key.name === "down") selectedIndex = Math.min(ordered.length - 1, selectedIndex + 1);
        else if (key.name === "home") selectedIndex = 0;
        else if (key.name === "end") selectedIndex = ordered.length - 1;
        else if (key.name === "return" || key.name === "enter") {
          finish(ordered[selectedIndex]);
          return;
        } else if (key.name === "escape" || (key.ctrl && (key.name === "c" || key.name === "d"))) {
          finish();
          return;
        } else return;
        render();
      } catch (error) {
        cleanup();
        reject(error);
      }
    };

    input.on("keypress", onKeypress);
    output.on("resize", onResize);
    render();
  });
}
