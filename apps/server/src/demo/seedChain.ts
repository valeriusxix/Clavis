// Planning and safety checks for `pnpm seed:chain` (scripts/seed-chain.ts). Pure: no network, no files.
import { toBaseUnits } from "../lib/units";
import { SEED_TRADERS, simTraderId, type SeedAccounts } from "./seed";

/** Storage of a new account with one full-access key, in bytes (NEAR: 100 for the account + 82 for the key). */
export const NEW_ACCOUNT_BYTES = 182n;
/** register_trader stores 298 bytes for the longest seeded name (measured); the contract refunds what it doesn't use. */
export const REGISTER_STORAGE_BYTES = 400n;
/** Gas attached to register_trader. */
export const REGISTER_GAS = 30_000_000_000_000n;
/** register_trader gas plus the transaction's own fees, which the sub-account pays. */
export const REGISTER_TX_GAS_BUDGET = 35_000_000_000_000n;
/**
 * A transaction must be able to pay its attached gas at the protocol's worst-case ("pessimistic") gas
 * price up front; the unused part is refunded after execution. On testnet (2026-11-04) the node asked
 * 0.0309 NEAR for 30 Tgas at a 1e8 gas price, i.e. about 10.3x, so budget 12x.
 */
export const PESSIMISTIC_GAS_FACTOR = 12n;

export type SeedTarget = { handle: string; accountId: string; priceYocto: string; periodDays: number };
/** registered: in the contract already; exists: account exists, not registered; missing: no account yet. */
export type ChainState = "registered" | "exists" | "missing";
export type Costs = { storageByteYocto: bigint; gasPriceYocto: bigint };
export type PlanStep = SeedTarget & { state: ChainState; create: boolean; register: boolean; fundYocto: bigint };

export function seedTargets(accounts: SeedAccounts): SeedTarget[] {
  return SEED_TRADERS.map((t) => ({
    handle: t.handle,
    accountId: simTraderId(t.handle, accounts),
    priceYocto: toBaseUnits(t.keyPriceNear, 24),
    periodDays: 30,
  }));
}

const ACCOUNT_ID = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

/** Refuses anything that is not plainly NEAR testnet (the script must never touch mainnet). */
export function assertTestnetOnly(input: { network: string; contractId: string | undefined; parent: string; accountIds: string[] }): void {
  if (input.network !== "testnet") throw new Error(`NETWORK is "${input.network}". seed:chain only runs on testnet.`);
  if (!input.contractId) throw new Error("CLAVIS_CONTRACT_ID is not set.");
  if (!input.contractId.endsWith(".testnet")) throw new Error(`CLAVIS_CONTRACT_ID ${input.contractId} is not a .testnet account.`);
  if (!input.parent.endsWith(".testnet")) throw new Error(`SEED_ACCOUNT_PARENT ${input.parent} is not a .testnet account.`);
  for (const id of input.accountIds) {
    if (!id.endsWith(`.${input.parent}`) || !id.endsWith(".testnet") || id.length > 64 || !ACCOUNT_ID.test(id)) {
      throw new Error(`Refusing account id ${id}: it must be a valid sub-account of ${input.parent} on testnet.`);
    }
  }
}

/** What one new demo trader account needs: its own storage, the register_trader deposit and gas. */
export function fundingPerAccount(c: Costs) {
  const storage = NEW_ACCOUNT_BYTES * c.storageByteYocto;
  const registerDeposit = REGISTER_STORAGE_BYTES * c.storageByteYocto;
  const gas = REGISTER_TX_GAS_BUDGET * c.gasPriceYocto * PESSIMISTIC_GAS_FACTOR;
  return { storage, registerDeposit, gas, total: storage + registerDeposit + gas };
}

/**
 * Re-runnable plan: registered accounts are skipped, existing ones are only registered (topped up
 * to what registering needs), missing ones are created, funded and registered.
 */
export function planSeed(
  targets: SeedTarget[],
  chain: ReadonlyMap<string, { state: ChainState; availableYocto: bigint }>,
  costs: Costs,
): PlanStep[] {
  const f = fundingPerAccount(costs);
  return targets.map((t) => {
    const c = chain.get(t.accountId) ?? { state: "missing" as const, availableYocto: 0n };
    if (c.state === "registered") return { ...t, state: c.state, create: false, register: false, fundYocto: 0n };
    if (c.state === "exists") {
      const need = f.registerDeposit + f.gas - c.availableYocto;
      return { ...t, state: c.state, create: false, register: true, fundYocto: need > 0n ? need : 0n };
    }
    return { ...t, state: c.state, create: true, register: true, fundYocto: f.total };
  });
}

/** Shows enough of a public key to recognise it, never a whole key. */
export const maskKey = (key: string) => (key.length <= 24 ? "(hidden)" : `${key.slice(0, 14)}…${key.slice(-4)}`);

/** True if .gitignore ignores the folder (an exact `folder/` or `/folder/` line). */
export const gitignoreCovers = (gitignore: string, folder = ".secrets/") =>
  gitignore.split(/\r?\n/).some((line) => line.trim() === folder || line.trim() === `/${folder}`);

/** yoctoNEAR -> "0.01234" NEAR (5 decimals, rounded up so totals never understate). */
export function nearOf(yocto: bigint): string {
  const unit = 10n ** 19n; // 0.00001 NEAR
  const units = (yocto + unit - 1n) / unit;
  const s = units.toString().padStart(6, "0");
  return `${s.slice(0, -5)}.${s.slice(-5)}`;
}
