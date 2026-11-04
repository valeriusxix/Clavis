import { UserRound, Wallet, X } from "lucide-react";
import { useState } from "react";
import { api, type TraderStats } from "../lib/api";
import { buyKeyOnChain } from "../lib/near";
import { useSession } from "../lib/session";
import { CutKey } from "./Key";
import { Button, Dialog, ErrorNote } from "./ui";

export type BuyResult = { kind: "demo"; expiresAt: string } | { kind: "wallet"; txHash: string | null };

export function BuyKeyDialog({ trader, onClose, onBought }: { trader: TraderStats; onClose: () => void; onBought: (r: BuyResult) => void }) {
  const { meta, session, wallet, loginDemo, loginWallet } = useSession();
  const [busy, setBusy] = useState<"demo" | "wallet" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const useDemo = async () => {
    setBusy("demo");
    setError(null);
    try {
      if (session?.kind !== "demo") await loginDemo();
      const r = await api.demoBuyKey(trader.id);
      onBought({ kind: "demo", expiresAt: r.expiresAt });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const useWallet = async () => {
    if (!meta?.contractId) return;
    setBusy("wallet");
    setError(null);
    try {
      const w = session?.kind === "wallet" && wallet ? wallet : await loginWallet();
      const outcome = await buyKeyOnChain(w, meta.contractId, trader.id, trader.keyPrice);
      const txHash = (outcome as { transaction?: { hash?: string } } | undefined)?.transaction?.hash ?? null;
      onBought({ kind: "wallet", txHash });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog labelledBy="buykey-title" onClose={onClose}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 id="buykey-title" className="font-serif text-2xl leading-tight">
            Buy key
          </h2>
          <p className="mt-1 text-sm text-muted">
            Unlock every trade by <span className="text-fg">{trader.name}</span> for {trader.periodDays} days.
          </p>
        </div>
        <button onClick={onClose} className="text-muted transition-colors hover:text-fg" aria-label="Close">
          <X size={18} strokeWidth={1.5} />
        </button>
      </div>

      <div className="mt-5 flex items-center gap-4 rounded-xl border border-line bg-ink-850 p-3">
        <CutKey hash={trader.headHash} className="min-w-0 flex-1" />
        <div className="num shrink-0 text-right">
          <div className="text-base">{trader.keyPriceNear} NEAR</div>
          <div className="text-xs text-faint">/ {trader.periodDays} days</div>
        </div>
      </div>

      <div className="mt-4 space-y-2">
        {meta?.demoMode && (
          <button
            onClick={() => void useDemo()}
            disabled={busy !== null}
            className="flex w-full items-start gap-3 rounded-xl border border-green/40 bg-green-soft p-3 text-left transition-colors hover:border-green disabled:opacity-60"
          >
            <UserRound size={18} strokeWidth={1.5} className="mt-0.5 shrink-0 text-green" aria-hidden />
            <span>
              <span className="block text-sm font-medium">{busy === "demo" ? "Unlocking…" : "Use demo account"}</span>
              <span className="block text-xs text-muted">No wallet, no funds. The purchase is simulated.</span>
            </span>
          </button>
        )}
        <button
          onClick={() => void useWallet()}
          disabled={busy !== null || !meta?.contractId}
          className="flex w-full items-start gap-3 rounded-xl border border-line-strong p-3 text-left transition-colors hover:border-faint disabled:opacity-60"
        >
          <Wallet size={18} strokeWidth={1.5} className="mt-0.5 shrink-0 text-muted" aria-hidden />
          <span>
            <span className="block text-sm font-medium">{busy === "wallet" ? "Waiting for wallet…" : "Connect wallet"}</span>
            <span className="block text-xs text-muted">
              {meta?.contractId
                ? `Pays ${trader.keyPriceNear} NEAR on ${meta.network} via buy_key on ${meta.contractId}. Unused storage deposit is refunded.`
                : "No contract configured on this server."}
            </span>
          </span>
        </button>
      </div>

      {error && (
        <div className="mt-3">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}
      <div className="mt-4 text-right">
        <Button size="sm" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </Dialog>
  );
}
