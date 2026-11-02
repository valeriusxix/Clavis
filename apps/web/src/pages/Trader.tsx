import { ArrowLeft, Info, KeyRound, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { SimulatedBadge } from "../components/Badge";
import { BuyKeyDialog, type BuyResult } from "../components/BuyKeyDialog";
import { EquityChart } from "../components/EquityChart";
import { LockedFeed } from "../components/LockedFeed";
import { TradeRow } from "../components/TradeRow";
import { VerifyPanel } from "../components/VerifyPanel";
import { Button, Card, ErrorNote, Spinner, Stat } from "../components/ui";
import { api, type FeedTrade, type TraderStats } from "../lib/api";
import { date, pct, shortHash, signedUsd, tone, usd } from "../lib/format";
import { useSession } from "../lib/session";

type Profile = Awaited<ReturnType<typeof api.trader>>;

export function Trader() {
  const { id = "" } = useParams();
  const { network } = useSession();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [feed, setFeed] = useState<FeedTrade[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [buying, setBuying] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  const load = useCallback(async () => {
    try {
      const p = await api.trader(id);
      setProfile(p);
      setFeed(p.unlocked ? (await api.feed(id)).trades : null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const onBought = async (r: BuyResult) => {
    setBuying(false);
    setBanner(
      r.kind === "demo"
        ? "Demo account — key purchase simulated"
        : `Key bought on-chain${r.txHash ? ` (tx ${shortHash(r.txHash, 8)})` : ""}. Access is checked against the contract.`,
    );
    await load();
  };

  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!profile) return <Spinner />;
  const t: TraderStats = profile.trader;

  return (
    <div className="space-y-6">
      <Link to="/" className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ArrowLeft size={14} aria-hidden /> Leaderboard
      </Link>

      {banner && (
        <div role="status" className="flex items-center gap-2 rounded-md border border-brass/50 bg-brass-soft px-4 py-3 text-sm">
          <Info size={16} className="shrink-0 text-brass" aria-hidden />
          {banner}
        </div>
      )}

      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{t.name}</h1>
            {t.simulated && <SimulatedBadge />}
          </div>
          <p className="mt-1 text-sm text-muted">{t.style}</p>
          <p className="num mt-1 truncate text-xs text-faint" title={t.id}>
            {t.id}
          </p>
        </div>
        <div className="text-right">
          <div className="text-xs text-muted">30-day PnL</div>
          <div className={`num text-3xl ${tone(t.pnl30dPct)}`}>{pct(t.pnl30dPct)}</div>
        </div>
      </header>

      <Card className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-5">
        <Stat label="Total PnL" value={signedUsd(t.pnlTotalUsd)} className={tone(t.pnlTotalUsd)} />
        <Stat label="PnL % (all time)" value={pct(t.pnlPct)} className={tone(t.pnlPct)} />
        <Stat label="Win rate" value={t.winRate === null ? "—" : `${Math.round(t.winRate * 100)}%`} />
        <Stat label="Peak capital" value={usd(t.capitalUsd)} />
        <Stat label="Trades committed" value={`${t.committedCount} / ${t.tradeCount}`} />
      </Card>

      <Card className="p-4">
        <div className="mb-2 flex items-center justify-between text-sm">
          <h2 className="font-medium">Equity curve</h2>
          <span className="text-xs text-muted">daily PnL, USD</span>
        </div>
        <EquityChart points={profile.equityCurve} />
      </Card>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-medium">Trades</h2>
          <div className="flex items-center gap-2">
            {profile.unlocked && (
              <Button size="sm" onClick={() => setVerifying((v) => !v)}>
                <ShieldCheck size={14} aria-hidden /> Verify log
              </Button>
            )}
            {!profile.unlocked && (
              <span className="num text-xs text-muted">
                head {shortHash(t.headHash)} · since {date(t.createdAt)}
              </span>
            )}
          </div>
        </div>

        {verifying && profile.unlocked && <VerifyPanel traderId={t.id} network={network} />}

        {profile.unlocked && feed ? (
          feed.length === 0 ? (
            <Card className="p-6 text-sm text-muted">No trades yet. Dry quotes you simulate on the Trade page appear here.</Card>
          ) : (
            <Card>
              <ul>
                {feed.map((tr) => (
                  <TradeRow key={tr.id} t={tr} />
                ))}
              </ul>
            </Card>
          )
        ) : (
          <LockedFeed
            count={profile.lockedCount}
            action={
              <Button variant="primary" onClick={() => setBuying(true)}>
                <KeyRound size={15} aria-hidden /> Buy key
              </Button>
            }
          />
        )}
      </section>

      {buying && <BuyKeyDialog trader={t} onClose={() => setBuying(false)} onBought={(r) => void onBought(r)} />}
    </div>
  );
}
