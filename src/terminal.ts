import { spawnSync } from "node:child_process";
import { clearLine, cursorTo, moveCursor } from "node:readline";
import type { Interface } from "node:readline/promises";
import process from "node:process";

type QuestionInterface = Pick<Interface, "question" | "getCursorPos"> & {
  cursor: number;
  readonly line: string;
};

type InputBoxFrame = {
  top: string;
  middle: string;
  bottom: string;
  width: number;
};

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

export function inputBoxFrame(columns: number | undefined): InputBoxFrame {
  const terminalWidth = Number.isFinite(columns) ? Math.floor(columns!) : 80;
  const width = Math.max(24, Math.min(160, terminalWidth - 1));
  const heading = "─ Message ";
  const horizontal = Math.max(0, width - heading.length - 2);
  return {
    top: `╭${heading}${"─".repeat(horizontal)}╮`,
    middle: `│${" ".repeat(width - 2)}│`,
    bottom: `╰${"─".repeat(width - 2)}╯`,
    width
  };
}

function cyan(value: string, enabled: boolean): string {
  return enabled ? `\u001b[36m${value}\u001b[0m` : value;
}

export async function askChatInput(
  readline: QuestionInterface,
  input: NodeJS.ReadStream = process.stdin,
  output: NodeJS.WriteStream = process.stdout
): Promise<string> {
  if (!input.isTTY || !output.isTTY || (output.columns || 0) < 25) {
    return readline.question("sentaurus> ");
  }

  const frame = inputBoxFrame(output.columns);
  const color = !process.env.NO_COLOR;
  output.write(`${cyan(frame.top, color)}\n`);

  let answered = false;
  let active = true;
  const redrawEdges = () => {
    if (!active) return;
    const current = readline.getCursorPos();
    const savedCursor = readline.cursor;
    readline.cursor = readline.line.length;
    const end = readline.getCursorPos();
    readline.cursor = savedCursor;

    output.write("\u001b7");
    if (end.rows === 0 && end.cols < frame.width - 1) {
      cursorTo(output, frame.width - 1);
      output.write(cyan("│", color));
    }
    moveCursor(output, 0, Math.max(0, end.rows - current.rows) + 1);
    cursorTo(output, 0);
    clearLine(output, 0);
    output.write(cyan(frame.bottom, color));
    output.write("\u001b8");
  };
  const onKeypress = () => redrawEdges();
  input.on("keypress", onKeypress);

  try {
    const pending = readline.question(`${cyan("│", color)} `);
    redrawEdges();
    const value = await pending;
    answered = true;
    return value;
  } finally {
    active = false;
    input.off("keypress", onKeypress);
    if (answered) {
      // Enter leaves the cursor on the bottom border. Continue below the box
      // without repainting conversation output or clearing scrollback.
      moveCursor(output, 0, 1);
      cursorTo(output, 0);
    }
  }
}
