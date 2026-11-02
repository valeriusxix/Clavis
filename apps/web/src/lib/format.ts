const usdFmt = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

export const usd = (n: number | string) => usdFmt.format(Number(n));
export const signedUsd = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${usdFmt.format(Math.abs(n))}`;
export const pct = (n: number, dp = 1) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n * 100).toFixed(dp)}%`;
export const shortHash = (h: string | null | undefined, n = 8) => (h ? `${h.slice(0, n)}…${h.slice(-4)}` : "—");
export const tone = (n: number) => (n > 0 ? "text-up" : n < 0 ? "text-down" : "text-muted");

/** Display a token amount: fewer decimals for bigger numbers, no trailing zeros. */
export function qty(s: string): string {
  const n = Number(s);
  if (!Number.isFinite(n)) return s;
  const abs = Math.abs(n);
  const dp = abs >= 1000 ? 2 : abs >= 1 ? 4 : 6;
  if (n !== 0 && abs < 1e-6) return n.toExponential(2);
  return n.toLocaleString("en-US", { maximumFractionDigits: dp });
}

export const dateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
export const date = (iso: string | number) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
