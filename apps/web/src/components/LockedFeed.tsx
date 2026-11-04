import { Lock } from "lucide-react";
import type { ReactNode } from "react";
import { TRADE_COLUMNS } from "./TradeRow";

/** Trades stay hidden until the visitor holds a key: blurred placeholder rows + count. */
export function LockedFeed({ count, action }: { count: number; action: ReactNode }) {
  const rows = Math.min(Math.max(count, 4), 7);
  return (
    <div className="relative overflow-hidden rounded-2xl border border-line bg-ink-900">
      <ul aria-hidden className="pointer-events-none select-none blur-[5px]">
        {Array.from({ length: rows }, (_, i) => (
          <li key={i} className={`flex items-center gap-4 border-b border-line px-4 py-3 last:border-0 sm:px-6 lg:min-h-12 lg:py-2 ${TRADE_COLUMNS}`}>
            <span className="hidden h-2.5 rounded bg-line lg:block" />
            <span className="h-2.5 w-24 rounded bg-line lg:w-auto" />
            <span className="hidden h-2.5 rounded bg-line lg:block" />
            <span className="h-2.5 flex-1 rounded bg-line-strong" />
            <span className="hidden lg:block" />
            <span className="hidden h-2.5 rounded bg-line-strong lg:block" />
            <span className="hidden h-2.5 rounded bg-line lg:block" />
            <span className="h-2.5 w-16 rounded bg-line lg:ml-auto" />
          </li>
        ))}
      </ul>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-ink-950/50 px-4 text-center">
        <p className="flex items-center gap-2 text-base font-medium">
          <Lock size={16} strokeWidth={1.5} className="text-green" aria-hidden />
          <span className="num">{count}</span> trades hidden
        </p>
        {action}
      </div>
    </div>
  );
}
