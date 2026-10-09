/** Unit conversions into the API's base units (grams, milliliters, millimeters). */

export type WeightUnit = "kg" | "lb" | "st" | "g";
export type VolumeUnit = "ml" | "l" | "floz" | "cup";
export type DistanceUnit = "km" | "mi" | "m";

const GRAMS: Record<WeightUnit, number> = { g: 1, kg: 1000, lb: 453.59237, st: 6350.29318 };
const MILLILITERS: Record<VolumeUnit, number> = { ml: 1, l: 1000, floz: 29.5735295625, cup: 236.5882365 };
const MILLIMETERS: Record<DistanceUnit, number> = { m: 1000, km: 1_000_000, mi: 1_609_344 };

/** Matching userProvidedUnit enum values, so the Google Health app shows the user's own unit. */
export const WEIGHT_UNIT_ENUM: Record<WeightUnit, string> = {
  g: "GRAM",
  kg: "KILOGRAM",
  lb: "POUND",
  st: "STONE",
};
export const VOLUME_UNIT_ENUM: Record<VolumeUnit, string> = {
  ml: "MILLILITER",
  l: "LITER",
  floz: "FLUID_OUNCE_US",
  cup: "CUP_US",
};

const round = (n: number, digits = 3) => Math.round(n * 10 ** digits) / 10 ** digits;

export function toGrams(value: number, unit: WeightUnit): number {
  return round(value * GRAMS[unit]);
}

export function toMilliliters(value: number, unit: VolumeUnit): number {
  return round(value * MILLILITERS[unit]);
}

export function toMillimeters(value: number, unit: DistanceUnit): number {
  return Math.round(value * MILLIMETERS[unit]);
}
