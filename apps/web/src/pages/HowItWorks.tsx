import { useEffect, useState, type ReactNode } from "react";
import { CutKey } from "../components/Key";
import { Card } from "../components/ui";
import { api } from "../lib/api";
import { useSession } from "../lib/session";

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-3 border-b border-line p-5 last:border-0 sm:p-6">
      <span className="num pt-0.5 text-sm text-green">{n}</span>
      <div>
        <h2 className="font-medium">{title}</h2>
        <p className="mt-1 text-sm leading-6 text-muted">{children}</p>
      </div>
    </li>
  );
}

export function HowItWorks() {
  const { meta } = useSession();
  const [head, setHead] = useState<string | null>(null);

  useEffect(() => {
    api.traders().then((r) => setHead(r.traders[0]?.headHash ?? null), () => undefined);
  }, []);

  return (
    <div className="rise space-y-8 pt-8">
      <div className="grid items-start gap-x-10 gap-y-8 lg:grid-cols-[5fr_7fr]">
        <div className="lg:sticky lg:top-24">
          <h1 className="font-serif text-4xl leading-tight tracking-[-0.02em] sm:text-5xl">How it works</h1>
          <p className="mt-3 text-base leading-6 text-muted">
            On-chain trading is public, so good traders either get copied or cannot prove they are good. Clavis splits a trader's record
            into what everyone sees (verified PnL) and what key holders see (every trade).
          </p>
          <CutKey hash={head} className="mt-6 max-w-md -rotate-3" />
          <p className="mt-2 max-w-md text-xs leading-5 text-faint">
            Every key on this site is cut from a trader's latest log hash, one cut per digit of the short hash. Change one log entry and
            every later hash changes, so the key changes too.
          </p>
        </div>

        <Card>
          <ol>
            <Step n={1} title="Trade privately">
              Traders request a quote from the NEAR Intents 1Click API with confidentiality "basic". The swap runs through Confidential
              Intents: the chain sees that the trader deposited some amount of token A into 1Click, but not what it was swapped into or
              where it went, as long as the output is not sent back to the same public account.
            </Step>
            <Step n={2} title="Record and prove">
              Clavis stores each trade with 1Click's signed quote, so its prices and amounts cannot be made up. PnL is computed from what was actually
              received, so fees are included.
            </Step>
            <Step n={3} title="Commit">
              Each trader's log is a hash chain: <code className="num text-[13px] text-fg">h0 = sha256("clavis:v1:" + trader)</code>, then each entry's hash includes the previous one. The latest
              hash is written to the Clavis contract on NEAR{meta?.contractId ? ` (${meta.contractId})` : ""}, and every earlier hash stays in the
              contract's events, so history can't be rewritten after keys are sold without it showing.
            </Step>
            <Step n={4} title="Sell access">
              Followers buy a key with buy_key on the contract. The server only serves a trader's feed to accounts the contract says have
              access.
            </Step>
            <Step n={5} title="Verify">
              Key holders click Verify log. Their browser downloads the log, recomputes the hash chain with Web Crypto, and compares it with the
              head stored in the contract, read directly from a NEAR RPC node.
            </Step>
          </ol>
        </Card>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[5fr_7fr]">
        <Card className="p-5 sm:p-6">
          <h2 className="font-medium">How PnL is calculated</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-muted marker:text-faint">
            <li>Every trade sells asset X and receives asset Y, with USD values recorded at execution.</li>
            <li>Selling X: realized PnL += what you received (USD) − what X cost you (average cost basis).</li>
            <li>Buying Y: Y's holdings and cost basis go up by what you received.</li>
            <li>Unrealized PnL = current value of holdings − their cost basis. Stablecoins count at $1.</li>
            <li>
              PnL % = total PnL ÷ peak capital deployed. Win rate = profitable closes ÷ all closes, where a close is selling a non-stablecoin
              asset you bought earlier (buying with stablecoins is not a close).
            </li>
          </ul>
        </Card>

        <Card className="p-5 sm:p-6">
          <h2 className="font-medium">Trust model (honest version)</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-muted marker:text-faint">
            <li>The public sees PnL, win rate, trade count and the on-chain hash head. Not trades.</li>
            <li>
              The chain sees the hash commitments and that a trader deposited some amount of a token into 1Click. It does not see what the
              deposit was swapped into or where it went, unless the output is sent back to the same public account that paid.
            </li>
            <li>
              The Clavis server sees every trade placed through it, because it relays the quotes. Traders trust the Clavis operator with their
              trade details.
            </li>
            <li>
              Clavis cannot make up quote prices (1Click signatures) or silently rewrite committed history: the server only commits logs that
              extend the on-chain head, and earlier heads stay in the contract's events (Verify checks the latest one). A signature proves the
              quote, not that the swap was executed: execution status comes from the Clavis server. Only trades placed through Clavis count.
            </li>
            <li>
              A 1Click signature proves the assets, amounts and recipient of a quote. It does not cover the confidentiality setting, so
              "1Click-signed" does not by itself prove a swap was confidential.
            </li>
            <li>Roadmap: run the relay inside a TEE with remote attestation, then switch to native Confidential Intents view keys.</li>
          </ul>
        </Card>
      </div>

      {meta?.demoMode && (
        <p className="text-xs leading-5 text-faint">
          Demo mode: the seeded traders and their trades are SIMULATED. Each visitor gets their own demo account; its key purchases are
          simulated in the server database, and its keys and simulated trades are deleted after 24 hours.
        </p>
      )}
    </div>
  );
}
