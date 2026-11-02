import { ArrowDown, BadgeCheck, CircleX, FlaskConical, Info, ShieldAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { ConfidentialBadge, SimulatedBadge } from "../components/Badge";
import { Button, Card, ErrorNote, Spinner } from "../components/ui";
import { api, type FeedTrade, type QuoteResult, type Token } from "../lib/api";
import { qty, shortHash, usd } from "../lib/format";
import { useSession } from "../lib/session";

const label = (t: Token) => (t.symbol === "wNEAR" ? "NEAR (wNEAR)" : t.blockchain === "near" ? t.symbol : `${t.symbol} (${t.blockchain})`);

export function Trade() {
  const { meta, session, loginDemo } = useSession();
  const [tokens, setTokens] = useState<Token[] | null>(null);
  const [tokenSource, setTokenSource] = useState<"live" | "seed">("live");
  const [origin, setOrigin] = useState("");
  const [dest, setDest] = useState("");
  const [amount, setAmount] = useState("1");
  const [dry, setDry] = useState(true);
  const [askReal, setAskReal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quote, setQuote] = useState<QuoteResult | null>(null);
  const [filled, setFilled] = useState<FeedTrade | null>(null);

  useEffect(() => {
    api.tokens().then(
      (r) => {
        setTokens(r.tokens);
        setTokenSource(r.source);
        const near = r.tokens.find((t) => t.symbol === "wNEAR");
        const usdc = r.tokens.find((t) => t.symbol === "USDC" && t.blockchain === "near");
        setOrigin(near?.assetId ?? "");
        setDest(usdc?.assetId ?? "");
      },
      (e: Error) => setError(e.message),
    );
  }, []);

  // Keep origin tokens on NEAR (NEP-141): the deposit is then one wallet ft_transfer (AGENT.md 6.2).
  const origins = useMemo(() => tokens?.filter((t) => t.blockchain === "near") ?? [], [tokens]);
  const dests = useMemo(() => tokens?.filter((t) => t.assetId !== origin) ?? [], [tokens, origin]);
  const amountOk = /^\d+(\.\d+)?$/.test(amount) && Number(amount) > 0;

  const getQuote = async () => {
    setBusy(true);
    setError(null);
    setQuote(null);
    setFilled(null);
    try {
      if (!session && meta?.demoMode) await loginDemo(); // dry run works with the demo account
      setQuote(await api.quote({ originAsset: origin, destinationAsset: dest, amountHuman: amount, dry }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const simulate = async () => {
    if (!quote) return;
    setBusy(true);
    setError(null);
    try {
      setFilled((await api.simulate(quote.tradeId)).trade);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toggleDry = () => {
    if (dry) setAskReal(true);
    else setDry(true);
  };

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="text-2xl font-semibold tracking-tight">Trade</h1>
      <p className="mt-1 text-sm text-muted">
        Get a confidential quote from the NEAR Intents 1Click API. Dry run is on by default: nothing executes and no funds move.
      </p>

      <Card className="mt-6 space-y-4 p-4">
        {!tokens && !error && <Spinner label="Loading tokens" />}
        {tokens && (
          <>
            <div className="grid grid-cols-[1fr_7rem] gap-2">
              <label className="space-y-1 text-sm">
                <span className="text-muted">From</span>
                <select value={origin} onChange={(e) => setOrigin(e.target.value)} className="h-10 w-full rounded-md border border-line-strong bg-ink-850 px-2">
                  {origins.map((t) => (
                    <option key={t.assetId} value={t.assetId}>
                      {label(t)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-muted">Amount</span>
                <input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value.trim())}
                  inputMode="decimal"
                  aria-label="Amount"
                  className={`num h-10 w-full rounded-md border bg-ink-850 px-2 ${amountOk ? "border-line-strong" : "border-down"}`}
                />
              </label>
            </div>
            <div className="flex justify-center text-faint">
              <ArrowDown size={16} aria-hidden />
            </div>
            <label className="block space-y-1 text-sm">
              <span className="text-muted">To</span>
              <select value={dest} onChange={(e) => setDest(e.target.value)} className="h-10 w-full rounded-md border border-line-strong bg-ink-850 px-2">
                {dests.map((t) => (
                  <option key={t.assetId} value={t.assetId}>
                    {label(t)}
                  </option>
                ))}
              </select>
            </label>
            {tokenSource === "seed" && <p className="text-xs text-faint">Token list from cache: the 1Click token API is not reachable right now.</p>}

            <div className="flex items-center justify-between rounded-md border border-line bg-ink-850 px-3 py-2">
              <div>
                <div className="text-sm font-medium">Dry run {dry ? "ON" : "OFF"}</div>
                <div className="text-xs text-muted">{dry ? "Quote only. No deposit address, nothing executes." : "REAL trade on NEAR Intents mainnet."}</div>
              </div>
              <button
                role="switch"
                aria-checked={dry}
                aria-label="Dry run"
                onClick={toggleDry}
                className={`relative h-6 w-11 rounded-full transition-colors ${dry ? "bg-brass" : "bg-down"}`}
              >
                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-ink-950 transition-all ${dry ? "left-[22px]" : "left-0.5"}`} />
              </button>
            </div>

            <Button variant="primary" className="w-full" onClick={() => void getQuote()} disabled={busy || !amountOk || !origin || !dest}>
              {busy && !quote ? "Requesting quote…" : "Get confidential quote"}
            </Button>
          </>
        )}
        {error && <ErrorNote>{error}</ErrorNote>}
      </Card>

      {quote && <QuoteCard q={quote} />}

      {quote && quote.dry && !filled && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted">Record this dry quote as a SIMULATED trade in your own trader profile.</p>
          <Button onClick={() => void simulate()} disabled={busy}>
            <FlaskConical size={14} aria-hidden /> Simulate fill
          </Button>
        </div>
      )}
      {filled && session && (
        <Card className="mt-4 flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
          <span className="flex items-center gap-2">
            Trade #{filled.seq} recorded <SimulatedBadge />
          </span>
          <Link className="text-brass hover:underline" to={`/trader/${encodeURIComponent(session.account)}`}>
            View in your trader profile →
          </Link>
        </Card>
      )}

      {askReal && <RealModeDialog onClose={() => setAskReal(false)} onConfirm={() => (setDry(false), setAskReal(false))} />}
    </div>
  );
}

function QuoteCard({ q }: { q: QuoteResult }) {
  return (
    <Card className="mt-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium">{q.dry ? "Dry quote" : "Quote"} from the NEAR Intents 1Click API</h2>
        {q.confidential ? (
          <ConfidentialBadge level={q.confidentiality} />
        ) : (
          <span className="inline-flex items-center gap-1 rounded border border-down/40 px-1.5 py-0.5 text-[11px] font-semibold text-down">
            <ShieldAlert size={11} aria-hidden /> PUBLIC (not confidential)
          </span>
        )}
      </div>
      {q.notice && (
        <p className="mt-3 flex gap-2 rounded-md border border-line-strong bg-ink-850 px-3 py-2 text-xs text-muted">
          <Info size={14} className="mt-0.5 shrink-0" aria-hidden /> {q.notice}
        </p>
      )}
      <div className="mt-4">
        <div className="text-xs text-muted">You receive</div>
        <div className="num text-3xl">
          {qty(q.quote.amountOutFormatted)} <span className="text-lg text-muted">{q.destination.symbol}</span>
        </div>
        <div className="num text-sm text-muted">{usd(q.quote.amountOutUsd)}</div>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted">You send</dt>
        <dd className="num text-right">
          {qty(q.quote.amountInFormatted)} {q.origin.symbol} <span className="text-muted">({usd(q.quote.amountInUsd)})</span>
        </dd>
        <dt className="text-muted">Estimated time</dt>
        <dd className="num text-right">{q.quote.timeEstimate}s</dd>
        <dt className="text-muted">Quote signature</dt>
        <dd className="text-right">
          {q.signature.valid ? (
            <span className="inline-flex items-center gap-1 text-up">
              <BadgeCheck size={14} aria-hidden /> signed by 1Click
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-down">
              <CircleX size={14} aria-hidden /> invalid
            </span>
          )}
        </dd>
        <dt className="text-muted">Correlation id</dt>
        <dd className="num truncate text-right text-xs text-muted" title={q.correlationId}>
          {shortHash(q.correlationId, 8)}
        </dd>
        {q.quote.depositAddress && (
          <>
            <dt className="text-muted">Deposit address</dt>
            <dd className="num truncate text-right text-xs" title={q.quote.depositAddress}>
              {q.quote.depositAddress}
            </dd>
          </>
        )}
      </dl>
      {q.dry && <p className="mt-3 text-xs text-faint">Dry run: no deposit address was created and no funds move.</p>}
    </Card>
  );
}

function RealModeDialog({ onClose, onConfirm }: { onClose: () => void; onConfirm: () => void }) {
  const { session } = useSession();
  const canTradeReal = session?.kind === "wallet";
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 p-4 sm:items-center" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="real-title" className="w-full max-w-md rounded-lg border border-down/50 bg-ink-900 p-5" onClick={(e) => e.stopPropagation()}>
        <h2 id="real-title" className="flex items-center gap-2 text-lg font-semibold">
          <ShieldAlert size={18} className="text-down" aria-hidden /> Turn off dry run?
        </h2>
        <p className="mt-2 text-sm text-muted">
          Real mode sends real tokens on NEAR Intents mainnet (there is no testnet for Intents). Use tiny amounts only. The quote returns a
          deposit address; your wallet sends the tokens and the trade is logged when 1Click reports SUCCESS.
        </p>
        {!canTradeReal && <p className="mt-3 text-sm text-down">Real mode needs a connected wallet. The demo account can only dry run.</p>}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Keep dry run
          </Button>
          <Button onClick={onConfirm} disabled={!canTradeReal} className="border-down/60 text-down">
            I understand, use real mode
          </Button>
        </div>
      </div>
    </div>
  );
}
