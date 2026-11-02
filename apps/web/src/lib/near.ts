// NEAR access from the browser.
// - View calls go straight to a public NEAR RPC, NOT through the Clavis server, so the Verify panel
//   does not have to trust our backend for the on-chain commitment.
// - Wallet: @hot-labs/near-connect (the connector docs.near.org recommends), loaded lazily so judges
//   without a wallet never load wallet code.
import type { NearConnector, NearWalletBase } from "@hot-labs/near-connect";

export type Network = "testnet" | "mainnet";

const RPC: Record<Network, string> = {
  // docs.near.org/api/rpc/providers (FASTNEAR public endpoints)
  testnet: import.meta.env.VITE_NEAR_RPC_URL || "https://test.rpc.fastnear.com",
  mainnet: "https://rpc.mainnet.fastnear.com",
};

/** Opens the transaction itself (explorer.near.org only shows an explorer chooser, AUDIT L5). */
export const explorerTxUrl = (network: Network, tx: string) => `https://nearvalidate.org/txns/${tx}?network=${network}`;
/** The chooser lists explorers for the account (nearvalidate's testnet account page shows no data). */
export const explorerAccountUrl = (network: Network, account: string) =>
  network === "testnet"
    ? `https://explorer.testnet.near.org/accounts/${account}`
    : `https://explorer.near.org/accounts/${account}`;

/** Read-only contract call over JSON-RPC (query / call_function). */
export async function viewCall<T>(network: Network, contractId: string, method: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch(RPC[network], {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "clavis",
      method: "query",
      params: {
        request_type: "call_function",
        finality: "final",
        account_id: contractId,
        method_name: method,
        args_base64: btoa(JSON.stringify(args)),
      },
    }),
  });
  const body = (await res.json()) as { result?: { result?: number[] }; error?: { cause?: { name?: string }; message?: string } };
  if (!res.ok || body.error || !body.result?.result) {
    throw new Error(`RPC ${method}: ${body.error?.cause?.name ?? body.error?.message ?? res.status}`);
  }
  return JSON.parse(new TextDecoder().decode(new Uint8Array(body.result.result))) as T;
}

export type Commitment = { trade_count: string; head_hash: string; last_commit_at: string };

export const getCommitment = (network: Network, contractId: string, traderId: string) =>
  viewCall<Commitment | null>(network, contractId, "get_commitment", { trader_id: traderId });

export const getAccess = (network: Network, contractId: string, traderId: string, accountId: string) =>
  viewCall<string | null>(network, contractId, "get_access", { trader_id: traderId, account_id: accountId });

// ----------------------------------------------------------------------------- wallet

// One connector per network: testnet for keys/login, mainnet for real-mode deposits.
const connectors = new Map<Network, Promise<NearConnector>>();

export function getConnector(network: Network): Promise<NearConnector> {
  let c = connectors.get(network);
  if (!c) {
    c = import("@hot-labs/near-connect").then(
      ({ NearConnector }) => new NearConnector({ network, features: { signMessage: true, signAndSendTransaction: true } }),
    );
    connectors.set(network, c);
  }
  return c;
}

export async function connectWallet(network: Network): Promise<{ wallet: NearWalletBase; accountId: string }> {
  const connector = await getConnector(network);
  const wallet = await connector.connect();
  const accounts = await wallet.getAccounts();
  const accountId = accounts[0]?.accountId;
  if (!accountId) throw new Error("The wallet returned no account.");
  return { wallet, accountId };
}

export async function disconnectWallet(network: Network): Promise<void> {
  const connector = await getConnector(network);
  try {
    await connector.disconnect();
  } catch {
    /* not connected */
  }
}

const base64ToBytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

/** Sign the server's NEP-413 challenge. Returns what POST /api/auth/nep413 expects. */
export async function signChallenge(
  wallet: NearWalletBase,
  challenge: { nonce: string; message: string; recipient: string },
): Promise<{ accountId: string; publicKey: string; signature: string; nonce: string }> {
  const signed = await wallet.signMessage({
    message: challenge.message,
    recipient: challenge.recipient,
    nonce: base64ToBytes(challenge.nonce),
  });
  return { accountId: signed.accountId, publicKey: signed.publicKey, signature: signed.signature, nonce: challenge.nonce };
}

/** yoctoNEAR string from a decimal NEAR string (no floats). */
export function nearToYocto(near: string): string {
  const [whole = "0", frac = ""] = near.split(".");
  return (BigInt(whole) * 10n ** 24n + BigInt(frac.padEnd(24, "0").slice(0, 24) || "0")).toString();
}

/** Contract buy_key: attaches price + a storage buffer; the contract refunds whatever is unused. */
export async function buyKeyOnChain(wallet: NearWalletBase, contractId: string, traderId: string, priceYocto: string) {
  const deposit = (BigInt(priceYocto) + BigInt(nearToYocto("0.01"))).toString();
  return wallet.signAndSendTransaction({
    receiverId: contractId,
    actions: [
      {
        type: "FunctionCall",
        params: { methodName: "buy_key", args: { trader_id: traderId }, gas: "30000000000000", deposit },
      },
    ],
  });
}

// ----------------------------------------------------------------------------- real-mode deposit

/** NEP-145 storage_balance_bounds of a token contract (yoctoNEAR strings). */
export const storageBounds = (network: Network, tokenContract: string) =>
  viewCall<{ min: string; max: string | null }>(network, tokenContract, "storage_balance_bounds", {});

/** "nep141:wrap.near" -> "wrap.near" */
export const tokenContractOf = (assetId: string) => {
  if (!assetId.startsWith("nep141:")) throw new Error(`Not a NEAR NEP-141 asset: ${assetId}`);
  return assetId.slice("nep141:".length);
};

/**
 * Send the 1Click deposit in ONE wallet transaction to the origin token contract:
 *   1. storage_deposit for the deposit address (registration_only: refunded if already registered),
 *   2. near_deposit (wrap native NEAR) when the origin is wNEAR,
 *   3. ft_transfer of exactly amountIn to the deposit address (1 yoctoNEAR attached).
 * Returns the transaction hash.
 */
export async function sendDeposit(
  wallet: NearWalletBase,
  network: Network,
  q: { originAsset: string; amountIn: string; depositAddress: string },
): Promise<string | null> {
  const contract = tokenContractOf(q.originAsset);
  const bounds = await storageBounds(network, contract);
  const actions: Parameters<NearWalletBase["signAndSendTransaction"]>[0]["actions"] = [
    {
      type: "FunctionCall",
      params: { methodName: "storage_deposit", args: { account_id: q.depositAddress, registration_only: true }, gas: "30000000000000", deposit: bounds.min },
    },
  ];
  if (contract === "wrap.near") {
    actions.push({ type: "FunctionCall", params: { methodName: "near_deposit", args: {}, gas: "10000000000000", deposit: q.amountIn } });
  }
  actions.push({
    type: "FunctionCall",
    params: { methodName: "ft_transfer", args: { receiver_id: q.depositAddress, amount: q.amountIn }, gas: "30000000000000", deposit: "1" },
  });
  const outcome = await wallet.signAndSendTransaction({ receiverId: contract, actions });
  return (outcome as { transaction?: { hash?: string } } | undefined)?.transaction?.hash ?? null;
}

