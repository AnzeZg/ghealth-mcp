/** Thin, runtime-agnostic client for the Google Health API v4. */
import { GoogleAuthError, type TokenProvider } from "./auth.js";

export const API_ROOT = "https://health.googleapis.com";

export class HealthApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly hint?: string,
  ) {
    super(message);
    this.name = "HealthApiError";
  }
}

export type ListParams = {
  filter?: string;
  pageSize?: number;
  pageToken?: string;
  dataSourceFamily?: string;
};

export interface ClientOptions {
  /** Shown in 401 errors, e.g. "run `ghealth-mcp auth`". */
  reauthHint: string;
  fetchImpl?: typeof fetch;
  /** Max seconds to wait on a 429 before retrying once. */
  maxRetryAfterSeconds?: number;
}

type Json = Record<string, unknown>;

interface GoogleErrorBody {
  error?: { code?: number; message?: string; status?: string };
}

export class HealthClient {
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly tokens: TokenProvider,
    private readonly options: ClientOptions,
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch.bind(globalThis);
  }

  // ---- data points ------------------------------------------------------

  private dataPointsPath(type: string, version = "v4"): string {
    return `${version}/users/me/dataTypes/${encodeURIComponent(type)}/dataPoints`;
  }

  /** Accepts a bare id or a full resource name ("users/…/dataPoints/{id}"). */
  private dataPointPath(type: string, id: string, version = "v4"): string {
    const bare = id.includes("/") ? id.split("/").pop()! : id;
    return `${this.dataPointsPath(type, version)}/${encodeURIComponent(bare)}`;
  }

  list(type: string, params: ListParams, version = "v4"): Promise<Json> {
    return this.request("GET", this.dataPointsPath(type, version), { query: params });
  }

  reconcile(type: string, params: ListParams, version = "v4"): Promise<Json> {
    return this.request("GET", `${this.dataPointsPath(type, version)}:reconcile`, { query: params });
  }

  get(type: string, id: string, version = "v4"): Promise<Json> {
    return this.request("GET", this.dataPointPath(type, id, version));
  }

  create(type: string, dataPoint: Json): Promise<Json> {
    return this.request("POST", this.dataPointsPath(type), { body: dataPoint });
  }

  update(type: string, id: string, dataPoint: Json): Promise<Json> {
    return this.request("PATCH", this.dataPointPath(type, id), { body: dataPoint });
  }

  batchDelete(type: string, ids: string[]): Promise<Json> {
    const names = ids.map((id) => (id.startsWith("users/") ? id : `users/me/dataTypes/${type}/dataPoints/${id}`));
    return this.request("POST", `${this.dataPointsPath(type)}:batchDelete`, { body: { names } });
  }

  rollUp(type: string, body: Json): Promise<Json> {
    return this.request("POST", `${this.dataPointsPath(type)}:rollUp`, { body });
  }

  dailyRollUp(type: string, body: Json): Promise<Json> {
    return this.request("POST", `${this.dataPointsPath(type)}:dailyRollUp`, { body });
  }

  exportExerciseTcx(id: string, partialData?: boolean): Promise<Json> {
    return this.request("GET", `${this.dataPointPath("exercise", id)}:exportExerciseTcx`, {
      query: partialData === undefined ? {} : { partialData },
    });
  }

  // ---- user resources ---------------------------------------------------

  getUserResource(resource: "identity" | "profile" | "settings" | "irnProfile"): Promise<Json> {
    return this.request("GET", `v4/users/me/${resource}`);
  }

  updateUserResource(resource: "profile" | "settings", body: Json, updateMask?: string): Promise<Json> {
    return this.request("PATCH", `v4/users/me/${resource}`, {
      body,
      query: updateMask ? { updateMask } : {},
    });
  }

  listPairedDevices(params: { pageSize?: number; pageToken?: string } = {}): Promise<Json> {
    return this.request("GET", "v4/users/me/pairedDevices", { query: params });
  }

  // ---- transport ----------------------------------------------------------

  private async request(
    method: string,
    path: string,
    opts: { query?: Record<string, unknown>; body?: unknown } = {},
  ): Promise<Json> {
    const url = new URL(`${API_ROOT}/${path}`);
    for (const [key, value] of Object.entries(opts.query ?? {})) {
      if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
    }

    const send = async (token: string) =>
      this.fetchImpl(url.toString(), {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          ...(opts.body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      });

    let res = await send(await this.accessToken(() => this.tokens.getAccessToken()));
    if (res.status === 401) {
      res = await send(await this.accessToken(() => this.tokens.refresh()));
    }
    if (res.status === 429) {
      const wait = Math.min(Number(res.headers.get("retry-after") ?? 2) || 2, this.options.maxRetryAfterSeconds ?? 10);
      await new Promise((r) => setTimeout(r, wait * 1000));
      res = await send(await this.accessToken(() => this.tokens.getAccessToken()));
    }

    const text = await res.text();
    if (!res.ok) throw this.toError(res.status, text, method, path);
    if (!text) return {};
    try {
      return JSON.parse(text) as Json;
    } catch {
      return { raw: text };
    }
  }

  private async accessToken(get: () => Promise<string>): Promise<string> {
    try {
      return await get();
    } catch (err) {
      if (err instanceof GoogleAuthError) {
        throw new HealthApiError(err.message, 401, "UNAUTHENTICATED", this.options.reauthHint);
      }
      throw err;
    }
  }

  private toError(status: number, text: string, method: string, path: string): HealthApiError {
    let parsed: GoogleErrorBody = {};
    try {
      parsed = JSON.parse(text) as GoogleErrorBody;
    } catch {
      /* non-JSON error body */
    }
    const code = parsed.error?.status ?? `HTTP_${status}`;
    const message = parsed.error?.message ?? (text.slice(0, 500) || `HTTP ${status}`);
    let hint: string | undefined;
    switch (status) {
      case 400:
        hint = message.includes("ACCOUNT_NOT_LINKED")
          ? "This Google account is not linked to a Fitbit / Google Health account."
          : "Check the request against describe_data_type.";
        break;
      case 401:
        hint = this.options.reauthHint;
        break;
      case 403:
        hint =
          "Permission denied. The category may not be enabled (ENABLED_CATEGORIES) or the OAuth grant is missing that scope; sign in again after enabling it.";
        break;
      case 404:
        hint = "Not found. Check the data type and id (ids come from read_data).";
        break;
      case 429:
        hint = "Rate limited by Google. Wait a minute and try again.";
        break;
    }
    return new HealthApiError(`${method} ${path} failed (${status} ${code}): ${message}`, status, code, hint);
  }
}
