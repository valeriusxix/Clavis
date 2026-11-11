import { Link } from "react-router";
import type { TraderStats } from "../lib/api";
import { pct, signedUsd, tone } from "../lib/format";
import { SimulatedBadge } from "./Badge";
import { MiniKey } from "./Key";

/**
 * Shared by the header row and the trader rows, so the columns line up.
 * Below md a row stacks; md shows six columns (no Total PnL); lg shows all seven.
 */
export const LEADER_COLUMNS =
  "md:grid-cols-[2rem_minmax(0,2fr)_minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,1fr)_11.5rem] lg:grid-cols-[2rem_minmax(0,2.2fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,0.7fr)_minmax(0,0.9fr)_11.5rem]";

export function TraderRow({ t, rank, onActive }: { t: TraderStats; rank: number; onActive?: () => void }) {
  const win = t.winRate === null ? "—" : `${Math.round(t.winRate * 100)}%`;
  return (
    <li className="border-b border-line last:border-0">
    <Link
      to={`/trader/${encodeURIComponent(t.id)}`}
      onMouseEnter={onActive}
      onFocus={onActive}
      aria-label={`${t.name}: 30-day PnL ${pct(t.pnl30dPct)}`}
      className={`grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-4 py-3 transition-colors hover:bg-ink-850 focus-visible:-outline-offset-2 sm:px-6 md:min-h-[4.5rem] md:gap-x-4 md:py-0 ${LEADER_COLUMNS}`}
    >
      <span className="num text-sm text-faint">{rank}</span>

      <div className="min-w-0">
        <div className="truncate text-[15px] font-medium">{t.name}</div>
        <div className="mt-0.5 flex min-w-0 items-center gap-2 text-xs text-faint">
          {t.simulated && <SimulatedBadge className="shrink-0" />}
          <span className="truncate">{t.style ?? t.id}</span>
        </div>
      </div>

      <div className={`num text-right text-base ${tone(t.pnl30dPct)}`}>{pct(t.pnl30dPct)}</div>
      <div className={`num hidden text-right text-sm lg:block ${tone(t.pnlTotalUsd)}`}>{signedUsd(t.pnlTotalUsd)}</div>
      <div className="num hidden text-right text-sm md:block">{win}</div>
      <div className="num hidden text-right text-sm md:block" title="Trades covered by the hash stored in the Clavis contract on NEAR">
        {t.committedCount}
        <span className="text-faint">/{t.tradeCount}</span>
      </div>

      <div className="col-span-2 col-start-2 flex items-center justify-between gap-3 md:col-span-1 md:col-start-auto md:justify-end">
        {/* Below md, win rate and trade count move here; total PnL stays on the trader page. */}
        <span className="num text-xs text-faint md:hidden">
          {win} win · {t.tradeCount} trades
        </span>
        <span className="flex items-center gap-3">
          <MiniKey hash={t.headHash} className="hidden text-faint sm:block" />
          <span className="num whitespace-nowrap text-right text-sm md:w-[4.5rem]">{t.keyPriceNear} NEAR</span>
        </span>
      </div>
    </Link>
    </li>
  );
}
