import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { maskedToken, normalizeApiUrl, resolveConfig, saveStoredConfig } from "../src/config.js";

test("normalizeApiUrl accepts bracketed IPv6 and removes a trailing slash", () => {
  assert.equal(normalizeApiUrl(" http://[2001:db8::10]:5175/ "), "http://[2001:db8::10]:5175");
});

test("normalizeApiUrl rejects paths and embedded credentials", () => {
  assert.throws(() => normalizeApiUrl("https://example.test/api"), /only scheme, host/);
  assert.throws(() => normalizeApiUrl("https://user:pass@example.test"), /credentials/);
});

test("stored config uses JSON and masks tokens", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "sentaurus-vm-cli-test-"));
  const configPath = path.join(directory, "config.json");
  await saveStoredConfig({ apiUrl: "http://[::1]:5175", authToken: "1234567890abcdef", lastSessionId: "run_test" }, configPath);
  const config = await resolveConfig({}, configPath);
  assert.equal(config.apiUrl, "http://[::1]:5175");
  assert.equal(config.lastSessionId, "run_test");
  assert.equal(maskedToken(config.authToken), "1234...cdef");
  assert.match(await readFile(configPath, "utf8"), /"authToken": "1234567890abcdef"/);
});
