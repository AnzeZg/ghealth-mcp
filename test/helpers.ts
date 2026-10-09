import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import type { TokenProvider } from "../src/core/auth.js";
import { HealthClient } from "../src/core/client.js";
import { type Config, loadConfig } from "../src/core/config.js";
import { createHealthServer } from "../src/core/server.js";

export interface RecordedCall {
  method: string;
  url: URL;
  body: unknown;
  auth: string | null;
}

type Responder = (
  call: RecordedCall,
) => { status?: number; body?: unknown; headers?: Record<string, string> } | undefined;

/** A fetch stand-in that records calls and answers via `respond` (default: 200 {}). */
export function fakeFetch(respond: Responder = () => undefined) {
  const calls: RecordedCall[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const headers = new Headers(init?.headers);
    const call: RecordedCall = {
      method: init?.method ?? "GET",
      url,
      body: typeof init?.body === "string" && init.body.startsWith("{") ? JSON.parse(init.body) : init?.body,
      auth: headers.get("authorization"),
    };
    calls.push(call);
    const reply = respond(call) ?? {};
    return new Response(reply.body === undefined ? "{}" : JSON.stringify(reply.body), {
      status: reply.status ?? 200,
      headers: { "content-type": "application/json", ...reply.headers },
    });
  }) as typeof fetch;
  return { impl, calls };
}

export const staticTokens = (token = "test-token"): TokenProvider => ({
  getAccessToken: async () => token,
  refresh: async () => token,
});

export function testConfig(overrides: Record<string, string> = {}): Config {
  return loadConfig({ DEFAULT_TIMEZONE: "Europe/Ljubljana", ...overrides });
}

/** Connects an MCP client to a server backed by a fake fetch. */
export async function connect(opts: { respond?: Responder; env?: Record<string, string> } = {}) {
  const fetch = fakeFetch((call) => {
    // Settings drive the time zone; answer them unless the test overrides.
    const custom = opts.respond?.(call);
    if (custom) return custom;
    if (call.url.pathname.endsWith("/users/me/settings")) return { body: { timeZone: "Europe/Ljubljana" } };
    return undefined;
  });
  const client = new HealthClient(staticTokens(), { reauthHint: "sign in again", fetchImpl: fetch.impl });
  const server = createHealthServer(client, testConfig(opts.env));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const mcp = new Client({ name: "test", version: "0.0.0" });
  await mcp.connect(clientTransport);
  const apiCalls = () => fetch.calls.filter((c) => !c.url.pathname.endsWith("/users/me/settings"));
  return { mcp, calls: fetch.calls, apiCalls };
}

export function textOf(result: { content?: unknown }): string {
  const content = result.content as Array<{ type: string; text?: string }>;
  return content.map((c) => c.text ?? "").join("\n");
}
