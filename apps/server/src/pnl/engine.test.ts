import { describe, expect, it } from "vitest";
import {
  computePnl,
  computeWindowPnl,
  equityCurve,
  positionsBefore,
  priceHistoryFromTrades,
  type PnlTrade,
  type PriceAt,
} from "./engine";

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 9, 1); // 2026-10-01
const STABLES = new Set(["USDC", "USDT"]);
const isStable = (a: string) => STABLES.has(a);
const fixed =
  (prices: Record<string, number>): PriceAt =>
  (a) =>
    prices[a];

/** Shorthand: at day d, sell qIn of `sell` worth vIn for qOut of `buy` worth vOut. */
const tr = (d: number, sell: string, qIn: number, vIn: number, buy: string, qOut: number, vOut: number): PnlTrade => ({
  t: T0 + d * DAY,
  sell,
  qIn,
  vIn,
  buy,
  qOut,
  vOut,
});

describe("computePnl (AGENT.md section 9)", () => {
  it("empty trader: zero PnL, $1 capital floor, no win rate", () => {
    const r = computePnl([], { isStable, priceAt: fixed({}) });
    expect(r).toMatchObject({ tradeCount: 0, realizedUsd: 0, unrealizedUsd: 0, totalPnlUsd: 0, capitalUsd: 1, pnlPct: 0, winRate: null });
  });

  it("single round-trip win: buy NEAR with USDC, sell it higher", () => {
    const trades = [
      tr(0, "USDC", 100, 100, "NEAR", 25, 100), // buy 25 NEAR @ $4
      tr(5, "NEAR", 25, 125, "USDC", 125, 125), // sell @ $5
    ];
    const r = computePnl(trades, { isStable, priceAt: fixed({ NEAR: 5 }) });
    // Trade 1 disposes USDC (funding: cost = vIn) -> realized 0. Trade 2 realizes 125 - 100.
    expect(r.realizedUsd).toBeCloseTo(25);
    expect(r.unrealizedUsd).toBeCloseTo(0); // only USDC left, stablecoin
    expect(r.capitalUsd).toBeCloseTo(125); // peak cost basis (after selling: 125 USDC)
    expect(r.pnlPct).toBeCloseTo(25 / 125);
    expect(r.closes).toBe(1);
    expect(r.wins).toBe(1);
    expect(r.winRate).toBe(1);
  });

  it("single loss", () => {
    const trades = [tr(0, "USDC", 100, 100, "NEAR", 25, 100), tr(3, "NEAR", 25, 80, "USDC", 80, 80)];
    const r = computePnl(trades, { isStable, priceAt: fixed({ NEAR: 3.2 }) });
    expect(r.realizedUsd).toBeCloseTo(-20);
    expect(r.totalPnlUsd).toBeCloseTo(-20);
    expect(r.capitalUsd).toBeCloseTo(100);
    expect(r.pnlPct).toBeCloseTo(-0.2);
    expect(r.winRate).toBe(0);
  });

  it("partial sells use average cost and leave the rest unrealized", () => {
    const trades = [
      tr(0, "USDC", 40, 40, "NEAR", 10, 40), // 10 NEAR @ $4
      tr(1, "USDC", 60, 60, "NEAR", 10, 60), // 10 NEAR @ $6 -> avg $5
      tr(2, "NEAR", 5, 35, "USDC", 35, 35), // sell 5 @ $7: cost 25, realized +10
    ];
    const r = computePnl(trades, { isStable, priceAt: fixed({ NEAR: 8 }) });
    expect(r.realizedUsd).toBeCloseTo(10);
    expect(r.positions.NEAR).toEqual({ qty: 15, costBasis: 75 });
    expect(r.unrealizedUsd).toBeCloseTo(15 * 8 - 75); // 45
    expect(r.totalPnlUsd).toBeCloseTo(55);
    expect(r.capitalUsd).toBeCloseTo(110); // peak Σ cost basis: 75 NEAR + 35 USDC received
    expect(r.pnlPct).toBeCloseTo(0.5);
    expect(r.winRate).toBe(1);
  });

  it("multi-asset: rotation NEAR -> ZEC -> USDC carries cost basis through", () => {
    const trades = [
      tr(0, "USDC", 100, 100, "NEAR", 25, 100), // NEAR basis 100
      tr(2, "NEAR", 25, 120, "ZEC", 2, 120), // close NEAR +20, ZEC basis 120
      tr(4, "ZEC", 1, 50, "USDC", 50, 50), // sell half ZEC: cost 60, -10
      tr(6, "USDC", 50, 50, "BTC", 0.001, 50), // buy BTC with stables (not a close)
    ];
    const r = computePnl(trades, { isStable, priceAt: fixed({ ZEC: 70, BTC: 60_000 }) });
    expect(r.realizedUsd).toBeCloseTo(20 - 10);
    expect(r.positions.ZEC).toEqual({ qty: 1, costBasis: 60 });
    expect(r.positions.BTC).toEqual({ qty: 0.001, costBasis: 50 });
    expect(r.unrealizedUsd).toBeCloseTo(70 - 60 + (60 - 50));
    expect(r.closes).toBe(2);
    expect(r.wins).toBe(1);
    expect(r.winRate).toBe(0.5);
  });

  it("stablecoin-only path loses roughly the fees", () => {
    const trades = [
      tr(0, "USDC", 100, 100, "USDT", 99.8, 99.8),
      tr(1, "USDT", 99.8, 99.8, "USDC", 99.6, 99.6),
    ];
    const r = computePnl(trades, { isStable, priceAt: fixed({}) });
    expect(r.realizedUsd).toBeCloseTo(-0.4);
    expect(r.unrealizedUsd).toBe(0);
    expect(r.totalPnlUsd).toBeCloseTo(-0.4);
    expect(r.closes).toBe(0); // stable disposals are not "sells" for win rate
    expect(r.winRate).toBeNull();
  });

  it("first sale of an asset never seen before is funding (cost = vIn)", () => {
    const r = computePnl([tr(0, "NEAR", 10, 50, "USDC", 49.9, 49.9)], { isStable, priceAt: fixed({}) });
    expect(r.realizedUsd).toBeCloseTo(-0.1);
    expect(r.closes).toBe(0);
  });

  it("over-selling: held part at average cost, excess at the trade's unit price", () => {
    const trades = [
      tr(0, "USDC", 40, 40, "NEAR", 10, 40), // 10 NEAR, basis 40
      tr(1, "NEAR", 15, 75, "USDC", 75, 75), // sell 15 @ $5: cost 40 + 5*5 = 65, realized 10
    ];
    const r = computePnl(trades, { isStable, priceAt: fixed({}) });
    expect(r.realizedUsd).toBeCloseTo(10);
    expect(r.positions.NEAR).toBeUndefined();
  });
});

