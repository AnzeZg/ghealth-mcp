/**
 * Example payloads shown by describe_data_type. Times may be local
 * ("2026-10-09T08:00") or relative ("now"); UTC offsets are filled in
 * automatically.
 */
export const EXAMPLES: Record<string, unknown> = {
  "nutrition-log": {
    foodDisplayName: "Oatmeal with banana",
    mealType: "BREAKFAST",
    interval: { startTime: "2026-10-09T08:00", endTime: "2026-10-09T08:01" },
    energy: { kcal: 350 },
    totalCarbohydrate: { grams: 60 },
    totalFat: { grams: 6 },
    nutrients: [
      { nutrient: "PROTEIN", quantity: { grams: 10 } },
      { nutrient: "DIETARY_FIBER", quantity: { grams: 8 } },
    ],
  },
  "hydration-log": {
    interval: { startTime: "now", endTime: "now" },
    amountConsumed: { milliliters: 250, userProvidedUnit: "MILLILITER" },
  },
  exercise: {
    exerciseType: "RUNNING",
    displayName: "Running",
    interval: { startTime: "2026-10-09T07:00", endTime: "2026-10-09T07:30" },
    activeDuration: "1800s",
    metricsSummary: { caloriesKcal: 320, distanceMillimeters: 5000000 },
    notes: "Easy morning run",
  },
  weight: { weightGrams: 72500, sampleTime: { physicalTime: "now" } },
  "body-fat": { percentage: 18.5, sampleTime: { physicalTime: "now" } },
  height: { heightMillimeters: 1800, sampleTime: { physicalTime: "now" } },
  sleep: {
    interval: { startTime: "2026-10-08T23:15", endTime: "2026-10-09T07:05" },
    type: "CLASSIC",
  },
};
