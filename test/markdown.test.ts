import assert from "node:assert/strict";
import test from "node:test";
import { MarkdownStream, renderMarkdown, sanitizeTerminalText, streamSafeBoundary } from "../src/markdown.js";

test("markdown renderer handles headings, lists, tables, and fenced code", () => {
  const rendered = renderMarkdown("# Result\n\n- one\n- two\n\n| A | B |\n| - | - |\n| x | y |\n\n```tcl\nputs ok\n```", 100);
  assert.match(rendered, /Result/);
  assert.match(rendered, /one/);
  assert.match(rendered, /puts ok/);
  assert.match(rendered, /A/);
});

test("terminal text removes control characters before rendering", () => {
  assert.equal(sanitizeTerminalText("before\u001b[2Jafter\u0007"), "before[2Jafter");
  assert.equal(renderMarkdown("safe\u001b[2J text").includes("\u001b[2J"), false);
});

test("markdown stream waits for safe paragraph and fence boundaries", () => {
  assert.equal(streamSafeBoundary("partial"), undefined);
  assert.equal(streamSafeBoundary("paragraph\n\n"), "paragraph\n\n".length);
  assert.equal(streamSafeBoundary("```ts\nconst x = 1;\n"), undefined);

  const stream = new MarkdownStream();
  assert.equal(stream.push("**bold"), "");
  const first = stream.push("**\n\n");
  assert.match(first, /bold/);
  assert.equal(stream.flush(), "");
});
