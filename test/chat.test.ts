import assert from "node:assert/strict";
import test from "node:test";
import { findRun, splitCommandLine } from "../src/chat.js";
import type { RunSummary } from "../src/types.js";

test("splitCommandLine preserves quoted Windows paths", () => {
  assert.deepEqual(
    splitCommandLine('/attach "C:\\My Files\\device.cmd" plain.txt'),
    ["/attach", "C:\\My Files\\device.cmd", "plain.txt"]
  );
});

test("splitCommandLine rejects an unclosed quote", () => {
  assert.throws(() => splitCommandLine('/attach "missing'), /Unclosed quote/);
});

test("findRun resolves ids, prefixes, and exact titles", () => {
  const runs: RunSummary[] = [
    { id: "run_alpha_123", status: "created", createdAt: "now", updatedAt: "now", title: "Threshold calibration" },
    { id: "run_beta_456", status: "created", createdAt: "now", updatedAt: "now", title: "Mesh check" }
  ];
  assert.equal(findRun(runs, "run_alpha").id, "run_alpha_123");
  assert.equal(findRun(runs, "mesh check").id, "run_beta_456");
  assert.equal(findRun(runs, "Threshold").id, "run_alpha_123");
});
