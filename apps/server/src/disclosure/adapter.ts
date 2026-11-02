// Who may see a trader's trades, and where the trade data comes from (AGENT.md 6.5).
//
// Today the only implementation is ClavisRelayAdapter: the Clavis server relays and stores every
// trade, and decides access from the contract (has_access) or a demo key. When NEAR ships native
// Confidential Intents view keys, a NativeViewKeyAdapter can read trades with the trader's view key
// instead, which removes the Clavis operator from the trust path. Routes only talk to this interface.
import type { LogEntry } from "@clavis/shared";
import type { Session } from "../auth/session";
import { logOf } from "../chain/log";
import type { ViewFn } from "../chain/nearView";
import type { Repo, TradeRow } from "../db/db";

export interface DisclosureAdapter {
  readonly name: string;
  /** May this viewer see the trader's full feed? */
  canSee(viewer: Session | null, traderId: string): Promise<boolean>;
  /** Trades for the feed (newest first), excluding unfilled quotes. */
  trades(traderId: string): TradeRow[];
  /** Canonical log entries for hash-chain verification, in seq order. */
  log(traderId: string): LogEntry[];
}

export class ClavisRelayAdapter implements DisclosureAdapter {
  readonly name = "clavis-relay";

  constructor(
    private readonly deps: {
      repo: Repo;
      now: () => number;
      /** Demo keys (demo_access rows) count only in demo mode (AUDIT L2). */
      demoMode: boolean;
      contractId?: string;
      view?: ViewFn;
      onViewError?: (err: unknown) => void;
    },
  ) {}

  async canSee(viewer: Session | null, traderId: string): Promise<boolean> {
    if (!viewer) return false;
    if (viewer.sub === traderId) return true; // traders always see their own feed
    if (this.deps.demoMode) {
      const demoExpiry = this.deps.repo.getDemoAccessExpiry(traderId, viewer.sub);
      if (demoExpiry && Date.parse(demoExpiry) > this.deps.now()) return true;
    }
    if (viewer.kind === "wallet" && this.deps.view && this.deps.contractId) {
      try {
        return await this.deps.view<boolean>(this.deps.contractId, "has_access", { trader_id: traderId, account_id: viewer.sub });
      } catch (err) {
        this.deps.onViewError?.(err);
        return false;
      }
    }
    return false;
  }

  trades(traderId: string): TradeRow[] {
    return this.deps.repo.db
      // Not shown: unfilled quotes, and quotes Clavis refused before anything was sent (FAILED without
      // any 1Click status; kept as a record, AUDIT L4).
      .prepare(
        `SELECT * FROM trades WHERE trader_id = ? AND status != 'QUOTED' AND NOT (status = 'FAILED' AND status_json IS NULL)
           ORDER BY COALESCE(settled_at, created_at) DESC`,
      )
      .all(traderId) as TradeRow[];
  }

  log(traderId: string): LogEntry[] {
    return logOf(this.deps.repo, traderId);
  }
}
