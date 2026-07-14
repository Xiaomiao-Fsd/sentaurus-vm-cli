import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  RunSummary,
  StreamEvent,
  UploadRunFileResponse,
  VmAgentAttachmentRef,
  VmAgentConnectResponse,
  VmAgentHistoryResponse,
  VmAgentMessageAttachment,
  VmAgentMessageResponse,
  VmAgentModelId,
  VmAgentModelsResponse,
  VmAgentStatus,
  VmHostStatus,
  VmSessionFilesResponse,
  VmSessionOutputCategory
} from "./types.js";

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

export type SentaurusApiOptions = {
  baseUrl: string;
  token: string;
  fetchImpl?: typeof fetch;
};

function errorMessage(status: number, body: unknown): string {
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    if (typeof record.message === "string" && record.message) return record.message;
    if (typeof record.error === "string" && record.error) return record.error;
  }
  if (typeof body === "string" && body.trim()) return body;
  return `Request failed with HTTP ${status}`;
}

async function parseResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function contentDispositionName(value: string | null): string | undefined {
  if (!value) return undefined;
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(value)?.[1];
  if (utf8) {
    try { return decodeURIComponent(utf8); } catch { /* use ASCII fallback */ }
  }
  return /filename="([^"]+)"/i.exec(value)?.[1];
}

function withSignal(signal?: AbortSignal): { signal: AbortSignal } | Record<string, never> {
  return signal ? { signal } : {};
}

