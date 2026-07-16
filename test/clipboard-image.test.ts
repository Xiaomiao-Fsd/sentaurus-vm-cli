import assert from "node:assert/strict";
import { access, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { captureClipboardImage } from "../src/clipboard-image.js";

const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00
]);

test("captures a Windows clipboard image through STA PowerShell and cleans it up", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "sentaurus-vm-clipboard-test-"));
  try {
    const captured = await captureClipboardImage({
      platform: "win32",
      tempRoot: root,
      runCommand: async (command, args, env) => {
        assert.equal(command, "powershell.exe");
        assert.ok(args.includes("-STA"));
        const outputPath = env.SENTAURUS_VM_CLIPBOARD_IMAGE_PATH;
        assert.ok(outputPath);
        await writeFile(outputPath, PNG_BYTES);
      }
    });
    await access(captured.path);
    await captured.cleanup();
    await captured.cleanup();
    await assert.rejects(access(captured.path));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects unsupported platforms before invoking a clipboard command", async () => {
  let invoked = false;
  await assert.rejects(
    captureClipboardImage({
      platform: "linux",
      runCommand: async () => { invoked = true; }
    }),
    /supported only on Windows/
  );
  assert.equal(invoked, false);
});

test("removes temporary files when clipboard capture is not a PNG", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "sentaurus-vm-clipboard-test-"));
  try {
    await assert.rejects(
      captureClipboardImage({
        platform: "win32",
        tempRoot: root,
        runCommand: async (_command, _args, env) => {
          const outputPath = env.SENTAURUS_VM_CLIPBOARD_IMAGE_PATH;
          assert.ok(outputPath);
          await writeFile(outputPath, "not an image");
        }
      }),
      /valid PNG/
    );
    assert.deepEqual(await readdir(root), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
