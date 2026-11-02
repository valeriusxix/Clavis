import { ArrowDown, BadgeCheck, CircleCheck, CircleX, FlaskConical, Info, Send, ShieldAlert, Wallet } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { ConfidentialBadge, SimulatedBadge } from "../components/Badge";
import { Button, Card, ErrorNote, Spinner } from "../components/ui";
import { api, type FeedTrade, type QuoteResult, type Token } from "../lib/api";
import { qty, shortHash, usd } from "../lib/format";
import { explorerTxUrl, sendDeposit } from "../lib/near";
import { useSession } from "../lib/session";

/** Final 1Click statuses. INCOMPLETE_DEPOSIT is not final, so the page keeps polling (AUDIT L1). */
const TERMINAL = new Set(["SUCCESS", "REFUNDED", "FAILED"]);
const REAL_CAP_USD = 2;

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
  // Real mode keeps both sides on NEAR: one wallet transaction in, output back to the same account.
  const dests = useMemo(
    () => tokens?.filter((t) => t.assetId !== origin && (dry || t.blockchain === "near")) ?? [],
    [tokens, origin, dry],
  );
  useEffect(() => {
    if (dests.length && !dests.some((t) => t.assetId === dest)) setDest(dests[0]!.assetId);
  }, [dests, dest]);
  const amountOk = /^\d+(\.\d+)?$/.test(amount) && Number(amount) > 0;
  const originToken = tokens?.find((t) => t.assetId === origin);
  const estimateUsd = originToken && amountOk ? Number(amount) * originToken.price : 0;
  const overCap = !dry && estimateUsd > REAL_CAP_USD;

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
            {!dry && (
              <p className={`text-xs ${overCap ? "text-down" : "text-muted"}`}>
                Real mode: NEAR tokens only, max ${REAL_CAP_USD} per trade (this one ≈ {usd(estimateUsd)}). Paid from{" "}
                <span className="num">{session?.payer ?? "your mainnet wallet"}</span>.
              </p>
            )}

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

            <Button variant="primary" className="w-full" onClick={() => void getQuote()} disabled={busy || !amountOk || !origin || !dest || overCap}>
              {busy && !quote ? "Requesting quote…" : "Get confidential quote"}
            </Button>
          </>
        )}
        {error && <ErrorNote>{error}</ErrorNote>}
      </Card>

      {quote && <QuoteCard q={quote} />}
      {quote && !quote.dry && quote.quote.depositAddress && <RealDeposit q={quote} />}

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
      {q.routing?.privacyWarning && (
        <p role="alert" className="mt-3 flex gap-2 rounded-md border border-down/60 bg-down/5 px-3 py-2 text-xs text-fg">
          <ShieldAlert size={14} className="mt-0.5 shrink-0 text-down" aria-hidden /> Privacy warning: {q.routing.privacyWarning}
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
  const { session, loginMainnet } = useSession();
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const linked = Boolean(session?.payer);
  const connect = async () => {
    setConnecting(true);
    setError(null);
    try {
      await loginMainnet();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setConnecting(false);
    }
  };
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 p-4 sm:items-center" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="real-title" className="w-full max-w-md rounded-lg border border-down/50 bg-ink-900 p-5" onClick={(e) => e.stopPropagation()}>
        <h2 id="real-title" className="flex items-center gap-2 text-lg font-semibold">
          <ShieldAlert size={18} className="text-down" aria-hidden /> Turn off dry run?
        </h2>
        <p className="mt-2 text-sm text-muted">
          Real mode sends real tokens on NEAR Intents mainnet (there is no testnet for Intents). Trades are capped at ${REAL_CAP_USD}. The quote
          returns a deposit address; your mainnet wallet sends the tokens and the trade is logged when 1Click reports SUCCESS.
        </p>
        {linked ? (
          <p className="mt-3 text-sm">
            Mainnet wallet <span className="num text-fg">{session!.payer}</span> → trader <span className="num text-fg">{session!.account}</span>
          </p>
        ) : (
          <div className="mt-3 space-y-2">
            <p className="text-sm text-muted">Real mode is operator-only: connect the mainnet wallet linked to the real trader on this server.</p>
            <Button onClick={() => void connect()} disabled={connecting}>
              <Wallet size={14} aria-hidden /> {connecting ? "Connecting…" : "Connect mainnet wallet"}
            </Button>
          </div>
        )}
        {error && <p className="mt-2 text-sm text-down">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Keep dry run
          </Button>
          <Button onClick={onConfirm} disabled={!linked} className="border-down/60 text-down">
            I understand, use real mode
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Real mode: send the deposit with the mainnet wallet, then follow 1Click's status until it is final. */
function RealDeposit({ q }: { q: QuoteResult }) {
  const { mainnetWallet, session } = useSession();
  const [confirming, setConfirming] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [trade, setTrade] = useState<FeedTrade | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!txHash || (trade && TERMINAL.has(trade.status))) return;
    const timer = setInterval(() => {
      api.trade(q.tradeId).then((r) => setTrade(r.trade), () => undefined);
    }, 4000);
    return () => clearInterval(timer);
  }, [txHash, trade, q.tradeId]);

  const send = async () => {
    setConfirming(false);
    setBusy(true);
    setError(null);
    try {
      if (!mainnetWallet) throw new Error("Connect the mainnet wallet first (turn dry run off again).");
      const hash = await sendDeposit(mainnetWallet, "mainnet", {
        originAsset: q.origin.assetId,
        amountIn: q.quote.amountIn,
        depositAddress: q.quote.depositAddress!,
      });
      if (!hash) throw new Error("The wallet did not return a transaction hash.");
      setTxHash(hash);
      setTrade((await api.deposit(q.tradeId, hash)).trade);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const status = trade?.status ?? (txHash ? "KNOWN_DEPOSIT_TX" : "PENDING_DEPOSIT");
  return (
    <Card className="mt-4 space-y-3 border-down/40 p-4">
      <h2 className="text-sm font-medium">Real trade on NEAR Intents mainnet</h2>
      {!txHash && (
        <Button variant="primary" className="w-full" onClick={() => setConfirming(true)} disabled={busy}>
          <Send size={14} aria-hidden /> {busy ? "Waiting for wallet…" : `Send ${qty(q.quote.amountInFormatted)} ${q.origin.symbol} with wallet`}
        </Button>
      )}
      {txHash && (
        <ol className="space-y-1 text-sm">
          {["KNOWN_DEPOSIT_TX", "PROCESSING", "SUCCESS"].map((s) => {
            const order = ["PENDING_DEPOSIT", "KNOWN_DEPOSIT_TX", "PROCESSING", "SUCCESS"];
            const done = order.indexOf(status) >= order.indexOf(s);
            return (
              <li key={s} className={`flex items-center gap-2 ${done ? "text-fg" : "text-faint"}`}>
                <CircleCheck size={14} className={done ? "text-up" : "text-faint"} aria-hidden /> <span className="num">{s}</span>
              </li>
            );
          })}
          {["REFUNDED", "FAILED"].includes(status) && (
            <li className="flex items-center gap-2 text-down">
              <CircleX size={14} aria-hidden /> <span className="num">{status}</span>: 1Click returns the deposit to {session?.payer}.
            </li>
          )}
          {status === "INCOMPLETE_DEPOSIT" && (
            <li className="flex items-center gap-2 text-down">
              <CircleX size={14} aria-hidden /> <span className="num">{status}</span>: 1Click received less than this quote needs. Waiting
              for its final status.
            </li>
          )}
          <li className="text-xs text-muted">
            deposit tx{" "}
            <a className="num text-brass hover:underline" href={explorerTxUrl("mainnet", txHash)} target="_blank" rel="noreferrer">
              {shortHash(txHash, 8)}
            </a>
          </li>
        </ol>
      )}
      {trade?.status === "SUCCESS" && session && (
        <p className="text-sm">
          Logged as trade #{trade.seq} {trade.oneClickSigned && "· 1Click-signed ✓"} ·{" "}
          <Link className="text-brass hover:underline" to={`/trader/${encodeURIComponent(session.account)}`}>
            View in your trader profile →
          </Link>
        </p>
      )}
      {error && <ErrorNote>{error}</ErrorNote>}

      {confirming && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 p-4 sm:items-center" onClick={() => setConfirming(false)}>
          <div role="dialog" aria-modal="true" aria-labelledby="send-title" className="w-full max-w-md rounded-lg border border-down/50 bg-ink-900 p-5" onClick={(e) => e.stopPropagation()}>
            <h2 id="send-title" className="text-lg font-semibold">Send real funds?</h2>
            <p className="mt-2 text-sm text-muted">
              Your wallet <span className="num text-fg">{session?.payer}</span> sends{" "}
              <span className="num text-fg">
                {qty(q.quote.amountInFormatted)} {q.origin.symbol} ({usd(q.quote.amountInUsd)})
              </span>{" "}
              to the 1Click deposit address <span className="num break-all text-fg">{q.quote.depositAddress}</span> on NEAR mainnet, for about{" "}
              <span className="num text-fg">
                {qty(q.quote.amountOutFormatted)} {q.destination.symbol}
              </span>
              . Your wallet will show the exact transaction to approve.
            </p>
            {q.routing?.privacyWarning && <p className="mt-2 text-sm text-down">Privacy warning: {q.routing.privacyWarning}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
              <Button onClick={() => void send()} className="border-down/60 text-down">
                Send with wallet
              </Button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
