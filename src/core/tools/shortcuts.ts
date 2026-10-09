/** Ergonomic tools for the everyday logging and summary use cases. */
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { canRead, canWrite } from "../categories.js";
import { HealthApiError } from "../client.js";
import { fillTimeFields, validatePayload } from "../payload.js";
import { buildDailyRollUpBody, buildListFilter } from "../queries.js";
import { compactDataPoint, compactList } from "../shape.js";
import { addDays, parseCivilDate, parseInstant } from "../time.js";
import {
  type DistanceUnit,
  toGrams,
  toMilliliters,
  toMillimeters,
  VOLUME_UNIT_ENUM,
  type VolumeUnit,
  WEIGHT_UNIT_ENUM,
  type WeightUnit,
} from "../units.js";
import { jsonResult, requireOp, safely, type ToolContext, ToolInputError } from "./context.js";

const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } as const;

const MEAL_TYPES = {
  breakfast: "BREAKFAST",
  morning_snack: "BEFORE_LUNCH",
  lunch: "LUNCH",
  afternoon_snack: "BEFORE_DINNER",
  dinner: "DINNER",
  evening_snack: "AFTER_DINNER",
  snack: "SNACK",
  anytime: "ANYTIME",
} as const;

const timeParam = z
  .string()
  .optional()
  .describe('When it happened. Local time like "2026-10-09T12:30", "now" (default), or RFC 3339 with offset.');

async function createPoint(ctx: ToolContext, type: string, payload: Record<string, unknown>) {
  const info = requireOp(ctx, type, "create");
  if (!info.writeSchema) throw new ToolInputError(`"${type}" is not writable.`);
  fillTimeFields(payload, info.writeSchema, await ctx.timeZone());
  validatePayload(info.writeSchema, payload, type);
  const created = await ctx.client.create(type, { [info.field]: payload });
  return compactDataPoint(created, false);
}

const oneMinuteAfter = (d: Date) => new Date(d.getTime() + 60_000);

