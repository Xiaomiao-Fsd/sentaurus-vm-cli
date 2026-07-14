import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { findWebRepository, parseDotEnv } from "../src/host.js";

test("parseDotEnv handles exports, quotes, comments, and embedded hashes", () => {
  assert.deepEqual(parseDotEnv([
    "# comment",
    "PORT=5175",
    "export AUTH_TOKEN='secret#inside'",
    "HOST=::1 # local only",
    'NAME="Sentaurus VM"'
  ].join("\n")), {
    PORT: "5175",
    AUTH_TOKEN: "secret#inside",
    HOST: "::1",
    NAME: "Sentaurus VM"
  });
});

test("findWebRepository validates an explicit repository", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "sentaurus-web-agent-test-"));
  await writeFile(path.join(directory, ".env"), "AUTH_TOKEN=test\n", "utf8");
  await writeFile(path.join(directory, "package.json"), '{"name":"sentaurus-web-agent"}\n', "utf8");
  assert.equal(await findWebRepository(directory), directory);
});
