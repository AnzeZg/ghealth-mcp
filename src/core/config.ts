import { type EnabledCategories, parseEnabledCategories } from "./categories.js";
import { assertTimeZone } from "./time.js";

export interface Config {
  enabled: EnabledCategories;
  /** Used when the account settings have no time zone. */
  defaultTimeZone: string;
  /** Tool responses larger than this are truncated (bytes of JSON). */
  maxResponseBytes: number;
}

export interface ConfigEnv {
  ENABLED_CATEGORIES?: string;
  DEFAULT_TIMEZONE?: string;
  MAX_RESPONSE_BYTES?: string;
}

export function loadConfig(env: ConfigEnv): Config {
  const systemTz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const maxBytes = Number(env.MAX_RESPONSE_BYTES ?? 60_000);
  return {
    enabled: parseEnabledCategories(env.ENABLED_CATEGORIES),
    defaultTimeZone: assertTimeZone(env.DEFAULT_TIMEZONE?.trim() || systemTz),
    maxResponseBytes: Number.isFinite(maxBytes) && maxBytes > 1000 ? maxBytes : 60_000,
  };
}
