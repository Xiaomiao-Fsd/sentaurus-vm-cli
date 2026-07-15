import { sanitizeTerminalText } from "./markdown.js";
import type {
  VmAgentPlanStepStatus,
  VmAgentWorkflow,
  VmAgentWorkflowUpdate
} from "./types.js";

function inlineText(value: string): string {
  return sanitizeTerminalText(value).replace(/\s+/gu, " ").trim();
}

function planMarker(status: VmAgentPlanStepStatus): string {
  if (status === "completed") return "[x]";
  if (status === "in_progress") return "[>]";
  return "[ ]";
}

export function formatWorkflow(workflow: VmAgentWorkflow): string {
  const lines = [`Workflow revision ${workflow.revision}`];
  if (workflow.goal) {
    lines.push(`Goal  ${workflow.goal.status}  ${inlineText(workflow.goal.objective)}`);
    if (workflow.goal.blockedReason) {
      lines.push(`      blocked: ${inlineText(workflow.goal.blockedReason)}`);
    }
  } else {
    lines.push("Goal  none");
  }
  lines.push(`Plan  ${workflow.plan.mode}`);
  if (workflow.plan.explanation) lines.push(`      ${inlineText(workflow.plan.explanation)}`);
  for (const step of workflow.plan.steps) {
    lines.push(`      ${planMarker(step.status)} ${step.id}  ${inlineText(step.step)}`);
  }
  return lines.join("\n");
}

export function goalWorkflowUpdate(args: readonly string[]): VmAgentWorkflowUpdate | undefined {
  if (!args.length || ["show", "status"].includes(args[0]?.toLowerCase() || "")) return undefined;
  const action = args[0]?.toLowerCase();
  const lifecycle = {
    pause: "goal.pause",
    resume: "goal.resume",
    complete: "goal.complete",
    clear: "goal.clear"
  } as const;
  if (action && action in lifecycle) {
    return { action: lifecycle[action as keyof typeof lifecycle] };
  }
  if (action === "block") {
    const reason = args.slice(1).join(" ").trim();
    return { action: "goal.block", ...(reason ? { payload: { reason } } : {}) };
  }
  const objective = ["edit", "set"].includes(action || "")
    ? args.slice(1).join(" ").trim()
    : args.join(" ").trim();
  if (!objective) throw new Error("Usage: /goal edit <objective>");
  return { action: "goal.set", payload: { objective } };
}

export function planWorkflowUpdate(
  args: readonly string[],
  currentMode: VmAgentWorkflow["plan"]["mode"] = "default"
): VmAgentWorkflowUpdate | undefined {
  const action = args[0]?.toLowerCase();
  if (action === "show" || action === "status") return undefined;
  if (!action || action === "enter" || action === "on") {
    return currentMode === "plan" ? undefined : { action: "plan.enter" };
  }
  if (action === "approve") return { action: "plan.approve" };
  if (action === "exit" || action === "off") return { action: "plan.exit" };
  if (action === "clear" || action === "reset") return { action: "plan.clear" };
  if (action === "step") {
    const stepId = args[1];
    const status = args[2];
    if (!stepId || !status) throw new Error("Usage: /plan step <id> <pending|in_progress|completed>");
    const statuses: VmAgentPlanStepStatus[] = ["pending", "in_progress", "completed"];
    if (!statuses.includes(status as VmAgentPlanStepStatus)) {
      throw new Error("Plan step status must be pending, in_progress, or completed");
    }
    return {
      action: "plan.step",
      payload: { stepId, status: status as VmAgentPlanStepStatus }
    };
  }
  throw new Error("Usage: /plan [show|enter|approve|exit|clear|step]");
}
