import { chainHashes, checkLogShape, type LogEntry } from "@clavis/shared";
import { CircleCheck, CircleMinus, CircleX, ExternalLink, FlaskConical, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, type TraderLog } from "../lib/api";
import { shortHash } from "../lib/format";
import { explorerAccountUrl, explorerTxUrl, getCommitment, type Network } from "../lib/near";
import { Button } from "./ui";

type State = "ok" | "fail" | "skip";
type Step = { state: State; title: string; detail?: React.ReactNode };
type Result = { steps: Step[]; verdict: "green" | "red" | "neutral" };

/**
 * Browser-side verification (AGENT.md 11.3). Everything here runs in the visitor's browser:
 * the hash chain is recomputed with Web Crypto and the on-chain commitment is read straight from a
 * NEAR RPC node, so the result does not depend on trusting the Clavis server.
 */
async function verify(log: TraderLog, entries: LogEntry[], network: Network): Promise<Result> {
  const steps: Step[] = [];
  const n = entries.length;
  steps.push({ state: "ok", title: `Downloaded ${n} log entries.` });

  // 2. recompute the chain locally
  const shape = checkLogShape(log.traderId, entries);
  const hashes = await chainHashes(log.traderId, entries);
  const head = hashes[n]!;
  if (shape.length > 0) {
    steps.push({ state: "fail", title: "The log is malformed.", detail: shape.map((p) => `entry ${p.index + 1}: ${p.message}`).join("; ") });
  } else {
    steps.push({
      state: "ok",
      title: "Recomputed hash chain in your browser",
      detail: (
        <>
          head = <span className="num text-fg">{shortHash(head, 10)}</span>
        </>
      ),
    });
  }

  // 3. compare with the commitment stored in the NEAR contract
  if (!log.contractId) {
    steps.push({ state: "skip", title: "On-chain check skipped (no contract configured)." });
  } else {
    try {
      const c = await getCommitment(network, log.contractId, log.traderId);
      if (!c) {
        steps.push({
          state: "skip",
          title: "On-chain check skipped: this trader has no record in the contract yet.",
          detail: <>Its log has not been committed to {log.contractId}.</>,
        });
      } else {
        const count = Number(c.trade_count);
        const contractLink = (
          <a className="inline-flex items-center gap-1 text-brass hover:underline" href={explorerAccountUrl(network, log.contractId)} target="_blank" rel="noreferrer">
            {log.contractId} <ExternalLink size={11} aria-hidden />
          </a>
        );
        if (count > n) {
          steps.push({
            state: "fail",
            title: `Mismatch: the contract has ${count} committed trades, but the log has only ${n}.`,
            detail: "Committed entries are missing from the log.",
          });
        } else if (hashes[count] !== c.head_hash) {
          steps.push({
            state: "fail",
            title: `Mismatch: the hash of the first ${count} entries does not match the head committed on-chain.`,
            detail: (
              <>
                browser <span className="num">{shortHash(hashes[count], 10)}</span> vs contract{" "}
                <span className="num">{shortHash(c.head_hash, 10)}</span> ({contractLink}). The log was changed after it was committed.
              </>
            ),
          });
        } else if (count === 0) {
          steps.push({ state: "skip", title: "No trades committed on-chain yet.", detail: <>The contract holds only the starting hash ({contractLink}).</> });
        } else {
          steps.push({
            state: "ok",
            title: `On-chain commitment matches (contract get_commitment)`,
            detail: (
              <>
                trade_count = <span className="num text-fg">{count}</span>, head = <span className="num text-fg">{shortHash(c.head_hash, 10)}</span> → match.{" "}
                {count < n && <>The {n - count} newest entries are not committed yet. </>}
                {contractLink}
                {log.committed?.tx && (
                  <>
                    {" · "}
                    <a className="inline-flex items-center gap-1 text-brass hover:underline" href={explorerTxUrl(network, log.committed.tx)} target="_blank" rel="noreferrer">
                      commit transaction <ExternalLink size={11} aria-hidden />
                    </a>
                  </>
                )}
              </>
            ),
          });
        }
      }
    } catch (e) {
      steps.push({ state: "skip", title: "On-chain check skipped: could not reach the NEAR RPC.", detail: (e as Error).message });
    }
  }

  // 4. 1Click signatures for real trades
  const real = entries.filter((e) => e.confidentiality !== "simulated");
  if (real.length === 0) {
    steps.push({ state: "skip", title: "No real trades in this log, so there are no 1Click signatures to check." });
  } else {
    const flags = real.map((e) => log.signatureValid[String(e.seq)]);
    const valid = flags.filter((f) => f === true).length;
    steps.push({
      state: valid === real.length ? "ok" : "fail",
      title: `1Click quote signature valid for ${valid} of ${real.length} real trades (server-verified).`,
    });
  }

  // 5. simulated entries
  const sim = n - real.length;
  steps.push({ state: "skip", title: `${sim} of ${n} entries are SIMULATED.` });

  const failed = steps.some((s) => s.state === "fail");
  const onChainOk = steps[2]?.state === "ok";
  return { steps, verdict: failed ? "red" : onChainOk ? "green" : "neutral" };
}

