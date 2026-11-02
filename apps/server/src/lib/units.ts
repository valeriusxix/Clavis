/** "1.5" with 24 decimals -> "1500000000000000000000000". String/BigInt math only, never floats. */
export function toBaseUnits(human: string, decimals: number): string {
  if (!/^\d+(\.\d+)?$/.test(human)) throw new Error(`Invalid amount: ${human}`);
  const [whole = "0", frac = ""] = human.split(".");
  const trimmed = frac.replace(/0+$/, "");
  if (trimmed.length > decimals) throw new Error(`Too many decimals for a ${decimals}-decimal token: ${human}`);
  return (BigInt(whole) * 10n ** BigInt(decimals) + BigInt(trimmed.padEnd(decimals, "0") || "0")).toString();
}

/** "1500000000000000000000000" with 24 decimals -> "1.5". */
export function fromBaseUnits(base: string, decimals: number): string {
  if (!/^\d+$/.test(base)) throw new Error(`Invalid base amount: ${base}`);
  const s = base.padStart(decimals + 1, "0");
  const whole = s.slice(0, s.length - decimals).replace(/^0+(?=\d)/, "");
  const frac = s.slice(s.length - decimals).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}

/** Trim trailing zeros of a fixed-precision decimal string: "1.50000000" -> "1.5". */
export const trimDecimal = (s: string) => (s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s);
