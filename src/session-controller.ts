import { SentaurusApi } from "./api.js";
import { loadStoredConfig, updateStoredConfig } from "./config.js";
import { applyProvisionalSessionTitle, PROVISIONAL_SESSION_TITLE } from "./session-title.js";
import type { RunSummary } from "./types.js";

export function findRun(runs: RunSummary[], selector: string): RunSummary {
  const exact = runs.find((run) => run.id === selector);
  if (exact) return exact;
  const normalized = selector.toLocaleLowerCase();
  const exactTitle = runs.filter((run) => run.title.toLocaleLowerCase() === normalized);
  if (exactTitle.length === 1 && exactTitle[0]) return exactTitle[0];
  if (exactTitle.length > 1) throw new Error(`Session title is ambiguous: ${selector}`);
  const matches = runs.filter((run) =>
    run.id.startsWith(selector) || run.title.toLocaleLowerCase().startsWith(normalized)
  );
  if (matches.length === 1 && matches[0]) return matches[0];
  if (matches.length > 1) throw new Error(`Session prefix is ambiguous: ${selector}`);
  throw new Error(`Session not found: ${selector}`);
}

export async function resolveSession(
  api: SentaurusApi,
  selector?: string,
  fallbackId?: string,
  title?: string,
  archivedSessionIds: string[] = []
): Promise<RunSummary> {
  const runs = await api.listRuns();
  if (selector) return findRun(runs, selector);
  const archived = new Set(archivedSessionIds);
  const activeRuns = runs.filter((run) => !archived.has(run.id));
  if (fallbackId && !archived.has(fallbackId)) {
    const existing = activeRuns.find((run) => run.id === fallbackId);
    if (existing) return existing;
  }
  if (activeRuns[0]) return activeRuns[0];
  return api.createRun(title || PROVISIONAL_SESSION_TITLE);
}

export class SessionController {
  private active?: RunSummary;

  constructor(
    private readonly api: SentaurusApi,
    private readonly configPath: string,
    private readonly archivedSessionIds: string[] = []
  ) {}

  get current(): RunSummary {
    if (!this.active) throw new Error("Session controller has not been initialized");
    return this.active;
  }

  async initialize(selector?: string, fallbackId?: string, title?: string): Promise<RunSummary> {
    return this.activate(await resolveSession(this.api, selector, fallbackId, title, this.archivedSessionIds));
  }

  async list(includeArchived = false): Promise<{ runs: RunSummary[]; archived: Set<string> }> {
    const stored = await loadStoredConfig(this.configPath);
    const archived = new Set(stored.archivedSessionIds || []);
    const runs = await this.api.listRuns();
    return { runs: includeArchived ? runs : runs.filter((run) => !archived.has(run.id)), archived };
  }

  async create(title?: string): Promise<RunSummary> {
    return this.activate(await this.api.createRun(title || PROVISIONAL_SESSION_TITLE));
  }

  async resume(selector: string): Promise<RunSummary> {
    return this.activate(findRun(await this.api.listRuns(), selector));
  }

  async rename(title: string): Promise<RunSummary> {
    return this.activate(await this.api.updateRunTitle(this.current.id, title));
  }

  async titleFromFirstPrompt(prompt: string): Promise<RunSummary> {
    this.active = await applyProvisionalSessionTitle(this.api, this.current, prompt);
    return this.active;
  }

  async archive(): Promise<RunSummary> {
    const stored = await loadStoredConfig(this.configPath);
    const archived = [...new Set([...(stored.archivedSessionIds || []), this.current.id])];
    await updateStoredConfig({ archivedSessionIds: archived }, this.configPath);
    const next = (await this.api.listRuns()).find((run) => !archived.includes(run.id));
    return this.activate(next || await this.api.createRun(PROVISIONAL_SESSION_TITLE));
  }

  private async activate(session: RunSummary): Promise<RunSummary> {
    this.active = session;
    await updateStoredConfig({ lastSessionId: session.id }, this.configPath);
    return session;
  }
}
