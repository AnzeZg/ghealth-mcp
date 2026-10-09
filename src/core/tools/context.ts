import type { CallToolResult } from "@modelcontextprotocol/server";
import { type DataTypeInfo, getDataType, type Operation, supports } from "../catalog.js";
import { canRead, canWrite } from "../categories.js";
import { HealthApiError, type HealthClient } from "../client.js";
import type { Config } from "../config.js";
import { PayloadError } from "../payload.js";
import { boundedJson } from "../shape.js";
import { assertTimeZone } from "../time.js";

export interface ToolContext {
  client: HealthClient;
  config: Config;
  /** The user's IANA time zone (from account settings, else config default). */
  timeZone(): Promise<string>;
}

export function createToolContext(client: HealthClient, config: Config): ToolContext {
  let cached: Promise<string> | undefined;
  return {
    client,
    config,
    timeZone() {
      cached ??= (async () => {
        if (!canRead(config.enabled, "settings")) return config.defaultTimeZone;
        try {
          const settings = await client.getUserResource("settings");
          const tz = typeof settings.timeZone === "string" ? settings.timeZone : undefined;
          return tz ? assertTimeZone(tz) : config.defaultTimeZone;
        } catch {
          return config.defaultTimeZone;
        }
      })();
      return cached;
    },
  };
}

/** Thrown for problems the agent can fix by changing its call. */
export class ToolInputError extends Error {}

const READ_OPS: Operation[] = ["list", "get", "reconcile", "rollup", "dailyRollup"];

/** Resolves a data type and checks the operation is supported and enabled. */
export function requireOp(ctx: ToolContext, type: string, op: Operation): DataTypeInfo {
  let info: DataTypeInfo;
  try {
    info = getDataType(type);
  } catch (err) {
    throw new ToolInputError((err as Error).message);
  }
  if (!supports(info, op)) {
    throw new ToolInputError(
      `Data type "${type}" does not support "${op}". Supported operations: ${info.ops.join(", ")}.`,
    );
  }
  const isRead = READ_OPS.includes(op);
  const allowed = isRead ? canRead(ctx.config.enabled, info.category) : canWrite(ctx.config.enabled, info.category);
  if (!allowed) {
    throw new ToolInputError(
      `${isRead ? "Reading" : "Writing"} "${info.category}" data is disabled on this server (ENABLED_CATEGORIES). Ask the server owner to enable "${info.category}:${isRead ? "r" : "w"}".`,
    );
  }
  return info;
}

export function jsonResult(ctx: ToolContext, value: unknown): CallToolResult {
  const { text } = boundedJson(value, ctx.config.maxResponseBytes);
  return { content: [{ type: "text", text }] };
}

export function errorResult(message: string, details?: Record<string, unknown>): CallToolResult {
  const text = details ? `${message}\n${JSON.stringify(details)}` : message;
  return { content: [{ type: "text", text }], isError: true };
}

/** Wraps a tool handler so every failure becomes a readable tool error. */
export function safely<A>(handler: (args: A) => Promise<CallToolResult>): (args: A) => Promise<CallToolResult> {
  return async (args: A) => {
    try {
      return await handler(args);
    } catch (err) {
      if (err instanceof PayloadError) return errorResult(err.message, { issues: err.issues });
      if (err instanceof HealthApiError) {
        return errorResult(err.message, err.hint ? { hint: err.hint } : undefined);
      }
      if (err instanceof ToolInputError) return errorResult(err.message);
      return errorResult(err instanceof Error ? err.message : String(err));
    }
  };
}