export function registerShortcutTools(server: McpServer, ctx: ToolContext): void {
  const { enabled } = ctx.config;

  if (canWrite(enabled, "nutrition")) {
    server.registerTool(
      "log_meal",
      {
        title: "Log a meal",
        description:
          "Logs a meal or food to Google Health. If the user doesn't give nutrition values, estimate calories and macros from the description using typical portions, and tell the user the estimate. Logged meals cannot be edited later (only deleted and re-logged).",
        inputSchema: z.object({
          name: z.string().min(1).describe('What was eaten, e.g. "2 scrambled eggs and toast".'),
          mealType: z.enum(Object.keys(MEAL_TYPES) as [keyof typeof MEAL_TYPES, ...(keyof typeof MEAL_TYPES)[]]),
          time: timeParam,
          kcal: z.number().min(0).max(100000).describe("Total energy in kcal."),
          proteinG: z.number().min(0).optional(),
          carbsG: z.number().min(0).optional(),
          fatG: z.number().min(0).optional(),
          fiberG: z.number().min(0).optional(),
          sugarG: z.number().min(0).optional(),
          saturatedFatG: z.number().min(0).optional(),
          sodiumMg: z.number().min(0).optional(),
        }),
        annotations: WRITE,
      },
      safely(async (args) => {
        const at = parseInstant(args.time, await ctx.timeZone());
        const nutrients: Array<{ nutrient: string; quantity: { grams: number } }> = [];
        const add = (nutrient: string, grams: number | undefined) => {
          if (grams !== undefined) nutrients.push({ nutrient, quantity: { grams } });
        };
        add("PROTEIN", args.proteinG);
        add("DIETARY_FIBER", args.fiberG);
        add("SUGAR", args.sugarG);
        add("SATURATED_FAT", args.saturatedFatG);
        add("SODIUM", args.sodiumMg === undefined ? undefined : args.sodiumMg / 1000);

        const payload: Record<string, unknown> = {
          foodDisplayName: args.name,
          mealType: MEAL_TYPES[args.mealType],
          interval: { startTime: at.toISOString(), endTime: oneMinuteAfter(at).toISOString() },
          energy: { kcal: args.kcal },
        };
        if (args.carbsG !== undefined) payload.totalCarbohydrate = { grams: args.carbsG };
        if (args.fatG !== undefined) payload.totalFat = { grams: args.fatG };
        if (nutrients.length) payload.nutrients = nutrients;
        return jsonResult(ctx, { logged: await createPoint(ctx, "nutrition-log", payload) });
      }),
    );

    server.registerTool(
      "log_water",
      {
        title: "Log water",
        description: "Logs water (or another drink's fluid volume) to Google Health.",
        inputSchema: z.object({
          amount: z.number().positive(),
          unit: z.enum(["ml", "l", "floz", "cup"]).default("ml"),
          time: timeParam,
        }),
        annotations: WRITE,
      },
      safely(async ({ amount, unit, time }) => {
        const at = parseInstant(time, await ctx.timeZone());
        const payload = {
          interval: { startTime: at.toISOString(), endTime: oneMinuteAfter(at).toISOString() },
          amountConsumed: {
            milliliters: toMilliliters(amount, unit as VolumeUnit),
            userProvidedUnit: VOLUME_UNIT_ENUM[unit as VolumeUnit],
          },
        };
        return jsonResult(ctx, { logged: await createPoint(ctx, "hydration-log", payload) });
      }),
    );
  }

  if (canWrite(enabled, "activity")) {
    server.registerTool(
      "log_workout",
      {
        title: "Log a workout",
        description:
          'Logs a workout/exercise session. exerciseType is an enum such as RUNNING, WALKING, BIKING, SWIMMING, WEIGHTLIFTING, YOGA, HIKING, ELLIPTICAL, HIIT, OTHER (call describe_data_type "exercise" for the full list). Give either durationMinutes or end.',
        inputSchema: z.object({
          exerciseType: z.string().describe("Exercise type enum value, e.g. RUNNING."),
          start: z
            .string()
            .optional()
            .describe('Start time, e.g. "2026-10-09T07:00". Defaults to now minus the duration.'),
          durationMinutes: z.number().positive().optional(),
          end: z.string().optional().describe("End time (alternative to durationMinutes)."),
          name: z.string().optional().describe('Custom name; only used when exerciseType is "OTHER".'),
          distance: z.number().positive().optional(),
          distanceUnit: z.enum(["km", "mi", "m"]).default("km"),
          calories: z.number().min(0).optional().describe("kcal burned."),
          steps: z.number().int().min(0).optional(),
          avgHeartRate: z.number().int().positive().optional().describe("Average heart rate in bpm."),
          notes: z.string().optional(),
        }),
        annotations: WRITE,
      },
      safely(async (args) => {
        const tz = await ctx.timeZone();
        let start: Date;
        let end: Date;
        if (args.end) {
          end = parseInstant(args.end, tz);
          start = args.start
            ? parseInstant(args.start, tz)
            : new Date(end.getTime() - (args.durationMinutes ?? 0) * 60_000);
        } else if (args.durationMinutes) {
          start = args.start ? parseInstant(args.start, tz) : new Date(Date.now() - args.durationMinutes * 60_000);
          end = new Date(start.getTime() + args.durationMinutes * 60_000);
        } else {
          throw new ToolInputError("Provide durationMinutes or end.");
        }
        if (end <= start) throw new ToolInputError("The workout must end after it starts.");

        const metrics: Record<string, unknown> = {};
        if (args.calories !== undefined) metrics.caloriesKcal = args.calories;
        if (args.distance !== undefined) {
          metrics.distanceMillimeters = toMillimeters(args.distance, args.distanceUnit as DistanceUnit);
        }
        if (args.steps !== undefined) metrics.steps = String(args.steps);
        if (args.avgHeartRate !== undefined) metrics.averageHeartRateBeatsPerMinute = String(args.avgHeartRate);

        const type = args.exerciseType
          .trim()
          .toUpperCase()
          .replace(/[\s-]+/g, "_");
        const payload: Record<string, unknown> = {
          exerciseType: type,
          displayName: args.name ?? type.charAt(0) + type.slice(1).toLowerCase().replace(/_/g, " "),
          interval: { startTime: start.toISOString(), endTime: end.toISOString() },
          activeDuration: `${Math.round((end.getTime() - start.getTime()) / 1000)}s`,
          metricsSummary: metrics,
        };
        if (args.notes) payload.notes = args.notes;
        return jsonResult(ctx, { logged: await createPoint(ctx, "exercise", payload) });
      }),
    );
  }

  if (canWrite(enabled, "metrics")) {
    server.registerTool(
      "log_weight",
      {
        title: "Log body weight",
        description: "Logs a body weight measurement, optionally with body fat percentage.",
        inputSchema: z.object({
          value: z.number().positive(),
          unit: z.enum(["kg", "lb", "st"]).default("kg"),
          time: timeParam,
          bodyFatPercent: z.number().min(0).max(100).optional(),
          notes: z.string().optional(),
        }),
        annotations: WRITE,
      },
      safely(async ({ value, unit, time, bodyFatPercent, notes }) => {
        const at = parseInstant(time, await ctx.timeZone()).toISOString();
        const weight: Record<string, unknown> = {
          weightGrams: toGrams(value, unit as WeightUnit),
          sampleTime: { physicalTime: at },
        };
        if (notes) weight.notes = notes;
        const result: Record<string, unknown> = {
          weight: await createPoint(ctx, "weight", weight),
          unitLogged: WEIGHT_UNIT_ENUM[unit as WeightUnit],
        };
        if (bodyFatPercent !== undefined) {
          result.bodyFat = await createPoint(ctx, "body-fat", {
            percentage: bodyFatPercent,
            sampleTime: { physicalTime: at },
          });
        }
        return jsonResult(ctx, { logged: result });
      }),
    );
  }

  const anyRead = ["activity", "nutrition", "sleep", "metrics"].some((c) => canRead(enabled, c as never));
  if (anyRead) {
    server.registerTool(
      "daily_summary",
      {
        title: "Daily health summary",
        description:
          "One-call overview of a day: steps, distance, calories burned, active zone minutes, workouts, food and water totals, the sleep that ended that day, resting heart rate and HRV. Sections for disabled categories are omitted.",
        inputSchema: z.object({
          date: z.string().optional().describe('Day to summarize: "YYYY-MM-DD", "today" (default) or "yesterday".'),
        }),
        annotations: { readOnlyHint: true, openWorldHint: true },
      },
      safely(async ({ date }) => jsonResult(ctx, await dailySummary(ctx, date))),
    );
  }
}

