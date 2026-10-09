import { describe, expect, it } from "vitest";
import { getDataType } from "../src/core/catalog.js";
import { buildDailyRollUpBody, buildListFilter, buildRollUpBody, parseWindow } from "../src/core/queries.js";

const TZ = "Europe/Ljubljana";
const NOW = new Date("2026-10-09T10:00:00Z");

describe("buildListFilter", () => {
  it("uses civil start time for interval types", () => {
    expect(buildListFilter(getDataType("steps"), { start: "2026-10-01", end: "2026-10-02" }, TZ, NOW)).toBe(
      'steps.interval.civil_start_time >= "2026-10-01" AND steps.interval.civil_start_time < "2026-10-02"',
    );
  });

  it("uses civil end time for sleep", () => {
    expect(buildListFilter(getDataType("sleep"), { start: "2026-10-09T00:00", end: "2026-10-10" }, TZ, NOW)).toBe(
      'sleep.interval.civil_end_time >= "2026-10-09T00:00:00" AND sleep.interval.civil_end_time < "2026-10-10"',
    );
  });

  it("uses sample time and date filters", () => {
    expect(buildListFilter(getDataType("weight"), { start: "2026-10-01T06:00:00Z" }, TZ, NOW)).toBe(
      'weight.sample_time.civil_time >= "2026-10-01T08:00:00"',
    );
    expect(
      buildListFilter(
        getDataType("daily-resting-heart-rate"),
        { start: "2026-10-01T08:00", end: "2026-10-05" },
        TZ,
        NOW,
      ),
    ).toBe('daily_resting_heart_rate.date >= "2026-10-01" AND daily_resting_heart_rate.date < "2026-10-05"');
  });

  it("defaults to yesterday through today", () => {
    expect(buildListFilter(getDataType("nutrition-log"), {}, TZ, NOW)).toBe(
      'nutrition_log.interval.civil_start_time >= "2026-10-08" AND nutrition_log.interval.civil_start_time < "2026-10-10"',
    );
  });

  it("only allows a physical lower bound for ECG", () => {
    expect(buildListFilter(getDataType("electrocardiogram"), { start: "2026-10-01" }, TZ, NOW)).toBe(
      'electrocardiogram.interval.start_time >= "2026-09-30T22:00:00.000Z"',
    );
  });

  it("returns no filter for untimed types", () => {
    expect(buildListFilter(getDataType("food"), { start: "2026-10-01" }, TZ, NOW)).toBeUndefined();
  });
});

describe("rollup bodies", () => {
  it("builds daily rollups with an exclusive end date", () => {
    expect(
      buildDailyRollUpBody(getDataType("steps"), { startDate: "2026-10-01", endDate: "2026-10-07" }, TZ, NOW),
    ).toEqual({
      range: {
        start: { date: { year: 2026, month: 10, day: 1 } },
        end: { date: { year: 2026, month: 10, day: 8 } },
      },
      windowSizeDays: 1,
    });
  });

  it("enforces range limits", () => {
    expect(() =>
      buildDailyRollUpBody(getDataType("heart-rate"), { startDate: "2026-09-01", endDate: "2026-09-30" }, TZ, NOW),
    ).toThrow(/14 days/);
    expect(() => buildRollUpBody(getDataType("steps"), { start: "2026-01-01", end: "2026-10-01" }, TZ, NOW)).toThrow(
      /90 days/,
    );
  });

  it("builds window rollups", () => {
    expect(
      buildRollUpBody(
        getDataType("heart-rate"),
        { start: "2026-10-09T08:00", end: "2026-10-09T10:00", window: "15m" },
        TZ,
        NOW,
      ),
    ).toEqual({
      range: { startTime: "2026-10-09T06:00:00.000Z", endTime: "2026-10-09T08:00:00.000Z" },
      windowSize: "900s",
    });
  });

  it("parses window sizes", () => {
    expect(parseWindow("1h")).toBe("3600s");
    expect(parseWindow("2d")).toBe("172800s");
    expect(parseWindow(90)).toBe("90s");
    expect(() => parseWindow("soon")).toThrow();
  });
});
