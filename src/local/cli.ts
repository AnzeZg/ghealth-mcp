#!/usr/bin/env node
/**
 * ghealth-mcp: local entry point.
 *
 *   ghealth-mcp            run the MCP server over stdio (what Claude Desktop / Claude Code launch)
 *   ghealth-mcp auth       sign in with Google in your browser and store tokens locally
 *   ghealth-mcp status     show who is signed in and test the connection
 *   ghealth-mcp logout     delete stored tokens
 */
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { GoogleAuthError, RefreshingTokenProvider, type TokenProvider } from "../core/auth.js";
import { scopesFor } from "../core/categories.js";
import { HealthClient } from "../core/client.js";
import { loadConfig } from "../core/config.js";
import { createHealthServer, SERVER_VERSION } from "../core/server.js";
import { browserLogin } from "./login.js";
import { deleteTokens, paths, readTokens, resolveLocalSettings, writeTokens } from "./store.js";

const REAUTH_HINT = "Run `npx ghealth-mcp auth` in a terminal to sign in again, then restart the MCP client.";

// stdout belongs to the MCP protocol; all human output goes to stderr.
const log = (msg: string) => process.stderr.write(`${msg}\n`);

async function tokenProvider(clientId: string, clientSecret: string): Promise<TokenProvider> {
  const stored = await readTokens();
  if (!stored) {
    const fail = async (): Promise<string> => {
      throw new GoogleAuthError("Not signed in.", true);
    };
    return { getAccessToken: fail, refresh: fail };
  }
  return new RefreshingTokenProvider(stored, { clientId, clientSecret }, (tokens) =>
    writeTokens({ ...tokens, email: stored.email }),
  );
}

function missingScopes(granted: string | undefined, wanted: string[]): string[] {
  const have = new Set((granted ?? "").split(/\s+/));
  return wanted.filter((s) => s.startsWith("https://") && !have.has(s));
}

async function serve(): Promise<void> {
  const settings = await resolveLocalSettings();
  const config = loadConfig(settings.env);
  const stored = await readTokens();
  if (!stored) log(`[ghealth-mcp] Not signed in. ${REAUTH_HINT}`);
  else {
    const missing = missingScopes(stored.scope, scopesFor(config.enabled));
    if (missing.length) {
      log(`[ghealth-mcp] Stored sign-in lacks ${missing.length} scope(s) for the enabled categories. ${REAUTH_HINT}`);
    }
  }
  const tokens = await tokenProvider(settings.clientId, settings.clientSecret);
  const client = new HealthClient(tokens, { reauthHint: REAUTH_HINT });
  serveStdio(() => createHealthServer(client, config));
  log(`[ghealth-mcp] v${SERVER_VERSION} running on stdio${stored?.email ? ` as ${stored.email}` : ""}`);
}

async function auth(): Promise<void> {
  const settings = await resolveLocalSettings();
  const config = loadConfig(settings.env);
  const tokens = await browserLogin({
    clientId: settings.clientId,
    clientSecret: settings.clientSecret,
    scopes: scopesFor(config.enabled),
    log,
  });
  await writeTokens(tokens);
  log(`Signed in as ${tokens.email}. Tokens saved to ${paths.tokens}`);
  const missing = missingScopes(tokens.scope, scopesFor(config.enabled));
  if (missing.length) {
    log(`\nWarning: Google did not grant these scopes (were boxes left unticked?):\n  ${missing.join("\n  ")}`);
  }
}

async function status(): Promise<void> {
  const settings = await resolveLocalSettings();
  const stored = await readTokens();
  if (!stored) {
    log(`Not signed in. Run \`ghealth-mcp auth\`.`);
    process.exitCode = 1;
    return;
  }
  log(`Signed in as: ${stored.email ?? "(unknown)"}`);
  log(`Granted scopes:\n  ${(stored.scope ?? "").split(/\s+/).join("\n  ")}`);
  const client = new HealthClient(await tokenProvider(settings.clientId, settings.clientSecret), {
    reauthHint: REAUTH_HINT,
  });
  try {
    const identity = await client.getUserResource("identity");
    log(`API check OK. Health user id: ${String(identity.healthUserId ?? "?")}`);
  } catch (err) {
    log(`API check failed: ${(err as Error).message}`);
    process.exitCode = 1;
  }
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? "serve";
  switch (command) {
    case "serve":
      return serve();
    case "auth":
    case "login":
      return auth();
    case "status":
      return status();
    case "logout":
      await deleteTokens();
      log("Signed out (local tokens deleted). Revoke access at https://myaccount.google.com/permissions if desired.");
      return;
    case "--version":
    case "-v":
      log(SERVER_VERSION);
      return;
    default:
      log(`Usage: ghealth-mcp [serve|auth|status|logout]\nConfig: ${paths.config}`);
      process.exitCode = command === "--help" || command === "-h" ? 0 : 1;
  }
}

main().catch((err: unknown) => {
  log(`[ghealth-mcp] ${(err as Error).message ?? String(err)}`);
  process.exit(1);
});
