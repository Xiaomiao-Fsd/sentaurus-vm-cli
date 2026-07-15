import assert from "node:assert/strict";
import test from "node:test";
import {
  shouldRelaunchForWindowsUtf8,
  shouldUseWindowsUtf8CodePage
} from "../src/terminal.js";

test("Windows interactive terminals opt into the UTF-8 code page", () => {
  assert.equal(shouldUseWindowsUtf8CodePage("win32", true, true), true);
  assert.equal(shouldUseWindowsUtf8CodePage("win32", true, false), false);
  assert.equal(shouldUseWindowsUtf8CodePage("linux", true, true), false);
  assert.equal(shouldRelaunchForWindowsUtf8("win32", true, true, false), true);
  assert.equal(shouldRelaunchForWindowsUtf8("win32", true, true, true), false);
});
