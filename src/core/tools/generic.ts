/** Generic tools that cover every data type and operation in the API. */
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { ACCOUNT_SCHEMAS, DATA_TYPES, type DataTypeInfo, getDataType } from "../catalog.js";
import { CATEGORIES, type CategoryId, canRead, canWrite, describeEnabled } from "../categories.js";
import { fillTimeFields, validatePayload } from "../payload.js";
import { buildDailyRollUpBody, buildListFilter, buildRollUpBody } from "../queries.js";
import { compactDataPoint, compactList } from "../shape.js";
import { EXAMPLES } from "./examples.js";
import { jsonResult, requireOp, safely, type ToolContext, ToolInputError } from "./context.js";

const dataTypeParam = z
  .string()
  .describe('Data type id in kebab-case, e.g. "steps", "nutrition-log", "exercise". See list_data_types.');

const timeParam = (what: string) =>
  z
    .string()
    .optional()
    .describe(
      `${what}. ISO 8601: "2026-10-09", "2026-10-09T08:30" (local time), "2026-10-09T08:30:00Z", or "today"/"yesterday"/"now".`,
    );

const READ_ONLY = { readOnlyHint: true, openWorldHint: true } as const;

function visibleOps(ctx: ToolContext, info: DataTypeInfo): string[] {
  const read = canRead(ctx.config.enabled, info.category);
  const write = canWrite(ctx.config.enabled, info.category);
  return info.ops.filter((op) => (["create", "update", "batchDelete"].includes(op) ? write : read));
}

