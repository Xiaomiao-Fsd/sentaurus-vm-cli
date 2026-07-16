import assert from "node:assert/strict";
import test from "node:test";
import {
  belongsToTurn,
  isAttachmentMessage,
  isFinalReply,
  isReasoningSummary,
  isReasoningSummaryDelta,
  isReasoningSummaryDone,
  mergeMessages
} from "../src/messages.js";
import type { VmAgentMessage } from "../src/types.js";
import { JsonlTurnRenderer, statusLine, TurnRenderer } from "../src/ui.js";

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

test("reasoning summaries and artifact publications stay auxiliary", () => {
  const summary = message("summary", "Grounded in fixed extractor output.", {
    kind: "agent_reasoning_summary",
    sessionId: "run_1",
    turnId: "turn_1",
    thinkingStage: "final",
    thinkingStatus: "completed"
  });
  const artifacts = message("attachments", "Published 1 VM attachment.", {
    kind: "vm_agent_attachments",
    sessionId: "run_1",
    turnId: "turn_1",
    runId: "run_result"
  });
  assert.equal(isReasoningSummary(summary), true);
  assert.equal(isAttachmentMessage(artifacts), true);
  assert.equal(isFinalReply(summary), false);
  assert.equal(isFinalReply(artifacts), false);
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

test("renderers stream one reasoning item and ignore legacy progress", () => {
  const deltaOne = message("r1", "Plan", {
    kind: "agent_reasoning_summary_delta",
    targetMessageId: "reasoning-item",
    sessionId: "run_1",
    turnId: "turn_1",
    thinkingStage: "planning",
    thinkingStatus: "streaming",
    append: true,
    delta: true
  });
  const deltaTwo = message("r2", " safely", {
    kind: "agent_reasoning_summary_delta",
    targetMessageId: "reasoning-item",
    sessionId: "run_1",
    turnId: "turn_1",
    thinkingStage: "planning",
    thinkingStatus: "streaming",
    append: true,
    delta: true
  });
  const reasoningDone = message("r3", "Plan safely", {
    kind: "agent_reasoning_summary_done",
    targetMessageId: "reasoning-item",
    sessionId: "run_1",
    turnId: "turn_1",
    thinkingStage: "planning",
    thinkingStatus: "completed",
    done: true,
    streamState: "done"
  });
  const progress: VmAgentMessage = {
    ...message("progress", "Progress: redundant", { kind: "progress", sessionId: "run_1", turnId: "turn_1" }),
    role: "system"
  };
  const final = message("final", "Finished", { kind: "llm", sessionId: "run_1", turnId: "turn_1" });

  assert.equal(isReasoningSummaryDelta(deltaOne), true);
  assert.equal(isReasoningSummaryDone(reasoningDone), true);
  assert.equal(isFinalReply(reasoningDone), false);

  let terminal = "";
  const terminalRenderer = new TurnRenderer((value) => { terminal += value; });
  assert.equal(terminalRenderer.render([deltaOne, progress], "run_1", "turn_1"), false);
  assert.equal(terminalRenderer.render([deltaTwo, reasoningDone, final], "run_1", "turn_1"), true);
  assert.match(terminal, /Plan safely\n\nsentaurus\nFinished/);
  assert.doesNotMatch(terminal, /reasoning summary|planning \/ streaming/);
  assert.doesNotMatch(terminal, /Progress: redundant/);

  let jsonl = "";
  const jsonRenderer = new JsonlTurnRenderer((value) => { jsonl += value; });
  assert.equal(jsonRenderer.render([deltaOne, progress, deltaTwo, reasoningDone, final], "run_1", "turn_1"), true);
  jsonRenderer.finish("run_1", "turn_1");
  const events = jsonl.trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
  assert.deepEqual(events.map((event) => event.type), [
    "reasoning.summary.delta",
    "reasoning.summary.delta",
    "reasoning.summary",
    "response.completed",
    "turn.completed"
  ]);
  const completed = events.at(-1) as { reasoningSummaries: Array<{ text: string }> };
  assert.deepEqual(completed.reasoningSummaries.map((summary) => summary.text), ["Plan safely"]);
});

test("JsonlTurnRenderer emits a machine-readable final response", () => {
  let output = "";
  const renderer = new JsonlTurnRenderer((value) => { output += value; });
  const delta = message("d1", "ready", { kind: "agent_response_delta", targetMessageId: "target", sessionId: "run_1", turnId: "turn_1", append: true });
  const done = message("d2", "", { kind: "agent_response_done", targetMessageId: "target", sessionId: "run_1", turnId: "turn_1", done: true });
  assert.equal(renderer.render([delta, done], "run_1", "turn_1"), true);
  renderer.finish("run_1", "turn_1");
  const events = output.trim().split("\n").map((line) => JSON.parse(line) as { type: string; finalResponse?: string });
  assert.equal(events.at(-1)?.type, "turn.completed");
  assert.equal(events.at(-1)?.finalResponse, "ready");
  assert.equal(renderer.finalMessage()?.content, "ready");
});

test("renderers expose safe summaries and concrete run artifacts", () => {
  const summary = message("summary", "最终结论来自结构化 DF-ISE 输出。", {
    kind: "agent_reasoning_summary",
    sessionId: "run_1",
    turnId: "turn_1",
    thinkingStage: "final",
    thinkingStatus: "completed"
  });
  const final = message("final", "SS_low=84.037618 mV/dec\n\nDIBL=87.938951 mV/V", {
    kind: "run_final",
    sessionId: "run_1",
    turnId: "turn_1",
    runId: "run_20260715_result",
    runStatus: "succeeded"
  });
  const artifacts: VmAgentMessage = {
    ...message("attachments", "Published 2 VM attachments.", {
      kind: "vm_agent_attachments",
      sessionId: "run_1",
      turnId: "turn_1",
      runId: "run_20260715_result",
      attachmentCount: 2
    }),
    attachments: [
      {
        id: "plot",
        kind: "image",
        source: "vm-run-artifact",
        name: "idvg_plot.png",
        path: "artifacts/idvg_plot.png",
        runId: "run_20260715_result",
        size: 4282,
        contentType: "image/png"
      },
      {
        id: "metrics",
        kind: "file",
        source: "vm-run-artifact",
        name: "ss_dibl_metrics.json",
        path: "artifacts/ss_dibl_metrics.json",
        runId: "run_20260715_result",
        size: 3030,
        contentType: "application/json"
      }
    ]
  };

  let terminal = "";
  const terminalRenderer = new TurnRenderer((value) => { terminal += value; });
  assert.equal(terminalRenderer.render([summary, final, artifacts], "run_1", "turn_1"), true);
  assert.match(terminal, /最终结论来自结构化 DF-ISE 输出。/);
  assert.doesNotMatch(terminal, /reasoning summary|final \/ completed/);
  assert.match(terminal, /SS_low=84\.037618 mV\/dec/);
  assert.match(terminal, /artifacts run_20260715_result/);
  assert.match(terminal, /\[image\] idvg_plot\.png \| artifacts\/idvg_plot\.png \| 4\.2 KiB/);
  assert.match(terminal, /\[file\] ss_dibl_metrics\.json/);

  let jsonl = "";
  const jsonRenderer = new JsonlTurnRenderer((value) => { jsonl += value; });
  assert.equal(jsonRenderer.render([summary, final, artifacts], "run_1", "turn_1"), true);
  assert.doesNotMatch(jsonl, /"type":"turn\.completed"/);
  jsonRenderer.finish("run_1", "turn_1");
  const events = jsonl.trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
  assert.deepEqual(events.map((event) => event.type), [
    "reasoning.summary",
    "response.completed",
    "attachments",
    "turn.completed"
  ]);
  const completed = events.at(-1) as {
    runId: string;
    runStatus: string;
    finalResponse: string;
    reasoningSummaries: unknown[];
    attachments: unknown[];
  };
  assert.equal(completed.runId, "run_20260715_result");
  assert.equal(completed.runStatus, "succeeded");
  assert.match(completed.finalResponse, /DIBL=87\.938951/);
  assert.equal(completed.reasoningSummaries.length, 1);
  assert.equal(completed.attachments.length, 2);
});

test("statusLine includes reasoning and the effective context window", () => {
  assert.match(statusLine({
    ok: true,
    checkedAt: "now",
    sshTarget: "vm",
    connected: true,
    workerRunning: true,
    llmConfigured: true,
    llmModel: "gpt-5.6-sol",
    llmReasoningEffort: "max",
    llmContextWindowTokens: 353000
  }), /gpt-5\.6-sol max \| context 353k/);
});
