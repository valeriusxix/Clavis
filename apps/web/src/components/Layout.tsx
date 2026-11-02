import { KeyRound, LogOut, Wallet } from "lucide-react";
import { useState } from "react";
import { NavLink, Outlet } from "react-router";
import { useSession } from "../lib/session";
import { Button } from "./ui";

const NAV = [
  { to: "/", label: "Leaderboard", end: true },
  { to: "/trade", label: "Trade" },
  { to: "/keys", label: "My Keys" },
  { to: "/how-it-works", label: "How it works" },
];

export function Layout() {
  const { meta, metaError, session, loginWallet, logout, resetDemo } = useSession();
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
      <header className="sticky top-0 z-20 border-b border-line bg-ink-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-4 py-3">
          <NavLink to="/" className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <KeyRound size={20} className="text-brass" aria-hidden />
            Clavis
          </NavLink>
          <div className="ml-auto flex items-center gap-2">
            {session ? (
              <>
                <span className="num hidden max-w-[14rem] truncate text-xs text-muted sm:inline" title={session.account}>
                  {session.kind === "demo" ? `${session.account} (demo)` : session.account}
                </span>
                {session.kind === "demo" && (
                  <button
                    className="text-xs text-muted underline-offset-2 hover:text-fg hover:underline"
                    title="Delete your demo keys and simulated trades and start a fresh demo account"
                    onClick={() => void resetDemo().then(() => window.location.reload())}
                  >
                    Reset demo
                  </button>
                )}
                <Button size="sm" variant="ghost" onClick={() => void logout()} aria-label="Log out">
                  <LogOut size={14} aria-hidden />
                </Button>
              </>
            ) : (
              <Button size="sm" onClick={() => void connect()} disabled={connecting}>
                <Wallet size={14} aria-hidden />
                {connecting ? "Connecting…" : "Connect wallet"}
              </Button>
            )}
          </div>
        </div>
        <nav className="mx-auto flex max-w-5xl gap-0.5 overflow-x-auto px-2 pb-2 text-sm sm:gap-1" aria-label="Main">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                `whitespace-nowrap rounded-md px-2.5 py-1.5 sm:px-3 ${isActive ? "bg-ink-800 text-fg" : "text-muted hover:text-fg"}`
              }
            >
              {n.label}
            </NavLink>
          ))}
        </nav>
      </header>

      {metaError && (
        <div className="mx-auto mt-4 w-full max-w-5xl px-4 text-sm text-down">
          Cannot reach the Clavis API ({metaError}). Is the server running on port 8787?
        </div>
      )}
      {walletError && <div className="mx-auto mt-4 w-full max-w-5xl px-4 text-sm text-down">Wallet: {walletError}</div>}

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
        <Outlet />
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-5xl flex-wrap gap-x-4 gap-y-1 px-4 py-4 text-xs text-faint">
          <span>Trades execute on NEAR Intents mainnet. Key sales and commitments run on NEAR {meta?.network ?? "testnet"}.</span>
          {meta?.contractId && <span className="num">contract {meta.contractId}</span>}
        </div>
      </footer>
    </div>
  );
}