export function registerGenericTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "list_data_types",
    {
      title: "List health data types",
      description:
        "Lists the Google Health data types this server can access, with the operations allowed for each (list, get, reconcile, rollup, dailyRollup, create, update, batchDelete). Start here when unsure which type holds the data.",
      inputSchema: z.object({
        category: z
          .enum(Object.keys(CATEGORIES) as [CategoryId, ...CategoryId[]])
          .optional()
          .describe("Only show types in this category."),
      }),
      annotations: READ_ONLY,
    },
    safely(async ({ category }) => {
      const types = [...DATA_TYPES.values()]
        .filter((info) => !category || info.category === category)
        .map((info) => ({ info, ops: visibleOps(ctx, info) }))
        .filter(({ ops }) => ops.length > 0)
        .map(({ info, ops }) => ({
          id: info.id,
          category: info.category,
          ops,
          description: info.description,
          ...(info.notes ? { notes: info.notes } : {}),
          ...(ops.some((o) => o.includes("ollup")) ? { rollupMaxDays: info.rollupMaxDays } : {}),
        }));
      return jsonResult(ctx, {
        enabledCategories: describeEnabled(ctx.config.enabled),
        timeZone: await ctx.timeZone(),
        dataTypes: types,
      });
    }),
  );

  server.registerTool(
    "describe_data_type",
    {
      title: "Describe a data type",
      description:
        "Returns the JSON Schema for writing a data type (create_data_point / update_data_point), an example payload, supported operations and notes. Call this before writing a type you have not written before.",
      inputSchema: z.object({ type: dataTypeParam }),
      annotations: READ_ONLY,
    },
    safely(async ({ type }) => {
      let info: DataTypeInfo;
      try {
        info = getDataType(type);
      } catch (err) {
        throw new ToolInputError((err as Error).message);
      }
      return jsonResult(ctx, {
        id: info.id,
        category: info.category,
        description: info.description,
        operations: visibleOps(ctx, info),
        timeFilter: info.timeKind,
        ...(info.notes ? { notes: info.notes } : {}),
        ...(info.writeSchema
          ? {
              writePayloadSchema: info.writeSchema,
              example: EXAMPLES[info.id],
              writeTips:
                'Pass the payload as `data` (without wrapping it in a DataPoint). Times may be local ("2026-10-09T08:00") or relative ("now"); missing *UtcOffset/utcOffset fields are filled from the user\'s time zone.',
            }
          : { writable: false }),
      });
    }),
  );

  server.registerTool(
    "read_data",
    {
      title: "Read health data points",
      description:
        "Reads raw data points of one type in a time range (newest first). Defaults to yesterday + today if no range is given. Set deduplicate=true to merge overlapping data from multiple devices (reconcile). For totals/averages over time prefer aggregate_data. Results are paginated via pageToken.",
      inputSchema: z.object({
        type: dataTypeParam,
        start: timeParam("Inclusive start (local time unless an offset is given)"),
        end: timeParam("Exclusive end"),
        deduplicate: z.boolean().optional().describe("Use the reconcile endpoint to deduplicate across devices."),
        pageSize: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Max points to return (default 100; max 25 for exercise and sleep)."),
        pageToken: z
          .string()
          .optional()
          .describe("nextPageToken from a previous call (repeat the same other arguments)."),
        dataSourceFamily: z
          .string()
          .optional()
          .describe('Optional source filter, full URI e.g. "users/me/dataSourceFamilies/google-wearables".'),
        verbose: z.boolean().optional().describe("Include full data source/device metadata."),
      }),
      annotations: READ_ONLY,
    },
    safely(async (args) => {
      const info = requireOp(ctx, args.type, args.deduplicate ? "reconcile" : "list");
      const tz = await ctx.timeZone();
      const params = {
        filter: buildListFilter(info, { start: args.start, end: args.end }, tz),
        pageSize: Math.min(args.pageSize ?? Math.min(100, info.pageSizeCap), info.pageSizeCap),
        pageToken: args.pageToken,
        dataSourceFamily: args.dataSourceFamily,
      };
      const response = args.deduplicate
        ? await ctx.client.reconcile(info.id, params, info.apiVersion)
        : await ctx.client.list(info.id, params, info.apiVersion);
      return jsonResult(ctx, { timeZone: tz, filter: params.filter, ...compactList(response, !!args.verbose) });
    }),
  );

  server.registerTool(
    "get_data_point",
    {
      title: "Get one data point",
      description: "Fetches a single data point by id (the last segment of its `name`, or the full name).",
      inputSchema: z.object({
        type: dataTypeParam,
        id: z.string().describe("Data point id or full resource name."),
        verbose: z.boolean().optional(),
      }),
      annotations: READ_ONLY,
    },
    safely(async ({ type, id, verbose }) => {
      const info = requireOp(ctx, type, "get");
      return jsonResult(ctx, compactDataPoint(await ctx.client.get(info.id, id, info.apiVersion), !!verbose));
    }),
  );

  server.registerTool(
    "aggregate_data",
    {
      title: "Aggregate health data",
      description:
        'Totals/averages for a data type. mode="daily" groups by local calendar day (startDate..endDate inclusive). mode="window" groups by fixed windows (e.g. "1h") between start and end. Most types allow up to 90 days per call; heart-rate, active-minutes, total-calories and calories-in-heart-rate-zone allow 14.',
      inputSchema: z.object({
        type: dataTypeParam,
        mode: z.enum(["daily", "window"]).default("daily"),
        start: z.string().describe('daily: start date ("2026-10-01", "today"); window: start time.'),
        end: z
          .string()
          .optional()
          .describe("daily: inclusive end date (defaults to start); window: exclusive end time (defaults to now)."),
        window: z.string().optional().describe('window mode only: window size such as "15m", "1h", "1d" (default 1h).'),
        windowDays: z.number().int().positive().optional().describe("daily mode only: days per bucket (default 1)."),
        dataSourceFamily: z
          .string()
          .optional()
          .describe('Full URI, e.g. "users/me/dataSourceFamilies/google-wearables".'),
        pageToken: z.string().optional(),
      }),
      annotations: READ_ONLY,
    },
    safely(async (args) => {
      const tz = await ctx.timeZone();
      if (args.mode === "daily") {
        const info = requireOp(ctx, args.type, "dailyRollup");
        const body = buildDailyRollUpBody(
          info,
          {
            startDate: args.start,
            endDate: args.end,
            windowDays: args.windowDays,
            dataSourceFamily: args.dataSourceFamily,
            pageToken: args.pageToken,
          },
          tz,
        );
        return jsonResult(ctx, { timeZone: tz, ...(await ctx.client.dailyRollUp(info.id, body)) });
      }
      const info = requireOp(ctx, args.type, "rollup");
      const body = buildRollUpBody(
        info,
        {
          start: args.start,
          end: args.end,
          window: args.window,
          dataSourceFamily: args.dataSourceFamily,
          pageToken: args.pageToken,
        },
        tz,
      );
      return jsonResult(ctx, { timeZone: tz, ...(await ctx.client.rollUp(info.id, body)) });
    }),
  );

  const writePayload = z
    .record(z.string(), z.unknown())
    .describe(
      "The data type's payload (see describe_data_type), e.g. for weight: {weightGrams, sampleTime:{physicalTime}}.",
    );

  async function preparePayload(info: DataTypeInfo, data: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!info.writeSchema) throw new ToolInputError(`"${info.id}" has no writable schema.`);
    const payload = structuredClone(data);
    fillTimeFields(payload, info.writeSchema, await ctx.timeZone());
    validatePayload(info.writeSchema, payload, info.id);
    return payload;
  }

  const anyDataWrite = [...DATA_TYPES.values()].some(
    (info) => info.ops.includes("create") && canWrite(ctx.config.enabled, info.category),
  );
  if (anyDataWrite) registerWriteTools();

  function registerWriteTools(): void {
    server.registerTool(
      "create_data_point",
      {
        title: "Create a data point",
        description:
          "Writes a new data point of any writable type (exercise, weight, body-fat, height, sleep, nutrition-log, hydration-log, menstrual-period, ovulation-test, moods, symptoms). Prefer the log_* tools for meals, water, workouts and weight. Call describe_data_type first for the schema.",
        inputSchema: z.object({ type: dataTypeParam, data: writePayload }),
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      },
      safely(async ({ type, data }) => {
        const info = requireOp(ctx, type, "create");
        const payload = await preparePayload(info, data);
        const created = await ctx.client.create(info.id, { [info.field]: payload });
        return jsonResult(ctx, { created: compactDataPoint(created, false) });
      }),
    );

    server.registerTool(
      "update_data_point",
      {
        title: "Update a data point",
        description:
          "Replaces an existing data point's payload. Provide the full payload, not just changed fields. Note: nutrition-log entries created without a food reference cannot be edited; delete and recreate them instead.",
        inputSchema: z.object({
          type: dataTypeParam,
          id: z.string().describe("Data point id or full resource name (from read_data)."),
          data: writePayload,
        }),
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
      },
      safely(async ({ type, id, data }) => {
        const info = requireOp(ctx, type, "update");
        const payload = await preparePayload(info, data);
        const bare = id.includes("/") ? id.split("/").pop()! : id;
        const updated = await ctx.client.update(info.id, bare, {
          name: `users/me/dataTypes/${info.id}/dataPoints/${bare}`,
          [info.field]: payload,
        });
        return jsonResult(ctx, { updated: compactDataPoint(updated, false) });
      }),
    );

    server.registerTool(
      "delete_data_points",
      {
        title: "Delete data points",
        description: "Permanently deletes one or more data points of a type by id. Confirm with the user first.",
        inputSchema: z.object({
          type: dataTypeParam,
          ids: z.array(z.string()).min(1).max(1000).describe("Data point ids or full resource names."),
        }),
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
      },
      safely(async ({ type, ids }) => {
        const info = requireOp(ctx, type, "batchDelete");
        await ctx.client.batchDelete(info.id, ids);
        return jsonResult(ctx, { deleted: ids.length, type: info.id });
      }),
    );
  }

  type Section = "identity" | "profile" | "settings" | "devices" | "irn_profile";
  server.registerTool(
    "get_account",
    {
      title: "Get account info",
      description:
        "Reads account-level info: identity (user ids), profile (age, stride lengths), settings (units, time zone, locale), devices (paired trackers/scales with battery and last sync time), irn_profile (irregular rhythm notification enrollment).",
      inputSchema: z.object({ section: z.enum(["identity", "profile", "settings", "devices", "irn_profile"]) }),
      annotations: READ_ONLY,
    },
    safely(async ({ section }: { section: Section }) => {
      const gate: Partial<Record<Section, CategoryId>> = {
        profile: "profile",
        settings: "settings",
        irn_profile: "irn",
      };
      const category = gate[section];
      if (category && !canRead(ctx.config.enabled, category)) {
        throw new ToolInputError(`Reading "${category}" is disabled on this server (ENABLED_CATEGORIES).`);
      }
      const result =
        section === "devices"
          ? await ctx.client.listPairedDevices()
          : await ctx.client.getUserResource(section === "irn_profile" ? "irnProfile" : section);
      return jsonResult(ctx, result);
    }),
  );

  if (canWrite(ctx.config.enabled, "profile") || canWrite(ctx.config.enabled, "settings")) {
    server.registerTool(
      "update_account",
      {
        title: "Update profile or settings",
        description:
          "Updates fields of the user's profile (e.g. userConfiguredWalkingStrideLengthMm) or settings (units such as weightUnit, waterUnit, distanceUnit). Only the given fields are changed. Some fields are not updatable yet; Google will reject those.",
        inputSchema: z.object({
          section: z.enum(["profile", "settings"]),
          data: z.record(z.string(), z.unknown()).describe("Fields to change."),
        }),
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
      },
      safely(async ({ section, data }) => {
        if (!canWrite(ctx.config.enabled, section)) {
          throw new ToolInputError(`Writing "${section}" is disabled on this server (ENABLED_CATEGORIES).`);
        }
        const schema = { ...ACCOUNT_SCHEMAS[section], required: undefined };
        validatePayload(schema, data, section);
        const body = { ...data, name: `users/me/${section}` };
        const result = await ctx.client.updateUserResource(section, body, Object.keys(data).join(","));
        return jsonResult(ctx, { updated: result });
      }),
    );
  }

  server.registerTool(
    "export_workout_tcx",
    {
      title: "Export workout as TCX",
      description:
        "Exports a recorded workout (exercise data point) as TCX XML, including GPS track points when available (requires the location category). Output can be large.",
      inputSchema: z.object({
        id: z.string().describe("Exercise data point id."),
        partialData: z.boolean().optional().describe("Include data points even when GPS is unavailable."),
      }),
      annotations: READ_ONLY,
    },
    safely(async ({ id, partialData }) => {
      requireOp(ctx, "exercise", "get");
      return jsonResult(ctx, await ctx.client.exportExerciseTcx(id, partialData));
    }),
  );
}
