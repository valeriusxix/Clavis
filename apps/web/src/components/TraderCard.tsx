import { ChevronRight, KeyRound } from "lucide-react";
import { Link } from "react-router";
import type { TraderStats } from "../lib/api";
import { pct, signedUsd, tone } from "../lib/format";
import { SimulatedBadge } from "./Badge";

export function TraderCard({ t, rank }: { t: TraderStats; rank: number }) {
  return (
    <Link
      to={`/trader/${encodeURIComponent(t.id)}`}
      className="group grid grid-cols-[2rem_1fr_auto] items-center gap-3 rounded-lg border border-line bg-ink-900 px-4 py-4 transition-colors hover:border-line-strong sm:grid-cols-[2rem_minmax(0,1.7fr)_repeat(4,minmax(0,1fr))_6.5rem]"
      aria-label={`${t.name}: 30-day PnL ${pct(t.pnl30dPct)}`}
    >
      <span className="num text-sm text-faint">{rank}</span>

      <div className="min-w-0">
        <div className="truncate font-medium">{t.name}</div>
        <div className="mt-1 flex min-w-0 items-center gap-2">
          {t.simulated && <SimulatedBadge className="shrink-0" />}
          <span className="truncate text-xs text-muted">{t.style ?? t.id}</span>
        </div>
      </div>

      {/* mobile: 30d PnL only, details on the trader page */}
      <div className={`num text-right text-lg sm:hidden ${tone(t.pnl30dPct)}`}>{pct(t.pnl30dPct)}</div>

      <Metric label="30-day PnL" value={pct(t.pnl30dPct)} className={`text-lg ${tone(t.pnl30dPct)}`} />
      <Metric label="Total PnL" value={signedUsd(t.pnlTotalUsd)} className={tone(t.pnlTotalUsd)} />
      <Metric label="Win rate" value={t.winRate === null ? "—" : `${Math.round(t.winRate * 100)}%`} />
      <Metric
        label="Trades committed"
        value={
          <>
            {t.committedCount}
            <span className="text-faint">/{t.tradeCount}</span>
          </>
        }
      />
      <div className="col-span-3 flex items-center justify-between gap-3 border-t border-line pt-3 text-sm sm:col-span-1 sm:border-0 sm:pt-0">
        <span className="flex items-center gap-1.5 text-muted sm:hidden">
          <span className="num">{t.winRate === null ? "—" : `${Math.round(t.winRate * 100)}%`} win</span>·
          <span className="num">{t.tradeCount} trades</span>
        </span>
        <span className="ml-auto flex items-center gap-1.5 text-brass sm:ml-0">
          <KeyRound size={14} aria-hidden />
          <span className="num">{t.keyPriceNear} NEAR</span>
          <ChevronRight size={16} className="text-faint transition-transform group-hover:translate-x-0.5" aria-hidden />
        </span>
      </div>
    </Link>
  );
}

function Metric({ label, value, className = "" }: { label: string; value: React.ReactNode; className?: string }) {
  return (
    <div className="hidden min-w-0 sm:block">
      <div className="text-[11px] text-faint">{label}</div>
      <div className={`num truncate ${className}`}>{value}</div>
    </div>
  );
}
