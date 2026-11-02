import { useEffect, useState } from "react";
import { TraderCard } from "../components/TraderCard";
import { ErrorNote, Spinner } from "../components/ui";
import { api, type TraderStats } from "../lib/api";
import { useSession } from "../lib/session";

export function Leaderboard() {
  const { meta } = useSession();
  const [traders, setTraders] = useState<TraderStats[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.traders().then((r) => setTraders(r.traders), (e: Error) => setError(e.message));
  }, []);

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Leaderboard</h1>
      <p className="mt-1 max-w-2xl text-sm text-muted">
        Traders ranked by 30-day PnL. Their trades are hidden until you buy a key; real trades run through NEAR Confidential Intents. Every trader's log is
        hash-chained, and its latest hash is committed to the Clavis contract on NEAR ("Trades committed" shows how many trades
        that hash covers). Buy a key to see the trades.
      </p>
      {meta?.demoMode && (
        <p className="mt-3 text-xs text-faint">
          Demo mode: these traders are SIMULATED (seeded history, 45 days to {new Date(meta.seedEnd).toDateString()}).
        </p>
      )}
      <div className="mt-6 space-y-3">
        {error && <ErrorNote>Could not load traders: {error}</ErrorNote>}
        {!traders && !error && <Spinner />}
        {traders?.map((t, i) => <TraderCard key={t.id} t={t} rank={i + 1} />)}
      </div>
    </div>
  );
}
