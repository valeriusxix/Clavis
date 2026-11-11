import { useEffect, useState } from "react";
import { Link } from "react-router";
import { CutKey } from "../components/Key";
import { LEADER_COLUMNS, TraderRow } from "../components/TraderRow";
import { Bone, Card, ErrorNote, Spinner } from "../components/ui";
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
            Every trader's PnL is hash-committed on NEAR and checkable in your browser. Their trades, made through NEAR Confidential Intents,
            stay sealed until you buy a key and follow them.
          </p>
        </div>
        <div className="mx-auto w-full max-w-xl lg:mr-0">
          <CutKey hash={active?.headHash} className="-rotate-6" />
          {active && (
            <p className="mt-1 flex flex-wrap items-center justify-end gap-x-3 text-xs text-faint">
              <span>
                Cut from {active.name}'s latest log hash <span className="num">{shortHash(active.headHash)}</span>
              </span>
              <Link
                to={`/trader/${encodeURIComponent(active.id)}`}
                className="inline-flex min-h-11 items-center gap-1 text-green hover:underline lg:min-h-0"
              >
                This key opens <span className="num">{active.tradeCount}</span> sealed trades for <span className="num">{active.keyPriceNear} NEAR</span> →
              </Link>
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
        {!traders && !error && (
          <Card className="overflow-hidden">
            <span className="sr-only">
              <Spinner />
            </span>
            <div className="hidden h-10 border-b border-line lg:block" />
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className={`grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 border-b border-line px-4 py-3 last:border-0 sm:px-6 lg:min-h-[4.5rem] lg:gap-x-4 lg:py-0 ${LEADER_COLUMNS}`}>
                <Bone className="h-3 w-3" />
                <span className="space-y-2">
                  <Bone className="h-3.5 w-28" />
                  <Bone className="h-2.5 w-40" />
                </span>
                <Bone className="h-3.5 w-14 justify-self-end" />
                <Bone className="hidden h-3 w-20 justify-self-end lg:block" />
                <Bone className="hidden h-3 w-8 justify-self-end lg:block" />
                <Bone className="hidden h-3 w-12 justify-self-end lg:block" />
                <Bone className="col-span-2 col-start-2 h-3 w-16 justify-self-end lg:col-span-1 lg:col-start-auto" />
              </div>
            ))}
          </Card>
        )}
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
