import { emitKeypressEvents } from "node:readline";
import { createInterface, type Interface } from "node:readline/promises";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import stringWidth from "string-width";

export type ReadOutcome =
  | { type: "submit"; value: string }
  | { type: "paste-image"; draft: InputDraft }
  | { type: "cancel" }
  | { type: "exit" };

export type InputDraft = {
  value: string;
  cursor: number;
};

export type InputSuggestion = {
  label: string;
  replacement: string;
  description: string;
};

export type InputEditorOptions = {
  historyPath?: string;
  historyLimit?: number;
};

type Key = {
  name?: string;
  sequence?: string;
  ctrl?: boolean;
  shift?: boolean;
  meta?: boolean;
};

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function graphemeStarts(value: string): number[] {
  return [...segmenter.segment(value)].map((part) => part.index);
}

function previousGrapheme(value: string, cursor: number): number {
  const starts = graphemeStarts(value).filter((index) => index < cursor);
  return starts.at(-1) ?? 0;
}

function nextGrapheme(value: string, cursor: number): number {
  return graphemeStarts(value).find((index) => index > cursor) ?? value.length;
}

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
  const missing = Math.max(0, width - stringWidth(value));
  return `${value}${" ".repeat(missing)}`;
}

export class InputBuffer {
  value = "";
  cursor = 0;

  replace(value: string): void {
    this.value = value;
    this.cursor = value.length;
  }

  insert(value: string): void {
    this.value = `${this.value.slice(0, this.cursor)}${value}${this.value.slice(this.cursor)}`;
    this.cursor += value.length;
  }

  backspace(): void {
    if (this.cursor <= 0) return;
    const previous = previousGrapheme(this.value, this.cursor);
    this.value = `${this.value.slice(0, previous)}${this.value.slice(this.cursor)}`;
    this.cursor = previous;
  }

  delete(): void {
    if (this.cursor >= this.value.length) return;
    const next = nextGrapheme(this.value, this.cursor);
    this.value = `${this.value.slice(0, this.cursor)}${this.value.slice(next)}`;
  }

  left(): void {
    this.cursor = previousGrapheme(this.value, this.cursor);
  }

  right(): void {
    this.cursor = nextGrapheme(this.value, this.cursor);
  }

  clearBeforeCursor(): void {
    this.value = this.value.slice(this.cursor);
    this.cursor = 0;
  }

  clearAfterCursor(): void {
    this.value = this.value.slice(0, this.cursor);
  }
}

export type InputLayout = {
  rows: string[];
  cursorRow: number;
  cursorColumn: number;
};

export type SuggestionPanelLayout = {
  rows: string[];
  selectedRow: number;
  visibleStart: number;
  visibleCount: number;
};

export type EditorLayout = InputLayout & {
  inputRowCount: number;
  panelRowCount: number;
  selectedRow?: number;
};

export function layoutInput(value: string, cursor: number, columns = 80): InputLayout {
  const terminalColumns = Math.max(20, Math.floor(columns || 80));
  const width = terminalColumns - 1;
  const rows = ["> "];
  let row = 0;
  let column = 2;
  let cursorRow = 0;
  let cursorColumn = 2;
  const parts = [...segmenter.segment(value)];

  for (const part of parts) {
    if (part.index === cursor) {
      cursorRow = row;
      cursorColumn = column;
    }
    const grapheme = part.segment;
    if (grapheme === "\n") {
      rows.push("| ");
      row += 1;
      column = 2;
      continue;
    }
    const graphemeWidth = Math.max(0, stringWidth(grapheme));
    if (column + graphemeWidth > width) {
      rows.push("| ");
      row += 1;
      column = 2;
    }
    rows[row] += grapheme;
    column += graphemeWidth;
  }
  if (cursor === value.length) {
    cursorRow = row;
    cursorColumn = column;
  }
  return { rows, cursorRow, cursorColumn };
}

