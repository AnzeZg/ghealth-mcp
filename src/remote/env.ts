import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

export interface Env {
  OAUTH_KV: KVNamespace;
  /** Injected by OAuthProvider into the default handler's env. */
  OAUTH_PROVIDER: OAuthHelpers;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  /** Comma-separated Google account emails allowed to connect (the owner lock). */
  ALLOWED_EMAILS: string;
  /** Optional canonical URL (e.g. a custom domain); defaults to the origin being served. */
  PUBLIC_URL?: string;
  ENABLED_CATEGORIES?: string;
  DEFAULT_TIMEZONE?: string;
  MAX_RESPONSE_BYTES?: string;
}

/** Encrypted per-grant data stored by workers-oauth-provider and handed to /mcp requests. */
export interface Props {
  email: string;
  googleAccessToken: string;
  googleRefreshToken: string;
  /** Epoch milliseconds. */
  googleExpiresAt: number;
  googleScope?: string;
}

export function allowedEmails(env: Env): Set<string> {
  return new Set(
    (env.ALLOWED_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}
