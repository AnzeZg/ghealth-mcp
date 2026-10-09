/** Local config and token storage under ~/.config/ghealth-mcp (files are 0600). */
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { GoogleTokens } from "../core/auth.js";

export const CONFIG_DIR =
  process.env.GHEALTH_MCP_HOME ?? join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "ghealth-mcp");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");
const TOKENS_FILE = join(CONFIG_DIR, "tokens.json");

export interface LocalConfigFile {
  clientId?: string;
  clientSecret?: string;
  enabledCategories?: string;
  defaultTimeZone?: string;
}

export interface StoredTokens extends GoogleTokens {
  email?: string;
}

async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new Error(`Could not read ${path}: ${(err as Error).message}`);
  }
}

async function writePrivateJson(path: string, value: unknown): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
}

export const readConfigFile = () => readJson<LocalConfigFile>(CONFIG_FILE);
export const readTokens = () => readJson<StoredTokens>(TOKENS_FILE);
export const writeTokens = (tokens: StoredTokens) => writePrivateJson(TOKENS_FILE, tokens);
export const deleteTokens = () => rm(TOKENS_FILE, { force: true });
export const paths = { config: CONFIG_FILE, tokens: TOKENS_FILE };

export interface ResolvedLocalSettings {
  clientId: string;
  clientSecret: string;
  env: { ENABLED_CATEGORIES?: string; DEFAULT_TIMEZONE?: string; MAX_RESPONSE_BYTES?: string };
}

/** Environment variables win over config.json. */
export async function resolveLocalSettings(): Promise<ResolvedLocalSettings> {
  const file = (await readConfigFile()) ?? {};
  const clientId = process.env.GOOGLE_CLIENT_ID ?? file.clientId;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET ?? file.clientSecret;
  if (!clientId || !clientSecret) {
    throw new Error(
      `Missing Google OAuth client. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, or add clientId/clientSecret to ${CONFIG_FILE}. See docs/SETUP.md.`,
    );
  }
  return {
    clientId,
    clientSecret,
    env: {
      ENABLED_CATEGORIES: process.env.ENABLED_CATEGORIES ?? file.enabledCategories,
      DEFAULT_TIMEZONE: process.env.DEFAULT_TIMEZONE ?? file.defaultTimeZone,
      MAX_RESPONSE_BYTES: process.env.MAX_RESPONSE_BYTES,
    },
  };
}