export function layoutSuggestionPanel(
  suggestions: readonly InputSuggestion[],
  selectedIndex: number,
  columns = 80,
  maxVisible = 8
): SuggestionPanelLayout {
  if (!suggestions.length || maxVisible <= 0) {
    return { rows: [], selectedRow: -1, visibleStart: 0, visibleCount: 0 };
  }
  const terminalColumns = Math.max(20, Math.floor(columns || 80));
  const panelWidth = terminalColumns - 1;
  const innerWidth = panelWidth - 2;
  const selected = Math.max(0, Math.min(selectedIndex, suggestions.length - 1));
  const visibleCount = Math.min(Math.max(1, maxVisible), suggestions.length);
  const centered = selected - Math.floor(visibleCount / 2);
  const visibleStart = Math.max(0, Math.min(centered, suggestions.length - visibleCount));
  const visible = suggestions.slice(visibleStart, visibleStart + visibleCount);
  const contentWidth = innerWidth - 2;
  const longestLabel = Math.max(...visible.map((item) => stringWidth(singleLine(item.label))));
  const labelWidth = Math.min(longestLabel, Math.max(8, Math.floor(contentWidth * 0.45)));
  const descriptionWidth = contentWidth - labelWidth - 2;
  const topPrefix = "+- Commands ";
  const top = `${topPrefix}${"-".repeat(Math.max(0, panelWidth - stringWidth(topPrefix) - 1))}+`;
  const rows = [top];

  visible.forEach((suggestion, index) => {
    const absoluteIndex = visibleStart + index;
    const marker = absoluteIndex === selected ? "> " : "  ";
    let content: string;
    if (descriptionWidth >= 8) {
      const label = padWidth(truncateWidth(suggestion.label, labelWidth), labelWidth);
      content = `${marker}${label}  ${truncateWidth(suggestion.description, descriptionWidth)}`;
    } else {
      content = `${marker}${truncateWidth(suggestion.label, contentWidth)}`;
    }
    rows.push(`|${padWidth(content, innerWidth)}|`);
  });
  const range = suggestions.length > visibleCount
    ? ` ${visibleStart + 1}-${visibleStart + visibleCount}/${suggestions.length} `
    : "";
  rows.push(`+${"-".repeat(Math.max(0, innerWidth - stringWidth(range)))}${range}+`);
  return {
    rows,
    selectedRow: 1 + selected - visibleStart,
    visibleStart,
    visibleCount
  };
}

export function layoutEditor(
  value: string,
  cursor: number,
  suggestions: readonly InputSuggestion[],
  selectedIndex: number,
  columns = 80,
  maxVisible = 8
): EditorLayout {
  const input = layoutInput(value, cursor, columns);
  const panel = layoutSuggestionPanel(suggestions, selectedIndex, columns, maxVisible);
  return {
    rows: [...input.rows, ...panel.rows],
    cursorRow: input.cursorRow,
    cursorColumn: input.cursorColumn,
    inputRowCount: input.rows.length,
    panelRowCount: panel.rows.length,
    ...(panel.selectedRow >= 0 ? { selectedRow: input.rows.length + panel.selectedRow } : {})
  };
}

export class SuggestionController {
  selectedIndex = 0;
  private value = "";
  private dismissedValue: string | undefined;

  visible(value: string, count: number): boolean {
    this.synchronize(value, count);
    return count > 0 && this.dismissedValue !== value;
  }

  move(value: string, count: number, delta: number): number {
    this.synchronize(value, count);
    if (count <= 0) return this.selectedIndex;
    this.dismissedValue = undefined;
    this.selectedIndex = (this.selectedIndex + delta + count) % count;
    return this.selectedIndex;
  }

  dismiss(value: string): void {
    this.value = value;
    this.dismissedValue = value;
  }

  reset(value: string): void {
    this.value = value;
    this.selectedIndex = 0;
    this.dismissedValue = undefined;
  }

  private synchronize(value: string, count: number): void {
    if (value !== this.value) {
      this.value = value;
      this.selectedIndex = 0;
      if (this.dismissedValue !== value) this.dismissedValue = undefined;
    }
    if (count <= 0) this.selectedIndex = 0;
    else this.selectedIndex = Math.min(this.selectedIndex, count - 1);
  }
}

export class InlineEditor {
  private readonly history: string[] = [];
  private readonly historyPath: string | undefined;
  private readonly historyLimit: number;
  private historyLoaded?: Promise<void>;
  private historyWrites = Promise.resolve();
  private fallback?: Interface;
  private closed = false;
  private interruptCurrent: (() => void) | undefined;

  constructor(
    private readonly suggestionProvider: (value: string, cursor: number) => readonly InputSuggestion[],
    private readonly input: NodeJS.ReadStream = process.stdin,
    private readonly output: NodeJS.WriteStream = process.stdout,
    options: InputEditorOptions = {}
  ) {
    this.historyPath = options.historyPath;
    this.historyLimit = Math.max(1, Math.floor(options.historyLimit || 500));
    if (!input.isTTY || !output.isTTY) {
      this.fallback = createInterface({ input, output, terminal: false });
    }
  }

