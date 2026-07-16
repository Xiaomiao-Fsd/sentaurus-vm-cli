import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import stringWidth from "string-width";
import {
  InlineEditor,
  InputBuffer,
  layoutEditor,
  layoutInput,
  layoutSuggestionPanel,
  SuggestionController,
  type InputSuggestion
} from "../src/input-editor.js";

test("input buffer edits Chinese graphemes without corrupting cursor state", () => {
  const buffer = new InputBuffer();
  buffer.insert("检查器件");
  buffer.left();
  buffer.backspace();
  assert.equal(buffer.value, "检查件");
  buffer.insert("器");
  assert.equal(buffer.value, "检查器件");
});

test("input layout wraps deterministically and preserves explicit newlines", () => {
  const layout = layoutInput("中文输入\nsecond line", "中文输入".length, 20);
  assert.equal(layout.rows.length, 2);
  assert.equal(layout.rows[0], "> 中文输入");
  assert.equal(layout.rows[1], "| second line");
  assert.equal(layout.cursorRow, 0);
  assert.equal(layout.cursorColumn, 10);

  const edge = layoutInput("123456789012345678", 18, 20);
  assert.deepEqual(edge.rows, ["> 12345678901234567", "| 8"]);
  assert.equal(edge.cursorRow, 1);
});

test("suggestion panel keeps the selected row visible and fits narrow terminals", () => {
  const suggestions: InputSuggestion[] = Array.from({ length: 12 }, (_, index) => ({
    label: `/command-${index}`,
    replacement: `/command-${index}`,
    description: `Description for command ${index}`
  }));
  const panel = layoutSuggestionPanel(suggestions, 10, 32, 8);
  assert.equal(panel.visibleStart, 4);
  assert.equal(panel.visibleCount, 8);
  assert.equal(panel.selectedRow, 7);
  assert.ok(panel.rows.every((row) => stringWidth(row) <= 31));
  assert.match(panel.rows[0] || "", /Commands/);
  assert.match(panel.rows[panel.selectedRow] || "", />/);
  assert.match(panel.rows.at(-1) || "", /5-12\/12/);

  const layout = layoutEditor("/c", 2, suggestions, 10, 20, 4);
  assert.equal(layout.inputRowCount, 1);
  assert.equal(layout.panelRowCount, 6);
  assert.ok(layout.rows.every((row) => stringWidth(row) <= 19));
});

test("suggestion selection wraps, dismisses, and reopens after input changes", () => {
  const controller = new SuggestionController();
  assert.equal(controller.visible("/", 3), true);
  assert.equal(controller.move("/", 3, -1), 2);
  assert.equal(controller.move("/", 3, 1), 0);
  controller.dismiss("/");
  assert.equal(controller.visible("/", 3), false);
  assert.equal(controller.visible("/g", 1), true);
  assert.equal(controller.selectedIndex, 0);
});

