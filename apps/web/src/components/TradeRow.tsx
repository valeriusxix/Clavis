import { ArrowRight } from "lucide-react";
import type { FeedTrade } from "../lib/api";
import { dateTime, qty, usd } from "../lib/format";
import { SignedBadge, SimulatedBadge, StatusBadge } from "./Badge";

/** Shared by the header row, the trade rows and the locked rows, so unlocking moves nothing. */
export const TRADE_COLUMNS =
  "lg:grid lg:grid-cols-[3.5rem_7.5rem_3rem_minmax(0,1fr)_1rem_minmax(0,1fr)_minmax(0,1.2fr)_11rem] lg:items-center lg:gap-x-4";

export function TradeHeader() {
  return (
    <div className={`hidden h-10 border-b border-line px-6 text-xs text-faint ${TRADE_COLUMNS}`}>
      <span>Entry</span>
      <span>Time</span>
      <span>Side</span>
      <span className="text-right">Sent</span>
      <span />
      <span>Received</span>
      <span>USD value</span>
      <span className="text-right">Status</span>
    </div>
  );
}

export function TradeRow({ t }: { t: FeedTrade }) {
  return (
    <li className={`flex flex-col gap-1.5 border-b border-line px-4 py-3 last:border-0 sm:px-6 lg:min-h-12 lg:py-2 ${TRADE_COLUMNS}`}>
      <div className="num flex items-center gap-2 text-xs lg:contents">
        <span className="text-faint">#{t.seq ?? "—"}</span>
        <span className="text-muted">{dateTime(t.time)}</span>
        <span className="ml-auto font-medium lg:ml-0">{t.side}</span>
      </div>

      <div className="num flex min-w-0 items-center gap-2 text-sm lg:contents">
        <span className="truncate lg:text-right">
          {qty(t.amountIn)} {t.originSymbol}
        </span>
        <ArrowRight size={14} strokeWidth={1.5} className="shrink-0 text-faint" aria-hidden />
        <span className="truncate">
          {qty(t.amountOut)} {t.destSymbol}
        </span>
      </div>

      <div className="num truncate text-xs text-muted lg:text-sm">
        {usd(t.amountInUsd)} <ArrowRight size={12} strokeWidth={1.5} className="inline text-faint" aria-hidden /> {usd(t.amountOutUsd)}
      </div>

      <div className="flex flex-wrap items-center gap-1.5 lg:justify-end">
        {t.simulated ? <SimulatedBadge /> : <StatusBadge status={t.status} />}
        {!t.simulated && t.oneClickSigned && <SignedBadge />}
      </div>
    </li>
  );
}
