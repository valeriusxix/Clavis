import { useEffect, useState } from "react";
import { Link } from "react-router";
import { CutKey } from "../components/Key";
import { Button, Card, ErrorNote, Spinner } from "../components/ui";
import { api } from "../lib/api";
import { date } from "../lib/format";
import { getAccess } from "../lib/near";
import { useSession } from "../lib/session";

type KeyRow = { traderId: string; traderName: string; expiresAt: string; active: boolean; simulated: boolean; headHash: string | null };

export function Keys() {
  const { meta, session, network, loginDemo } = useSession();
  const [keys, setKeys] = useState<KeyRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    setKeys(null);
    (async () => {
      const { traders } = await api.traders();
      if (session.kind === "demo") {
        const heads = new Map(traders.map((t) => [t.id, t.headHash]));
        return (await api.myKeys()).keys.map((k) => ({ ...k, headHash: heads.get(k.traderId) ?? null }));
      }
      // Wallet keys live in the contract: read get_access for each trader, straight from NEAR RPC.
      if (!meta?.contractId) return [];
      const rows = await Promise.all(
        traders.map(async (t) => {
          const expiry = await getAccess(network, meta.contractId!, t.id, session.account).catch(() => null);
          if (!expiry) return null;
          const ms = Number(BigInt(expiry) / 1_000_000n);
          return {
            traderId: t.id,
            traderName: t.name,
            expiresAt: new Date(ms).toISOString(),
            active: ms > Date.now(),
            simulated: false,
            headHash: t.headHash,
          };
        }),
      );
      return rows.filter((r): r is KeyRow => r !== null);
    })().then((k) => setKeys(k ?? []), (e: Error) => setError(e.message));
  }, [session, meta, network]);

  return (
    <div className="rise pt-8">
      <h1 className="font-serif text-4xl leading-tight tracking-[-0.02em] sm:text-5xl">My Keys</h1>
      <p className="mt-2 text-sm text-muted">Traders whose feeds you can see, and until when.</p>

      {!session && (
        <Card className="mt-6 max-w-md p-6">
          <CutKey hash={null} />
          <p className="mt-2 text-sm text-muted">Log in to see your keys: connect a wallet, or use the demo account.</p>
          {meta?.demoMode && (
            <Button className="mt-4" onClick={() => void loginDemo()}>
              Use demo account
            </Button>
          )}
        </Card>
      )}

      {session && (
        <div className="mt-6">
          {error && <ErrorNote>{error}</ErrorNote>}
          {!keys && !error && <Spinner />}
          {keys?.length === 0 && (
            <Card className="max-w-md p-6">
              <CutKey hash={null} />
              <p className="mt-2 text-sm text-muted">
                No keys yet. Open a trader on the{" "}
                <Link className="text-green hover:underline" to="/">
                  Leaderboard
                </Link>{" "}
                and click Buy key.
              </p>
            </Card>
          )}
          {keys && keys.length > 0 && (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {keys.map((k) => (
                <Link key={k.traderId} to={`/trader/${encodeURIComponent(k.traderId)}`} className="group block rounded-2xl">
                  <Card className="h-full p-5 transition-colors group-hover:border-line-strong">
                    <CutKey hash={k.headHash} spent={!k.active} />
                    <div className="mt-3 flex flex-wrap items-baseline gap-x-2">
                      <span className="font-medium">{k.traderName}</span>
                      {/* `simulated` is the purchase, not the trader: a demo key can open a real trader's feed. */}
                      {k.simulated && (
                        <span className="num text-[11px] leading-4 text-muted" title="Demo key: the purchase was simulated. The trader's own SIMULATED label is on their profile.">
                          SIMULATED purchase
                        </span>
                      )}
                    </div>
                    <div className={`num mt-1 text-xs ${k.active ? "text-muted" : "text-down"}`}>
                      {k.active ? "until" : "expired"} {date(k.expiresAt)}
                    </div>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
