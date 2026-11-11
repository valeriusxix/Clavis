import { ArrowDown, BadgeCheck, ChevronDown, CircleCheck, CircleX, FlaskConical, Info, Send, ShieldAlert, Wallet } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { ConfidentialBadge, SimulatedBadge } from "../components/Badge";
import { Button, Card, Dialog, ErrorNote, fieldClass, Spinner } from "../components/ui";
import { api, type FeedTrade, type QuoteResult, type Token } from "../lib/api";
import { qty, shortHash, usd } from "../lib/format";
import { explorerTxUrl, sendDeposit } from "../lib/near";
import { useSession } from "../lib/session";

/** Final 1Click statuses. INCOMPLETE_DEPOSIT is not final, so the page keeps polling (AUDIT L1). */
const TERMINAL = new Set(["SUCCESS", "REFUNDED", "FAILED"]);
const REAL_CAP_USD = 4; // keep in step with REAL_TRADE_MAX_USD on the server, which enforces it

const label = (t: Token) => (t.symbol === "wNEAR" ? "NEAR (wNEAR)" : t.blockchain === "near" ? t.symbol : `${t.symbol} (${t.blockchain})`);

function TokenSelect({ text, value, onChange, tokens }: { text: string; value: string; onChange: (v: string) => void; tokens: Token[] }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs text-faint">{text}</span>
      <span className="relative block">
        <select value={value} onChange={(e) => onChange(e.target.value)} className={`${fieldClass} appearance-none border-line-strong pr-9`}>
          {tokens.map((t) => (
            <option key={t.assetId} value={t.assetId}>
              {label(t)}
            </option>
          ))}
        </select>
        <ChevronDown size={16} strokeWidth={1.5} className="pointer-events-none absolute top-3.5 right-3 text-faint" aria-hidden />
      </span>
    </label>
  );
}

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
    <div className="rise pt-8">
      <h1 className="font-serif text-4xl leading-tight tracking-[-0.02em] sm:text-5xl">Trade</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted">
        Get a confidential quote from the NEAR Intents 1Click API. Dry run is on by default: nothing executes and no funds move.
      </p>

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,27rem)_minmax(0,1fr)]">
        <Card danger={!dry} className="space-y-4 p-5">
          {!tokens && !error && <Spinner label="Loading tokens" />}
          {tokens && (
            <>
              <div className="grid grid-cols-[minmax(0,1fr)_7.5rem] gap-3">
                <TokenSelect text="From" value={origin} onChange={setOrigin} tokens={origins} />
                <label className="block space-y-1.5">
                  <span className="text-xs text-faint">Amount</span>
                  <input
                    value={amount}
                    onChange={(e) => setAmount(e.target.value.trim())}
                    inputMode="decimal"
                    aria-label="Amount"
                    className={`num ${fieldClass} text-right ${amountOk ? "border-line-strong" : "border-down"}`}
                  />
                </label>
              </div>
              <div className="flex items-center gap-3 text-faint">
                <span className="h-px flex-1 bg-line" />
                <ArrowDown size={16} strokeWidth={1.5} aria-hidden />
                <span className="h-px flex-1 bg-line" />
              </div>
              <TokenSelect text="To" value={dest} onChange={setDest} tokens={dests} />
              {tokenSource === "seed" && <p className="text-xs text-faint">Token list from cache: the 1Click token API is not reachable right now.</p>}
              {!dry && (
                <p className={`text-xs ${overCap ? "text-down" : "text-muted"}`}>
                  Real mode: NEAR tokens only, max ${REAL_CAP_USD} per trade (this one ≈ {usd(estimateUsd)}). Paid from{" "}
                  <span className="num">{session?.payer ?? "your mainnet wallet"}</span>.
                </p>
              )}

              <div className="flex items-center justify-between gap-4 rounded-xl border border-line bg-ink-850 px-4 py-3">
                <div>
                  <div className="text-sm font-medium">Dry run {dry ? "ON" : "OFF"}</div>
                  <div className={`text-xs ${dry ? "text-muted" : "text-down"}`}>
                    {dry ? "Quote only. No deposit address, nothing executes." : "REAL trade on NEAR Intents mainnet."}
                  </div>
                </div>
                <button
                  role="switch"
                  aria-checked={dry}
                  aria-label="Dry run"
                  onClick={toggleDry}
                  className={`relative h-6 w-11 shrink-0 rounded-full transition-colors duration-150 ${dry ? "bg-green-deep" : "bg-down"}`}
                >
                  <span className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform duration-150 ${dry ? "translate-x-5" : ""}`} />
                </button>
              </div>

              <Button variant="primary" size="lg" className="w-full" onClick={() => void getQuote()} disabled={busy || !amountOk || !origin || !dest || overCap}>
                {busy && !quote ? "Requesting quote…" : "Get confidential quote"}
              </Button>
            </>
          )}
          {error && <ErrorNote>{error}</ErrorNote>}
        </Card>

        <div className="min-w-0 space-y-4">
          {!quote && (
            <Card className="p-5">
              <h2 className="font-medium">No quote yet</h2>
              <p className="mt-1 text-sm text-muted">Quotes from the NEAR Intents 1Click API appear here.</p>
            </Card>
          )}
          {quote && <QuoteCard q={quote} />}
          {quote && !quote.dry && quote.quote.depositAddress && <RealDeposit q={quote} />}

          {quote && quote.dry && !filled && (
            <Card className="flex flex-wrap items-center justify-between gap-3 p-5">
              <p className="min-w-0 flex-1 basis-56 text-sm text-muted">Record this dry quote as a SIMULATED trade in your own trader profile.</p>
              <Button onClick={() => void simulate()} disabled={busy}>
                <FlaskConical size={16} strokeWidth={1.5} aria-hidden /> Simulate fill
              </Button>
            </Card>
          )}
          {filled && session && (
            <Card className="flex flex-wrap items-center justify-between gap-3 p-5 text-sm">
              <span className="flex items-center gap-2">
                Trade #{filled.seq} recorded <SimulatedBadge />
              </span>
              <Link className="text-green hover:underline" to={`/trader/${encodeURIComponent(session.account)}`}>
                View in your trader profile →
              </Link>
            </Card>
          )}
        </div>
      </div>

      {askReal && <RealModeDialog onClose={() => setAskReal(false)} onConfirm={() => (setDry(false), setAskReal(false))} />}
    </div>
  );
}

function QuoteRow({ term, title, children }: { term: string; title?: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-6 border-t border-line py-2.5">
      <dt className="shrink-0 text-sm text-muted">{term}</dt>
      <dd className="min-w-0 truncate text-right" title={title}>
        {children}
      </dd>
    </div>
  );
}

function QuoteCard({ q }: { q: QuoteResult }) {
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-medium">{q.dry ? "Dry quote" : "Quote"} from the NEAR Intents 1Click API</h2>
        {q.confidential ? (
          <ConfidentialBadge level={q.confidentiality} />
        ) : (
          <span className="num inline-flex items-center gap-1 rounded border border-down/40 px-1.5 py-0.5 text-[11px] leading-4 text-down">
            <ShieldAlert size={12} strokeWidth={1.5} aria-hidden /> PUBLIC (not confidential)
          </span>
        )}
      </div>
      {q.notice && (
        <p className="mt-3 flex gap-2 rounded-lg border border-line-strong bg-ink-850 px-3 py-2 text-xs text-muted">
          <Info size={14} strokeWidth={1.5} className="mt-0.5 shrink-0" aria-hidden /> {q.notice}
        </p>
      )}
      {q.routing?.privacyWarning && (
        <p role="alert" className="mt-3 flex gap-2 rounded-lg border border-down/60 bg-ink-850 px-3 py-2 text-xs text-fg">
          <ShieldAlert size={14} strokeWidth={1.5} className="mt-0.5 shrink-0 text-down" aria-hidden /> Privacy warning: {q.routing.privacyWarning}
        </p>
      )}
      <div className="mt-5">
        <div className="text-xs text-faint">You receive</div>
        <div className="num mt-1 text-4xl leading-none">
          {qty(q.quote.amountOutFormatted)} <span className="text-lg text-muted">{q.destination.symbol}</span>
        </div>
        <div className="num mt-1 text-sm text-muted">{usd(q.quote.amountOutUsd)}</div>
      </div>
      <dl className="mt-5">
        <QuoteRow term="You send">
          <span className="num text-sm">
            {qty(q.quote.amountInFormatted)} {q.origin.symbol} <span className="text-muted">({usd(q.quote.amountInUsd)})</span>
          </span>
        </QuoteRow>
        <QuoteRow term="Estimated time">
          <span className="num text-sm">{q.quote.timeEstimate}s</span>
        </QuoteRow>
        <QuoteRow term="Quote signature">
          {q.signature.valid ? (
            <span className="inline-flex items-center gap-1 text-sm text-up">
              <BadgeCheck size={16} strokeWidth={1.5} aria-hidden /> signed by 1Click
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-sm text-down">
              <CircleX size={16} strokeWidth={1.5} aria-hidden /> invalid
            </span>
          )}
        </QuoteRow>
        <QuoteRow term="Correlation id" title={q.correlationId}>
          <span className="num text-xs text-muted">{shortHash(q.correlationId, 8)}</span>
        </QuoteRow>
        {!q.dry && q.routing && (
          <QuoteRow term="Output goes to" title={q.routing.recipient}>
            <span className="num text-xs">
              {q.routing.recipientType === "CONFIDENTIAL_INTENTS" ? `Confidential Intents balance of ${q.routing.recipient}` : q.routing.recipient}
            </span>
          </QuoteRow>
        )}
        {q.quote.depositAddress && (
          <QuoteRow term="Deposit address" title={q.quote.depositAddress}>
            <span className="num text-xs">{q.quote.depositAddress}</span>
          </QuoteRow>
        )}
      </dl>
      {q.dry && <p className="border-t border-line pt-3 text-xs text-faint">Dry run: no deposit address was created and no funds move.</p>}
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
    <Dialog labelledBy="real-title" onClose={onClose} danger>
      <h2 id="real-title" className="flex items-center gap-2 font-serif text-2xl leading-tight">
        <ShieldAlert size={18} strokeWidth={1.5} className="shrink-0 text-down" aria-hidden /> Turn off dry run?
      </h2>
      <p className="mt-2 text-sm leading-6 text-muted">
        Real mode sends real tokens on NEAR Intents mainnet (there is no testnet for Intents). Trades are capped at ${REAL_CAP_USD}. The quote
        returns a deposit address; your mainnet wallet sends the tokens and the trade is logged when 1Click reports SUCCESS. The output
        stays in your Confidential Intents balance; it is not sent back to your wallet on-chain.
      </p>
      {linked ? (
        <p className="mt-3 text-sm">
          Mainnet wallet <span className="num text-fg">{session!.payer}</span> → trader <span className="num text-fg">{session!.account}</span>
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          <p className="text-sm text-muted">Real mode is operator-only: connect the mainnet wallet linked to the real trader on this server.</p>
          <Button onClick={() => void connect()} disabled={connecting}>
            <Wallet size={16} strokeWidth={1.5} aria-hidden /> {connecting ? "Connecting…" : "Connect mainnet wallet"}
          </Button>
        </div>
      )}
      {error && <p className="mt-2 text-sm text-down">{error}</p>}
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Keep dry run
        </Button>
        <Button variant="danger" onClick={onConfirm} disabled={!linked}>
          I understand, use real mode
        </Button>
      </div>
    </Dialog>
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
    <Card danger className="space-y-3 p-5">
      <h2 className="font-medium">Real trade on NEAR Intents mainnet</h2>
      {!txHash && (
        <Button variant="danger" size="lg" className="w-full" onClick={() => setConfirming(true)} disabled={busy}>
          <Send size={16} strokeWidth={1.5} aria-hidden /> {busy ? "Waiting for wallet…" : `Send ${qty(q.quote.amountInFormatted)} ${q.origin.symbol} with wallet`}
        </Button>
      )}
      {txHash && (
        <ol className="space-y-1 text-sm">
          {["KNOWN_DEPOSIT_TX", "PROCESSING", "SUCCESS"].map((s) => {
            const order = ["PENDING_DEPOSIT", "KNOWN_DEPOSIT_TX", "PROCESSING", "SUCCESS"];
            const done = order.indexOf(status) >= order.indexOf(s);
            return (
              <li key={s} className={`flex items-center gap-2 ${done ? "text-fg" : "text-faint"}`}>
                <CircleCheck size={16} strokeWidth={1.5} className={done ? "text-up" : "text-faint"} aria-hidden /> <span className="num">{s}</span>
              </li>
            );
          })}
          {["REFUNDED", "FAILED"].includes(status) && (
            <li className="flex items-center gap-2 text-down">
              <CircleX size={16} strokeWidth={1.5} aria-hidden /> <span className="num">{status}</span>: 1Click returns the deposit to {session?.payer}.
            </li>
          )}
          {status === "INCOMPLETE_DEPOSIT" && (
            <li className="flex items-center gap-2 text-down">
              <CircleX size={16} strokeWidth={1.5} aria-hidden /> <span className="num">{status}</span>: 1Click received less than this quote needs. Waiting
              for its final status.
            </li>
          )}
          <li className="text-xs text-muted">
            deposit tx{" "}
            <a className="num text-green hover:underline" href={explorerTxUrl("mainnet", txHash)} target="_blank" rel="noreferrer">
              {shortHash(txHash, 8)}
            </a>
          </li>
        </ol>
      )}
      {trade?.status === "SUCCESS" && session && (
        <p className="text-sm">
          Logged as trade #{trade.seq} {trade.oneClickSigned && "· 1Click-signed ✓"} ·{" "}
          <Link className="text-green hover:underline" to={`/trader/${encodeURIComponent(session.account)}`}>
            View in your trader profile →
          </Link>
        </p>
      )}
      {error && <ErrorNote>{error}</ErrorNote>}

      {confirming && (
        <Dialog labelledBy="send-title" onClose={() => setConfirming(false)} danger>
          <h2 id="send-title" className="font-serif text-2xl leading-tight">
            Send real funds?
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted">
            Your wallet <span className="num text-fg">{session?.payer}</span> sends{" "}
            <span className="num text-fg">
              {qty(q.quote.amountInFormatted)} {q.origin.symbol} ({usd(q.quote.amountInUsd)})
            </span>{" "}
            to the 1Click deposit address <span className="num break-all text-fg">{q.quote.depositAddress}</span> on NEAR mainnet, for about{" "}
            <span className="num text-fg">
              {qty(q.quote.amountOutFormatted)} {q.destination.symbol}
            </span>
            {q.routing?.recipientType === "CONFIDENTIAL_INTENTS" && ", kept in your Confidential Intents balance (not sent back to your wallet on-chain)"}.
            Your wallet will show the exact transaction to approve.
          </p>
          {q.routing?.privacyWarning && <p className="mt-2 text-sm text-down">Privacy warning: {q.routing.privacyWarning}</p>}
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => void send()}>
              Send with wallet
            </Button>
          </div>
        </Dialog>
      )}
    </Card>
  );
}
