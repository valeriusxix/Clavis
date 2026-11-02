/**
 * Canonical JSON (AGENT.md 11.1): object keys sorted, no whitespace, UTF-8.
 * Keys are sorted by UTF-16 code unit order (JavaScript's default sort), recursively.
 * Throws on values JSON cannot represent exactly (undefined, functions, bigint, NaN, Infinity),
 * so a bad log entry fails loudly instead of hashing to something surprising.
 */
export function canonicalJSON(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
    case "boolean":
      return JSON.stringify(value);
    case "number":
      if (!Number.isFinite(value)) throw new TypeError(`canonicalJSON: non-finite number ${value}`);
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(",")}]`;
      const obj = value as Record<string, unknown>;
      const keys = Object.keys(obj).sort();
      const parts = keys.map((k) => {
        if (obj[k] === undefined) throw new TypeError(`canonicalJSON: undefined value for key "${k}"`);
        return `${JSON.stringify(k)}:${canonicalJSON(obj[k])}`;
      });
      return `{${parts.join(",")}}`;
    }
    default:
      throw new TypeError(`canonicalJSON: unsupported type ${typeof value}`);
  }
}
