import assert from "node:assert/strict";
import test from "node:test";
import { formatWorkflow, goalWorkflowUpdate, planWorkflowUpdate } from "../src/workflow.js";

test("goal commands map to typed workflow actions", () => {
  assert.equal(goalWorkflowUpdate([]), undefined);
  assert.deepEqual(goalWorkflowUpdate(["Calibrate", "threshold"]), {
    action: "goal.set",
    payload: { objective: "Calibrate threshold" }
  });
  assert.deepEqual(goalWorkflowUpdate(["edit", "New", "target"]), {
    action: "goal.set",
    payload: { objective: "New target" }
  });
  assert.deepEqual(goalWorkflowUpdate(["pause"]), { action: "goal.pause" });
  assert.deepEqual(goalWorkflowUpdate(["block", "missing", "data"]), {
    action: "goal.block",
    payload: { reason: "missing data" }
  });
  assert.throws(() => goalWorkflowUpdate(["edit"]), /objective/);
});

test("plan commands map to typed transitions and validate step status", () => {
  assert.deepEqual(planWorkflowUpdate([], "default"), { action: "plan.enter" });
  assert.equal(planWorkflowUpdate([], "plan"), undefined);
  assert.equal(planWorkflowUpdate(["show"], "plan"), undefined);
  assert.deepEqual(planWorkflowUpdate(["approve"], "plan"), { action: "plan.approve" });
  assert.deepEqual(planWorkflowUpdate(["step", "inspect", "in_progress"], "default"), {
    action: "plan.step",
    payload: { stepId: "inspect", status: "in_progress" }
  });
  assert.throws(() => planWorkflowUpdate(["step", "inspect", "running"]), /status must be/);
  assert.throws(() => planWorkflowUpdate(["unknown"]), /Usage/);
});

test("workflow formatting includes goal and plan state without terminal controls", () => {
  const output = formatWorkflow({
    version: 1,
    revision: 4,
    sessionId: "run_1",
    goal: {
      objective: "Inspect\u001b[2J deck",
      status: "active",
      createdAt: "now",
      updatedAt: "now"
    },
    plan: {
      mode: "plan",
      steps: [{ id: "inspect", step: "Inspect inputs", status: "in_progress" }]
    }
  });
  assert.match(output, /Workflow revision 4/);
  assert.match(output, /\[>\] inspect/);
  assert.equal(output.includes("\u001b[2J"), false);
});
