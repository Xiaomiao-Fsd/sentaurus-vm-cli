import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeReasoningSummary,
  ReasoningSummaryBuffer,
  reasoningSummaryLength,
  reasoningSummarySeparator
} from "../src/reasoning-summary.js";

test("reasoning summaries normalize headings and merge short updates", () => {
  const buffer = new ReasoningSummaryBuffer({ minChars: 80, maxChars: 140 });
  assert.deepEqual(buffer.push("**正在核对当前任务阶段和已有输入文件。**"), []);
  assert.deepEqual(buffer.push("已检查 device.cmd 与参数文件，暂未改动仿真结果。"), []);
  const blocks = buffer.push("发现栅极功函数定义与目标阈值不一致，下一步会修正参数并重新验证 Id-Vg、Ion 和 Ioff。" );
  assert.equal(blocks.length, 1);
  assert.ok(reasoningSummaryLength(blocks[0] || "") >= 80);
  assert.ok(reasoningSummaryLength(blocks[0] || "") <= 140);
  assert.match(blocks[0] || "", /device\.cmd/);
  assert.match(blocks[0] || "", /下一步/);
  assert.doesNotMatch(blocks[0] || "", /\*\*/);
});

test("reasoning summaries split oversized text and suppress duplicates", () => {
  const buffer = new ReasoningSummaryBuffer({ minChars: 60, maxChars: 100 });
  const text = "当前正在整理仿真输入、核对已修改文件并定位收敛问题，随后会根据失败日志调整求解步长和网格设置。".repeat(3);
  const blocks = [...buffer.push(text), ...buffer.push(text), ...buffer.flush()];
  assert.ok(blocks.length >= 2);
  assert.ok(blocks.every((block) => reasoningSummaryLength(block) <= 100));
  assert.equal(blocks.join("").match(/当前正在整理/g)?.length, 3);
});

test("reasoning summary output uses body-only text and a terminal-width separator", () => {
  assert.equal(
    normalizeReasoningSummary("reasoning summary planning / streaming\n### **正在检查文件**"),
    "正在检查文件"
  );
  assert.equal(reasoningSummarySeparator(40), "─".repeat(39));
  assert.equal(reasoningSummarySeparator(200), "─".repeat(100));
});
