import { describe, expect, it } from "vitest";
import {
  addDays,
  civilDate,
  civilDateTime,
  offsetDuration,
  parseCivilDate,
  parseInstant,
  toCivilDateTime,
  utcOffsetSeconds,
} from "../src/core/time.js";

const TZ = "Europe/Ljubljana";

describe("time helpers", () => {
  it("computes UTC offsets across DST", () => {
    expect(utcOffsetSeconds(new Date("2026-07-01T12:00:00Z"), TZ)).toBe(7200);
    expect(utcOffsetSeconds(new Date("2026-12-01T12:00:00Z"), TZ)).toBe(3600);
    expect(utcOffsetSeconds(new Date("2026-07-01T12:00:00Z"), "America/New_York")).toBe(-14400);
    expect(offsetDuration(new Date("2026-12-01T12:00:00Z"), "UTC")).toBe("0s");
  });

  it("parses local times in the given zone", () => {
    expect(parseInstant("2026-07-01T08:30", TZ).toISOString()).toBe("2026-07-01T06:30:00.000Z");
    expect(parseInstant("2026-12-01", TZ).toISOString()).toBe("2026-11-30T23:00:00.000Z");
    expect(parseInstant("2026-07-01T08:30:00Z", TZ).toISOString()).toBe("2026-07-01T08:30:00.000Z");
    expect(parseInstant("2026-07-01T08:30:00+02:00", TZ).toISOString()).toBe("2026-07-01T06:30:00.000Z");
  });

  it("handles relative words", () => {
    const now = new Date("2026-10-09T22:30:00Z"); // 00:30 on Oct 10 in Ljubljana
    expect(parseInstant(undefined, TZ, now)).toBe(now);
    expect(parseCivilDate("today", TZ, now)).toBe("2026-10-10");
    expect(parseCivilDate("yesterday", TZ, now)).toBe("2026-10-09");
    expect(parseInstant("today", TZ, now).toISOString()).toBe("2026-10-09T22:00:00.000Z");
  });

  it("formats civil dates and times", () => {
    const d = new Date("2026-10-09T22:30:05Z");
    expect(civilDate(d, TZ)).toBe("2026-10-10");
    expect(civilDateTime(d, TZ)).toBe("2026-10-10T00:30:05");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(toCivilDateTime("2026-10-09")).toEqual({ date: { year: 2026, month: 10, day: 9 } });
    expect(toCivilDateTime("2026-10-09T07:05:00")).toEqual({
      date: { year: 2026, month: 10, day: 9 },
      time: { hours: 7, minutes: 5, seconds: 0 },
    });
  });

  it("rejects garbage", () => {
    expect(() => parseInstant("next tuesday", TZ)).toThrow(/Could not parse/);
  });
});
