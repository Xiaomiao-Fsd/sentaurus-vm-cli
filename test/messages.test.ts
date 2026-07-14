import assert from "node:assert/strict";
import test from "node:test";
import { belongsToTurn, isFinalReply, mergeMessages } from "../src/messages.js";
import type { VmAgentMessage } from "../src/types.js";
import { JsonlTurnRenderer, TurnRenderer } from "../src/ui.js";

function message(id: string, content: string, meta: VmAgentMessage["meta"]): VmAgentMessage {
  return { id, role: "agent", content, createdAt: "2026-07-14T00:00:00Z", meta };
}

test("mergeMessages assembles streaming deltas by target id", () => {
  const merged = mergeMessages([], [
    message("delta-1", "Hello ", { kind: "agent_response_delta", targetMessageId: "answer", sessionId: "run_1", append: true }),
    message("delta-2", "world", { kind: "agent_response_delta", targetMessageId: "answer", sessionId: "run_1", append: true }),
    message("done", "", { kind: "agent_response_done", targetMessageId: "answer", sessionId: "run_1", done: true })
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.id, "answer");
  assert.equal(merged[0]?.content, "Hello world");
  assert.equal(merged[0]?.meta?.done, true);
  assert.equal(isFinalReply(merged[0]!), true);
});

test("turn filtering rejects messages from concurrent sessions", () => {
  const own = message("own", "ok", { sessionId: "run_a", turnId: "turn_a" });
  const other = message("other", "no", { sessionId: "run_b", turnId: "turn_b" });
  assert.equal(belongsToTurn(own, "run_a", "turn_a"), true);
  assert.equal(belongsToTurn(other, "run_a", "turn_a"), false);
});

test("TurnRenderer emits incremental text once and completes", () => {
  let output = "";
  const renderer = new TurnRenderer((value) => { output += value; });
  const first = message("d1", "abc", { kind: "agent_response_delta", targetMessageId: "target", sessionId: "run_1", turnId: "turn_1", append: true });
  const second = message("d2", "def", { kind: "agent_response_delta", targetMessageId: "target", sessionId: "run_1", turnId: "turn_1", append: true });
  const done = message("d3", "", { kind: "agent_response_done", targetMessageId: "target", sessionId: "run_1", turnId: "turn_1", done: true });
  assert.equal(renderer.render([first], "run_1", "turn_1"), false);
  assert.equal(renderer.render([second, done], "run_1", "turn_1"), true);
  assert.equal(output, "sentaurus\nabcdef\n\n");
});

test("JsonlTurnRenderer emits a machine-readable final response", () => {
  let output = "";
  const renderer = new JsonlTurnRenderer((value) => { output += value; });
  const delta = message("d1", "ready", { kind: "agent_response_delta", targetMessageId: "target", sessionId: "run_1", turnId: "turn_1", append: true });
  const done = message("d2", "", { kind: "agent_response_done", targetMessageId: "target", sessionId: "run_1", turnId: "turn_1", done: true });
  assert.equal(renderer.render([delta, done], "run_1", "turn_1"), true);
  const events = output.trim().split("\n").map((line) => JSON.parse(line) as { type: string; finalResponse?: string });
  assert.equal(events.at(-1)?.type, "turn.completed");
  assert.equal(events.at(-1)?.finalResponse, "ready");
  assert.equal(renderer.finalMessage()?.content, "ready");
});