export function VerifyPanel({ traderId, network }: { traderId: string; network: Network }) {
  const [log, setLog] = useState<TraderLog | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [tampered, setTampered] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = useCallback(
    async (opts: { tamper?: boolean; reverify?: boolean } = {}) => {
      setBusy(true);
      setError(null);
      try {
        const l = await api.log(traderId);
        if (opts.reverify) l.signatureValid = (await api.reverify(traderId)).results;
        let entries = l.entries;
        if (opts.tamper && entries.length > 0) {
          // Test only: change one amount in the downloaded copy, as an edited log would.
          const i = Math.floor(entries.length / 2);
          entries = entries.map((e, k) => (k === i ? { ...e, amountOut: (BigInt(e.amountOut) + 1n).toString() } : e));
        }
        setLog(l);
        setTampered(Boolean(opts.tamper));
        setResult(await verify(l, entries, network));
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [traderId, network],
  );

  useEffect(() => {
    void run();
  }, [run]);

  const frame =
    result?.verdict === "green"
      ? "border-up/50 bg-up/5"
      : result?.verdict === "red"
        ? "border-down/60 bg-down/5"
        : "border-line-strong bg-ink-900";

  return (
    <section aria-live="polite" className={`rounded-lg border p-4 ${frame}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">
          {busy && !result
            ? "Verifying…"
            : result?.verdict === "green"
              ? "Verified: this log matches its on-chain commitment"
              : result?.verdict === "red"
                ? "Verification failed"
                : "Log verified locally"}
          {tampered && <span className="ml-2 text-xs text-down">(tamper test)</span>}
        </h3>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => void run({ reverify: true })} disabled={busy} title="Ask the server to re-check every 1Click signature">
            <RefreshCw size={13} aria-hidden /> Re-verify
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void run({ tamper: !tampered })} disabled={busy} title="Edit one entry in your downloaded copy and verify again">
            <FlaskConical size={13} aria-hidden /> {tampered ? "Undo tamper test" : "Tamper test"}
          </Button>
        </div>
      </div>
      {error && <p className="mt-2 text-sm text-down">{error}</p>}
      {result && (
        <ol className="mt-3 space-y-2">
          {result.steps.map((s, i) => (
            <li key={i} className="flex gap-2 text-sm">
              {s.state === "ok" ? (
                <CircleCheck size={16} className="mt-0.5 shrink-0 text-up" aria-label="passed" />
              ) : s.state === "fail" ? (
                <CircleX size={16} className="mt-0.5 shrink-0 text-down" aria-label="failed" />
              ) : (
                <CircleMinus size={16} className="mt-0.5 shrink-0 text-faint" aria-label="not applicable" />
              )}
              <div className="min-w-0">
                <div>{s.title}</div>
                {s.detail && <div className="mt-0.5 break-words text-xs text-muted">{s.detail}</div>}
              </div>
            </li>
          ))}
        </ol>
      )}
      {log && result?.verdict !== "red" && (
        <p className="mt-3 text-xs text-faint">
          Hashing ran in your browser (Web Crypto). The commitment was read directly from NEAR {network} RPC, not from the Clavis server.
        </p>
      )}
    </section>
  );
}
