/**
 * Generates src/core/generated/schemas.json from the public Google Health API
 * discovery document. For every data type it records:
 *   - the DataPoint field name and schema name
 *   - how the type is filtered by time ("interval" | "sample" | "date" | "none")
 *   - a JSON Schema for the writable payload (refs resolved, output-only fields removed)
 *
 * Types that exist only in the v4beta API are included with apiVersion "v4beta".
 *
 * Usage: npm run generate
 */
import { writeFile } from "node:fs/promises";

const DISCOVERY_URL = "https://health.googleapis.com/$discovery/rest?version=v4";
const BETA_DISCOVERY_URL = "https://health.googleapis.com/$discovery/rest?version=v4beta";
const OUT = new URL("../src/core/generated/schemas.json", import.meta.url);
const MAX_DESCRIPTION = 300;

interface DiscoveryProperty {
  type?: string;
  format?: string;
  description?: string;
  readOnly?: boolean;
  enum?: string[];
  $ref?: string;
  items?: DiscoveryProperty;
  additionalProperties?: DiscoveryProperty;
}
interface DiscoverySchema {
  id: string;
  type: string;
  description?: string;
  properties?: Record<string, DiscoveryProperty>;
}
interface Discovery {
  revision: string;
  schemas: Record<string, DiscoverySchema>;
}

type JsonSchema = Record<string, unknown>;

async function loadDiscovery(url: string): Promise<Discovery> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Discovery fetch failed for ${url}: ${res.status}`);
  return (await res.json()) as Discovery;
}

function trimDescription(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > MAX_DESCRIPTION ? `${flat.slice(0, MAX_DESCRIPTION - 1)}…` : flat;
}

function isRequired(prop: DiscoveryProperty): boolean {
  return !prop.readOnly && /^Required\b/.test(prop.description ?? "");
}

function formatNote(format: string | undefined): string | undefined {
  switch (format) {
    case "google-datetime":
      return "RFC 3339 timestamp, e.g. 2026-10-09T08:30:00Z";
    case "google-duration":
      return "Duration in seconds with an 's' suffix, e.g. '7200s' or '-18000s'";
    default:
      return undefined;
  }
}

function convertProperty(
  prop: DiscoveryProperty,
  schemas: Record<string, DiscoverySchema>,
  stack: string[],
): JsonSchema {
  const description = [trimDescription(prop.description), formatNote(prop.format)].filter(Boolean).join(" ");
  let out: JsonSchema;
  if (prop.$ref) {
    out = convertSchema(prop.$ref, schemas, stack);
  } else if (prop.type === "array" && prop.items) {
    out = { type: "array", items: convertProperty(prop.items, schemas, stack) };
  } else if (prop.type === "object" && prop.additionalProperties) {
    out = {
      type: "object",
      additionalProperties: convertProperty(prop.additionalProperties, schemas, stack),
    };
  } else if (prop.format === "int64" || prop.format === "uint64") {
    // proto3 JSON accepts 64-bit integers as numbers or decimal strings.
    out = { type: ["string", "integer"] };
  } else if (prop.type === "integer" || prop.type === "number" || prop.type === "boolean") {
    out = { type: prop.type };
  } else if (prop.type === "any") {
    out = {};
  } else {
    out = { type: "string" };
  }
  if (prop.enum) out.enum = prop.enum;
  if (description) out.description = description;
  return out;
}

function convertSchema(name: string, schemas: Record<string, DiscoverySchema>, stack: string[]): JsonSchema {
  const schema = schemas[name];
  if (!schema) throw new Error(`Unknown schema ${name}`);
  if (stack.includes(name)) return { type: "object", description: `(recursive ${name})` };
  const nextStack = [...stack, name];
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];
  for (const [key, prop] of Object.entries(schema.properties ?? {})) {
    if (prop.readOnly) continue;
    properties[key] = convertProperty(prop, schemas, nextStack);
    if (isRequired(prop)) required.push(key);
  }
  const out: JsonSchema = { type: "object", properties, additionalProperties: false };
  if (required.length) out.required = required;
  return out;
}

function timeKind(schema: DiscoverySchema): "interval" | "sample" | "date" | "none" {
  const props = schema.properties ?? {};
  if (props.interval) return "interval";
  if (props.sampleTime) return "sample";
  if (props.date?.$ref === "Date") return "date";
  return "none";
}

function kebab(camel: string): string {
  return camel.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

function collectDataTypes(discovery: Discovery, apiVersion: "v4" | "v4beta", into: Record<string, unknown>): void {
  const dataPoint = discovery.schemas.DataPoint;
  if (!dataPoint?.properties) throw new Error("DataPoint schema missing from discovery doc");
  for (const [field, prop] of Object.entries(dataPoint.properties)) {
    const id = kebab(field);
    if (!prop.$ref || field === "dataSource" || id in into) continue;
    const schema = discovery.schemas[prop.$ref];
    if (!schema) continue;
    into[id] = {
      field,
      schemaName: prop.$ref,
      apiVersion,
      description: trimDescription(schema.description),
      timeKind: timeKind(schema),
      writeSchema: convertSchema(prop.$ref, discovery.schemas, []),
    };
  }
}

async function main(): Promise<void> {
  const [discovery, beta] = await Promise.all([loadDiscovery(DISCOVERY_URL), loadDiscovery(BETA_DISCOVERY_URL)]);

  const dataTypes: Record<string, unknown> = {};
  collectDataTypes(discovery, "v4", dataTypes);
  collectDataTypes(beta, "v4beta", dataTypes);

  const accountSchemas = {
    profile: convertSchema("Profile", discovery.schemas, []),
    settings: convertSchema("Settings", discovery.schemas, []),
  };

  const output = {
    source: DISCOVERY_URL,
    dataTypes,
    accountSchemas,
  };
  await writeFile(OUT, `${JSON.stringify(output, null, 1)}\n`);
  console.log(`Wrote ${Object.keys(dataTypes).length} data types (revision ${discovery.revision})`);
}

await main();
