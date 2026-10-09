/**
 * Prepares write payloads: fills in UTC offsets the agent left out, then
 * validates against the generated JSON Schema (no eval, so it runs in Workers).
 */
import { type Schema, Validator } from "@cfworker/json-schema";
import { offsetDuration, parseInstant } from "./time.js";

export class PayloadError extends Error {
  constructor(
    message: string,
    readonly issues: string[],
  ) {
    super(message);
    this.name = "PayloadError";
  }
}

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

const TIME_PAIRS: Array<[string, string]> = [
  ["startTime", "startUtcOffset"],
  ["endTime", "endUtcOffset"],
  ["physicalTime", "utcOffset"],
];

/**
 * Normalizes time fields in place, walking the payload alongside its schema:
 *  - startTime/endTime/physicalTime given as local or relative times become RFC 3339 UTC
 *  - missing startUtcOffset/endUtcOffset/utcOffset are computed from the time zone,
 *    but only where the schema actually has that offset field
 */
export function fillTimeFields(value: unknown, schema: Record<string, unknown> | undefined, tz: string): void {
  if (!schema) return;
  if (Array.isArray(value)) {
    const items = isObject(schema.items) ? schema.items : undefined;
    for (const item of value) fillTimeFields(item, items, tz);
    return;
  }
  if (!isObject(value)) return;
  const props = isObject(schema.properties) ? schema.properties : {};

  for (const [timeKey, offsetKey] of TIME_PAIRS) {
    const raw = value[timeKey];
    if (typeof raw !== "string" || !(timeKey in props)) continue;
    const instant = parseInstant(raw, tz);
    value[timeKey] = instant.toISOString();
    if (value[offsetKey] === undefined && offsetKey in props) {
      value[offsetKey] = offsetDuration(instant, tz);
    }
  }
  for (const [key, child] of Object.entries(value)) {
    const childSchema = props[key];
    if (isObject(childSchema)) fillTimeFields(child, childSchema, tz);
  }
}

const validators = new WeakMap<object, Validator>();

export function validatePayload(schema: Record<string, unknown>, payload: unknown, label: string): void {
  let validator = validators.get(schema);
  if (!validator) {
    validator = new Validator(schema as Schema, "2020-12", false);
    validators.set(schema, validator);
  }
  const result = validator.validate(payload);
  if (result.valid) return;
  // Report the most specific errors (deepest locations), deduplicated.
  const issues = [
    ...new Set(
      result.errors
        .filter((e) => !["properties", "$ref", "items", "allOf"].includes(e.keyword))
        .map((e) => `${e.instanceLocation.replace(/^#/, "") || "/"}: ${e.error}`),
    ),
  ].slice(0, 15);
  throw new PayloadError(
    `Invalid ${label} payload. Call describe_data_type for the exact schema.`,
    issues.length ? issues : result.errors.slice(0, 5).map((e) => e.error),
  );
}
