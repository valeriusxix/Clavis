import { KeyRound, UserRound, Wallet, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api, type TraderStats } from "../lib/api";
import { buyKeyOnChain } from "../lib/near";
import { useSession } from "../lib/session";
import { Button, ErrorNote } from "./ui";

export type BuyResult = { kind: "demo"; expiresAt: string } | { kind: "wallet"; txHash: string | null };

export function BuyKeyDialog({ trader, onClose, onBought }: { trader: TraderStats; onClose: () => void; onBought: (r: BuyResult) => void }) {
  const { meta, session, wallet, loginDemo, loginWallet } = useSession();
  const [busy, setBusy] = useState<"demo" | "wallet" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 p-4 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="buykey-title"
        className="w-full max-w-md rounded-lg border border-line-strong bg-ink-900 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="buykey-title" className="flex items-center gap-2 text-lg font-semibold">
              <KeyRound size={18} className="text-brass" aria-hidden /> Buy key
            </h2>
            <p className="mt-1 text-sm text-muted">
              Unlock every trade by <span className="text-fg">{trader.name}</span> for {trader.periodDays} days.
            </p>
          </div>
          <button onClick={onClose} className="text-muted hover:text-fg" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="num mt-4 rounded-md border border-line bg-ink-850 px-3 py-2 text-sm">
          {trader.keyPriceNear} NEAR <span className="text-faint">/ {trader.periodDays} days</span>
        </div>

        <div className="mt-4 space-y-3">
          {meta?.demoMode && (
            <button
              onClick={() => void useDemo()}
              disabled={busy !== null}
              className="flex w-full items-start gap-3 rounded-md border border-brass/50 bg-brass-soft p-3 text-left hover:border-brass disabled:opacity-60"
            >
              <UserRound size={18} className="mt-0.5 text-brass" aria-hidden />
              <span>
                <span className="block font-medium">{busy === "demo" ? "Unlocking…" : "Use demo account"}</span>
                <span className="block text-xs text-muted">No wallet, no funds. The purchase is simulated.</span>
              </span>
            </button>
          )}
          <button
            onClick={() => void useWallet()}
            disabled={busy !== null || !meta?.contractId}
            className="flex w-full items-start gap-3 rounded-md border border-line-strong p-3 text-left hover:border-faint disabled:opacity-60"
          >
            <Wallet size={18} className="mt-0.5 text-muted" aria-hidden />
            <span>
              <span className="block font-medium">{busy === "wallet" ? "Waiting for wallet…" : "Connect wallet"}</span>
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
      </div>
    </div>
  );
}
