import assert from "node:assert/strict";
import test from "node:test";
import type { SentaurusApi } from "../src/api.js";
import { sendTurn, waitForReply } from "../src/turn-controller.js";
import type { StreamEvent, VmAgentHistoryResponse, VmAgentMessage, VmAgentStatus } from "../src/types.js";
import { JsonlTurnRenderer } from "../src/ui.js";

const status: VmAgentStatus = {
  ok: true,
  checkedAt: "2026-07-15T00:00:00Z",
  sshTarget: "sentaurus-centos7",
  connected: true,
  workerRunning: true
};

function agentMessage(id: string, content: string, kind: string): VmAgentMessage {
  return {
    id,
    role: "agent",
    content,
    createdAt: "2026-07-15T00:00:00Z",
    meta: {
      kind,
      sessionId: "run_session",
      turnId: "turn_result",
      runId: "run_simulation"
    }
  };
}

function history(cursor: number, messages: VmAgentMessage[]): VmAgentHistoryResponse {
  return { ok: true, status, cursor, messages };
}

const attachmentMessage: VmAgentMessage = {
  ...agentMessage("attachments", "Published 1 VM attachment.", "vm_agent_attachments"),
  attachments: [{
    id: "metrics",
    kind: "file",
    source: "vm-run-artifact",
    name: "ss_dibl_metrics.json",
    path: "artifacts/ss_dibl_metrics.json",
    runId: "run_simulation",
    size: 3030
  }]
};

test("sendTurn updates metadata after submission without delaying reply rendering", async () => {
  const events: string[] = [];
  const final = agentMessage("final", "done", "agent_response");
  const api = {
    sendMessage: async () => {
      events.push("submitted");
      return history(1, [final]);
    }
  } as unknown as SentaurusApi;
  const renderer = {
    render: () => {
      events.push("rendered");
      return true;
    },
    finalMessage: () => final
  };

  await sendTurn(api, "run_session", "question", [], 1_000, undefined, renderer, async () => {
    events.push("titled");
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
  assert.deepEqual(events, ["submitted", "titled", "rendered"]);
});

test("waitForReply polls once for artifacts after an initial run_final", async () => {
  const calls: number[] = [];
  const api = {
    messages: async (after: number) => {
      calls.push(after);
      return history(6, [attachmentMessage]);
    }
  } as unknown as SentaurusApi;
  let output = "";
  const renderer = new JsonlTurnRenderer((value) => { output += value; });

  const final = agentMessage("final", "SS_low=84.037618 mV/dec", "run_final");
  final.meta = { ...final.meta, runStatus: "succeeded" };
  const result = await waitForReply(api, history(5, [final]), "run_session", renderer, {
    timeoutMs: 1_000,
    runFinalSettleMs: 0
  });

  assert.equal(result?.id, "final");
  assert.deepEqual(calls, [5]);
  const events = output.trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
  assert.deepEqual(events.map((event) => event.type), ["response.completed", "attachments", "turn.completed"]);
  assert.equal((events.at(-1)?.attachments as unknown[]).length, 1);
});

test("waitForReply keeps SSE open for artifacts that follow run_final", async () => {
  const request: VmAgentMessage = {
    id: "request",
    role: "user",
    content: "run",
    createdAt: "2026-07-15T00:00:00Z",
    meta: { sessionId: "run_session", turnId: "turn_result" }
  };
  const final = agentMessage("final", "DIBL=87.938951 mV/V", "run_final");
  final.meta = { ...final.meta, runStatus: "succeeded" };
  const api = {
    streamMessages: async (
      _after: number,
      onEvent: (event: StreamEvent) => void,
      signal?: AbortSignal
    ) => {
      onEvent({ event: "messages", data: history(2, [final]) });
      await new Promise((resolve) => setTimeout(resolve, 1));
      onEvent({ event: "messages", data: history(3, [attachmentMessage]) });
      await new Promise<void>((resolve) => {
        if (signal?.aborted) resolve();
        else signal?.addEventListener("abort", () => resolve(), { once: true });
      });
    }
  } as unknown as SentaurusApi;
  let output = "";
  const renderer = new JsonlTurnRenderer((value) => { output += value; });

  await waitForReply(api, history(1, [request]), "run_session", renderer, {
    timeoutMs: 1_000,
    runFinalSettleMs: 10
  });

  const events = output.trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
  assert.deepEqual(events.map((event) => event.type), ["response.completed", "attachments", "turn.completed"]);
  assert.equal(events.at(-1)?.runId, "run_simulation");
  assert.equal((events.at(-1)?.attachments as unknown[]).length, 1);
});
