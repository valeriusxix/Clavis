/** One entry of a trader's append-only trade log (AGENT.md 11.1). Amounts are base-unit strings. */
export type LogEntry = {
  seq: number;
  traderId: string;
  settledAt: string; // ISO
  originAsset: string;
  destAsset: string;
  amountIn: string; // base units
  amountOut: string; // base units
  amountInUsd: string;
  amountOutUsd: string;
  confidentiality: "basic" | "advanced" | "simulated";
  quoteSignature: string | null;
  correlationId: string | null;
};