export class SentaurusApi {
  readonly baseUrl: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: SentaurusApiOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.token = options.token;
    this.fetchImpl = options.fetchImpl || fetch;
  }

  private async request(pathname: string, options: RequestInit = {}, authenticated = true): Promise<Response> {
    const headers = new Headers(options.headers);
    if (authenticated && this.token) headers.set("authorization", `Bearer ${this.token}`);
    if (options.body && !(options.body instanceof FormData) && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${pathname}`, { ...options, headers });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Cannot reach ${this.baseUrl}: ${detail}`);
    }
    if (!response.ok) {
      const body = await parseResponse(response);
      throw new ApiError(response.status, errorMessage(response.status, body), body);
    }
    return response;
  }

  private async json<T>(pathname: string, options: RequestInit = {}, authenticated = true): Promise<T> {
    return await parseResponse(await this.request(pathname, options, authenticated)) as T;
  }

  health(signal?: AbortSignal): Promise<{ ok: boolean; service: string; time: string }> {
    return this.json("/api/health", withSignal(signal), false);
  }

  status(signal?: AbortSignal): Promise<VmAgentStatus> {
    return this.json("/api/vm/agent/status", withSignal(signal));
  }

  vmStatus(signal?: AbortSignal): Promise<VmHostStatus> {
    return this.json("/api/vm/status", withSignal(signal));
  }

  connect(signal?: AbortSignal): Promise<VmAgentConnectResponse> {
    return this.json("/api/vm/agent/connect", { method: "POST", body: "{}", ...withSignal(signal) });
  }

  models(signal?: AbortSignal): Promise<VmAgentModelsResponse> {
    return this.json("/api/vm/agent/models", withSignal(signal));
  }

  setModel(model: VmAgentModelId, signal?: AbortSignal): Promise<VmAgentModelsResponse> {
    return this.json("/api/vm/agent/model", {
      method: "PUT",
      body: JSON.stringify({ model }),
      ...withSignal(signal)
    });
  }

  async listRuns(signal?: AbortSignal): Promise<RunSummary[]> {
    const body = await this.json<{ runs: RunSummary[] }>("/api/runs", withSignal(signal));
    return body.runs;
  }

  async createRun(title: string, signal?: AbortSignal): Promise<RunSummary> {
    const body = await this.json<{ run: RunSummary }>("/api/runs", {
      method: "POST",
      body: JSON.stringify({ title }),
      ...withSignal(signal)
    });
    return body.run;
  }

  async updateRunTitle(id: string, title: string, signal?: AbortSignal): Promise<RunSummary> {
    const body = await this.json<{ run: RunSummary }>(`/api/runs/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ title }),
      ...withSignal(signal)
    });
    return body.run;
  }

  async deleteRun(id: string, signal?: AbortSignal): Promise<void> {
    await this.json<{ ok: boolean }>(`/api/runs/${encodeURIComponent(id)}`, {
      method: "DELETE",
      ...withSignal(signal)
    });
  }

  messages(after = 0, options: { limit?: number; sessionId?: string; signal?: AbortSignal } = {}): Promise<VmAgentHistoryResponse> {
    const query = new URLSearchParams({ after: String(after), limit: String(options.limit || 100) });
    if (options.sessionId) query.set("sessionId", options.sessionId);
    return this.json(`/api/vm/agent/messages?${query}`, withSignal(options.signal));
  }

  sendMessage(
    message: string,
    sessionId: string,
    attachments: VmAgentAttachmentRef[] = [],
    displayAttachments: VmAgentMessageAttachment[] = [],
    signal?: AbortSignal
  ): Promise<VmAgentMessageResponse> {
    return this.json("/api/vm/agent/messages", {
      method: "POST",
      body: JSON.stringify({ message, sessionId, attachments, displayAttachments }),
      ...withSignal(signal)
    });
  }

  async uploadFile(sessionId: string, localPath: string, signal?: AbortSignal): Promise<{ response: UploadRunFileResponse; ref: VmAgentAttachmentRef; display: VmAgentMessageAttachment }> {
    const data = await readFile(localPath);
    const name = path.basename(localPath);
    const form = new FormData();
    form.append("file", new Blob([data]), name);
    const response = await this.json<UploadRunFileResponse>(`/api/runs/${encodeURIComponent(sessionId)}/files`, {
      method: "POST",
      body: form,
      ...withSignal(signal)
    });
    const synced = response.vmSync?.ok;
    const source = synced ? "vm-session-file" : "run-input";
    const extension = path.extname(name).toLowerCase();
    const imageType = new Map([
      [".png", "image/png"],
      [".jpg", "image/jpeg"],
      [".jpeg", "image/jpeg"],
      [".gif", "image/gif"],
      [".webp", "image/webp"],
      [".bmp", "image/bmp"]
    ]).get(extension);
    const ref: VmAgentAttachmentRef = {
      id: `cli_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      source,
      name: response.file.name,
      path: synced ? response.vmSync.path || response.file.name : response.file.name,
      size: response.file.size,
      runId: sessionId,
      ...(imageType ? { contentType: imageType } : {}),
      ...(synced && response.vmSync.category ? { category: response.vmSync.category } : {})
    };
    return {
      response,
      ref,
      display: { ...ref, source: "run-input", path: response.file.name, kind: imageType ? "image" : "file" }
    };
  }

  sessionFiles(sessionId: string, signal?: AbortSignal): Promise<VmSessionFilesResponse> {
    return this.json(`/api/vm/agent/sessions/${encodeURIComponent(sessionId)}/files`, withSignal(signal));
  }

  async downloadSessionFile(
    sessionId: string,
    category: VmSessionOutputCategory,
    filePath: string,
    outputPath?: string,
    signal?: AbortSignal
  ): Promise<string> {
    const query = new URLSearchParams({ category, path: filePath });
    const response = await this.request(`/api/vm/agent/sessions/${encodeURIComponent(sessionId)}/files/download?${query}`, withSignal(signal));
    const destination = outputPath || contentDispositionName(response.headers.get("content-disposition")) || path.basename(filePath);
    await writeFile(destination, new Uint8Array(await response.arrayBuffer()));
    return path.resolve(destination);
  }

  async downloadArtifact(runId: string, artifactPath: string, outputPath?: string, signal?: AbortSignal): Promise<string> {
    const query = new URLSearchParams({ path: artifactPath });
    const response = await this.request(`/api/vm/agent/runs/${encodeURIComponent(runId)}/artifacts?${query}`, withSignal(signal));
    const destination = outputPath || contentDispositionName(response.headers.get("content-disposition")) || path.basename(artifactPath);
    await writeFile(destination, new Uint8Array(await response.arrayBuffer()));
    return path.resolve(destination);
  }

  async streamMessages(after: number, onEvent: (event: StreamEvent) => void, signal?: AbortSignal): Promise<void> {
    const response = await this.request(`/api/vm/agent/messages/stream?after=${encodeURIComponent(String(after))}`, {
      headers: { accept: "text/event-stream" },
      ...withSignal(signal)
    });
    if (!response.body) throw new Error("SSE response has no body");
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    let eventName = "message";
    let dataLines: string[] = [];
    const dispatch = () => {
      if (dataLines.length === 0) return;
      const raw = dataLines.join("\n");
      let data: unknown = raw;
      try { data = JSON.parse(raw); } catch { /* keep text */ }
      onEvent({ event: eventName, data });
      eventName = "message";
      dataLines = [];
    };
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      buffer += item.value;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line) {
          dispatch();
        } else if (line.startsWith("event:")) {
          eventName = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).trimStart());
        }
      }
    }
    dispatch();
  }
}