  async read(initialDraft?: InputDraft): Promise<ReadOutcome> {
    if (this.closed) return { type: "exit" };
    if (this.historyPath) await this.loadHistory();
    if (this.fallback) {
      try {
        const value = await this.fallback.question("> ");
        this.pushHistory(value);
        return { type: "submit", value };
      } catch {
        return { type: "exit" };
      }
    }
    return this.readRaw(initialDraft);
  }

  close(): void {
    this.closed = true;
    this.interruptCurrent?.();
    this.fallback?.close();
  }

  async flushHistory(): Promise<void> {
    await this.historyWrites;
  }

  interrupt(): boolean {
    if (this.interruptCurrent) {
      this.interruptCurrent();
      return true;
    }
    if (this.fallback) {
      this.closed = true;
      this.fallback.close();
      return true;
    }
    return false;
  }

  private pushHistory(value: string): void {
    const normalized = value.trim();
    if (!normalized || this.history.at(-1) === value) return;
    this.history.push(value);
    if (this.history.length > this.historyLimit) this.history.splice(0, this.history.length - this.historyLimit);
    this.persistHistory(value);
  }

  private async loadHistory(): Promise<void> {
    if (this.historyLoaded) return this.historyLoaded;
    this.historyLoaded = (async () => {
      if (!this.historyPath) return;
      try {
        const content = await readFile(this.historyPath, "utf8");
        const values = content.split(/\r?\n/u).flatMap((line) => {
          if (!line.trim()) return [];
          try {
            const value: unknown = JSON.parse(line);
            return typeof value === "string" && value.trim() ? [value] : [];
          } catch {
            return [];
          }
        });
        this.history.push(...values.slice(-this.historyLimit));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") return;
      }
    })();
    return this.historyLoaded;
  }

  private persistHistory(value: string): void {
    if (!this.historyPath) return;
    const snapshot = `${this.history.map((item) => JSON.stringify(item)).join("\n")}\n`;
    this.historyWrites = this.historyWrites.then(async () => {
      await mkdir(path.dirname(this.historyPath!), { recursive: true });
      await writeFile(this.historyPath!, snapshot, { encoding: "utf8", mode: 0o600 });
    }).catch(() => undefined);
  }

