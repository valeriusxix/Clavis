import { useEffect, useState } from "react";
import { CutKey } from "../components/Key";
import { LEADER_COLUMNS, TraderRow } from "../components/TraderRow";
import { Card, ErrorNote, Spinner } from "../components/ui";
import { api, type TraderStats } from "../lib/api";
import { shortHash } from "../lib/format";
import { useSession } from "../lib/session";

export function Leaderboard() {
  const { meta } = useSession();
  const [traders, setTraders] = useState<TraderStats[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    api.traders().then((r) => setTraders(r.traders), (e: Error) => setError(e.message));
  }, []);

  // The key shows the first trader until the visitor points at another row, then recuts itself.
  const active = traders?.find((t) => t.id === activeId) ?? traders?.[0] ?? null;

  return (
    <div className="rise">
      <section className="grid items-center gap-x-10 gap-y-6 py-10 lg:min-h-[19rem] lg:grid-cols-[5fr_6fr] lg:py-8">
        <div>
          <h1 className="font-serif text-[2.75rem] leading-[1.04] tracking-[-0.02em] sm:text-6xl sm:tracking-[-0.03em]">
            Trades stay sealed.
            <br />
            PnL stays public.
          </h1>
          <p className="mt-4 max-w-md text-base leading-6 text-muted">
            Traders are ranked by 30-day PnL. Real trades run through NEAR Confidential Intents and stay hidden until you buy a key.
          </p>
        </div>
        <div className="mx-auto w-full max-w-xl lg:mr-0">
          <CutKey hash={active?.headHash} className="-rotate-6" />
          {active && (
            <p className="mt-1 flex flex-wrap justify-end gap-x-3 text-xs text-faint">
              <span>Cut from {active.name}'s latest log hash</span>
              <span className="num">{shortHash(active.headHash)}</span>
            </p>
          )}
        </div>
      </section>

      <section>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 pb-3">
          <h2 className="font-medium">Leaderboard</h2>
          <span className="text-sm text-faint">Ranked by 30-day PnL</span>
        </div>

        {error && <ErrorNote>Could not load traders: {error}</ErrorNote>}
        {!traders && !error && <Spinner />}
        {traders && (
          <Card className="overflow-hidden">
            <div className={`hidden h-10 items-center gap-x-4 border-b border-line px-6 text-xs text-faint lg:grid ${LEADER_COLUMNS}`}>
              <span>#</span>
              <span>Trader</span>
              <span className="text-right">30-day PnL</span>
              <span className="text-right">Total PnL</span>
              <span className="text-right">Win rate</span>
              <span className="text-right">Trades committed</span>
              <span className="text-right">Key price</span>
            </div>
            {traders.map((t, i) => (
              <TraderRow key={t.id} t={t} rank={i + 1} onActive={() => setActiveId(t.id)} />
            ))}
          </Card>
        )}

        <div className="mt-3 max-w-3xl space-y-1 text-xs leading-5 text-faint">
          <p>
            Every trader's log is hash-chained, and its latest hash goes into the Clavis contract on NEAR once the trader is registered there.
            "Trades committed" shows how many trades the on-chain hash covers. Buy a key to see the trades.
          </p>
          {meta?.demoMode && (
            <p>Demo mode: these traders are SIMULATED (seeded history, 45 days to {new Date(meta.seedEnd).toDateString()}).</p>
          )}
        </div>
      </section>
    </div>
  );
}
