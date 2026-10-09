/**
 * Categories group data types by the OAuth scope that protects them. Each
 * category can be enabled for reading, writing, or both via ENABLED_CATEGORIES.
 */

const SCOPE_PREFIX = "https://www.googleapis.com/auth/googlehealth.";

export type CategoryId =
  | "activity"
  | "metrics"
  | "nutrition"
  | "sleep"
  | "profile"
  | "settings"
  | "location"
  | "ecg"
  | "irn"
  | "symptoms"
  | "mindfulness"
  | "reproductive";

export interface Access {
  read: boolean;
  write: boolean;
}

interface CategoryDef {
  scope: string;
  supportsRead: boolean;
  supportsWrite: boolean;
  label: string;
}

export const CATEGORIES: Record<CategoryId, CategoryDef> = {
  activity: {
    scope: "activity_and_fitness",
    supportsRead: true,
    supportsWrite: true,
    label: "Activity & fitness (steps, workouts, calories, VO2 max…)",
  },
  metrics: {
    scope: "health_metrics_and_measurements",
    supportsRead: true,
    supportsWrite: true,
    label: "Health metrics (heart rate, HRV, SpO2, weight, body fat…)",
  },
  nutrition: { scope: "nutrition", supportsRead: true, supportsWrite: true, label: "Nutrition (meals, water, foods)" },
  sleep: { scope: "sleep", supportsRead: true, supportsWrite: true, label: "Sleep" },
  profile: { scope: "profile", supportsRead: true, supportsWrite: true, label: "Profile (age, stride length…)" },
  settings: { scope: "settings", supportsRead: true, supportsWrite: true, label: "Settings (units, time zone…)" },
  location: {
    scope: "location",
    supportsRead: true,
    supportsWrite: false,
    label: "GPS location recorded during workouts",
  },
  ecg: { scope: "ecg", supportsRead: true, supportsWrite: false, label: "ECG readings" },
  irn: { scope: "irn", supportsRead: true, supportsWrite: false, label: "Irregular rhythm notifications" },
  symptoms: { scope: "logged_symptoms", supportsRead: false, supportsWrite: true, label: "Logged symptoms" },
  mindfulness: { scope: "mindfulness", supportsRead: false, supportsWrite: true, label: "Moods / mindfulness" },
  reproductive: {
    scope: "reproductive_health",
    supportsRead: false,
    supportsWrite: true,
    label: "Menstrual periods and ovulation tests",
  },
};

export const CATEGORY_IDS = Object.keys(CATEGORIES) as CategoryId[];

export type EnabledCategories = Partial<Record<CategoryId, Access>>;

/** Every category with every access it supports. */
export function allCategories(): EnabledCategories {
  const out: EnabledCategories = {};
  for (const id of CATEGORY_IDS) {
    const def = CATEGORIES[id];
    out[id] = { read: def.supportsRead, write: def.supportsWrite };
  }
  return out;
}

/**
 * Parses ENABLED_CATEGORIES, e.g. "nutrition:rw,activity:rw,sleep:r".
 * Empty / undefined / "all" enables everything. Access that a category does
 * not support (e.g. "ecg:w") is silently dropped; unknown names throw.
 */
export function parseEnabledCategories(value: string | undefined): EnabledCategories {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.toLowerCase() === "all") return allCategories();

  const out: EnabledCategories = {};
  for (const raw of trimmed.split(",")) {
    const entry = raw.trim();
    if (!entry) continue;
    const [name, mode = "rw"] = entry.split(":").map((s) => s.trim().toLowerCase());
    if (!name || !(name in CATEGORIES)) {
      throw new Error(`Unknown category "${name}" in ENABLED_CATEGORIES. Valid: ${CATEGORY_IDS.join(", ")}`);
    }
    if (!/^(r|w|rw|wr)$/.test(mode)) {
      throw new Error(`Invalid access "${mode}" for category "${name}". Use r, w or rw.`);
    }
    const def = CATEGORIES[name as CategoryId];
    out[name as CategoryId] = {
      read: mode.includes("r") && def.supportsRead,
      write: mode.includes("w") && def.supportsWrite,
    };
  }
  return out;
}

export function canRead(enabled: EnabledCategories, category: CategoryId): boolean {
  return enabled[category]?.read ?? false;
}

export function canWrite(enabled: EnabledCategories, category: CategoryId): boolean {
  return enabled[category]?.write ?? false;
}

/** OAuth scopes to request for the enabled categories (plus identity scopes). */
export function scopesFor(enabled: EnabledCategories): string[] {
  const scopes = ["openid", "email"];
  for (const id of CATEGORY_IDS) {
    const access = enabled[id];
    if (!access) continue;
    const { scope } = CATEGORIES[id];
    if (access.read) scopes.push(`${SCOPE_PREFIX}${scope}.readonly`);
    if (access.write) scopes.push(`${SCOPE_PREFIX}${scope}.writeonly`);
  }
  return scopes;
}

export function describeEnabled(enabled: EnabledCategories): string {
  return CATEGORY_IDS.filter((id) => enabled[id]?.read || enabled[id]?.write)
    .map((id) => {
      const a = enabled[id]!;
      return `${id}:${a.read ? "r" : ""}${a.write ? "w" : ""}`;
    })
    .join(",");
}
