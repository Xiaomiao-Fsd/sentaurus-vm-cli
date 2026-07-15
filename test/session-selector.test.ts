import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";
import stringWidth from "string-width";
import {
  formatSessionAge,
  layoutSessionSelector,
  orderSessions,
  selectSession,
  shouldOpenSessionSelector
} from "../src/session-selector.js";
import type { RunSummary } from "../src/types.js";

function run(id: string, title: string, updatedAt: string): RunSummary {
  return {
    id,
    title,
    status: "created",
    createdAt: updatedAt,
    updatedAt
  };
}

const runs = [
  run("run_old", "Older session", "2026-07-14T00:00:00Z"),
  run("run_new", "排查 SDevice 收敛问题", "2026-07-15T11:58:00Z"),
  run("run_middle", "Mesh calibration", "2026-07-15T10:00:00Z")
];

test("session selector opens only for the exact interactive resume --all path", () => {
  const base = {
    includeAll: true,
    useLast: false,
    remainingArgs: [] as string[],
    interactiveCommand: true,
    json: false,
    inputIsTty: true,
    outputIsTty: true
  };
  assert.equal(shouldOpenSessionSelector(base), true);
  assert.equal(shouldOpenSessionSelector({ ...base, selector: "run_new" }), false);
  assert.equal(shouldOpenSessionSelector({ ...base, useLast: true }), false);
  assert.equal(shouldOpenSessionSelector({ ...base, remainingArgs: ["run_new"] }), false);
  assert.equal(shouldOpenSessionSelector({ ...base, interactiveCommand: false }), false);
  assert.equal(shouldOpenSessionSelector({ ...base, json: true }), false);
  assert.equal(shouldOpenSessionSelector({ ...base, inputIsTty: false }), false);
});

test("session selector sorts by recency and lays out archived rows within terminal width", () => {
  assert.deepEqual(orderSessions(runs).map((item) => item.id), ["run_new", "run_middle", "run_old"]);
  assert.equal(formatSessionAge("2026-07-15T11:58:00Z", new Date("2026-07-15T12:00:00Z")), "2m ago");

  const many = Array.from({ length: 12 }, (_, index) =>
    run(`run_${index}`, `Session ${index} with a long descriptive title`, `2026-07-15T${String(index).padStart(2, "0")}:00:00Z`)
  );
  const layout = layoutSessionSelector(
    many,
    10,
    new Set(["run_10"]),
    42,
    6,
    new Date("2026-07-15T12:00:00Z")
  );
  assert.equal(layout.visibleStart, 6);
  assert.equal(layout.visibleCount, 6);
  assert.equal(layout.selectedRow, 5);
  assert.ok(layout.rows.every((row) => stringWidth(row) <= 41));
  assert.match(layout.rows[layout.selectedRow] || "", /> A/);
  assert.match(layout.rows.at(-2) || "", /7-12\/12/);

  const duplicates = layoutSessionSelector([
    run("run_duplicate_alpha", "Same title", "2026-07-15T11:00:00Z"),
    run("run_duplicate_beta", "Same title", "2026-07-15T10:00:00Z")
  ], 0, new Set(), 64, 10, new Date("2026-07-15T12:00:00Z"));
  assert.match(duplicates.rows[1] || "", /run_dupl.*alpha/);
});

test("interactive selector uses arrows, enter, escape, and resize", async () => {
  const input = new PassThrough() as PassThrough & NodeJS.ReadStream;
  const output = new PassThrough() as PassThrough & NodeJS.WriteStream;
  Object.assign(input, {
    isTTY: true,
    isRaw: false,
    setRawMode(value: boolean) {
      this.isRaw = value;
      return this;
    }
  });
  Object.assign(output, { isTTY: true, columns: 80, rows: 24 });
  let rendered = "";
  output.on("data", (chunk) => { rendered += chunk.toString(); });
  const key = (name: string, ctrl = false) => input.emit("keypress", "", { name, ctrl });

  const selected = selectSession(runs, { input, output, currentId: "run_middle" });
  key("up");
  output.columns = 36;
  output.emit("resize");
  key("return");
  assert.equal((await selected)?.id, "run_new");
  assert.match(rendered, /Select a session/);
  assert.match(rendered, /Enter resume/);
  assert.equal(input.isRaw, false);

  const cancelled = selectSession(runs, { input, output });
  key("escape");
  assert.equal(await cancelled, undefined);
  assert.equal(input.isRaw, false);
});
