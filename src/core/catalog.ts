/**
 * Every Google Health API data type and the operations it supports
 * (from https://developers.google.com/health/data-types), joined with the
 * generated schema info (field name, time kind, writable JSON Schema).
 */
import type { CategoryId } from "./categories.js";
import generated from "./generated/schemas.json" with { type: "json" };

export type Operation = "list" | "get" | "reconcile" | "rollup" | "dailyRollup" | "create" | "update" | "batchDelete";

export type TimeKind = "interval" | "sample" | "date" | "none";

export interface DataTypeInfo {
  id: string;
  category: CategoryId;
  ops: readonly Operation[];
  /** DataPoint field holding this type's payload, e.g. "nutritionLog". */
  field: string;
  timeKind: TimeKind;
  apiVersion: "v4" | "v4beta";
  description: string;
  /** Max range for rollUp / dailyRollUp in days. */
  rollupMaxDays: number;
  /** Max page size for list / reconcile. */
  pageSizeCap: number;
  /** JSON Schema for create/update payloads, if the type is writable. */
  writeSchema?: Record<string, unknown>;
  notes?: string;
}

const READ_ROLLUP = ["list", "reconcile", "rollup", "dailyRollup"] as const;
const READ_ONLY = ["list", "reconcile"] as const;
const ROLLUP_ONLY = ["reconcile", "rollup", "dailyRollup"] as const;
const WRITE_ONLY = ["create", "update", "batchDelete"] as const;

interface Entry {
  category: CategoryId;
  ops: readonly Operation[];
  rollupMaxDays?: number;
  pageSizeCap?: number;
  notes?: string;
  /** For rollup-only types that have no DataPoint schema. */
  timeKind?: TimeKind;
  description?: string;
}

const ENTRIES: Record<string, Entry> = {
  // Activity & fitness
  "active-energy-burned": { category: "activity", ops: READ_ROLLUP },
  "active-minutes": { category: "activity", ops: READ_ROLLUP, rollupMaxDays: 14 },
  "active-zone-minutes": { category: "activity", ops: READ_ROLLUP },
  "activity-level": { category: "activity", ops: READ_ONLY },
  altitude: { category: "activity", ops: READ_ROLLUP },
  "basal-energy-burned": {
    category: "activity",
    ops: READ_ONLY,
    notes: "Not listed in the public data type table; may not be available yet.",
  },
  "calories-in-heart-rate-zone": {
    category: "activity",
    ops: ["rollup", "dailyRollup"],
    rollupMaxDays: 14,
    timeKind: "none",
    description: "Calories burned in each heart rate zone (aggregate only).",
  },
  "daily-vo2-max": { category: "activity", ops: READ_ONLY },
  distance: { category: "activity", ops: READ_ROLLUP },
  exercise: {
    category: "activity",
    ops: ["list", "get", "reconcile", "create", "update", "batchDelete"],
    pageSizeCap: 25,
    notes: "Workouts. Use export_workout_tcx for GPS/TCX data.",
  },
  floors: { category: "activity", ops: ROLLUP_ONLY },
  "run-vo2-max": { category: "activity", ops: READ_ROLLUP },
  "sedentary-period": { category: "activity", ops: READ_ROLLUP },
  steps: { category: "activity", ops: READ_ROLLUP },
  "swim-lengths-data": { category: "activity", ops: READ_ROLLUP },
  "time-in-heart-rate-zone": { category: "activity", ops: READ_ROLLUP },
  "total-calories": {
    category: "activity",
    ops: ["rollup", "dailyRollup"],
    rollupMaxDays: 14,
    timeKind: "none",
    description: "Total calories burned (BMR + activity), aggregate only.",
  },
  "vo2-max": { category: "activity", ops: READ_ONLY },

  // Health metrics & measurements
  "blood-glucose": { category: "metrics", ops: ["list", "get", "reconcile", "rollup", "dailyRollup"] },
  "body-fat": {
    category: "metrics",
    ops: ["list", "get", "reconcile", "rollup", "dailyRollup", "create", "update", "batchDelete"],
  },
  "core-body-temperature": { category: "metrics", ops: ["list", "get", "reconcile", "rollup", "dailyRollup"] },
  "daily-heart-rate-variability": { category: "metrics", ops: READ_ONLY },
  "daily-heart-rate-zones": { category: "metrics", ops: READ_ONLY },
  "daily-oxygen-saturation": { category: "metrics", ops: READ_ONLY },
  "daily-respiratory-rate": { category: "metrics", ops: READ_ONLY },
  "daily-resting-heart-rate": { category: "metrics", ops: READ_ONLY },
  "daily-sleep-temperature-derivations": { category: "metrics", ops: READ_ONLY },
  "heart-rate": { category: "metrics", ops: READ_ROLLUP, rollupMaxDays: 14 },
  "heart-rate-variability": { category: "metrics", ops: READ_ONLY },
  height: { category: "metrics", ops: ["list", "get", "reconcile", "create", "update", "batchDelete"] },
  "oxygen-saturation": { category: "metrics", ops: READ_ONLY },
  "respiratory-rate-sleep-summary": { category: "metrics", ops: READ_ONLY },
  "skin-temperature": {
    category: "metrics",
    ops: ["list"],
    notes: "v4beta preview; not yet in the public data type table.",
  },
  "skin-temperature-sensors": { category: "metrics", ops: ["list"], notes: "v4beta preview." },
  weight: {
    category: "metrics",
    ops: ["list", "get", "reconcile", "rollup", "dailyRollup", "create", "update", "batchDelete"],
  },

  // Nutrition
  food: { category: "nutrition", ops: ["list", "get"] },
  "food-measurement-unit": { category: "nutrition", ops: ["list", "get"] },
  "hydration-log": {
    category: "nutrition",
    ops: ["list", "get", "reconcile", "rollup", "dailyRollup", "create", "update", "batchDelete"],
  },
  "nutrition-log": {
    category: "nutrition",
    ops: ["list", "get", "reconcile", "rollup", "dailyRollup", "create", "update", "batchDelete"],
    notes: "Logs created without a `food` reference (anonymous food) cannot be edited; delete and recreate instead.",
  },

  // Sleep
  sleep: {
    category: "sleep",
    ops: ["list", "get", "reconcile", "create", "update", "batchDelete"],
    pageSizeCap: 25,
  },

  // Single-scope types
  electrocardiogram: { category: "ecg", ops: ["list"] },
  "irregular-rhythm-notification": { category: "irn", ops: ["list"] },
  "menstrual-period": { category: "reproductive", ops: WRITE_ONLY },
  "ovulation-test": { category: "reproductive", ops: WRITE_ONLY },
  moods: { category: "mindfulness", ops: WRITE_ONLY },
  symptoms: { category: "symptoms", ops: WRITE_ONLY },
};

