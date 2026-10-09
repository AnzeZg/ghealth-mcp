/** Builds list filters and rollup request bodies from friendly inputs. */
import { type DataTypeInfo, filterName } from "./catalog.js";
import {
  addDays,
  civilDate,
  civilDateTime,
  daysBetween,
  parseCivilDate,
  parseInstant,
  toCivilDateTime,
} from "./time.js";

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

/** Civil (local) form of a user time: "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm:ss". */
export function toCivil(input: string, tz: string, now = new Date()): string {
  const value = input.trim();
  if (DATE_ONLY.test(value)) return value;
  if (LOCAL_DATE_TIME.test(value)) return value.length === 16 ? `${value}:00` : value;
  const lower = value.toLowerCase();
  if (lower === "today" || lower === "yesterday") return parseCivilDate(lower, tz, now);
  return civilDateTime(parseInstant(value, tz, now), tz);
}

export interface TimeRange {
  start?: string;
  end?: string;
}

/**
 * AIP-160 filter for a list/reconcile call. `end` is exclusive. If neither
 * bound is given, defaults to yesterday 00:00 through the end of today.
 */
export function buildListFilter(
  info: DataTypeInfo,
  range: TimeRange,
  tz: string,
  now = new Date(),
): string | undefined {
  if (info.timeKind === "none") return undefined;
  const today = civilDate(now, tz);
  const startInput = range.start ?? (range.end ? undefined : addDays(today, -1));
  const endInput = range.end ?? (range.start ? undefined : addDays(today, 1));
  const name = filterName(info.id);

  if (info.id === "electrocardiogram") {
    // ECG only supports a physical start-time lower bound.
    return startInput
      ? `electrocardiogram.interval.start_time >= "${parseInstant(startInput, tz, now).toISOString()}"`
      : undefined;
  }

  let field: string;
  let format: (v: string) => string = (v) => toCivil(v, tz, now);
  switch (info.timeKind) {
    case "interval":
      field = info.id === "sleep" ? "sleep.interval.civil_end_time" : `${name}.interval.civil_start_time`;
      break;
    case "sample":
      field = `${name}.sample_time.civil_time`;
      break;
    case "date":
      field = `${name}.date`;
      format = (v) => toCivil(v, tz, now).slice(0, 10);
      break;
    default:
      return undefined;
  }
  const clauses: string[] = [];
  if (startInput) clauses.push(`${field} >= "${format(startInput)}"`);
  if (endInput) clauses.push(`${field} < "${format(endInput)}"`);
  return clauses.length ? clauses.join(" AND ") : undefined;
}

/** Parses "1h", "15m", "30s", "1d" or a number of seconds into a Google duration string. */
export function parseWindow(input: string | number | undefined, fallbackSeconds = 3600): string {
  if (input === undefined || input === "") return `${fallbackSeconds}s`;
  if (typeof input === "number") return `${Math.round(input)}s`;
  const m = /^(\d+(?:\.\d+)?)\s*(s|sec|m|min|h|hr|hour|hours|d|day|days)?$/i.exec(input.trim());
  if (!m) throw new Error(`Invalid window "${input}". Use e.g. "15m", "1h", "1d" or seconds.`);
  const n = Number(m[1]);
  const unit = (m[2] ?? "s").toLowerCase()[0];
  const mult = unit === "d" ? 86400 : unit === "h" ? 3600 : unit === "m" ? 60 : 1;
  return `${Math.round(n * mult)}s`;
}

export function buildRollUpBody(
  info: DataTypeInfo,
  opts: { start: string; end?: string; window?: string | number; dataSourceFamily?: string; pageToken?: string },
  tz: string,
  now = new Date(),
): Record<string, unknown> {
  const start = parseInstant(opts.start, tz, now);
  const end = opts.end ? parseInstant(opts.end, tz, now) : now;
  if (end <= start) throw new Error("end must be after start.");
  const days = daysBetween(start, end);
  if (days > info.rollupMaxDays) {
    throw new Error(`${info.id} rollups are limited to ${info.rollupMaxDays} days (requested ${days.toFixed(1)}).`);
  }
  return omitUndefined({
    range: { startTime: start.toISOString(), endTime: end.toISOString() },
    windowSize: parseWindow(opts.window),
    dataSourceFamily: opts.dataSourceFamily,
    pageToken: opts.pageToken,
  });
}

/** Daily rollup: `startDate`..`endDate` inclusive civil dates. */
export function buildDailyRollUpBody(
  info: DataTypeInfo,
  opts: { startDate: string; endDate?: string; windowDays?: number; dataSourceFamily?: string; pageToken?: string },
  tz: string,
  now = new Date(),
): Record<string, unknown> {
  const startDate = parseCivilDate(opts.startDate, tz, now);
  const endDate = parseCivilDate(opts.endDate ?? startDate, tz, now);
  const endExclusive = addDays(endDate, 1);
  const days = Math.round(daysBetween(new Date(`${startDate}T00:00:00Z`), new Date(`${endExclusive}T00:00:00Z`)));
  if (days <= 0) throw new Error("endDate must be on or after startDate.");
  if (days > info.rollupMaxDays) {
    throw new Error(`${info.id} rollups are limited to ${info.rollupMaxDays} days (requested ${days}).`);
  }
  return omitUndefined({
    range: { start: toCivilDateTime(startDate), end: toCivilDateTime(endExclusive) },
    windowSizeDays: opts.windowDays ?? 1,
    dataSourceFamily: opts.dataSourceFamily,
    pageToken: opts.pageToken,
  });
}

function omitUndefined(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}
