/** Builds the MCP server for a given API client and config. Shared by both entry points. */
import { McpServer } from "@modelcontextprotocol/server";
import type { HealthClient } from "./client.js";
import type { Config } from "./config.js";
import { createToolContext } from "./tools/context.js";
import { registerGenericTools } from "./tools/generic.js";
import { registerShortcutTools } from "./tools/shortcuts.js";

export const SERVER_NAME = "ghealth-mcp";
export const SERVER_VERSION = "0.1.0";

const INSTRUCTIONS = `Access to the user's Google Health (Fitbit / Pixel Watch) data.
- For quick questions about a day use daily_summary. For trends use aggregate_data (mode "daily").
- To log meals, water, workouts or weight use log_meal / log_water / log_workout / log_weight. When logging food without given nutrition values, estimate them and tell the user.
- For anything else: list_data_types → describe_data_type → read_data / create_data_point.
- Times without an offset are interpreted in the user's time zone.
- Confirm with the user before update_data_point, delete_data_points or update_account.`;

export function createHealthServer(client: HealthClient, config: Config): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { instructions: INSTRUCTIONS });
  const ctx = createToolContext(client, config);
  registerGenericTools(server, ctx);
  registerShortcutTools(server, ctx);
  return server;
}
