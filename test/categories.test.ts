import { describe, expect, it } from "vitest";
import { parseEnabledCategories, scopesFor } from "../src/core/categories.js";

const P = "https://www.googleapis.com/auth/googlehealth.";

describe("parseEnabledCategories", () => {
  it("enables everything by default", () => {
    const all = parseEnabledCategories(undefined);
    expect(all.nutrition).toEqual({ read: true, write: true });
    expect(all.ecg).toEqual({ read: true, write: false });
    expect(all.symptoms).toEqual({ read: false, write: true });
    expect(parseEnabledCategories("all")).toEqual(all);
  });

  it("parses access modes and drops unsupported access", () => {
    const enabled = parseEnabledCategories("nutrition:rw, sleep:r, ecg:rw");
    expect(enabled).toEqual({
      nutrition: { read: true, write: true },
      sleep: { read: true, write: false },
      ecg: { read: true, write: false },
    });
  });

  it("defaults to rw when no mode is given", () => {
    expect(parseEnabledCategories("activity").activity).toEqual({ read: true, write: true });
  });

  it("rejects unknown categories and modes", () => {
    expect(() => parseEnabledCategories("food:r")).toThrow(/Unknown category/);
    expect(() => parseEnabledCategories("sleep:x")).toThrow(/Invalid access/);
  });
});

describe("scopesFor", () => {
  it("requests only the scopes for enabled access", () => {
    expect(scopesFor(parseEnabledCategories("nutrition:rw,sleep:r,symptoms:w"))).toEqual([
      "openid",
      "email",
      `${P}nutrition.readonly`,
      `${P}nutrition.writeonly`,
      `${P}sleep.readonly`,
      `${P}logged_symptoms.writeonly`,
    ]);
  });
});
