import { KeyRound } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { SimulatedBadge } from "../components/Badge";
import { Button, Card, ErrorNote, Spinner } from "../components/ui";
import { api } from "../lib/api";
import { date } from "../lib/format";
import { getAccess } from "../lib/near";
import { useSession } from "../lib/session";

type KeyRow = { traderId: string; traderName: string; expiresAt: string; active: boolean; simulated: boolean };

export function Keys() {
  const { meta, session, network, loginDemo } = useSession();
  const [keys, setKeys] = useState<KeyRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    setKeys(null);
    (async () => {
      if (session.kind === "demo") return (await api.myKeys()).keys;
      // Wallet keys live in the contract: read get_access for each trader, straight from NEAR RPC.
      if (!meta?.contractId) return [];
      const { traders } = await api.traders();
      const rows = await Promise.all(
        traders.map(async (t) => {
          const expiry = await getAccess(network, meta.contractId!, t.id, session.account).catch(() => null);
          if (!expiry) return null;
          const ms = Number(BigInt(expiry) / 1_000_000n);
          return { traderId: t.id, traderName: t.name, expiresAt: new Date(ms).toISOString(), active: ms > Date.now(), simulated: false };
        }),
      );
      return rows.filter((r): r is KeyRow => r !== null);
    })().then((k) => setKeys(k ?? []), (e: Error) => setError(e.message));
  }, [session, meta, network]);

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-semibold tracking-tight">My Keys</h1>
      <p className="mt-1 text-sm text-muted">Traders whose feeds you can see, and until when.</p>

      {!session && (
        <Card className="mt-6 space-y-3 p-5 text-sm">
          <p className="text-muted">Log in to see your keys: connect a wallet, or use the demo account.</p>
          {meta?.demoMode && <Button onClick={() => void loginDemo()}>Use demo account</Button>}
        </Card>
      )}
      {session && (
        <div className="mt-6 space-y-3">
          {error && <ErrorNote>{error}</ErrorNote>}
          {!keys && !error && <Spinner />}
          {keys?.length === 0 && (
            <Card className="p-5 text-sm text-muted">
              No keys yet. Open a trader on the <Link className="text-brass hover:underline" to="/">Leaderboard</Link> and click Buy key.
            </Card>
          )}
          {keys?.map((k) => (
            <Link key={k.traderId} to={`/trader/${encodeURIComponent(k.traderId)}`} className="block">
              <Card className="flex items-center justify-between gap-3 p-4 hover:border-line-strong">
                <span className="flex min-w-0 items-center gap-2">
                  <KeyRound size={16} className={k.active ? "text-brass" : "text-faint"} aria-hidden />
                  <span className="truncate font-medium">{k.traderName}</span>
                  {k.simulated && <SimulatedBadge />}
                </span>
                <span className={`num text-xs ${k.active ? "text-muted" : "text-down"}`}>
                  {k.active ? "until" : "expired"} {date(k.expiresAt)}
                </span>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
