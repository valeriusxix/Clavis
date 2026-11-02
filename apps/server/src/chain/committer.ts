// Commits each trader's hash-chain head to the Clavis contract (AGENT.md 8.2):
// commit_log(trader_id, trade_count, head_hash), signed with COMMITTER_PRIVATE_KEY, at most once per
// trader per 30 s. Traders that are not registered on-chain are skipped (the contract would reject them).
import { Account, JsonRpcProvider, type KeyPairString } from "near-api-js";
import type { Repo } from "../db/db";
import type { ViewFn } from "./nearView";

/** Sends commit_log and returns the transaction hash. */
export type CommitFn = (traderId: string, tradeCount: number, headHash: string) => Promise<string>;
type OnChainCommitment = { trade_count: string; head_hash: string; last_commit_at: string };

export function makeNearCommit(rpcUrl: string, contractId: string, committerId: string, privateKey: string): CommitFn {
  const account = new Account(committerId, new JsonRpcProvider({ url: rpcUrl }), privateKey as KeyPairString);
  return async (traderId, tradeCount, headHash) => {
    const res = await account.callFunctionRaw({
      contractId,
      methodName: "commit_log",
      args: { trader_id: traderId, trade_count: String(tradeCount), head_hash: headHash },
      gas: 30_000_000_000_000n,
    });
    return res.transaction_outcome.id;
  };
}

type Deps = {
  repo: Repo;
  contractId: string;
  view: ViewFn;
  commit: CommitFn;
  now: () => number;
  minIntervalMs?: number;
  log?: (msg: string, extra?: Record<string, unknown>) => void;
};

export class Committer {
  private readonly lastAttempt = new Map<string, number>();
  constructor(private readonly deps: Deps) {}

  async tick(): Promise<void> {
    const { repo, view, contractId, now, log } = this.deps;
    const minInterval = this.deps.minIntervalMs ?? 30_000;
    for (const h of repo.chainHeads()) {
      if (h.trade_count <= h.committed_count) continue;
      if (now() - (this.lastAttempt.get(h.trader_id) ?? -Infinity) < minInterval) continue;

      let onChain: OnChainCommitment | null;
      try {
        onChain = await view<OnChainCommitment | null>(contractId, "get_commitment", { trader_id: h.trader_id });
      } catch (err) {
        log?.("get_commitment failed", { traderId: h.trader_id, err: (err as Error).message });
        continue;
      }
      if (!onChain) continue; // not registered on-chain (e.g. seeded traders before `pnpm seed:chain`)
      const count = Number(onChain.trade_count);
      if (count === h.trade_count && onChain.head_hash === h.head_hash) {
        repo.markCommitted(h.trader_id, count, h.commit_tx ?? ""); // already on-chain (e.g. after a restart)
        continue;
      }
      if (count >= h.trade_count) {
        log?.("on-chain commitment is ahead of or differs from the local log; not committing", { traderId: h.trader_id, count });
        continue;
      }

      this.lastAttempt.set(h.trader_id, now());
      try {
        const tx = await this.deps.commit(h.trader_id, h.trade_count, h.head_hash);
        repo.markCommitted(h.trader_id, h.trade_count, tx);
        log?.("committed head", { traderId: h.trader_id, tradeCount: h.trade_count, tx });
      } catch (err) {
        log?.("commit_log failed", { traderId: h.trader_id, err: (err as Error).message });
      }
    }
  }

  start(intervalMs = 10_000): () => void {
    let running = false;
    const timer = setInterval(async () => {
      if (running) return;
      running = true;
      try {
        await this.tick();
      } finally {
        running = false;
      }
    }, intervalMs);
    timer.unref();
    return () => clearInterval(timer);
  }
}
