import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { date, signedUsd } from "../lib/format";

const TICK = { fill: "var(--color-faint)", fontSize: 11, fontFamily: "var(--font-mono)" };

/** Axis money: rounded, sign before the dollar (−$926, not $-926), with cents on small accounts so ticks stay distinct. */
function axisUsd(v: number): string {
  const sign = v < 0 ? "−" : "";
  const abs = Math.abs(v);
  const text = abs >= 1000 ? `${(abs / 1000).toFixed(0)}k` : abs >= 10 || abs === 0 ? abs.toFixed(0) : abs.toFixed(2);
  return `${sign}$${text}`;
}

function ChartTip({ active, label, value }: { active?: boolean; label?: string | number; value?: unknown }) {
  if (!active || value === undefined) return null;
  return (
    <div className="rounded-lg border border-line-strong bg-ink-850 px-3 py-2">
      <div className="text-xs text-muted">{date(Number(label))}</div>
      <div className="num mt-0.5 text-sm text-fg">{signedUsd(Number(value))}</div>
    </div>
  );
}

/** Daily equity (realized + unrealized PnL, USD). One series, so the card title names it and no legend is needed. */
export function EquityChart({ points }: { points: { t: number; equityUsd: number }[] }) {
  if (points.length === 0) return <div className="flex h-72 items-center justify-center text-sm text-muted">No trades yet.</div>;
  const last = points[points.length - 1]!.equityUsd;
  // One or two daily points draw a dot or a stub, which reads as broken. Say what there is instead.
  if (points.length < 3) {
    return (
      <div className="flex h-72 flex-col items-center justify-center gap-1 px-4 text-center">
        <div className={`num text-3xl leading-none ${last >= 0 ? "text-up" : "text-down"}`}>{signedUsd(last)}</div>
        <div className="mt-2 text-sm text-muted">
          {points.length === 1 ? "One day" : "Two days"} of history, since {date(points[0]!.t)}. The curve appears after three days.
        </div>
      </div>
    );
  }
  const stroke = last >= 0 ? "var(--color-up)" : "var(--color-down)";
  const crossesZero = points.some((p) => p.equityUsd < 0) && points.some((p) => p.equityUsd > 0);
  return (
    <div className="h-72 w-full" role="img" aria-label={`Equity curve, latest ${signedUsd(last)}`}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 8, right: 24, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="eq" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity={0.16} />
              <stop offset="100%" stopColor={stroke} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--color-line)" vertical={false} />
          <XAxis
            dataKey="t"
            type="number"
            domain={["dataMin", "dataMax"]}
            tickFormatter={(t: number) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
            stroke="var(--color-line-strong)"
            tick={TICK}
            tickLine={false}
            minTickGap={48}
          />
          <YAxis width={64} tick={TICK} tickLine={false} axisLine={false} tickFormatter={axisUsd} />
          {crossesZero && <ReferenceLine y={0} stroke="var(--color-line-strong)" />}
          <Tooltip
            cursor={{ stroke: "var(--color-line-strong)", strokeWidth: 1 }}
            content={(p) => <ChartTip active={p.active} label={p.label} value={p.payload?.[0]?.value} />}
          />
          <Area
            type="monotone"
            dataKey="equityUsd"
            stroke={stroke}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            fill="url(#eq)"
            activeDot={{ r: 4, fill: stroke, stroke: "var(--color-ink-900)", strokeWidth: 2 }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
