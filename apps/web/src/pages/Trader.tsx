import { ArrowLeft, ChevronRight, Copy as CopyIcon, KeyRound, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { SimulatedBadge } from "../components/Badge";
import { BuyKeyDialog, type BuyResult } from "../components/BuyKeyDialog";
import { EquityChart } from "../components/EquityChart";
import { CutKey, MiniKey } from "../components/Key";
import { LockedFeed } from "../components/LockedFeed";
import { TradeHeader, TradeRow } from "../components/TradeRow";
import { VerifyPanel } from "../components/VerifyPanel";
import { Bone, Button, Card, ErrorNote, Notice, Spinner } from "../components/ui";
import { api, type FeedTrade, type Token, type TraderStats } from "../lib/api";
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

  // Copy needs asset ids for the trade's two tokens. Only NEAR-chain tokens can be quoted from the
  // Trade page (origins are NEAR-only, and dry quotes to other chains are rejected), so only rows
  // whose both sides are NEAR tokens get a Copy link. No token list = no Copy links, nothing else changes.
  const [nearTokens, setNearTokens] = useState<Map<string, Token> | null>(null);
  const unlocked = profile?.unlocked ?? false;
  useEffect(() => {
    if (!unlocked) return;
    api.tokens().then(
      (r) => setNearTokens(new Map(r.tokens.filter((tk) => tk.blockchain === "near").map((tk) => [tk.symbol, tk]))),
      () => setNearTokens(null),
    );
  }, [unlocked]);

  const copyLink = (tr: FeedTrade) => {
    const from = nearTokens?.get(tr.originSymbol);
    const to = nearTokens?.get(tr.destSymbol);
    if (!profile || !from || !to || tr.seq === null || session?.account === profile.trader.id) return null;
    const q = new URLSearchParams({ from: from.assetId, to: to.assetId, by: profile.trader.name, entry: String(tr.seq) });
    return (
      <Link
        to={`/trade?${q}`}
        aria-label={`Copy trade #${tr.seq}: ${tr.originSymbol} to ${tr.destSymbol}, on the Trade page with dry run on`}
        className="num inline-flex min-h-11 items-center gap-1 rounded px-1.5 text-[11px] text-green transition-colors hover:underline lg:min-h-0 lg:py-0.5"
      >
        <CopyIcon size={12} strokeWidth={1.5} aria-hidden /> Copy
      </Link>
    );
  };

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
    // Same boxes as the loaded page, so nothing jumps when the data lands.
    return (
      <div className="space-y-6 pt-3">
        <span className="sr-only">
          <Spinner />
        </span>
        <div className="flex min-h-11 items-center">
          <Bone className="h-3 w-24" />
        </div>
        <div className="grid items-start gap-x-8 gap-y-12 lg:grid-cols-[minmax(0,1fr)_22.5rem]">
          <div className="min-w-0 space-y-6">
            <div className="grid grid-cols-1 items-end gap-x-8 gap-y-4 sm:grid-cols-[minmax(0,1fr)_auto]">
              <div className="space-y-3">
                <Bone className="h-10 w-56" />
                <Bone className="h-3 w-40" />
                <Bone className="h-2.5 w-48" />
              </div>
              <Bone className="h-10 w-32 sm:justify-self-end" />
            </div>
            <Card className="p-5">
              <Bone className="h-4 w-24" />
              <div className="mt-3 h-72" />
            </Card>
          </div>
          <div className="min-w-0 space-y-4">
            <Card className="h-72 p-6">
              <Bone className="mt-24 h-8 w-32" />
              <Bone className="mt-4 h-12 w-full" />
            </Card>
            <Card className="space-y-6 p-6">
              {Array.from({ length: 5 }, (_, i) => (
                <Bone key={i} className="h-3 w-full" />
              ))}
            </Card>
          </div>
        </div>
      </div>
    );
  }
  const t: TraderStats = profile.trader;

  return (
    <div className="rise space-y-6 pt-3">
      <Link to="/" className="inline-flex min-h-11 items-center gap-1 pr-2 text-sm text-muted transition-colors hover:text-fg">
        <ArrowLeft size={16} strokeWidth={1.5} aria-hidden /> Leaderboard
      </Link>

      {banner && (
        <Notice>
          <span>
            {banner}
            {profile.unlocked && !verifying && <span className="text-muted"> Next: Verify log, below the chart, checks this feed against NEAR.</span>}
          </span>
        </Notice>
      )}

      <div className="grid items-start gap-x-8 gap-y-12 lg:grid-cols-[minmax(0,1fr)_22.5rem]">
        <div className="min-w-0 space-y-6">
          {/* Two fixed columns: a long style line wraps under the name instead of pushing the PnL below it. */}
          <header className="grid grid-cols-1 items-end gap-x-8 gap-y-4 sm:grid-cols-[minmax(0,1fr)_auto]">
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h1 className="min-w-0 font-serif text-4xl leading-tight tracking-[-0.02em] break-all sm:text-5xl">{t.name}</h1>
                {t.simulated && <SimulatedBadge />}
              </div>
              {/* [overflow-wrap:anywhere]: a 64-char account id in the style line must wrap, not widen the page. */}
              {t.style && <p className="mt-1 text-sm text-muted [overflow-wrap:anywhere]">{t.style}</p>}
              <p className="num mt-1 truncate text-xs text-faint" title={t.id}>
                {t.id}
              </p>
            </div>
            <div className="sm:justify-self-end sm:text-right">
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
              <StatRow label="Trades committed" value={`${t.committedCount} / ${t.tradeCount}`} hint="Trades covered by the hash stored in the Clavis contract on NEAR" />
            </dl>
          </Card>
        </div>
      </div>

      <section className="space-y-3 pt-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-medium">Trades</h2>
          {profile.unlocked && (
            <Button size="sm" variant={verifying ? "secondary" : "primary"} onClick={() => setVerifying((v) => !v)}>
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
              <ul aria-label="Logged trades, newest first">
                {feed
                  .filter((tr) => tr.seq !== null)
                  .map((tr) => (
                    <TradeRow key={tr.id} t={tr} action={copyLink(tr)} />
                  ))}
              </ul>
              {/* Quotes without a settled trade have no entry number and are not in the hash chain: folded, not hidden. */}
              {feed.some((tr) => tr.seq === null) && (
                <details className="group border-t border-line">
                  <summary className="flex min-h-11 cursor-pointer items-center gap-2 px-4 text-sm text-muted transition-colors hover:text-fg sm:px-6">
                    <ChevronRight size={14} strokeWidth={1.5} className="shrink-0 transition-transform duration-150 group-open:rotate-90" aria-hidden />
                    <span className="num">{feed.filter((tr) => tr.seq === null).length}</span> quotes without a settled trade (not in the log)
                  </summary>
                  <ul className="border-t border-line">
                    {feed
                      .filter((tr) => tr.seq === null)
                      .map((tr) => (
                        <TradeRow key={tr.id} t={tr} />
                      ))}
                  </ul>
                </details>
              )}
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

function StatRow({ label, value, className = "", hint }: { label: string; value: string; className?: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line py-2.5 last:border-0">
      <dt className={`text-sm text-muted ${hint ? "cursor-help underline decoration-dotted decoration-faint underline-offset-4" : ""}`} title={hint}>
        {label}
      </dt>
      <dd className={`num truncate text-sm ${className}`}>{value}</dd>
    </div>
  );
}

/** The key to this trader's feed: the one thing on the page that carries the brand colour as a fill. */
function KeyPanel({ t, unlocked, own, onBuy }: { t: TraderStats; unlocked: boolean; own: boolean; onBuy: () => void }) {
  return (
    <Card className="p-6">
      {/* Capped on tablets, where the side panel spans the full width and the key would be 700px long. */}
      <div className="-mx-1 -mt-14 md:mx-auto md:max-w-sm lg:-mx-1 lg:max-w-none">
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
