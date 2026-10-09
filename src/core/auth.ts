/** Google OAuth token handling shared by the local and remote entry points. */

export const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

/** Supplies Google access tokens to the API client. */
export interface TokenProvider {
  getAccessToken(): Promise<string>;
  /** Forces a refresh (called after a 401). */
  refresh(): Promise<string>;
}

export interface GoogleTokens {
  accessToken: string;
  /** Epoch milliseconds. */
  expiresAt: number;
  refreshToken?: string;
  scope?: string;
}

export class GoogleAuthError extends Error {
  constructor(
    message: string,
    /** True when the refresh token is permanently invalid (revoked / expired). */
    readonly invalidGrant: boolean,
    readonly status?: number,
  ) {
    super(message);
    this.name = "GoogleAuthError";
  }
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

async function postToken(params: Record<string, string>, fetchImpl: typeof fetch): Promise<GoogleTokens> {
  const res = await fetchImpl(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  const body = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || !body.access_token) {
    const code = body.error ?? `http_${res.status}`;
    throw new GoogleAuthError(
      `Google token request failed: ${code}${body.error_description ? ` (${body.error_description})` : ""}`,
      code === "invalid_grant",
      res.status,
    );
  }
  return {
    accessToken: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
    refreshToken: body.refresh_token,
    scope: body.scope,
  };
}

export function exchangeCode(
  opts: { clientId: string; clientSecret: string; code: string; redirectUri: string; codeVerifier?: string },
  fetchImpl: typeof fetch = fetch,
): Promise<GoogleTokens> {
  const params: Record<string, string> = {
    grant_type: "authorization_code",
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
    code: opts.code,
    redirect_uri: opts.redirectUri,
  };
  if (opts.codeVerifier) params.code_verifier = opts.codeVerifier;
  return postToken(params, fetchImpl);
}

export function refreshAccessToken(
  opts: { clientId: string; clientSecret: string; refreshToken: string },
  fetchImpl: typeof fetch = fetch,
): Promise<GoogleTokens> {
  return postToken(
    {
      grant_type: "refresh_token",
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
      refresh_token: opts.refreshToken,
    },
    fetchImpl,
  );
}

export function buildAuthorizeUrl(opts: {
  clientId: string;
  redirectUri: string;
  scopes: string[];
  state: string;
  codeChallenge?: string;
  loginHint?: string;
}): string {
  const url = new URL(GOOGLE_AUTHORIZE_URL);
  url.searchParams.set("client_id", opts.clientId);
  url.searchParams.set("redirect_uri", opts.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", opts.scopes.join(" "));
  url.searchParams.set("state", opts.state);
  // offline + consent guarantees a refresh token on every authorization.
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  if (opts.codeChallenge) {
    url.searchParams.set("code_challenge", opts.codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
  }
  if (opts.loginHint) url.searchParams.set("login_hint", opts.loginHint);
  return url.toString();
}

export async function fetchUserEmail(accessToken: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const res = await fetchImpl(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new GoogleAuthError(`Could not read Google account info (${res.status})`, false, res.status);
  const body = (await res.json()) as { email?: string; email_verified?: boolean };
  if (!body.email) throw new GoogleAuthError("Google account has no email", false);
  return body.email.toLowerCase();
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function randomToken(bytes = 32): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** PKCE S256 code challenge for a verifier. */
export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

/**
 * TokenProvider backed by an access/refresh token pair. `onRefresh` lets the
 * caller persist rotated tokens (local file, etc.).
 */
export class RefreshingTokenProvider implements TokenProvider {
  private tokens: GoogleTokens;
  private inflight?: Promise<string>;

  constructor(
    initial: GoogleTokens,
    private readonly client: { clientId: string; clientSecret: string },
    private readonly onRefresh?: (tokens: GoogleTokens) => void | Promise<void>,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.tokens = initial;
  }

  async getAccessToken(): Promise<string> {
    if (this.tokens.expiresAt - Date.now() > 60_000) return this.tokens.accessToken;
    return this.refresh();
  }

  refresh(): Promise<string> {
    this.inflight ??= this.doRefresh().finally(() => {
      this.inflight = undefined;
    });
    return this.inflight;
  }

  private async doRefresh(): Promise<string> {
    if (!this.tokens.refreshToken) {
      throw new GoogleAuthError("No refresh token available; please sign in again.", true);
    }
    const next = await refreshAccessToken({ ...this.client, refreshToken: this.tokens.refreshToken }, this.fetchImpl);
    this.tokens = { ...next, refreshToken: next.refreshToken ?? this.tokens.refreshToken };
    await this.onRefresh?.(this.tokens);
    return this.tokens.accessToken;
  }
}
