import { execFile, spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { SentaurusApi } from "./api.js";
import { defaultConfigPath, loadStoredConfig } from "./config.js";
import type { VmAgentStatus } from "./types.js";
import { statusLine, style } from "./ui.js";

const execFileAsync = promisify(execFile);
const defaultTaskName = "Sentaurus VM Agent IPv6 API";

export type LocalHostOptions = {
  webRepository?: string;
  taskName?: string;
  restartWorker?: boolean;
  configPath?: string;
  quiet?: boolean;
};

export type LocalHostContext = {
  api: SentaurusApi;
  apiUrl: string;
  configPath: string;
  lastSessionId?: string;
  status: VmAgentStatus;
  webRepository: string;
};

export function parseDotEnv(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match?.[1]) continue;
    let value = match[2] || "";
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, "").trim();
    }
    result[match[1]] = value;
  }
  return result;
}

async function isWebRepository(candidate: string): Promise<boolean> {
  try {
    await access(path.join(candidate, ".env"));
    const packageJson = JSON.parse(await readFile(path.join(candidate, "package.json"), "utf8")) as { name?: string };
    return packageJson.name === "sentaurus-web-agent";
  } catch {
    return false;
  }
}

export async function findWebRepository(explicit?: string): Promise<string> {
  const packageSibling = fileURLToPath(new URL("../../Sentaurus-agent", import.meta.url));
  const candidates = [
    explicit,
    process.env.SENTAURUS_WEB_AGENT_REPO,
    path.join(process.cwd(), "Sentaurus-agent"),
    process.cwd(),
    packageSibling,
    process.platform === "win32" ? "E:\\VSCode\\Sentaurus-agent" : undefined
  ].filter((value): value is string => Boolean(value));

  for (const candidate of [...new Set(candidates.map((value) => path.resolve(value)))]) {
    if (await isWebRepository(candidate)) return candidate;
  }
  throw new Error("Sentaurus Web Agent repository was not found. Pass --web-repo or set SENTAURUS_WEB_AGENT_REPO.");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function reachableApi(urls: string[], token: string): Promise<{ api: SentaurusApi; apiUrl: string } | undefined> {
  for (const apiUrl of urls) {
    const api = new SentaurusApi({ baseUrl: apiUrl, token });
    try {
      const health = await api.health(AbortSignal.timeout(2_000));
      if (health.ok) return { api, apiUrl };
    } catch {
      // Try the next loopback family while the service starts.
    }
  }
  return undefined;
}

async function startServer(webRepository: string, taskName: string): Promise<void> {
  if (process.platform === "win32") {
    try {
      await execFileAsync("schtasks.exe", ["/Run", "/TN", taskName], { windowsHide: true });
      return;
    } catch {
      const launcher = fileURLToPath(new URL("../scripts/start-sentaurus-agent-server.ps1", import.meta.url));
      const child = spawn("powershell.exe", [
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-WindowStyle", "Hidden",
        "-File", launcher,
        "-ServerRepository", webRepository
      ], { detached: true, stdio: "ignore", windowsHide: true });
      child.unref();
      return;
    }
  }
  throw new Error("Automatic host service startup currently requires Windows; start sentaurus-web-agent manually.");
}

async function ensureServer(
  webRepository: string,
  taskName: string,
  urls: string[],
  token: string,
  quiet = false
): Promise<{ api: SentaurusApi; apiUrl: string }> {
  const current = await reachableApi(urls, token);
  if (current) return current;

  if (!quiet) process.stdout.write(`${style.dim("Starting the local Sentaurus Web Agent service...")}\n`);
  await startServer(webRepository, taskName);
  for (let attempt = 0; attempt < 45; attempt += 1) {
    await sleep(attempt < 10 ? 500 : 1_000);
    const ready = await reachableApi(urls, token);
    if (ready) return ready;
  }
  throw new Error(`Sentaurus Web Agent did not become ready. Check ${path.join(webRepository, ".ipv6-server.log")}`);
}

export async function bootstrapLocalHost(options: LocalHostOptions = {}): Promise<LocalHostContext> {
  const webRepository = await findWebRepository(options.webRepository);
  const envPath = path.join(webRepository, ".env");
  const env = parseDotEnv(await readFile(envPath, "utf8"));
  const token = env.AUTH_TOKEN?.trim();
  if (!token) throw new Error(`AUTH_TOKEN is missing from ${envPath}`);
  const port = Number.parseInt(env.PORT || "5175", 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid PORT in ${envPath}`);

  const urls = [`http://[::1]:${port}`, `http://127.0.0.1:${port}`];
  const ready = await ensureServer(webRepository, options.taskName || defaultTaskName, urls, token, options.quiet);
  let status: VmAgentStatus | undefined;
  try {
    status = await ready.api.status(AbortSignal.timeout(45_000));
  } catch {
    // connect provides the actionable SSH/deployment error below.
  }

  if (options.restartWorker || !status?.ok || !status.connected || !status.workerRunning) {
    if (!options.quiet) process.stdout.write(`${style.dim("Connecting to CentOS 7 and waking the VM worker...")}\n`);
    const connected = await ready.api.connect(AbortSignal.timeout(120_000));
    status = connected.status;
  }
  if (!status?.ok || !status.connected || !status.workerRunning) {
    throw new Error(status?.error || "CentOS VM worker is not ready");
  }

  const configPath = options.configPath || defaultConfigPath();
  const stored = await loadStoredConfig(configPath);
  if (!options.quiet) process.stdout.write(`${style.green("host ready")} ${ready.apiUrl} | ${statusLine(status)}\n`);
  return {
    api: ready.api,
    apiUrl: ready.apiUrl,
    configPath,
    ...(stored.lastSessionId ? { lastSessionId: stored.lastSessionId } : {}),
    status,
    webRepository
  };
}