  private readRaw(initialDraft?: InputDraft): Promise<ReadOutcome> {
    return new Promise((resolve, reject) => {
      const buffer = new InputBuffer();
      if (initialDraft) {
        buffer.replace(initialDraft.value);
        buffer.cursor = Math.max(0, Math.min(initialDraft.cursor, buffer.value.length));
      }
      const palette = new SuggestionController();
      let historyIndex = this.history.length;
      let historyDraft = "";
      let reverseIndex = this.history.length;
      let layout: EditorLayout | undefined;
      let finished = false;
      const wasRaw = Boolean(this.input.isRaw);
      const inverseSelection = !process.env.NO_COLOR;
      emitKeypressEvents(this.input);
      this.input.setRawMode?.(true);
      this.input.resume();

      const availableSuggestions = (): InputSuggestion[] => {
        if (buffer.cursor !== buffer.value.length) return [];
        const candidates = [...this.suggestionProvider(buffer.value, buffer.cursor)];
        return palette.visible(buffer.value, candidates.length) ? candidates : [];
      };
      const moveToTop = () => {
        if (!layout) return;
        if (layout.cursorRow > 0) this.output.write(`\u001b[${layout.cursorRow}A`);
        this.output.write("\r");
      };
      const clearRendered = () => {
        if (!layout) return;
        moveToTop();
        layout.rows.forEach((_row, index) => {
          this.output.write("\u001b[2K");
          if (index + 1 < layout!.rows.length) this.output.write("\u001b[1B\r");
        });
        if (layout.rows.length > 1) this.output.write(`\u001b[${layout.rows.length - 1}A`);
        this.output.write("\r");
      };
      const render = () => {
        clearRendered();
        const suggestions = availableSuggestions();
        layout = layoutEditor(
          buffer.value,
          buffer.cursor,
          suggestions,
          palette.selectedIndex,
          this.output.columns || 80
        );
        const rows = layout.rows.map((row, index) =>
          inverseSelection && index === layout!.selectedRow ? `\u001b[7m${row}\u001b[0m` : row
        );
        this.output.write(rows.join("\n"));
        const up = layout.rows.length - 1 - layout.cursorRow;
        if (up > 0) this.output.write(`\u001b[${up}A`);
        this.output.write("\r");
        if (layout.cursorColumn > 0) this.output.write(`\u001b[${layout.cursorColumn}C`);
      };
      const cleanup = () => {
        this.input.off("keypress", onKeypress);
        this.output.off("resize", onResize);
        this.input.setRawMode?.(wasRaw);
        if (!wasRaw) this.input.pause();
        this.interruptCurrent = undefined;
      };
      const finish = (outcome: ReadOutcome) => {
        if (finished) return;
        if (layout?.panelRowCount) {
          palette.dismiss(buffer.value);
          render();
        }
        finished = true;
        if (layout) {
          const down = layout.rows.length - 1 - layout.cursorRow;
          if (down > 0) this.output.write(`\u001b[${down}B`);
        }
        this.output.write("\r\n");
        cleanup();
        if (outcome.type === "submit") this.pushHistory(outcome.value);
        resolve(outcome);
      };
      this.interruptCurrent = () => finish({ type: "exit" });
      const onResize = () => render();
      const onKeypress = (text: string, key: Key) => {
        try {
          if (key.ctrl && key.name === "c") {
            if (buffer.value) {
              buffer.replace("");
              palette.reset("");
              render();
              return;
            }
            finish({ type: "exit" });
            return;
          }
          if (key.ctrl && key.name === "d" && !buffer.value) {
            finish({ type: "exit" });
            return;
          }
          if (key.ctrl && key.name?.toLowerCase() === "v") {
            finish({
              type: "paste-image",
              draft: { value: buffer.value, cursor: buffer.cursor }
            });
            return;
          }
          if (key.name === "escape") {
            const suggestions = availableSuggestions();
            if (suggestions.length) {
              palette.dismiss(buffer.value);
              render();
            }
            return;
          }
          if ((key.shift && (key.name === "return" || key.name === "enter")) || (key.ctrl && key.name === "j")) {
            buffer.insert("\n");
          } else if (key.name === "return" || key.name === "enter") {
            finish({ type: "submit", value: buffer.value });
            return;
          } else if (key.name === "backspace") {
            buffer.backspace();
          } else if (key.name === "delete" || (key.ctrl && key.name === "d")) {
            buffer.delete();
          } else if (key.name === "left") {
            buffer.left();
          } else if (key.name === "right") {
            buffer.right();
          } else if (key.name === "home" || (key.ctrl && key.name === "a")) {
            buffer.cursor = 0;
          } else if (key.name === "end" || (key.ctrl && key.name === "e")) {
            buffer.cursor = buffer.value.length;
          } else if (key.ctrl && key.name === "u") {
            buffer.clearBeforeCursor();
          } else if (key.ctrl && key.name === "k") {
            buffer.clearAfterCursor();
          } else if (key.name === "up") {
            const suggestions = availableSuggestions();
            if (suggestions.length) {
              palette.move(buffer.value, suggestions.length, -1);
              render();
              return;
            }
            if (historyIndex === this.history.length) historyDraft = buffer.value;
            if (historyIndex > 0) historyIndex -= 1;
            buffer.replace(this.history[historyIndex] ?? historyDraft);
          } else if (key.name === "down") {
            const suggestions = availableSuggestions();
            if (suggestions.length) {
              palette.move(buffer.value, suggestions.length, 1);
              render();
              return;
            }
            if (historyIndex < this.history.length) historyIndex += 1;
            buffer.replace(historyIndex === this.history.length ? historyDraft : this.history[historyIndex] || "");
          } else if (key.ctrl && key.name === "r") {
            const query = buffer.value;
            const matchIndex = this.history.map((value, index) => ({ value, index }))
              .slice(0, reverseIndex).reverse().find((item) => item.value.includes(query))?.index;
            if (matchIndex !== undefined) {
              reverseIndex = matchIndex;
              buffer.replace(this.history[matchIndex] || "");
            }
          } else if (key.name === "tab") {
            let suggestions = availableSuggestions();
            if (!suggestions.length && buffer.cursor === buffer.value.length) {
              const candidates = [...this.suggestionProvider(buffer.value, buffer.cursor)];
              if (candidates.length) {
                palette.reset(buffer.value);
                suggestions = candidates;
              }
            }
            const selected = suggestions[palette.selectedIndex];
            if (selected) {
              buffer.replace(selected.replacement);
              palette.reset(buffer.value);
              if (!selected.replacement.endsWith(" ")) palette.dismiss(buffer.value);
              render();
              return;
            }
          } else if (!key.ctrl && !key.meta && text && !text.includes("\u001b") && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text)) {
            buffer.insert(text);
          }
          render();
        } catch (error) {
          cleanup();
          reject(error);
        }
      };

      this.input.on("keypress", onKeypress);
      this.output.on("resize", onResize);
      render();
    });
  }
}
