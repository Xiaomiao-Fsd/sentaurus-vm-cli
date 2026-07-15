import assert from "node:assert/strict";
import test from "node:test";
import type { SentaurusApi } from "../src/api.js";
import {
  applyProvisionalSessionTitle,
  PROVISIONAL_SESSION_TITLE,
  sessionTitleFromFirstPrompt
} from "../src/session-title.js";
import type { RunSummary } from "../src/types.js";

function run(title: string): RunSummary {
  return {
    id: "run_1",
    title,
    status: "created",
    createdAt: "2026-07-15T00:00:00Z",
    updatedAt: "2026-07-15T00:00:00Z"
  };
}

test("first prompt becomes a compact provisional session title", () => {
  assert.equal(
    sessionTitleFromFirstPrompt("我想请你帮忙看看为什么这个 SDevice 仿真在牛顿迭代第 30 步不收敛"),
    "排查 SDevice 仿真在牛顿迭代第 30 步不收敛"
  );
  assert.equal(
    sessionTitleFromFirstPrompt("Could you please help me analyze mesh convergence?"),
    "mesh convergence"
  );
  assert.equal(sessionTitleFromFirstPrompt("/status"), undefined);
  assert.equal(sessionTitleFromFirstPrompt("```text\nsolver output\n```"), "Code task");
});

test("generated titles redact common secrets and respect display width", () => {
  const title = sessionTitleFromFirstPrompt(
    "Please check Bearer highly-sensitive-token and sk-abcdefghijklmnopqrstuvwxyz in this very long request",
    32
  );
  assert.doesNotMatch(title || "", /highly-sensitive|abcdefghijklmnopqrstuvwxyz/);
  assert.match(title || "", /\[secret\]/);
  assert.ok((title || "").length <= 32);
});

test("only the provisional title is replaced through the existing run API", async () => {
  const updates: Array<{ id: string; title: string }> = [];
  const api = {
    updateRunTitle: async (id: string, title: string) => {
      updates.push({ id, title });
      return { ...run(title), id };
    }
  } as unknown as SentaurusApi;

  const titled = await applyProvisionalSessionTitle(api, run(PROVISIONAL_SESSION_TITLE), "请帮我检查 Id-Vg 曲线异常");
  assert.equal(titled.title, "检查 Id-Vg 曲线异常");
  assert.deepEqual(updates, [{ id: "run_1", title: "检查 Id-Vg 曲线异常" }]);

  const explicit = await applyProvisionalSessionTitle(api, run("Manual title"), "another prompt");
  assert.equal(explicit.title, "Manual title");
  assert.equal(updates.length, 1);
});
