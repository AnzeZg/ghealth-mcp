import { describe, expect, it } from "vitest";
import { DATA_TYPES, getDataType } from "../src/core/catalog.js";
import { fillTimeFields, PayloadError, validatePayload } from "../src/core/payload.js";
import { EXAMPLES } from "../src/core/tools/examples.js";

const TZ = "Europe/Ljubljana";

describe("fillTimeFields", () => {
  it("converts local times and adds offsets where the schema has them", () => {
    const info = getDataType("hydration-log");
    const payload = {
      interval: { startTime: "2026-07-01T08:00", endTime: "2026-07-01T08:01" },
      amountConsumed: { milliliters: 250 },
    };
    fillTimeFields(payload, info.writeSchema, TZ);
    expect(payload.interval).toEqual({
      startTime: "2026-07-01T06:00:00.000Z",
      endTime: "2026-07-01T06:01:00.000Z",
      startUtcOffset: "7200s",
      endUtcOffset: "7200s",
    });
  });

  it("fills sample time offsets", () => {
    const payload = { weightGrams: 70000, sampleTime: { physicalTime: "2026-12-01T07:00" } };
    fillTimeFields(payload, getDataType("weight").writeSchema, TZ);
    expect(payload.sampleTime).toEqual({ physicalTime: "2026-12-01T06:00:00.000Z", utcOffset: "3600s" });
  });

  it("keeps explicit offsets", () => {
    const payload = { weightGrams: 70000, sampleTime: { physicalTime: "2026-12-01T07:00:00Z", utcOffset: "0s" } };
    fillTimeFields(payload, getDataType("weight").writeSchema, TZ);
    expect(payload.sampleTime.utcOffset).toBe("0s");
  });
});

describe("validatePayload", () => {
  it("reports missing and unknown fields", () => {
    const schema = getDataType("weight").writeSchema!;
    try {
      validatePayload(schema, { weightKg: 70 }, "weight");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(PayloadError);
      const issues = (err as PayloadError).issues.join("\n");
      expect(issues).toMatch(/weightGrams|required/i);
    }
  });

  it("rejects invalid enum values", () => {
    const info = getDataType("nutrition-log");
    const payload = {
      foodDisplayName: "x",
      mealType: "SECOND_BREAKFAST",
      interval: { startTime: "now", endTime: "now" },
    };
    fillTimeFields(payload, info.writeSchema, TZ);
    expect(() => validatePayload(info.writeSchema!, payload, "nutrition-log")).toThrow(PayloadError);
  });

  it("accepts every documented example", () => {
    for (const [id, example] of Object.entries(EXAMPLES)) {
      const info = getDataType(id);
      const payload = structuredClone(example) as Record<string, unknown>;
      fillTimeFields(payload, info.writeSchema, TZ);
      expect(() => validatePayload(info.writeSchema!, payload, id), id).not.toThrow();
    }
  });

  it("has a write schema for every writable type", () => {
    for (const info of DATA_TYPES.values()) {
      if (info.ops.includes("create")) expect(info.writeSchema, info.id).toBeDefined();
    }
  });
});