interface GeneratedType {
  field: string;
  apiVersion: "v4" | "v4beta";
  description?: string;
  timeKind: TimeKind;
  writeSchema: Record<string, unknown>;
}

const GENERATED = generated.dataTypes as unknown as Record<string, GeneratedType>;

export const ACCOUNT_SCHEMAS = generated.accountSchemas as unknown as {
  profile: Record<string, unknown>;
  settings: Record<string, unknown>;
};

function camel(id: string): string {
  return id.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

function build(): Map<string, DataTypeInfo> {
  const map = new Map<string, DataTypeInfo>();
  for (const [id, entry] of Object.entries(ENTRIES)) {
    const gen = GENERATED[id];
    const writable = entry.ops.includes("create") || entry.ops.includes("update");
    map.set(id, {
      id,
      category: entry.category,
      ops: entry.ops,
      field: gen?.field ?? camel(id),
      timeKind: entry.timeKind ?? gen?.timeKind ?? "none",
      apiVersion: gen?.apiVersion ?? "v4",
      description: entry.description ?? gen?.description ?? "",
      rollupMaxDays: entry.rollupMaxDays ?? 90,
      pageSizeCap: entry.pageSizeCap ?? 10000,
      writeSchema: writable ? gen?.writeSchema : undefined,
      notes: entry.notes,
    });
  }
  return map;
}

export const DATA_TYPES: ReadonlyMap<string, DataTypeInfo> = build();

export const DATA_TYPE_IDS: readonly string[] = [...DATA_TYPES.keys()];

export function getDataType(id: string): DataTypeInfo {
  const info = DATA_TYPES.get(id);
  if (!info) {
    throw new Error(`Unknown data type "${id}". Call list_data_types to see valid ids.`);
  }
  return info;
}

export function supports(info: DataTypeInfo, op: Operation): boolean {
  return info.ops.includes(op);
}

/** snake_case name used inside filter expressions, e.g. "nutrition_log". */
export function filterName(id: string): string {
  return id.replace(/-/g, "_");
}
