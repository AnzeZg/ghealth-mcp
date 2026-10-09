import { describe, expect, it } from "vitest";
import { connect, textOf } from "./helpers.js";

describe("tool registration", () => {
  it("registers everything by default with correct annotations", async () => {
    const { mcp } = await connect();
    const { tools } = await mcp.listTools();
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    expect(Object.keys(byName).sort()).toEqual(
      [
        "aggregate_data",
        "create_data_point",
        "daily_summary",
        "delete_data_points",
        "describe_data_type",
        "export_workout_tcx",
        "get_account",
        "get_data_point",
        "list_data_types",
        "log_meal",
        "log_water",
        "log_weight",
        "log_workout",
        "read_data",
        "update_account",
        "update_data_point",
      ].sort(),
    );
    expect(byName.delete_data_points!.annotations?.destructiveHint).toBe(true);
    expect(byName.update_data_point!.annotations?.destructiveHint).toBe(true);
    expect(byName.update_account!.annotations?.destructiveHint).toBe(true);
    expect(byName.read_data!.annotations?.readOnlyHint).toBe(true);
    expect(byName.log_meal!.annotations?.destructiveHint).toBe(false);
  });

  it("hides write tools when only reading is enabled", async () => {
    const { mcp } = await connect({ env: { ENABLED_CATEGORIES: "activity:r,sleep:r" } });
    const names = (await mcp.listTools()).tools.map((t) => t.name);
    expect(names).not.toContain("log_meal");
    expect(names).not.toContain("create_data_point");
    expect(names).not.toContain("update_account");
    expect(names).toContain("read_data");
    expect(names).toContain("daily_summary");
  });

  it("refuses disabled categories at call time", async () => {
    const { mcp, apiCalls } = await connect({ env: { ENABLED_CATEGORIES: "activity:rw" } });
    const result = await mcp.callTool({ name: "read_data", arguments: { type: "weight" } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/disabled/);
    expect(apiCalls()).toHaveLength(0);
  });
});

describe("log_meal", () => {
  it("creates a nutrition-log with macros in base units", async () => {
    const { mcp, apiCalls } = await connect({
      respond: (c) =>
        c.method === "POST" ? { body: { name: "users/me/dataTypes/nutrition-log/dataPoints/42" } } : undefined,
    });
    const result = await mcp.callTool({
      name: "log_meal",
      arguments: {
        name: "2 eggs and toast",
        mealType: "breakfast",
        time: "2026-10-09T08:00",
        kcal: 380,
        proteinG: 20,
        carbsG: 30,
        fatG: 18,
        sodiumMg: 600,
      },
    });
    expect(result.isError).toBeFalsy();
    const call = apiCalls()[0]!;
    expect(call.method).toBe("POST");
    expect(call.url.pathname).toBe("/v4/users/me/dataTypes/nutrition-log/dataPoints");
    expect(call.body).toEqual({
      nutritionLog: {
        foodDisplayName: "2 eggs and toast",
        mealType: "BREAKFAST",
        interval: {
          startTime: "2026-10-09T06:00:00.000Z",
          endTime: "2026-10-09T06:01:00.000Z",
          startUtcOffset: "7200s",
          endUtcOffset: "7200s",
        },
        energy: { kcal: 380 },
        totalCarbohydrate: { grams: 30 },
        totalFat: { grams: 18 },
        nutrients: [
          { nutrient: "PROTEIN", quantity: { grams: 20 } },
          { nutrient: "SODIUM", quantity: { grams: 0.6 } },
        ],
      },
    });
    expect(textOf(result)).toContain("dataPoints/42");
  });
});

describe("log_workout / log_water / log_weight", () => {
  it("logs a run with distance and duration", async () => {
    const { mcp, apiCalls } = await connect();
    const result = await mcp.callTool({
      name: "log_workout",
      arguments: {
        exerciseType: "running",
        start: "2026-10-09T07:00",
        durationMinutes: 30,
        distance: 5,
        calories: 320,
      },
    });
    expect(result.isError, textOf(result)).toBeFalsy();
    expect(apiCalls()[0]!.body).toMatchObject({
      exercise: {
        exerciseType: "RUNNING",
        interval: { startTime: "2026-10-09T05:00:00.000Z", endTime: "2026-10-09T05:30:00.000Z" },
        activeDuration: "1800s",
        metricsSummary: { caloriesKcal: 320, distanceMillimeters: 5_000_000 },
      },
    });
  });

  it("rejects unknown exercise types before calling the API", async () => {
    const { mcp, apiCalls } = await connect();
    const result = await mcp.callTool({
      name: "log_workout",
      arguments: { exerciseType: "quidditch", durationMinutes: 30 },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/describe_data_type/);
    expect(apiCalls()).toHaveLength(0);
  });

  it("logs water in cups", async () => {
    const { mcp, apiCalls } = await connect();
    await mcp.callTool({ name: "log_water", arguments: { amount: 2, unit: "cup", time: "2026-10-09T10:00" } });
    expect(apiCalls()[0]!.body).toMatchObject({
      hydrationLog: { amountConsumed: { milliliters: 473.176, userProvidedUnit: "CUP_US" } },
    });
  });

  it("logs weight and body fat", async () => {
    const { mcp, apiCalls } = await connect();
    const result = await mcp.callTool({
      name: "log_weight",
      arguments: { value: 160, unit: "lb", bodyFatPercent: 18, time: "2026-10-09T07:00" },
    });
    expect(result.isError, textOf(result)).toBeFalsy();
    const [weight, fat] = apiCalls();
    expect(weight!.body).toEqual({
      weight: { weightGrams: 72574.779, sampleTime: { physicalTime: "2026-10-09T05:00:00.000Z", utcOffset: "7200s" } },
    });
    expect(fat!.url.pathname).toContain("/body-fat/");
    expect(fat!.body).toMatchObject({ bodyFat: { percentage: 18 } });
  });
});

describe("generic tools", () => {
  it("read_data builds the filter and compacts data sources", async () => {
    const { mcp, apiCalls } = await connect({
      respond: (c) =>
        c.url.pathname.includes("/steps/")
          ? {
              body: {
                dataPoints: [
                  {
                    name: "users/me/dataTypes/steps/dataPoints/1",
                    steps: { count: "120" },
                    dataSource: {
                      platform: "FITBIT",
                      recordingMethod: "PASSIVELY_MEASURED",
                      device: { displayName: "Fitbit Air" },
                    },
                  },
                ],
              },
            }
          : undefined,
    });
    const result = await mcp.callTool({
      name: "read_data",
      arguments: { type: "steps", start: "2026-10-09", end: "2026-10-10" },
    });
    const call = apiCalls()[0]!;
    expect(call.url.searchParams.get("filter")).toBe(
      'steps.interval.civil_start_time >= "2026-10-09" AND steps.interval.civil_start_time < "2026-10-10"',
    );
    const parsed = JSON.parse(textOf(result));
    expect(parsed.dataPoints[0].source).toBe("FITBIT · PASSIVELY_MEASURED · Fitbit Air");
    expect(parsed.dataPoints[0].dataSource).toBeUndefined();
  });

  it("read_data with deduplicate uses reconcile and caps page size", async () => {
    const { mcp, apiCalls } = await connect();
    await mcp.callTool({ name: "read_data", arguments: { type: "exercise", deduplicate: true, pageSize: 500 } });
    const call = apiCalls()[0]!;
    expect(call.url.pathname).toBe("/v4/users/me/dataTypes/exercise/dataPoints:reconcile");
    expect(call.url.searchParams.get("pageSize")).toBe("25");
  });

  it("create_data_point wraps, fills and validates", async () => {
    const { mcp, apiCalls } = await connect();
    const result = await mcp.callTool({
      name: "create_data_point",
      arguments: {
        type: "height",
        data: { heightMillimeters: 1800, sampleTime: { physicalTime: "2026-10-09T09:00" } },
      },
    });
    expect(result.isError, textOf(result)).toBeFalsy();
    expect(apiCalls()[0]!.body).toEqual({
      height: { heightMillimeters: 1800, sampleTime: { physicalTime: "2026-10-09T07:00:00.000Z", utcOffset: "7200s" } },
    });
  });

  it("create_data_point refuses unsupported operations", async () => {
    const { mcp } = await connect();
    const result = await mcp.callTool({ name: "create_data_point", arguments: { type: "steps", data: {} } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/does not support "create"/);
  });

  it("update_data_point PATCHes with the resource name", async () => {
    const { mcp, apiCalls } = await connect();
    await mcp.callTool({
      name: "update_data_point",
      arguments: {
        type: "weight",
        id: "users/me/dataTypes/weight/dataPoints/77",
        data: { weightGrams: 71000, sampleTime: { physicalTime: "2026-10-09T07:00:00Z" } },
      },
    });
    const call = apiCalls()[0]!;
    expect(call.method).toBe("PATCH");
    expect(call.url.pathname).toBe("/v4/users/me/dataTypes/weight/dataPoints/77");
    expect(call.body).toMatchObject({
      name: "users/me/dataTypes/weight/dataPoints/77",
      weight: { weightGrams: 71000 },
    });
  });

  it("aggregate_data daily sends a civil range", async () => {
    const { mcp, apiCalls } = await connect();
    await mcp.callTool({
      name: "aggregate_data",
      arguments: { type: "steps", mode: "daily", start: "2026-10-01", end: "2026-10-07" },
    });
    const call = apiCalls()[0]!;
    expect(call.url.pathname).toBe("/v4/users/me/dataTypes/steps/dataPoints:dailyRollUp");
    expect(call.body).toMatchObject({ range: { end: { date: { day: 8 } } }, windowSizeDays: 1 });
  });

  it("surfaces Google errors as tool errors with hints", async () => {
    const { mcp } = await connect({
      respond: (c) =>
        c.url.pathname.includes("/weight/")
          ? { status: 404, body: { error: { status: "NOT_FOUND", message: "missing" } } }
          : undefined,
    });
    const result = await mcp.callTool({ name: "get_data_point", arguments: { type: "weight", id: "nope" } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/404 NOT_FOUND/);
    expect(textOf(result)).toMatch(/hint/);
  });

  it("describe_data_type returns the schema and an example", async () => {
    const { mcp } = await connect();
    const parsed = JSON.parse(
      textOf(await mcp.callTool({ name: "describe_data_type", arguments: { type: "exercise" } })),
    );
    expect(parsed.writePayloadSchema.properties.exerciseType.enum).toContain("RUNNING");
    expect(parsed.example.exerciseType).toBe("RUNNING");
  });
});

describe("daily_summary", () => {
  it("collects sections and reports per-section errors", async () => {
    const { mcp } = await connect({
      respond: (c) => {
        if (c.url.pathname.endsWith("/steps/dataPoints:dailyRollUp")) {
          return { body: { rollupDataPoints: [{ steps: { countSum: "8421" } }] } };
        }
        if (c.url.pathname.includes("/sleep/")) return { status: 500, body: { error: { message: "boom" } } };
        return undefined;
      },
    });
    const summary = JSON.parse(
      textOf(await mcp.callTool({ name: "daily_summary", arguments: { date: "2026-10-09" } })),
    );
    expect(summary.date).toBe("2026-10-09");
    expect(summary.steps).toEqual({ countSum: "8421" });
    expect(summary.errors.sleep).toMatch(/500/);
    expect(summary.workouts).toEqual([]);
  });
});
