import type { NearWalletBase } from "@hot-labs/near-connect";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, type Meta, type SessionInfo } from "./api";
import { connectWallet, disconnectWallet, signChallenge, type Network } from "./near";

type SessionCtx = {
  meta: Meta | null;
  metaError: string | null;
  session: SessionInfo;
  network: Network;
  wallet: NearWalletBase | null;
  /** Log in with this visitor's own demo account (demo mode only). */
  loginDemo: () => Promise<void>;
  /** Delete this visitor's demo keys and trades and start a fresh demo account. */
  resetDemo: () => Promise<void>;
  /** Connect a wallet and log in with a signed NEP-413 message. */
  loginWallet: () => Promise<NearWalletBase>;
  /** Real mode: connect the linked MAINNET wallet (sends deposits) and log in as its real trader. */
  loginMainnet: () => Promise<NearWalletBase>;
  mainnetWallet: NearWalletBase | null;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const Ctx = createContext<SessionCtx | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [session, setSession] = useState<SessionInfo>(null);
  const [wallet, setWallet] = useState<NearWalletBase | null>(null);
  const [mainnetWallet, setMainnetWallet] = useState<NearWalletBase | null>(null);
  const network: Network = (meta?.network ?? import.meta.env.VITE_NETWORK ?? "testnet") as Network;

  const refresh = useCallback(async () => {
    try {
      const [m, me] = await Promise.all([api.meta(), api.me()]);
      setMeta(m);
      setSession(me.session);
      setMetaError(null);
    } catch (e) {
      setMetaError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const loginDemo = useCallback(async () => {
    const r = await api.demoLogin();
    setSession({ account: r.account, kind: "demo" });
  }, []);

  const resetDemo = useCallback(async () => {
    const r = await api.demoReset();
    setSession({ account: r.account, kind: "demo" });
  }, []);

  const loginWallet = useCallback(async () => {
    const { wallet: w } = await connectWallet(network);
    const challenge = await api.challenge();
    const signed = await signChallenge(w, challenge);
    const r = await api.nep413Login(signed);
    setWallet(w);
    setSession({ account: r.account, kind: "wallet" });
    return w;
  }, [network]);

  const loginMainnet = useCallback(async () => {
    const { wallet: w } = await connectWallet("mainnet");
    const challenge = await api.challenge("mainnet");
    const signed = await signChallenge(w, challenge);
    const r = await api.nep413Login(signed);
    setMainnetWallet(w);
    setSession({ account: r.account, kind: "wallet", payer: r.payer });
    return w;
  }, []);

  const logout = useCallback(async () => {
    await api.logout();
    if (wallet) await disconnectWallet(network);
    if (mainnetWallet) await disconnectWallet("mainnet");
    setWallet(null);
    setMainnetWallet(null);
    setSession(null);
  }, [wallet, mainnetWallet, network]);

  const value = useMemo(
    () => ({ meta, metaError, session, network, wallet, mainnetWallet, loginDemo, resetDemo, loginWallet, loginMainnet, logout, refresh }),
    [meta, metaError, session, network, wallet, mainnetWallet, loginDemo, resetDemo, loginWallet, loginMainnet, logout, refresh],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSession outside SessionProvider");
  return v;
}
