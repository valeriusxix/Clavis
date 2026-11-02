import { ArrowRight } from "lucide-react";
import type { FeedTrade } from "../lib/api";
import { dateTime, qty, usd } from "../lib/format";
import { SignedBadge, SimulatedBadge, StatusBadge } from "./Badge";

const SIDE_TONE = { BUY: "text-up", SELL: "text-down", SWAP: "text-fg" } as const;

export function TradeRow({ t }: { t: FeedTrade }) {
  return (
    <li className="grid grid-cols-1 gap-2 border-b border-line px-4 py-3 last:border-0 sm:grid-cols-[8rem_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-center">
      <div className="flex items-center gap-2 text-xs text-muted sm:block">
        <span className="num">{dateTime(t.time)}</span>
        <span className={`num ml-2 font-semibold sm:ml-0 sm:block ${SIDE_TONE[t.side]}`}>
          {t.side} <span className="text-faint">#{t.seq ?? "—"}</span>
        </span>
      </div>
      <div className="flex min-w-0 items-center gap-2 text-sm">
        <span className="num truncate">
          {qty(t.amountIn)} {t.originSymbol}
        </span>
        <ArrowRight size={14} className="shrink-0 text-faint" aria-hidden />
        <span className="num truncate">
          {qty(t.amountOut)} {t.destSymbol}
        </span>
      </div>
      <div className="num text-sm text-muted">
        {usd(t.amountInUsd)} <ArrowRight size={12} className="inline text-faint" aria-hidden /> {usd(t.amountOutUsd)}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 sm:justify-end">
        {t.simulated ? <SimulatedBadge /> : <StatusBadge status={t.status} />}
        {!t.simulated && t.oneClickSigned && <SignedBadge />}
      </div>
    </li>
  );
}
