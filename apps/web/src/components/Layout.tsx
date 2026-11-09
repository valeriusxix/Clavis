import { LogOut, Wallet } from "lucide-react";
import { useState } from "react";
import { NavLink, Outlet } from "react-router";
import { explorerAccountUrl } from "../lib/near";
import { useSession } from "../lib/session";
import DotGrid from "./DotGrid";
import { Button } from "./ui";

const NAV = [
  { to: "/", label: "Leaderboard", end: true },
  { to: "/trade", label: "Trade" },
  { to: "/keys", label: "My Keys" },
  { to: "/how-it-works", label: "How it works" },
];

export function Layout() {
  const { meta, metaError, network, session, loginWallet, logout, resetDemo } = useSession();
  const [connecting, setConnecting] = useState(false);
  const [walletError, setWalletError] = useState<string | null>(null);

  const connect = async () => {
    setConnecting(true);
    setWalletError(null);
    try {
      await loginWallet();
    } catch (e) {
      setWalletError((e as Error).message);
    } finally {
      setConnecting(false);
    }
  };

  return (
    <div className="flex min-h-dvh flex-col">
      {/* Fixed to the viewport so the canvas stays screen-sized on long pages. Colors must be hex. */}
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10">
        <DotGrid baseColor="#1f6b45" activeColor="#6cf2a8" />
        {/* Dims the dots behind the content column so text on the page stays readable. */}
        <div className="absolute inset-y-0 left-1/2 w-full max-w-[84rem] -translate-x-1/2 bg-[linear-gradient(90deg,transparent,var(--color-ink-950)_6%,var(--color-ink-950)_94%,transparent)] opacity-75" />
      </div>

      <header className="sticky top-0 z-20 border-b border-line bg-ink-950">
        <div className="page flex flex-wrap items-center gap-x-8">
          <NavLink to="/" className="flex h-16 items-center gap-2 font-serif text-2xl leading-none">
            <img src="/logo.png" alt="" aria-hidden width={28} height={28} className="size-7" />
            Clavis
          </NavLink>

          <nav aria-label="Main" className="order-last flex w-full gap-5 overflow-x-auto text-sm md:order-none md:w-auto md:gap-6">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) =>
                  `flex h-11 items-center whitespace-nowrap transition-colors md:h-16 ${isActive ? "text-fg shadow-[inset_0_-2px_0_var(--color-green)]" : "text-muted hover:text-fg"}`
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex h-16 items-center gap-3">
            {session ? (
              <>
                <span className="num hidden max-w-[16rem] truncate text-xs text-muted lg:inline" title={session.account}>
                  {session.kind === "demo" ? `${session.account} (demo)` : session.account}
                </span>
                {session.kind === "demo" && (
                  <button
                    className="text-sm text-muted transition-colors hover:text-fg"
                    title="Delete your demo keys and simulated trades and start a fresh demo account"
                    onClick={() => void resetDemo().then(() => window.location.reload())}
                  >
                    Reset demo
                  </button>
                )}
                <Button size="sm" variant="ghost" className="w-9 px-0!" onClick={() => void logout()} aria-label="Log out">
                  <LogOut size={16} strokeWidth={1.5} aria-hidden />
                </Button>
              </>
            ) : (
              <Button size="sm" onClick={() => void connect()} disabled={connecting}>
                <Wallet size={16} strokeWidth={1.5} aria-hidden />
                {connecting ? "Connecting…" : "Connect wallet"}
              </Button>
            )}
          </div>
        </div>
      </header>

      {metaError && <div className="page mt-4 text-sm text-down">Cannot reach the Clavis API ({metaError}). Is the server running on port 8787?</div>}
      {walletError && <div className="page mt-4 text-sm text-down">Wallet: {walletError}</div>}

      <main className="page flex-1 pb-16">
        <Outlet />
      </main>

      <footer className="border-t border-line bg-ink-950">
        <div className="page flex flex-wrap gap-x-6 gap-y-1 py-5 text-xs text-faint">
          <span>Trades execute on NEAR Intents mainnet. Key sales and commitments run on NEAR {meta?.network ?? "testnet"}.</span>
          {meta?.contractId && (
            <a className="num transition-colors hover:text-fg" href={explorerAccountUrl(network, meta.contractId)} target="_blank" rel="noreferrer">
              contract {meta.contractId}
            </a>
          )}
        </div>
      </footer>
    </div>
  );
}
