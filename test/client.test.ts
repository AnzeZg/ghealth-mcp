import { describe, expect, it } from "vitest";
import { GoogleAuthError, RefreshingTokenProvider } from "../src/core/auth.js";
import { HealthApiError, HealthClient } from "../src/core/client.js";
import { fakeFetch, staticTokens } from "./helpers.js";

describe("HealthClient", () => {
  it("sends list queries to the right URL", async () => {
    const f = fakeFetch(() => ({ body: { dataPoints: [] } }));
    const client = new HealthClient(staticTokens("abc"), { reauthHint: "x", fetchImpl: f.impl });
    await client.list("steps", { filter: 'steps.interval.civil_start_time >= "2026-10-01"', pageSize: 10 });
    const call = f.calls[0]!;
    expect(call.url.pathname).toBe("/v4/users/me/dataTypes/steps/dataPoints");
    expect(call.url.searchParams.get("filter")).toBe('steps.interval.civil_start_time >= "2026-10-01"');
    expect(call.url.searchParams.get("pageSize")).toBe("10");
    expect(call.auth).toBe("Bearer abc");
  });

  it("uses v4beta when asked and full names for batchDelete", async () => {
    const f = fakeFetch();
    const client = new HealthClient(staticTokens(), { reauthHint: "x", fetchImpl: f.impl });
    await client.list("skin-temperature-sensors", {}, "v4beta");
    await client.batchDelete("weight", ["123", "users/me/dataTypes/weight/dataPoints/456"]);
    expect(f.calls[0]!.url.pathname).toBe("/v4beta/users/me/dataTypes/skin-temperature-sensors/dataPoints");
    expect(f.calls[1]!.url.pathname).toBe("/v4/users/me/dataTypes/weight/dataPoints:batchDelete");
    expect(f.calls[1]!.body).toEqual({
      names: ["users/me/dataTypes/weight/dataPoints/123", "users/me/dataTypes/weight/dataPoints/456"],
    });
  });

  it("refreshes the token once on 401", async () => {
    let calls = 0;
    const f = fakeFetch(() =>
      ++calls === 1 ? { status: 401, body: { error: { status: "UNAUTHENTICATED" } } } : { body: { ok: true } },
    );
    let refreshed = 0;
    const tokens = { getAccessToken: async () => "old", refresh: async () => (refreshed++, "new") };
    const client = new HealthClient(tokens, { reauthHint: "x", fetchImpl: f.impl });
    expect(await client.getUserResource("identity")).toEqual({ ok: true });
    expect(refreshed).toBe(1);
    expect(f.calls.map((c) => c.auth)).toEqual(["Bearer old", "Bearer new"]);
  });

  it("maps API errors with hints", async () => {
    const f = fakeFetch(() => ({
      status: 403,
      body: { error: { code: 403, status: "PERMISSION_DENIED", message: "nope" } },
    }));
    const client = new HealthClient(staticTokens(), { reauthHint: "x", fetchImpl: f.impl });
    const err = await client.get("weight", "1").catch((e) => e);
    expect(err).toBeInstanceOf(HealthApiError);
    expect(err.status).toBe(403);
    expect(err.code).toBe("PERMISSION_DENIED");
    expect(err.hint).toMatch(/ENABLED_CATEGORIES/);
  });

  it("turns dead refresh tokens into a re-auth error", async () => {
    const tokens = {
      getAccessToken: async () => {
        throw new GoogleAuthError("revoked", true);
      },
      refresh: async () => "",
    };
    const client = new HealthClient(tokens, { reauthHint: "run auth", fetchImpl: fakeFetch().impl });
    const err = await client.getUserResource("identity").catch((e) => e);
    expect(err).toBeInstanceOf(HealthApiError);
    expect(err.hint).toBe("run auth");
  });
});

describe("RefreshingTokenProvider", () => {
  it("refreshes when close to expiry and persists the result", async () => {
    const f = fakeFetch(() => ({ body: { access_token: "fresh", expires_in: 3600 } }));
    const saved: unknown[] = [];
    const provider = new RefreshingTokenProvider(
      { accessToken: "stale", expiresAt: Date.now() + 10_000, refreshToken: "r1" },
      { clientId: "id", clientSecret: "secret" },
      (t) => {
        saved.push(t);
      },
      f.impl,
    );
    expect(await provider.getAccessToken()).toBe("fresh");
    expect(f.calls[0]!.url.href).toBe("https://oauth2.googleapis.com/token");
    expect(saved).toHaveLength(1);
    expect((saved[0] as { refreshToken: string }).refreshToken).toBe("r1");
  });

  it("flags invalid_grant", async () => {
    const f = fakeFetch(() => ({ status: 400, body: { error: "invalid_grant" } }));
    const provider = new RefreshingTokenProvider(
      { accessToken: "x", expiresAt: 0, refreshToken: "r" },
      { clientId: "id", clientSecret: "s" },
      undefined,
      f.impl,
    );
    const err = await provider.getAccessToken().catch((e) => e);
    expect(err).toBeInstanceOf(GoogleAuthError);
    expect(err.invalidGrant).toBe(true);
  });
});
