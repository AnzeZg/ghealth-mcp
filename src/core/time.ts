/**
 * Time helpers. The API wants RFC 3339 instants plus the user's UTC offset
 * (as a duration string like "7200s") for writes, and civil (local) date/times
 * for filters and daily rollups. All conversions use Intl so they work in
 * Node and Cloudflare Workers alike.
 */

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/;
const HAS_OFFSET = /(Z|[+-]\d{2}:?\d{2})$/i;

export function assertTimeZone(tz: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    throw new Error(`Invalid IANA time zone "${tz}" (example: "Europe/Ljubljana").`);
  }
}

/** Offset of `tz` from UTC at `instant`, in seconds (e.g. 7200 for CEST). */
export function utcOffsetSeconds(instant: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    timeZoneName: "longOffset",
  }).formatToParts(instant);
  const name = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const match = /GMT([+-])(\d{2}):?(\d{2})?/.exec(name);
  if (!match) return 0;
  const sign = match[1] === "-" ? -1 : 1;
  return sign * (Number(match[2]) * 3600 + Number(match[3] ?? 0) * 60);
}

/** Google duration string for an offset, e.g. 7200 -> "7200s". */
export function toDuration(seconds: number): string {
  return `${Math.round(seconds)}s`;
}

export function offsetDuration(instant: Date, tz: string): string {
  return toDuration(utcOffsetSeconds(instant, tz));
}

interface CivilParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function civilParts(instant: Date, tz: string): CivilParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/** "YYYY-MM-DD" in `tz`. */
export function civilDate(instant: Date, tz: string): string {
  const p = civilParts(instant, tz);
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;
}

/** "YYYY-MM-DDTHH:mm:ss" in `tz`. */
export function civilDateTime(instant: Date, tz: string): string {
  const p = civilParts(instant, tz);
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`;
}

/** Converts a wall-clock time in `tz` to an instant (handles DST transitions). */
function zonedToInstant(p: CivilParts, tz: string): Date {
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  let guess = asUtc - utcOffsetSeconds(new Date(asUtc), tz) * 1000;
  // Second pass corrects guesses that crossed a DST boundary.
  guess = asUtc - utcOffsetSeconds(new Date(guess), tz) * 1000;
  return new Date(guess);
}

/**
 * Parses a user/agent supplied time into an instant.
 * Accepts RFC 3339 with offset ("2026-10-09T08:00:00Z"), local date-times
 * ("2026-10-09T08:00", interpreted in `tz`), dates ("2026-10-09" = local
 * midnight), "now", "today" and "yesterday". Undefined means now.
 */
export function parseInstant(input: string | undefined, tz: string, now = new Date()): Date {
  if (input === undefined || input.trim() === "" || input.trim().toLowerCase() === "now") {
    return now;
  }
  const value = input.trim();
  const lower = value.toLowerCase();
  if (lower === "today" || lower === "yesterday") {
    const date = civilDate(now, tz);
    return parseInstant(lower === "today" ? date : addDays(date, -1), tz, now);
  }
  if (HAS_OFFSET.test(value)) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new Error(`Invalid timestamp "${input}".`);
    return date;
  }
  const dateOnly = DATE_ONLY.exec(value);
  if (dateOnly) {
    return zonedToInstant(
      { year: +dateOnly[1]!, month: +dateOnly[2]!, day: +dateOnly[3]!, hour: 0, minute: 0, second: 0 },
      tz,
    );
  }
  const local = LOCAL_DATE_TIME.exec(value);
  if (local) {
    return zonedToInstant(
      {
        year: +local[1]!,
        month: +local[2]!,
        day: +local[3]!,
        hour: +local[4]!,
        minute: +local[5]!,
        second: +(local[6] ?? 0),
      },
      tz,
    );
  }
  throw new Error(
    `Could not parse time "${input}". Use ISO 8601, e.g. "2026-10-09", "2026-10-09T08:30" or "2026-10-09T08:30:00Z".`,
  );
}

/** Parses a date ("YYYY-MM-DD", "today", "yesterday", or any instant) into a civil date in `tz`. */
export function parseCivilDate(input: string | undefined, tz: string, now = new Date()): string {
  if (input && DATE_ONLY.test(input.trim())) return input.trim();
  return civilDate(parseInstant(input ?? "today", tz, now), tz);
}

/** Adds days to a "YYYY-MM-DD" date. */
export function addDays(date: string, days: number): string {
  const m = DATE_ONLY.exec(date);
  if (!m) throw new Error(`Expected YYYY-MM-DD, got "${date}".`);
  const d = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]! + days));
  return d.toISOString().slice(0, 10);
}

export function daysBetween(start: Date, end: Date): number {
  return (end.getTime() - start.getTime()) / 86_400_000;
}

/** Google CivilDateTime object from "YYYY-MM-DD[THH:mm:ss]". */
export function toCivilDateTime(civil: string): {
  date: { year: number; month: number; day: number };
  time?: { hours: number; minutes: number; seconds: number };
} {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2}))?$/.exec(civil);
  if (!m) throw new Error(`Expected civil date/time, got "${civil}".`);
  const out: ReturnType<typeof toCivilDateTime> = {
    date: { year: +m[1]!, month: +m[2]!, day: +m[3]! },
  };
  if (m[4] !== undefined) out.time = { hours: +m[4], minutes: +m[5]!, seconds: +m[6]! };
  return out;
}
