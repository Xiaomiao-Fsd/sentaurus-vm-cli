import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const OUTPUT_PATH_ENV = "SENTAURUS_VM_CLIPBOARD_IMAGE_PATH";
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const POWERSHELL_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$image = $null
$failure = $null
try {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing

  $outputPath = [Environment]::GetEnvironmentVariable('SENTAURUS_VM_CLIPBOARD_IMAGE_PATH')
  if ([string]::IsNullOrWhiteSpace($outputPath)) {
    throw 'Clipboard image output path is missing.'
  }

  $lastError = $null
  for ($attempt = 0; $attempt -lt 10; $attempt++) {
    try {
      $image = [System.Windows.Forms.Clipboard]::GetImage()
      if ($null -ne $image) { break }
    } catch {
      $lastError = $_.Exception
    }
    if ($attempt -lt 9) { Start-Sleep -Milliseconds 50 }
  }

  if ($null -eq $image) {
    if ($null -ne $lastError) {
      throw "Unable to read the Windows clipboard: $($lastError.Message)"
    }
    throw 'The Windows clipboard does not contain an image.'
  }

  $image.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)
} catch {
  $failure = $_.Exception.Message
} finally {
  if ($null -ne $image) { $image.Dispose() }
}

if ($null -ne $failure) {
  [Console]::Error.WriteLine($failure)
  exit 1
}
`;

export type ClipboardCommandRunner = (
  command: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv
) => Promise<void>;

export type CaptureClipboardImageOptions = {
  platform?: NodeJS.Platform;
  tempRoot?: string;
  runCommand?: ClipboardCommandRunner;
};

export type CapturedClipboardImage = {
  path: string;
  cleanup: () => Promise<void>;
};

async function runCommand(command: string, args: readonly string[], env: NodeJS.ProcessEnv): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, [...args], {
      env,
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"]
    });
    let stderr = "";
    let settled = false;
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-8192);
    });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    child.once("exit", (code, signal) => {
      if (settled) return;
      settled = true;
      if (code === 0) {
        resolve();
        return;
      }
      const detail = stderr.trim() || (signal ? `terminated by ${signal}` : `exited with code ${code}`);
      reject(new Error(detail));
    });
  });
}

export async function captureClipboardImage(
  options: CaptureClipboardImageOptions = {}
): Promise<CapturedClipboardImage> {
  if ((options.platform ?? process.platform) !== "win32") {
    throw new Error("Clipboard image paste is currently supported only on Windows.");
  }

  const directory = await mkdtemp(path.join(options.tempRoot ?? os.tmpdir(), "sentaurus-vm-clipboard-"));
  const imagePath = path.join(directory, "clipboard.png");
  try {
    await (options.runCommand ?? runCommand)(
      "powershell.exe",
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-STA", "-Command", POWERSHELL_SCRIPT],
      { ...process.env, [OUTPUT_PATH_ENV]: imagePath }
    );
    const bytes = await readFile(imagePath);
    if (bytes.length <= PNG_SIGNATURE.length || !bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
      throw new Error("Windows clipboard capture did not produce a valid PNG image.");
    }
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not paste the clipboard image: ${detail}`, { cause: error });
  }

  let cleaned = false;
  return {
    path: imagePath,
    cleanup: async () => {
      if (cleaned) return;
      cleaned = true;
      await rm(directory, { recursive: true, force: true });
    }
  };
}
