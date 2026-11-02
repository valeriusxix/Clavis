import { Lock } from "lucide-react";
import type { ReactNode } from "react";

/** Trades stay hidden until the visitor holds a key: blurred placeholder rows + count. */
export function LockedFeed({ count, action }: { count: number; action: ReactNode }) {
  const rows = Math.min(Math.max(count, 3), 6);
  return (
    <div className="relative overflow-hidden rounded-lg border border-line bg-ink-900">
      <ul aria-hidden className="pointer-events-none select-none blur-[5px]">
        {Array.from({ length: rows }, (_, i) => (
          <li key={i} className="grid grid-cols-[8rem_1fr_1fr_6rem] gap-4 border-b border-line px-4 py-3 last:border-0">
            <span className="h-3 rounded bg-line-strong" />
            <span className="h-3 w-3/4 rounded bg-line-strong" />
            <span className="h-3 w-1/2 rounded bg-line" />
            <span className="h-3 rounded bg-line" />
          </li>
        ))}
      </ul>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-ink-950/40 px-4 text-center">
        <p className="flex items-center gap-2 text-base font-medium">
          <Lock size={16} className="text-brass" aria-hidden />
          <span className="num">{count}</span> trades hidden
        </p>
        {action}
      </div>
    </div>
  );
}
