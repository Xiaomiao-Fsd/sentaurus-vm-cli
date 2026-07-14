import assert from "node:assert/strict";
import test from "node:test";
import { ApiError, SentaurusApi } from "../src/api.js";

type SeenRequest = { url: string; init?: RequestInit };

test("API client applies bearer auth except on health", async () => {
  const seen: SeenRequest[] = [];
  const mockFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(input), ...(init ? { init } : {}) });
    if (String(input).endsWith("/api/health")) {
      return Response.json({ ok: true, service: "test", time: "now" });
    }
    return Response.json({ ok: true, checkedAt: "now", sshTarget: "vm", connected: true });
  }) as typeof fetch;
  const api = new SentaurusApi({ baseUrl: "http://[::1]:5175", token: "secret-token", fetchImpl: mockFetch });
  await api.health();
  await api.status();
  assert.equal(new Headers(seen[0]?.init?.headers).get("authorization"), null);
  assert.equal(new Headers(seen[1]?.init?.headers).get("authorization"), "Bearer secret-token");
});

test("API client surfaces structured HTTP errors", async () => {
  const mockFetch = (async () => Response.json({ error: "bad token" }, { status: 401 })) as typeof fetch;
  const api = new SentaurusApi({ baseUrl: "http://localhost:5175", token: "bad", fetchImpl: mockFetch });
  await assert.rejects(api.status(), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 401);
    assert.equal(error.message, "bad token");
    return true;
  });
});

test("SSE parser dispatches named JSON events", async () => {
  const body = [
    "event: ping",
    'data: {"cursor":1}',
    "",
    "event: messages",
    'data: {"cursor":2,"messages":[]}',
    "",
    ""
  ].join("\n");
  const mockFetch = (async () => new Response(body, { headers: { "content-type": "text/event-stream" } })) as typeof fetch;
  const api = new SentaurusApi({ baseUrl: "http://localhost:5175", token: "token", fetchImpl: mockFetch });
  const events: Array<{ event: string; data: unknown }> = [];
  await api.streamMessages(0, (event) => events.push(event));
  assert.deepEqual(events, [
    { event: "ping", data: { cursor: 1 } },
    { event: "messages", data: { cursor: 2, messages: [] } }
  ]);
});

test("API client renames and deletes runs", async () => {
  const seen: SeenRequest[] = [];
  const mockFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(input), ...(init ? { init } : {}) });
    if (init?.method === "PATCH") {
      return Response.json({ run: { id: "run_1", title: "renamed", status: "created", createdAt: "now", updatedAt: "now" } });
    }
    return Response.json({ ok: true });
  }) as typeof fetch;
  const api = new SentaurusApi({ baseUrl: "http://localhost:5175", token: "token", fetchImpl: mockFetch });
  assert.equal((await api.updateRunTitle("run_1", "renamed")).title, "renamed");
  await api.deleteRun("run_1");
  assert.equal(seen[0]?.init?.method, "PATCH");
  assert.equal(seen[0]?.init?.body, JSON.stringify({ title: "renamed" }));
  assert.equal(seen[1]?.init?.method, "DELETE");
});
