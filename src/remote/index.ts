/**
 * Cloudflare Worker entry point: an OAuth 2.1 authorization server for MCP
 * clients (Claude) that signs the owner in with Google, plus the /mcp endpoint.
 */
import OAuthProvider, {
  GrantType,
  OAuthError,
  type TokenExchangeCallbackOptions,
} from "@cloudflare/workers-oauth-provider";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { GoogleAuthError, refreshAccessToken, RefreshingTokenProvider } from "../core/auth.js";
import { HealthClient } from "../core/client.js";
import { loadConfig } from "../core/config.js";
import { createHealthServer } from "../core/server.js";
import { allowedEmails, type Env, type Props } from "./env.js";
import { googleHandler } from "./google-handler.js";

const REAUTH_HINT = "Reconnect the Google Health connector in Claude (Settings → Connectors) to sign in again.";
/** Our MCP access tokens expire a bit before Google's, so refreshes keep both in step. */
const MAX_ACCESS_TOKEN_TTL = 50 * 60;

function ttlFor(googleExpiresAt: number): number {
  const remaining = Math.floor((googleExpiresAt - Date.now()) / 1000) - 120;
  return Math.max(60, Math.min(MAX_ACCESS_TOKEN_TTL, remaining));
}

const apiHandler = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const props = (ctx as ExecutionContext & { props: Props }).props;
    if (!props?.email || !allowedEmails(env).has(props.email)) {
      return new Response("Forbidden: this account is not allowed on this server.", { status: 403 });
    }
    const tokens = new RefreshingTokenProvider(
      {
        accessToken: props.googleAccessToken,
        expiresAt: props.googleExpiresAt,
        refreshToken: props.googleRefreshToken,
      },
      { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET },
    );
    const client = new HealthClient(tokens, { reauthHint: REAUTH_HINT });
    const config = loadConfig(env);
    return createMcpHandler(() => createHealthServer(client, config)).fetch(request);
  },
};

async function tokenExchangeCallback(options: TokenExchangeCallbackOptions<Env>) {
  const props = options.props as Props;
  if (options.grantType === GrantType.AUTHORIZATION_CODE) {
    return { accessTokenTTL: ttlFor(props.googleExpiresAt) };
  }
  if (options.grantType !== GrantType.REFRESH_TOKEN) return undefined;

  try {
    const next = await refreshAccessToken({
      clientId: options.env.GOOGLE_CLIENT_ID,
      clientSecret: options.env.GOOGLE_CLIENT_SECRET,
      refreshToken: props.googleRefreshToken,
    });
    const newProps: Props = {
      ...props,
      googleAccessToken: next.accessToken,
      googleExpiresAt: next.expiresAt,
      googleRefreshToken: next.refreshToken ?? props.googleRefreshToken,
    };
    return { newProps, accessTokenTTL: ttlFor(next.expiresAt) };
  } catch (err) {
    if (err instanceof GoogleAuthError && err.invalidGrant) {
      // Revoked or expired at Google: drop this grant so Claude re-authorizes.
      throw new OAuthError("invalid_grant", { description: "Google access was revoked or expired; please reconnect." });
    }
    throw new OAuthError("temporarily_unavailable", {
      description: "Could not refresh Google access; try again shortly.",
      statusCode: 503,
      headers: { "Retry-After": "30" },
    });
  }
}

function createProvider(origin: string): OAuthProvider<Env> {
  return new OAuthProvider<Env>({
    apiRoute: "/mcp",
    apiHandler,
    defaultHandler: googleHandler,
    authorizeEndpoint: "/authorize",
    tokenEndpoint: "/token",
    clientRegistrationEndpoint: "/register",
    resourceMetadata: { resource: `${origin}/mcp`, resource_name: "Google Health (ghealth-mcp)" },
    accessTokenTTL: MAX_ACCESS_TOKEN_TTL,
    // Keep the MCP grant alive while it's used; Google's own refresh token governs real expiry.
    refreshTokenIdleTTL: 90 * 24 * 3600,
    tokenExchangeCallback,
  });
}

// Tokens are bound to the server's public URL, which differs per deployment, so the
// provider is built for the configured PUBLIC_URL or else the origin being served.
const providers = new Map<string, OAuthProvider<Env>>();

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response> {
    const origin = new URL(env.PUBLIC_URL || request.url).origin.toLowerCase();
    let provider = providers.get(origin);
    if (!provider) {
      provider = createProvider(origin);
      providers.set(origin, provider);
    }
    return provider.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
