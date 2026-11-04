import { ArrowLeft, KeyRound, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { SimulatedBadge } from "../components/Badge";
import { BuyKeyDialog, type BuyResult } from "../components/BuyKeyDialog";
import { EquityChart } from "../components/EquityChart";
import { CutKey, MiniKey } from "../components/Key";
import { LockedFeed } from "../components/LockedFeed";
import { TradeHeader, TradeRow } from "../components/TradeRow";
import { VerifyPanel } from "../components/VerifyPanel";
import { Button, Card, ErrorNote, Notice, Spinner } from "../components/ui";
import { api, type FeedTrade, type TraderStats } from "../lib/api";
import { date, pct, shortHash, signedUsd, tone, usd } from "../lib/format";
import { useSession } from "../lib/session";

type Profile = Awaited<ReturnType<typeof api.trader>>;

export function Trader() {
  const { id = "" } = useParams();
  const { network, session } = useSession();
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

  if (error) {
    return (
      <div className="pt-8">
        <ErrorNote>{error}</ErrorNote>
      </div>
    );
  }
  if (!profile) {
    return (
      <div className="pt-8">
        <Spinner />
      </div>
    );
  }
  const t: TraderStats = profile.trader;

  return (
    <div className="rise space-y-6 pt-6">
      <Link to="/" className="inline-flex items-center gap-1 text-sm text-muted transition-colors hover:text-fg">
        <ArrowLeft size={16} strokeWidth={1.5} aria-hidden /> Leaderboard
      </Link>

      {banner && <Notice>{banner}</Notice>}

      <div className="grid items-start gap-x-8 gap-y-12 lg:grid-cols-[minmax(0,1fr)_22.5rem]">
        <div className="min-w-0 space-y-6">
          <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h1 className="min-w-0 font-serif text-4xl leading-tight tracking-[-0.02em] break-all sm:text-5xl">{t.name}</h1>
                {t.simulated && <SimulatedBadge />}
              </div>
              {t.style && <p className="mt-1 text-sm text-muted">{t.style}</p>}
              <p className="num mt-1 truncate text-xs text-faint" title={t.id}>
                {t.id}
              </p>
            </div>
            <div className="sm:text-right">
              <div className="text-xs text-faint">30-day PnL</div>
              <div className={`num mt-1 text-5xl leading-none ${tone(t.pnl30dPct)}`}>{pct(t.pnl30dPct)}</div>
            </div>
          </header>

          <Card className="p-5">
            <div className="mb-3 flex items-baseline justify-between gap-4">
              <h2 className="font-medium">Equity curve</h2>
              <span className="text-xs text-faint">daily PnL, USD</span>
            </div>
            <EquityChart points={profile.equityCurve} />
          </Card>
        </div>

        <div className="min-w-0 space-y-4">
          <KeyPanel t={t} unlocked={profile.unlocked} own={session?.account === t.id} onBuy={() => setBuying(true)} />
          <Card className="px-6 py-1">
            <dl>
              <StatRow label="Total PnL" value={signedUsd(t.pnlTotalUsd)} className={tone(t.pnlTotalUsd)} />
              <StatRow label="PnL % (all time)" value={pct(t.pnlPct)} className={tone(t.pnlPct)} />
              <StatRow label="Win rate" value={t.winRate === null ? "—" : `${Math.round(t.winRate * 100)}%`} />
              <StatRow label="Peak capital" value={usd(t.capitalUsd)} />
              <StatRow label="Trades committed" value={`${t.committedCount} / ${t.tradeCount}`} />
            </dl>
          </Card>
        </div>
      </div>

      <section className="space-y-3 pt-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-medium">Trades</h2>
          {profile.unlocked && (
            <Button size="sm" onClick={() => setVerifying((v) => !v)}>
              <ShieldCheck size={16} strokeWidth={1.5} aria-hidden /> Verify log
            </Button>
          )}
        </div>

        {verifying && profile.unlocked && <VerifyPanel traderId={t.id} network={network} />}

        {profile.unlocked && feed ? (
          feed.length === 0 ? (
            <Card className="p-6 text-sm text-muted">No trades yet. Dry quotes you simulate on the Trade page appear here.</Card>
          ) : (
            <Card className="overflow-hidden">
              <TradeHeader />
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
              <Button onClick={() => setBuying(true)}>
                <KeyRound size={16} strokeWidth={1.5} aria-hidden /> Buy key
              </Button>
            }
          />
        )}
      </section>

      {buying && <BuyKeyDialog trader={t} onClose={() => setBuying(false)} onBought={(r) => void onBought(r)} />}
    </div>
  );
}

function StatRow({ label, value, className = "" }: { label: string; value: string; className?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line py-2.5 last:border-0">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className={`num truncate text-sm ${className}`}>{value}</dd>
    </div>
  );
}

/** The key to this trader's feed: the one thing on the page that carries the brand colour as a fill. */
function KeyPanel({ t, unlocked, own, onBuy }: { t: TraderStats; unlocked: boolean; own: boolean; onBuy: () => void }) {
  return (
    <Card className="p-6">
      <div className="-mx-1 -mt-14">
        <CutKey hash={t.headHash} className="-rotate-3" />
      </div>

      {unlocked ? (
        <div className="mt-4">
          <p className="font-medium">{own ? "Your trader profile" : "You hold this key"}</p>
          <p className="mt-1 text-sm text-muted">
            {own ? "Your simulated trades are listed below." : "Every trade below is unlocked."}{" "}
            {!own && (
              <Link to="/keys" className="text-green hover:underline">
                My Keys
              </Link>
            )}
          </p>
        </div>
      ) : (
        <div className="mt-4">
          <div className="num text-3xl leading-none">
            {t.keyPriceNear} NEAR <span className="text-sm text-faint">/ {t.periodDays} days</span>
          </div>
          <Button variant="primary" size="lg" className="mt-4 w-full" onClick={onBuy}>
            <KeyRound size={16} strokeWidth={1.5} aria-hidden /> Buy key
          </Button>
        </div>
      )}

      <dl className="mt-5 space-y-2 border-t border-line pt-4 text-sm">
        <div className="flex items-center justify-between gap-4">
          <dt className="text-faint">Head</dt>
          <dd className="num flex min-w-0 items-center gap-2 text-xs text-muted" title={t.headHash ?? undefined}>
            <MiniKey hash={t.headHash} className="hidden text-faint sm:block lg:hidden xl:block" />
            {shortHash(t.headHash)}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-4">
          <dt className="text-faint">Since</dt>
          <dd className="num text-xs text-muted">{date(t.createdAt)}</dd>
        </div>
      </dl>
    </Card>
  );
}
