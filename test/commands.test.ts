import assert from "node:assert/strict";
import test from "node:test";
import { commandRegistry, splitCommandLine } from "../src/commands.js";

test("command registry parses quoted Windows paths and canonical aliases", () => {
  assert.deepEqual(
    splitCommandLine('/attach "C:\\My Files\\device.cmd" plain.txt'),
    ["/attach", "C:\\My Files\\device.cmd", "plain.txt"]
  );
  const models = commandRegistry.parse("/models");
  assert.equal(models?.name, "model");
  assert.equal(models?.spec?.target, "local");
  assert.deepEqual(commandRegistry.parse('/resume "Threshold calibration"')?.args, ["Threshold calibration"]);
});

test("command registry drives help and dynamic completions", () => {
  const values = {
    sessions: ["run_123"],
    models: ["gpt-5.6-sol"],
    planSteps: ["inspect"]
  };
  const completions = commandRegistry.completions(values);
  assert.ok(completions.includes("/goal pause"));
  assert.ok(completions.includes("/goal block "));
  assert.ok(completions.includes("/plan approve"));
  assert.ok(completions.includes("/plan step inspect in_progress"));
  assert.ok(completions.includes("/resume run_123"));
  assert.ok(completions.includes("/model gpt-5.6-sol"));
  assert.match(commandRegistry.help(), /\/goal/);
  assert.match(commandRegistry.help("plan"), /read-only plan mode/i);
});

test("command suggestions include descriptions and nested dynamic values", () => {
  const values = {
    sessions: ["run_alpha", "run_beta"],
    models: ["gpt-5.6-sol"],
    planSteps: ["inspect", "run"]
  };
  const root = commandRegistry.suggestions("/g", values);
  assert.deepEqual(root.map((item) => item.label), ["/goal"]);
  assert.match(root[0]?.description || "", /durable goal/i);
  assert.equal(root[0]?.replacement, "/goal ");

  const goal = commandRegistry.suggestions("/goal p", values);
  assert.deepEqual(goal.map((item) => item.label), ["/goal pause"]);
  assert.match(goal[0]?.description || "", /Pause goal injection/i);

  const model = commandRegistry.suggestions("/model set gpt", values);
  assert.deepEqual(model, [{
    label: "/model set gpt-5.6-sol",
    replacement: "/model set gpt-5.6-sol",
    description: "Switch to this allowlisted VM model"
  }]);

  assert.deepEqual(
    commandRegistry.suggestions("/resume run_b", values).map((item) => item.label),
    ["/resume run_beta"]
  );
  assert.deepEqual(
    commandRegistry.suggestions("/plan step i", values).map((item) => item.replacement),
    ["/plan step inspect "]
  );
  assert.deepEqual(
    commandRegistry.suggestions("/plan step inspect in_", values).map((item) => item.label),
    ["/plan step inspect in_progress"]
  );
  assert.deepEqual(commandRegistry.suggestions("normal text", values), []);
  assert.deepEqual(commandRegistry.suggestions("/goal\nnext", values), []);
  assert.deepEqual(commandRegistry.suggestions("/resume ", {
    sessions: ["run_safe", "run_bad\u001b[2J"]
  }).map((item) => item.label), ["/resume run_safe"]);
});
