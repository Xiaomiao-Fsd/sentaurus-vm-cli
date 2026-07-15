import assert from "node:assert/strict";
import test from "node:test";
import { completionScript } from "../src/completion.js";
import { cliFeatures, formatFeatureList } from "../src/features.js";
import { shouldReadStdin } from "../src/input.js";
import { parseVmAgentModel, VM_AGENT_MODEL_IDS } from "../src/models.js";
import { buildReviewPrompt } from "../src/review.js";

test("completion generators cover the installed command aliases", () => {
  for (const shell of ["powershell", "bash", "zsh", "fish"]) {
    const script = completionScript(shell);
    assert.match(script, /sentaurus-vm/);
    assert.match(script, /vm-agent/);
    assert.match(script, /exec/);
    assert.match(script, /--session/);
    assert.match(script, /gpt-5\.6-sol/);
  }
  assert.throws(() => completionScript("cmd"), /Unsupported shell/);
});

test("feature list exposes migrated Codex-style capabilities", () => {
  assert.ok(cliFeatures.some((feature) => feature.name === "non_interactive_exec"));
  assert.ok(cliFeatures.some((feature) => feature.name === "session_lifecycle"));
  assert.ok(cliFeatures.some((feature) => feature.name === "model_switching"));
  assert.ok(cliFeatures.some((feature) => feature.name === "unicode_input"));
  assert.ok(cliFeatures.some((feature) => feature.name === "interactive_completion"));
  assert.ok(cliFeatures.some((feature) => feature.name === "slash_command_palette"));
  assert.ok(cliFeatures.some((feature) => feature.name === "interactive_session_selector"));
  assert.ok(cliFeatures.some((feature) => feature.name === "provisional_session_titles"));
  assert.ok(cliFeatures.some((feature) => feature.name === "session_workflow"));
  assert.ok(cliFeatures.some((feature) => feature.name === "plan_mode"));
  assert.ok(cliFeatures.some((feature) => feature.name === "reasoning_summaries"));
  assert.ok(cliFeatures.some((feature) => feature.name === "structured_run_results"));
  assert.ok(cliFeatures.some((feature) => feature.name === "artifact_events"));
  assert.match(formatFeatureList(), /jsonl_events/);
  assert.match(formatFeatureList(), /markdown_streaming/);
});

test("review prompt is findings-first and does not run by default", () => {
  const prompt = buildReviewPrompt("Check the drain contact.");
  assert.match(prompt, /findings ordered by severity/i);
  assert.match(prompt, /Do not start or rerun/i);
  assert.match(prompt, /Check the drain contact/);
});

test("stdin detection does not hang an SSH command that already has a prompt", () => {
  assert.equal(shouldReadStdin(["/status"], false), false);
  assert.equal(shouldReadStdin(["explain", "-"], false), true);
  assert.equal(shouldReadStdin([], false), true);
  assert.equal(shouldReadStdin([], true), false);
});

test("client model selector exposes only the five configured models", () => {
  assert.deepEqual(VM_AGENT_MODEL_IDS, ["gpt-5.4", "gpt-5.5", "gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol"]);
  assert.equal(parseVmAgentModel("gpt-5.6-sol"), "gpt-5.6-sol");
  assert.throws(() => parseVmAgentModel("gpt-5.6-unknown"), /Model must be one of/);
});
