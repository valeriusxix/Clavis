import { EyeOff, Fingerprint, KeyRound, Link2, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { Card } from "../components/ui";
import { useSession } from "../lib/session";

function Step({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 shrink-0 text-brass">{icon}</span>
      <div>
        <h3 className="font-medium">{title}</h3>
        <p className="mt-1 text-sm text-muted">{children}</p>
      </div>
    </li>
  );
}

export function HowItWorks() {
  const { meta } = useSession();
  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">How it works</h1>
        <p className="mt-2 text-muted">
          On-chain trading is public, so good traders either get copied or cannot prove they are good. Clavis splits a trader's record
          into what everyone sees (verified PnL) and what key holders see (every trade).
        </p>
      </div>

      <ol className="space-y-5">
        <Step icon={<EyeOff size={18} />} title="Trade privately">
          Traders request a quote from the NEAR Intents 1Click API with confidentiality "basic". The swap runs through Confidential
          Intents: the chain sees that the trader deposited some amount of token A into 1Click, but not what it was swapped into or
          where it went, as long as the output is not sent back to the same public account.
        </Step>
        <Step icon={<Fingerprint size={18} />} title="Record and prove">
          Clavis stores each trade with 1Click's signed quote, so its prices and amounts cannot be made up. PnL is computed from what was actually
          received, so fees are included.
        </Step>
        <Step icon={<Link2 size={18} />} title="Commit">
          Each trader's log is a hash chain: h0 = sha256("clavis:v1:" + trader), then each entry's hash includes the previous one. The latest
          hash is written to the Clavis contract on NEAR{meta?.contractId ? ` (${meta.contractId})` : ""}, and every earlier hash stays in the
          contract's events, so history can't be rewritten after keys are sold without it showing.
        </Step>
        <Step icon={<KeyRound size={18} />} title="Sell access">
          Followers buy a key with buy_key on the contract. The server only serves a trader's feed to accounts the contract says have
          access.
        </Step>
        <Step icon={<ShieldCheck size={18} />} title="Verify">
          Key holders click Verify log. Their browser downloads the log, recomputes the hash chain with Web Crypto, and compares it with the
          head stored in the contract, read directly from a NEAR RPC node.
        </Step>
      </ol>

      <Card className="p-5">
        <h2 className="font-medium">How PnL is calculated</h2>
        <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-muted">
          <li>Every trade sells asset X and receives asset Y, with USD values recorded at execution.</li>
          <li>Selling X: realized PnL += what you received (USD) − what X cost you (average cost basis).</li>
          <li>Buying Y: Y's holdings and cost basis go up by what you received.</li>
          <li>Unrealized PnL = current value of holdings − their cost basis. Stablecoins count at $1.</li>
          <li>PnL % = total PnL ÷ peak capital deployed. Win rate = profitable sells ÷ all sells.</li>
        </ul>
      </Card>

      <Card className="p-5">
        <h2 className="font-medium">Trust model (honest version)</h2>
        <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-muted">
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

      {meta?.demoMode && (
        <p className="text-xs text-faint">
          Demo mode: the seeded traders and their trades are SIMULATED. Key purchases with the demo account are simulated in the server
          database.
        </p>
      )}
    </div>
  );
}