test("inline editor uses arrows for the palette and for history when the palette is closed", async () => {
  const input = new PassThrough() as PassThrough & NodeJS.ReadStream;
  const output = new PassThrough() as PassThrough & NodeJS.WriteStream;
  Object.assign(input, {
    isTTY: true,
    isRaw: false,
    setRawMode(value: boolean) {
      this.isRaw = value;
      return this;
    }
  });
  Object.assign(output, { isTTY: true, columns: 80 });
  let rendered = "";
  output.on("data", (chunk) => { rendered += chunk.toString(); });
  const suggestions = (value: string): InputSuggestion[] => {
    if (value === "/") return [
      { label: "/help", replacement: "/help ", description: "Show commands" },
      { label: "/plan", replacement: "/plan ", description: "Manage plan mode" }
    ];
    if (value === "/plan ") return [
      { label: "/plan show", replacement: "/plan show", description: "Show the plan" }
    ];
    return [];
  };
  const editor = new InlineEditor((value) => suggestions(value), input, output);
  const key = (
    text: string,
    name?: string,
    modifiers: { ctrl?: boolean; meta?: boolean; shift?: boolean } = {}
  ) => input.emit("keypress", text, { name, ...modifiers });

  const first = editor.read();
  key("past");
  key("\r", "return");
  assert.deepEqual(await first, { type: "submit", value: "past" });

  const history = editor.read();
  key("", "up");
  key("\r", "return");
  assert.deepEqual(await history, { type: "submit", value: "past" });

  const palette = editor.read();
  key("/");
  output.columns = 32;
  output.emit("resize");
  key("", "down");
  key("\t", "tab");
  key("\t", "tab");
  key("\r", "return");
  assert.deepEqual(await palette, { type: "submit", value: "/plan show" });
  assert.match(rendered, /Commands/);
  assert.match(rendered, /Manage plan mode/);
  assert.match(rendered, /Show the plan/);

  const reopened = editor.read();
  key("/");
  key("", "escape");
  key("\t", "tab");
  key("\r", "return");
  assert.deepEqual(await reopened, { type: "submit", value: "/help " });

  const clipboardPaste = editor.read();
  key("draft");
  key("", "v", { ctrl: true, meta: true });
  assert.deepEqual(await clipboardPaste, {
    type: "paste-image",
    draft: { value: "draft", cursor: 5 }
  });

  const resumed = editor.read({ value: "draft", cursor: 2 });
  key("X");
  key("\r", "return");
  assert.deepEqual(await resumed, { type: "submit", value: "drXaft" });
  editor.close();
});

function ttyStreams(): { input: PassThrough & NodeJS.ReadStream; output: PassThrough & NodeJS.WriteStream } {
  const input = new PassThrough() as PassThrough & NodeJS.ReadStream;
  const output = new PassThrough() as PassThrough & NodeJS.WriteStream;
  Object.assign(input, {
    isTTY: true,
    isRaw: false,
    setRawMode(value: boolean) {
      this.isRaw = value;
      return this;
    }
  });
  Object.assign(output, { isTTY: true, columns: 80 });
  return { input, output };
}

async function nextInputTick(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

async function waitForKeypressListener(input: PassThrough): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (input.listenerCount("keypress") > 0) return;
    await nextInputTick();
  }
  assert.fail("Inline editor did not install its keypress listener");
}

test("inline editor restores submitted prompts from persistent history", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "sentaurus-vm-history-test-"));
  const historyPath = path.join(directory, "input-history.jsonl");
  try {
    const firstStreams = ttyStreams();
    const firstEditor = new InlineEditor(() => [], firstStreams.input, firstStreams.output, { historyPath });
    const first = firstEditor.read();
    await waitForKeypressListener(firstStreams.input);
    firstStreams.input.emit("keypress", "first prompt", {});
    firstStreams.input.emit("keypress", "\r", { name: "return" });
    assert.deepEqual(await first, { type: "submit", value: "first prompt" });
    await firstEditor.flushHistory();
    firstEditor.close();

    const secondStreams = ttyStreams();
    const secondEditor = new InlineEditor(() => [], secondStreams.input, secondStreams.output, { historyPath });
    const restored = secondEditor.read();
    await waitForKeypressListener(secondStreams.input);
    secondStreams.input.emit("keypress", "", { name: "up" });
    secondStreams.input.emit("keypress", "\r", { name: "return" });
    assert.deepEqual(await restored, { type: "submit", value: "first prompt" });
    secondEditor.close();

    assert.equal((await readFile(historyPath, "utf8")).trim(), JSON.stringify("first prompt"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("inline editor skips malformed persistent history lines", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "sentaurus-vm-history-test-"));
  const historyPath = path.join(directory, "input-history.jsonl");
  try {
    await writeFile(historyPath, `${JSON.stringify("valid prompt")}\nnot json\n${JSON.stringify(42)}\n`, "utf8");
    const streams = ttyStreams();
    const editor = new InlineEditor(() => [], streams.input, streams.output, { historyPath });
    const restored = editor.read();
    await waitForKeypressListener(streams.input);
    streams.input.emit("keypress", "", { name: "up" });
    streams.input.emit("keypress", "\r", { name: "return" });
    assert.deepEqual(await restored, { type: "submit", value: "valid prompt" });
    editor.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