export async function dailySummary(ctx: ToolContext, dateInput?: string): Promise<Record<string, unknown>> {
  const tz = await ctx.timeZone();
  const date = parseCivilDate(dateInput ?? "today", tz);
  const next = addDays(date, 1);
  const { enabled } = ctx.config;
  const tasks: Record<string, () => Promise<unknown>> = {};

  const daily = (type: string) => async () => {
    const info = requireOp(ctx, type, "dailyRollup");
    const res = await ctx.client.dailyRollUp(type, buildDailyRollUpBody(info, { startDate: date }, tz));
    const point = (res.rollupDataPoints as Array<Record<string, unknown>> | undefined)?.[0];
    return point?.[info.field] ?? null;
  };
  const list =
    (type: string, pageSize = 25) =>
    async () => {
      const info = requireOp(ctx, type, "list");
      const res = await ctx.client.list(type, {
        filter: buildListFilter(info, { start: date, end: next }, tz),
        pageSize: Math.min(pageSize, info.pageSizeCap),
      });
      return (compactList(res, false).dataPoints as unknown[] | undefined) ?? [];
    };

  if (canRead(enabled, "activity")) {
    tasks.steps = daily("steps");
    tasks.distance = daily("distance");
    tasks.totalCalories = daily("total-calories");
    tasks.activeZoneMinutes = daily("active-zone-minutes");
    tasks.workouts = list("exercise");
  }
  if (canRead(enabled, "nutrition")) {
    tasks.nutrition = daily("nutrition-log");
    tasks.water = daily("hydration-log");
  }
  if (canRead(enabled, "sleep")) tasks.sleep = list("sleep", 5);
  if (canRead(enabled, "metrics")) {
    tasks.restingHeartRate = list("daily-resting-heart-rate", 1);
    tasks.heartRateVariability = list("daily-heart-rate-variability", 1);
  }

  const keys = Object.keys(tasks);
  const settled = await Promise.allSettled(keys.map((k) => tasks[k]!()));
  // An auth failure affects every section; report it once with its re-login hint.
  const authFailure = settled.find(
    (r): r is PromiseRejectedResult =>
      r.status === "rejected" && r.reason instanceof HealthApiError && r.reason.status === 401,
  );
  if (authFailure) throw authFailure.reason;
  const summary: Record<string, unknown> = { date, timeZone: tz };
  const errors: Record<string, string> = {};
  settled.forEach((result, i) => {
    const key = keys[i]!;
    if (result.status === "fulfilled") summary[key] = result.value;
    else errors[key] = (result.reason as Error)?.message ?? String(result.reason);
  });
  if (Object.keys(errors).length) summary.errors = errors;
  return summary;
}
