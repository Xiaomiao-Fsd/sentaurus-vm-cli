import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type StoredConfig = {
  apiUrl?: string;
  authToken?: string;
  lastSessionId?: string;
  archivedSessionIds?: string[];
};

export type ResolvedConfig = {
  apiUrl: string;
  authToken: string;
  lastSessionId?: string;
  archivedSessionIds: string[];
  path: string;
};

export function defaultConfigPath(): string {
  return process.env.SENTAURUS_VM_CONFIG || path.join(os.homedir(), ".sentaurus-vm-cli", "config.json");
}

export function normalizeApiUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`Invalid API URL: ${value}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("API URL must use http:// or https://");
  }
  if (parsed.username || parsed.password) {
    throw new Error("Do not place credentials in the API URL");
  }
  if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error("API URL must contain only scheme, host, and optional port");
  }
  return parsed.origin;
}

export async function loadStoredConfig(configPath = defaultConfigPath()): Promise<StoredConfig> {
  try {
    const value = JSON.parse(await readFile(configPath, "utf8")) as StoredConfig;
    if (!value || typeof value !== "object") return {};
    const archivedSessionIds = Array.isArray(value.archivedSessionIds)
      ? [...new Set(value.archivedSessionIds.filter((item): item is string => typeof item === "string" && item.length > 0))]
      : undefined;
    return { ...value, ...(archivedSessionIds ? { archivedSessionIds } : {}) };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return {};
    if (error instanceof SyntaxError) throw new Error(`Config is not valid JSON: ${configPath}`);
    throw error;
  }
}

export async function resolveConfig(overrides: StoredConfig = {}, configPath = defaultConfigPath()): Promise<ResolvedConfig> {
  const stored = await loadStoredConfig(configPath);
  const apiUrl = normalizeApiUrl(
    overrides.apiUrl || process.env.SENTAURUS_VM_URL || stored.apiUrl || ""
  );
  const authToken = (overrides.authToken || process.env.SENTAURUS_VM_TOKEN || stored.authToken || "").trim();
  const lastSessionId = overrides.lastSessionId || stored.lastSessionId;
  const archivedSessionIds = overrides.archivedSessionIds || stored.archivedSessionIds || [];
  return {
    apiUrl,
    authToken,
    ...(lastSessionId ? { lastSessionId } : {}),
    archivedSessionIds,
    path: configPath
  };
}

export async function saveStoredConfig(value: StoredConfig, configPath = defaultConfigPath()): Promise<void> {
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  if (process.platform !== "win32") await chmod(configPath, 0o600);
}

export async function updateStoredConfig(patch: StoredConfig, configPath = defaultConfigPath()): Promise<StoredConfig> {
  const current = await loadStoredConfig(configPath);
  const next = { ...current, ...patch };
  await saveStoredConfig(next, configPath);
  return next;
}

export async function removeStoredConfigKeys(
  keys: Array<keyof StoredConfig>,
  configPath = defaultConfigPath()
): Promise<StoredConfig> {
  const current = await loadStoredConfig(configPath);
  for (const key of keys) delete current[key];
  await saveStoredConfig(current, configPath);
  return current;
}

export function maskedToken(token: string): string {
  if (!token) return "<not configured>";
  if (token.length < 9) return "********";
  return `${token.slice(0, 4)}...${token.slice(-4)}`;
}
