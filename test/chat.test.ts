import assert from "node:assert/strict";
import test from "node:test";
import { splitCommandLine } from "../src/chat.js";

test("splitCommandLine preserves quoted Windows paths", () => {
  assert.deepEqual(
    splitCommandLine('/attach "C:\\My Files\\device.cmd" plain.txt'),
    ["/attach", "C:\\My Files\\device.cmd", "plain.txt"]
  );
});

test("splitCommandLine rejects an unclosed quote", () => {
  assert.throws(() => splitCommandLine('/attach "missing'), /Unclosed quote/);
});
