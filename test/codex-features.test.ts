import assert from "node:assert/strict";
import test from "node:test";
import { completionScript } from "../src/completion.js";
import { cliFeatures, formatFeatureList } from "../src/features.js";
import { shouldReadStdin } from "../src/input.js";
import { buildReviewPrompt } from "../src/review.js";

test("completion generators cover the installed command aliases", () => {
  for (const shell of ["powershell", "bash", "zsh", "fish"]) {
    const script = completionScript(shell);
    assert.match(script, /sentaurus-vm/);
    assert.match(script, /vm-agent/);
    assert.match(script, /exec/);
    assert.match(script, /--session/);
  }
  assert.throws(() => completionScript("cmd"), /Unsupported shell/);
});

test("feature list exposes migrated Codex-style capabilities", () => {
  assert.ok(cliFeatures.some((feature) => feature.name === "non_interactive_exec"));
  assert.ok(cliFeatures.some((feature) => feature.name === "session_lifecycle"));
  assert.match(formatFeatureList(), /jsonl_events/);
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
