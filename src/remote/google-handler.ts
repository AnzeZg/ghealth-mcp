/**
 * The authorization UI: a consent page for the MCP client, then Google sign-in,
 * then the owner-lock check, then completion back to the MCP client.
 */
import {
  AuthorizationError,
  authorizationErrorRedirect,
  CimdFetchError,
  type ConsentDescription,
} from "@cloudflare/workers-oauth-provider";
import { buildAuthorizeUrl, exchangeCode, fetchUserEmail, pkceChallenge, randomToken } from "../core/auth.js";
import { scopesFor } from "../core/categories.js";
import { loadConfig } from "../core/config.js";
import { allowedEmails, type Env, type Props } from "./env.js";

const escape = (value: string) => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function html(body: string, status = 200, headers = new Headers()): Response {
  headers.set("Content-Type", "text/html; charset=utf-8");
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ghealth-mcp</title><body style="font-family:system-ui,sans-serif;max-width:34rem;margin:3rem auto;padding:0 1rem;line-height:1.5">${body}</body>`,
    { status, headers },
  );
}

function consentPage(details: ConsentDescription, handle: string, owners: string): string {
  const name = escape(details.clientName || "An MCP client");
  const origin = details.clientDomain
    ? `Published by <strong>${escape(details.clientDomain)}</strong>.`
    : "This app registered itself; its name is not verified.";
  return `<h1>Connect ${name} to your Google Health data?</h1>
<p>${origin} Access will be sent to <strong>${escape(details.redirectHost)}</strong>.</p>
${details.redirectIsLoopback ? "<p><strong>This sends access to an app on your computer.</strong> Continue only if you just started connecting from it.</p>" : ""}
<p>Next you'll sign in with Google. Only ${escape(owners)} can connect to this server.</p>
<form method="post">
  <input type="hidden" name="handle" value="${escape(handle)}">
  <p><button name="decision" value="approve">Continue to Google</button> <button name="decision" value="deny">Cancel</button></p>
</form>`;
}

function renderError(error: unknown): Response {
  if (error instanceof AuthorizationError && error.redirectTo) return Response.redirect(error.redirectTo, 302);
  if (error instanceof AuthorizationError || error instanceof CimdFetchError) {
    const message = error instanceof AuthorizationError ? error.description : "This app could not be verified.";
    return html(
      `<h1>Can't continue</h1><p>${escape(message ?? "Invalid request")}</p><p>Start connecting again from your app.</p>`,
      400,
    );
  }
  throw error;
}

async function authorizeGet(request: Request, env: Env): Promise<Response> {
  const oauth = env.OAUTH_PROVIDER;
  const authRequest = await oauth.parseAuthRequest(request);
  const details = await oauth.describeConsent(authRequest);
  const consent = await oauth.beginConsent(authRequest);
  const owners = [...allowedEmails(env)].join(", ") || "the configured owner";
  return html(consentPage(details, consent.handle, owners), 200, consent.headers);
}

async function authorizePost(request: Request, env: Env): Promise<Response> {
  const oauth = env.OAUTH_PROVIDER;
  const form = await request.formData();
  const handle = String(form.get("handle") ?? "");
  if (form.get("decision") !== "approve") {
    const denied = await oauth.denyConsent(request, handle);
    return new Response(null, { status: 302, headers: denied.headers });
  }
  const approved = await oauth.approveConsent(request, handle);
  const verifier = randomToken(48);
  const { state, headers } = await oauth.beginUpstream(approved.request, {
    data: { verifier },
    headers: approved.headers,
  });
  const owners = [...allowedEmails(env)];
  headers.set(
    "Location",
    buildAuthorizeUrl({
      clientId: env.GOOGLE_CLIENT_ID,
      redirectUri: new URL("/callback", request.url).href,
      scopes: scopesFor(loadConfig(env).enabled),
      state,
      codeChallenge: await pkceChallenge(verifier),
      loginHint: owners.length === 1 ? owners[0] : undefined,
    }),
  );
  return new Response(null, { status: 302, headers });
}

async function callback(request: Request, env: Env): Promise<Response> {
  const oauth = env.OAUTH_PROVIDER;
  const url = new URL(request.url);
  const { request: original, data, headers } = await oauth.finishUpstream<{ verifier: string }>(request);

  if (url.searchParams.get("error")) {
    headers.set("Location", authorizationErrorRedirect(original, "access_denied"));
    return new Response(null, { status: 302, headers });
  }
  const code = url.searchParams.get("code");
  if (!code) return html("<h1>Sign-in failed</h1><p>Google did not return an authorization code.</p>", 400);

  const tokens = await exchangeCode({
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    code,
    redirectUri: new URL("/callback", request.url).href,
    codeVerifier: data.verifier,
  });
  const email = await fetchUserEmail(tokens.accessToken);

  if (!allowedEmails(env).has(email)) {
    // Not the owner: refuse and tell the client the user denied access.
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(tokens.accessToken)}`, {
      method: "POST",
    }).catch(() => undefined);
    return html(
      `<h1>Not allowed</h1><p>${escape(email)} is not allowed to use this server. This is a personal server: deploy your own copy to connect your own Google account.</p>`,
      403,
    );
  }
  if (!tokens.refreshToken) {
    return html(
      "<h1>Sign-in incomplete</h1><p>Google did not return a refresh token. Please try connecting again.</p>",
      400,
    );
  }

  const props: Props = {
    email,
    googleAccessToken: tokens.accessToken,
    googleRefreshToken: tokens.refreshToken,
    googleExpiresAt: tokens.expiresAt,
    googleScope: tokens.scope,
  };
  const { redirectTo } = await oauth.completeAuthorization({
    request: original,
    userId: email,
    metadata: { label: email },
    scope: original.scope,
    props,
  });
  headers.set("Location", redirectTo);
  return new Response(null, { status: 302, headers });
}

function home(request: Request, env: Env): Response {
  const mcpUrl = new URL("/mcp", request.url).href;
  const configured = env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && allowedEmails(env).size > 0;
  return html(`<h1>ghealth-mcp</h1>
<p>A personal MCP server for Google Health data.</p>
<p>${configured ? "✅ Configured." : "⚠️ Missing configuration: set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and ALLOWED_EMAILS."}</p>
<p>Add this URL as a custom connector in Claude:</p><pre>${escape(mcpUrl)}</pre>`);
}

export const googleHandler = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    try {
      if (pathname === "/authorize") {
        if (allowedEmails(env).size === 0) {
          return html("<h1>Not configured</h1><p>Set the ALLOWED_EMAILS secret before connecting.</p>", 503);
        }
        if (request.method === "GET") return await authorizeGet(request, env);
        if (request.method === "POST") return await authorizePost(request, env);
        return new Response("Method not allowed", { status: 405 });
      }
      if (pathname === "/callback" && request.method === "GET") return await callback(request, env);
      if (pathname === "/" && request.method === "GET") return home(request, env);
      return new Response("Not found", { status: 404 });
    } catch (error) {
      return renderError(error);
    }
  },
};
