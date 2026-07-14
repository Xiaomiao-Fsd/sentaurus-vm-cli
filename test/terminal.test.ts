import assert from "node:assert/strict";
import test from "node:test";
import {
  askChatInput,
  inputBoxFrame,
  shouldRelaunchForWindowsUtf8,
  shouldUseWindowsUtf8CodePage
} from "../src/terminal.js";

test("Windows interactive terminals opt into the UTF-8 code page", () => {
  assert.equal(shouldUseWindowsUtf8CodePage("win32", true, true), true);
  assert.equal(shouldUseWindowsUtf8CodePage("win32", true, false), false);
  assert.equal(shouldUseWindowsUtf8CodePage("linux", true, true), false);
  assert.equal(shouldRelaunchForWindowsUtf8("win32", true, true, false), true);
  assert.equal(shouldRelaunchForWindowsUtf8("win32", true, true, true), false);
});

test("input box fits within the terminal and keeps stable borders", () => {
  const frame = inputBoxFrame(80);
  assert.equal(frame.width, 79);
  assert.equal(frame.top.length, frame.width);
  assert.equal(frame.middle.length, frame.width);
  assert.equal(frame.bottom.length, frame.width);
  assert.match(frame.top, /^╭─ Message /);
  assert.match(frame.bottom, /^╰─+╯$/);
});

test("boxed input returns Chinese text without transforming it", async () => {
  const writes: string[] = [];
  let prompt = "";
  const output = {
    isTTY: true,
    columns: 60,
    write(value: string | Uint8Array) {
      writes.push(String(value));
      return true;
    }
  } as NodeJS.WriteStream;
  const input = {
    isTTY: true,
    on() {},
    off() {}
  } as unknown as NodeJS.ReadStream;
  const readline = {
    cursor: 0,
    line: "",
    getCursorPos() {
      return { cols: 2, rows: 0 };
    },
    async question(value: string) {
      prompt = value;
      return "检查当前器件的阈值电压";
    }
  };

  const answer = await askChatInput(readline, input, output);
  assert.equal(answer, "检查当前器件的阈值电压");
  assert.match(prompt, /│/);
  assert.match(writes.join(""), /╭─ Message/);
  assert.match(writes.join(""), /╰─+╯/);
});