describe("window PnL (pnl30d)", () => {
  it("only counts what happened in the window, from the day -30 mark", () => {
    const trades = [
      tr(0, "USDC", 100, 100, "NEAR", 25, 100), // bought @ $4, 40 days before "now"
      tr(35, "NEAR", 25, 150, "USDC", 150, 150), // sold @ $6, inside the window
    ];
    const now = T0 + 40 * DAY;
    const prices: PriceAt = (a, t) => (a === "NEAR" ? (t < T0 + 10 * DAY ? 4 : 5) : undefined); // $5 at day 10
    const full = computePnl(trades, { isStable, priceAt: prices });
    expect(full.realizedUsd).toBeCloseTo(50);
    const w = computeWindowPnl(trades, { isStable, priceAt: prices, now, days: 30 });
    // Window starts at day 10 holding 25 NEAR marked @ $5 = 125 basis -> sold for 150: +25
    expect(w.realizedUsd).toBeCloseTo(25);
    expect(w.totalPnlUsd).toBeCloseTo(25);
    expect(w.capitalUsd).toBeCloseTo(150);
  });

  it("positionsBefore excludes trades at or after the cutoff", () => {
    const trades = [tr(0, "USDC", 10, 10, "NEAR", 2, 10), tr(5, "USDC", 10, 10, "NEAR", 2, 10)];
    expect(positionsBefore(trades, T0 + 5 * DAY, isStable).get("NEAR")).toEqual({ qty: 2, costBasis: 10 });
  });
});

describe("equity curve", () => {
  it("one point per day, realized + unrealized at historical prices", () => {
    const trades = [tr(0, "USDC", 100, 100, "NEAR", 25, 100), tr(2, "NEAR", 25, 125, "USDC", 125, 125)];
    const priceAt: PriceAt = (a, t) => (a === "NEAR" ? (t < T0 + DAY ? 4 : 4.4) : undefined);
    const curve = equityCurve(trades, { isStable, priceAt, now: T0 + 3 * DAY + 1 });
    expect(curve).toHaveLength(4);
    expect(curve[0]!.equityUsd).toBeCloseTo(0); // day 0: 25 NEAR @ 4 = basis
    expect(curve[1]!.equityUsd).toBeCloseTo(10); // day 1: 25 @ 4.4 - 100
    expect(curve[2]!.equityUsd).toBeCloseTo(25); // day 2: sold, realized 25
    expect(curve[3]!.equityUsd).toBeCloseTo(25);
  });

  it("is empty for an empty trader", () => {
    expect(equityCurve([], { isStable, priceAt: fixed({}), now: T0 })).toEqual([]);
  });
});

describe("priceHistoryFromTrades", () => {
  const trades = [tr(0, "USDC", 100, 100, "NEAR", 25, 100), tr(4, "NEAR", 10, 50, "USDC", 50, 50)];

  it("uses the latest implied price at or before t", () => {
    const p = priceHistoryFromTrades(trades);
    expect(p("NEAR", T0 + 2 * DAY)).toBeCloseTo(4);
    expect(p("NEAR", T0 + 4 * DAY)).toBeCloseTo(5);
    expect(p("NEAR", T0 - DAY)).toBeCloseTo(4); // before the first record: earliest known
    expect(p("BTC", T0)).toBeUndefined();
  });

  it("live prices override from their timestamp on", () => {
    const p = priceHistoryFromTrades(trades, { prices: { NEAR: 4.25, BTC: 60_000 }, at: T0 + 10 * DAY });
    expect(p("NEAR", T0 + 11 * DAY)).toBe(4.25);
    expect(p("NEAR", T0 + 4 * DAY)).toBeCloseTo(5);
    expect(p("BTC", T0)).toBe(60_000);
  });
});
