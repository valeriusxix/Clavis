import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { date, signedUsd } from "../lib/format";

/** Daily equity (realized + unrealized PnL, USD). */
export function EquityChart({ points }: { points: { t: number; equityUsd: number }[] }) {
  if (points.length === 0) return <div className="flex h-48 items-center justify-center text-sm text-muted">No trades yet.</div>;
  const last = points[points.length - 1]!.equityUsd;
  const stroke = last >= 0 ? "var(--color-up)" : "var(--color-down)";
  return (
    <div className="h-56 w-full" role="img" aria-label={`Equity curve, latest ${signedUsd(last)}`}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="eq" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity={0.25} />
              <stop offset="100%" stopColor={stroke} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--color-line)" vertical={false} />
          <XAxis
            dataKey="t"
            type="number"
            domain={["dataMin", "dataMax"]}
            tickFormatter={(t: number) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
            stroke="var(--color-faint)"
            fontSize={11}
            tickLine={false}
            minTickGap={40}
          />
          <YAxis
            width={64}
            stroke="var(--color-faint)"
            fontSize={11}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => `$${Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(0)}k` : v.toFixed(0)}`}
          />
          <Tooltip
            contentStyle={{ background: "var(--color-ink-850)", border: "1px solid var(--color-line-strong)", borderRadius: 6, fontSize: 12 }}
            labelFormatter={(t) => date(Number(t))}
            formatter={(v) => [signedUsd(Number(v)), "PnL"]}
          />
          <Area type="monotone" dataKey="equityUsd" stroke={stroke} strokeWidth={1.75} fill="url(#eq)" isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
