import { spawnSync } from "node:child_process";
import process from "node:process";

let terminalConfigured = false;
const utf8ReexecEnvironment = "SENTAURUS_VM_UTF8_REEXEC";

export function shouldUseWindowsUtf8CodePage(
  platform: NodeJS.Platform,
  inputIsTty: boolean,
  outputIsTty: boolean
): boolean {
  return platform === "win32" && inputIsTty && outputIsTty;
}

export function shouldRelaunchForWindowsUtf8(
  platform: NodeJS.Platform,
  inputIsTty: boolean,
  outputIsTty: boolean,
  alreadyRelaunched: boolean
): boolean {
  return shouldUseWindowsUtf8CodePage(platform, inputIsTty, outputIsTty) && !alreadyRelaunched;
}

export function relaunchForWindowsUtf8IfNeeded(): boolean {
  if (!shouldRelaunchForWindowsUtf8(
    process.platform,
    Boolean(process.stdin.isTTY),
    Boolean(process.stdout.isTTY),
    process.env[utf8ReexecEnvironment] === "1"
  )) return false;

  const codePage = spawnSync("cmd.exe", ["/d", "/s", "/c", "chcp 65001 >nul"], {
    // Inheriting the console handles is required for chcp to update ConPTY.
    // Redirection happens inside cmd, so no setup line appears in the UI.
    stdio: "inherit",
    windowsHide: true
  });
  if (codePage.error || codePage.status !== 0) {
    throw codePage.error || new Error("Failed to switch the Windows terminal to UTF-8 code page 65001");
  }

  // Node initializes Windows TTY handles using the code page present at
  // process startup. Relaunch once so OpenSSH ConPTY is Unicode end to end.
  const child = spawnSync(process.execPath, process.argv.slice(1), {
    stdio: "inherit",
    windowsHide: false,
    env: { ...process.env, [utf8ReexecEnvironment]: "1" }
  });
  if (child.error) throw child.error;
  process.exitCode = child.status ?? 1;
  return true;
}

export function configureUtf8Terminal(): void {
  if (terminalConfigured) return;
  terminalConfigured = true;

  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  if (!interactive) return;

  process.stdin.setEncoding("utf8");
}
