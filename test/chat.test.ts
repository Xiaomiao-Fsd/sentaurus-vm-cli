import assert from "node:assert/strict";
import test from "node:test";
import type { SentaurusApi } from "../src/api.js";
import { findRun, resolveSession, splitCommandLine } from "../src/chat.js";
import { PROVISIONAL_SESSION_TITLE } from "../src/session-title.js";
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

test("an automatically created session starts with a neutral provisional title", async () => {
  const titles: string[] = [];
  const api = {
    listRuns: async () => [],
    createRun: async (title: string) => {
      titles.push(title);
      return {
        id: "run_new",
        title,
        status: "created",
        createdAt: "now",
        updatedAt: "now"
      } as RunSummary;
    }
  } as unknown as SentaurusApi;

  assert.equal((await resolveSession(api)).title, PROVISIONAL_SESSION_TITLE);
  assert.deepEqual(titles, [PROVISIONAL_SESSION_TITLE]);
});
