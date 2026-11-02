import type { LogEntry } from "@clavis/shared";

/** API base. Empty = same origin (Vite dev proxy forwards /api to the server). */
export const API_URL = (import.meta.env.VITE_API_URL ?? "").replace(/\/+$/, "");

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly body: unknown,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: init?.method ?? "GET",
    credentials: "include",
    headers: init?.body === undefined ? undefined : { "content-type": "application/json" },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = (json as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(res.status, err?.code ?? "HTTP_ERROR", err?.message ?? `HTTP ${res.status}`, json);
  }
  return json as T;
}

export type Meta = {
  demoMode: boolean;
  network: "testnet" | "mainnet";
  contractId: string | null;
  hasOneClickKey: boolean;
  confidentialQuotes: boolean;
  seedEnd: string;
  serverTime: string;
};

export type TraderStats = {
  id: string;
  name: string;
  simulated: boolean;
  style: string | null;
  createdAt: string;
  pnl30dPct: number;
  pnl30dUsd: number;
  pnlPct: number;
  pnlTotalUsd: number;
  realizedUsd: number;
  unrealizedUsd: number;
  capitalUsd: number;
  winRate: number | null;
  tradeCount: number;
  committedCount: number;
  headHash: string | null;
  commitTx: string | null;
  keyPrice: string;
  keyPriceNear: string;
  periodDays: number;
  lastTradeAt: string | null;
};

export type FeedTrade = {
  id: string;
  seq: number | null;
  time: string;
  pair: string;
  side: "BUY" | "SELL" | "SWAP";
  originSymbol: string;
  destSymbol: string;
  amountIn: string;
  amountOut: string;
  amountInUsd: string;
  amountOutUsd: string;
  status: string;
  simulated: boolean;
  confidentiality: string;
  oneClickSigned: boolean;
  txHash: string | null;
};

export type TraderLog = {
  traderId: string;
  entries: LogEntry[];
  signatureValid: Record<string, boolean | null>;
  head: { tradeCount: number; headHash: string } | null;
  committed: { count: number; tx: string | null } | null;
  contractId: string | null;
  network: "testnet" | "mainnet";
};

export type Token = { assetId: string; symbol: string; blockchain: string; decimals: number; price: number; priceUpdatedAt: string | null };

export type QuoteResult = {
  tradeId: string;
  dry: boolean;
  confidentiality: string;
  confidential: boolean;
  notice: string | null;
  quote: {
    amountIn: string;
    amountInFormatted: string;
    amountInUsd: string;
    amountOut: string;
    amountOutFormatted: string;
    amountOutUsd: string;
    minAmountOut: string;
    timeEstimate: number;
    deadline: string | null;
    depositAddress: string | null;
    depositMemo: string | null;
  };
  origin: { assetId: string; symbol: string };
  destination: { assetId: string; symbol: string };
  signature: { valid: boolean; publicKey: string; signature: string | null };
  correlationId: string;
  timestamp: string;
};

export type SessionInfo = { account: string; kind: "demo" | "wallet" } | null;
export type MyKey = { traderId: string; traderName: string; expiresAt: string; active: boolean; simulated: boolean };

export const api = {
  meta: () => request<Meta>("/api/meta"),
  traders: () => request<{ traders: TraderStats[] }>("/api/traders"),
  trader: (id: string) =>
    request<{ trader: TraderStats; equityCurve: { t: number; equityUsd: number }[]; lockedCount: number; unlocked: boolean }>(
      `/api/traders/${encodeURIComponent(id)}`,
    ),
  feed: (id: string) => request<{ traderId: string; trades: FeedTrade[] }>(`/api/traders/${encodeURIComponent(id)}/feed`),
  log: (id: string) => request<TraderLog>(`/api/traders/${encodeURIComponent(id)}/log`),
  reverify: (id: string) =>
    request<{ results: Record<string, boolean | null> }>(`/api/traders/${encodeURIComponent(id)}/reverify`, { method: "POST" }),
  tokens: () => request<{ tokens: Token[]; source: "live" | "seed"; updatedAt: string | null }>("/api/tokens"),
  me: () => request<{ session: SessionInfo }>("/api/me"),
  myKeys: () => request<{ account: string; keys: MyKey[] }>("/api/me/keys"),
  demoLogin: () => request<{ account: string; kind: "demo"; banner: string }>("/api/demo/login", { method: "POST" }),
  demoBuyKey: (traderId: string) =>
    request<{ traderId: string; expiresAt: string; simulated: true }>("/api/demo/buy-key", { method: "POST", body: { traderId } }),
  logout: () => request<{ ok: true }>("/api/auth/logout", { method: "POST" }),
  challenge: () => request<{ nonce: string; message: string; recipient: string; expiresAt: string }>("/api/auth/challenge"),
  nep413Login: (body: { accountId: string; publicKey: string; signature: string; nonce: string }) =>
    request<{ account: string; kind: "wallet" }>("/api/auth/nep413", { method: "POST", body }),
  quote: (body: { originAsset: string; destinationAsset: string; amountHuman: string; dry: boolean; recipient?: string; refundTo?: string }) =>
    request<QuoteResult>("/api/trades/quote", { method: "POST", body }),
  simulate: (tradeId: string) =>
    request<{ trade: FeedTrade; head: { tradeCount: number; headHash: string } }>(`/api/trades/${tradeId}/simulate`, { method: "POST" }),
};
