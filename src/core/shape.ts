/** Keeps tool responses compact and bounded so they fit in the agent's context. */

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

/** Drops device/application detail from dataSource unless verbose. */
export function compactDataPoint(point: unknown, verbose: boolean): unknown {
  if (verbose || !isObject(point)) return point;
  const { dataSource, ...rest } = point;
  if (!isObject(dataSource)) return rest;
  const app = isObject(dataSource.application) ? dataSource.application : undefined;
  const device = isObject(dataSource.device) ? dataSource.device : undefined;
  return {
    ...rest,
    source:
      [
        dataSource.platform,
        dataSource.recordingMethod,
        app?.displayName ?? app?.packageName,
        device?.displayName ?? device?.model,
      ]
        .filter((v) => typeof v === "string" && v && !v.endsWith("UNSPECIFIED"))
        .join(" · ") || undefined,
  };
}

export function compactList(response: Json, verbose: boolean): Json {
  const out: Json = { ...response };
  for (const key of ["dataPoints", "reconciledDataPoints"]) {
    const list = out[key];
    if (Array.isArray(list)) out[key] = list.map((p) => compactDataPoint(p, verbose));
  }
  return out;
}

/**
 * Serializes `value`, trimming the largest array if the JSON exceeds maxBytes.
 * Returns the text plus whether truncation happened.
 */
export function boundedJson(value: unknown, maxBytes: number): { text: string; truncated: boolean } {
  let text = JSON.stringify(value);
  if (text.length <= maxBytes || !isObject(value)) return { text, truncated: false };

  const arrayKey = Object.keys(value)
    .filter((k) => Array.isArray(value[k]))
    .sort((a, b) => (value[b] as unknown[]).length - (value[a] as unknown[]).length)[0];
  if (!arrayKey) {
    return { text: `${text.slice(0, maxBytes)}… [truncated]`, truncated: true };
  }

  const items = value[arrayKey] as unknown[];
  let keep = items.length;
  while (keep > 0) {
    keep = Math.floor(keep * 0.7);
    const candidate = {
      ...value,
      [arrayKey]: items.slice(0, keep),
      truncated: {
        shown: keep,
        total: items.length,
        note: "Response was too large. Narrow the time range, use a smaller pageSize, or use aggregate_data for totals.",
      },
    };
    text = JSON.stringify(candidate);
    if (text.length <= maxBytes) return { text, truncated: true };
  }
  return { text: JSON.stringify({ ...value, [arrayKey]: [], truncated: true }), truncated: true };
}
