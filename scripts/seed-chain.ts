// Registers the seeded demo traders on the testnet contract, so their log hashes can be committed
// and "Verify log" can turn green (AGENT.md 10.3, AUDIT C3). Steps are in docs/SEEDING.md.
//
// Usage: pnpm seed:chain [--dry-run] [--version v2] [--parent-key-file .secrets/<parent>.json]
//   --dry-run          print what would be created, funded and registered; send nothing
//   --version v2       use fresh accounts <handle>-v2.<parent> (default: SEED_ACCOUNT_VERSION from .env)
//   --parent-key-file  near-cli style JSON with "private_key" for SEED_ACCOUNT_PARENT
//                      (default: SEED_PARENT_PRIVATE_KEY from .env)
//
// Testnet only. Safe to re-run: registered accounts are skipped. New accounts' keys go to the
// gitignored .secrets/seed-accounts/ folder and are never printed. The running Clavis server (with
// COMMITTER_* set) then commits each trader's hash by itself.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { Account, JsonRpcProvider, KeyPair, type KeyPairString } from "../apps/server/src/chain/nearApi";
import { DEFAULT_RPC, makeViewFn } from "../apps/server/src/chain/nearView";
import { loadDotEnv, parseConfig, REPO_ROOT } from "../apps/server/src/config";
import {
  assertTestnetOnly,
  fundingPerAccount,
  gitignoreCovers,
  maskKey,
  nearOf,
  planSeed,
  REGISTER_GAS,
  seedTargets,
  type ChainState,
} from "../apps/server/src/demo/seedChain";
import { SEED_CHAIN_PATH, type SeedChainFile } from "../apps/server/src/demo/seedDb";

const { values: args } = parseArgs({
  options: {
    "dry-run": { type: "boolean", default: false },
    version: { type: "string" },
    "parent-key-file": { type: "string" },
  },
});

const KEYS_DIR = resolve(REPO_ROOT, ".secrets", "seed-accounts");
const explorerTx = (hash: string) => `https://testnet.nearblocks.io/txns/${hash}`;

async function main() {
  loadDotEnv();
  const config = parseConfig();
  const version = args.version ?? config.SEED_ACCOUNT_VERSION;
  if (version !== undefined && !/^[a-z0-9]+$/.test(version)) throw new Error(`--version must be letters and digits only, e.g. v2 (got "${version}")`);
  const parent = config.SEED_ACCOUNT_PARENT;
  const contractId = config.CLAVIS_CONTRACT_ID;
  const targets = seedTargets({ parent, version });

  // 1. Testnet only, secrets folder ignored by git.
  assertTestnetOnly({ network: config.NETWORK, contractId, parent, accountIds: targets.map((t) => t.accountId) });
  const rpcUrl = config.NEAR_RPC_URL ?? DEFAULT_RPC.testnet;
  const rpc = async <T>(method: string, params: unknown): Promise<T> => {
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "seed-chain", method, params }),
    });
    const body = (await res.json()) as { result?: T; error?: { cause?: { name?: string }; message?: string } };
    if (body.error) throw Object.assign(new Error(`RPC ${method}: ${body.error.cause?.name ?? body.error.message}`), { cause: body.error.cause?.name });
    return body.result as T;
  };
  const chainId = (await rpc<{ chain_id: string }>("status", [])).chain_id;
  if (chainId !== "testnet") throw new Error(`${rpcUrl} is a "${chainId}" node, not testnet. Refusing to run.`);
  if (!gitignoreCovers(readFileSync(resolve(REPO_ROOT, ".gitignore"), "utf8"))) throw new Error(".secrets/ is not in .gitignore. Refusing to create keys.");

  // 2. Read the chain: prices, and each account's state.
  const storageByteYocto = BigInt(
    (await rpc<{ runtime_config: { storage_amount_per_byte: string } }>("EXPERIMENTAL_protocol_config", { finality: "final" })).runtime_config
      .storage_amount_per_byte,
  );
  const gasPriceYocto = BigInt((await rpc<{ gas_price: string }>("gas_price", [null])).gas_price);
  const costs = { storageByteYocto, gasPriceYocto };
  const view = makeViewFn(rpcUrl);
  const viewAccount = async (accountId: string) => {
    try {
      return await rpc<{ amount: string; storage_usage: number }>("query", { request_type: "view_account", finality: "final", account_id: accountId });
    } catch (err) {
      if ((err as { cause?: string }).cause === "UNKNOWN_ACCOUNT") return null;
      throw err;
    }
  };
  const chain = new Map<string, { state: ChainState; availableYocto: bigint }>();
  for (const t of targets) {
    const acc = await viewAccount(t.accountId);
    if (!acc) continue; // missing
    const registered = (await view<unknown>(contractId!, "get_trader", { trader_id: t.accountId })) !== null;
    const available = BigInt(acc.amount) - BigInt(acc.storage_usage) * storageByteYocto;
    chain.set(t.accountId, { state: registered ? "registered" : "exists", availableYocto: available > 0n ? available : 0n });
  }
  const plan = planSeed(targets, chain, costs);
  const f = fundingPerAccount(costs);
  const total = plan.reduce((sum, s) => sum + s.fundYocto, 0n);

  // 3. Print the plan and the total before anything is sent.
  console.log(`Network   : testnet (${rpcUrl})`);
  console.log(`Contract  : ${contractId}`);
  console.log(`Parent    : ${parent}${version ? `   version: ${version}` : ""}`);
  console.log(`Per new account: ${nearOf(f.total)} NEAR = ${nearOf(f.storage)} account storage + ${nearOf(f.registerDeposit)} register_trader deposit (unused part refunded) + ${nearOf(f.gas)} gas`);
  console.log("");
  for (const s of plan) {
    const action = s.state === "registered" ? "skip (already registered)" : s.create ? "create + fund + register" : "register only";
    console.log(`  ${s.accountId.padEnd(42)} ${action.padEnd(26)} ${s.fundYocto > 0n ? `${nearOf(s.fundYocto)} NEAR` : ""}`);
  }
  console.log(`\nTotal sent from ${parent}: ${nearOf(total)} testnet NEAR (plus a few small transaction fees)`);
  const todo = plan.filter((s) => s.create || s.register);
  if (todo.length === 0) {
    console.log("Nothing to do: every demo trader is already registered.");
    if (!args["dry-run"]) writeSeedChainFile(contractId!, parent, version, plan.map((s) => ({ handle: s.handle, accountId: s.accountId })), new Map());
    return;
  }
  const parentState = await viewAccount(parent);
  if (!parentState) throw new Error(`Parent account ${parent} does not exist on testnet.`);
  const parentAvailable = BigInt(parentState.amount) - BigInt(parentState.storage_usage) * storageByteYocto;
  if (parentAvailable < total + 10n ** 22n) throw new Error(`${parent} has ${nearOf(parentAvailable)} NEAR available; it needs ${nearOf(total)} plus fees.`);
  if (args["dry-run"]) {
    console.log("\nDry run: nothing was sent. Run again without --dry-run to do it.");
    return;
  }

  // 4. Parent key: must be a full-access key of the parent. Never printed in full.
  const parentKey = loadParentKey(args["parent-key-file"], config.SEED_PARENT_PRIVATE_KEY);
  const parentPublic = KeyPair.fromString(parentKey).getPublicKey().toString();
  const access = await rpc<{ permission: unknown }>("query", { request_type: "view_access_key", finality: "final", account_id: parent, public_key: parentPublic });
  if (access.permission !== "FullAccess") throw new Error(`Key ${maskKey(parentPublic)} is not a full-access key of ${parent}.`);
  console.log(`Parent key: ${maskKey(parentPublic)} (full access on ${parent})\n`);

  const provider = new JsonRpcProvider({ url: rpcUrl });
  const parentAccount = new Account(parent, provider, parentKey);
  mkdirSync(KEYS_DIR, { recursive: true });
  const registerTxs = new Map<string, string>();

  for (const s of todo) {
    const keyFile = resolve(KEYS_DIR, `${s.accountId}.json`);
    if (s.create) {
      const kp = KeyPair.fromRandom("ed25519");
      const publicKey = kp.getPublicKey().toString();
      // Save the key BEFORE creating the account, so a crash can't lose it.
      writeFileSync(keyFile, JSON.stringify({ account_id: s.accountId, public_key: publicKey, private_key: kp.toString() }, null, 2) + "\n", { mode: 0o600 });
      const res = await parentAccount.createSubAccount({ accountOrPrefix: s.accountId, publicKey, nearToTransfer: s.fundYocto });
      console.log(`created ${s.accountId}  key ${maskKey(publicKey)}  tx ${res.transaction_outcome.id}`);
    } else if (s.fundYocto > 0n) {
      const res = await parentAccount.transfer({ receiverId: s.accountId, amount: s.fundYocto });
      console.log(`topped up ${s.accountId} with ${nearOf(s.fundYocto)} NEAR  tx ${res.transaction_outcome.id}`);
    }
    if (!existsSync(keyFile)) {
      throw new Error(`${s.accountId} exists but its key is not in ${keyFile}. Register it by hand, or use --version to create fresh accounts.`);
    }
    const key = (JSON.parse(readFileSync(keyFile, "utf8")) as { private_key: KeyPairString }).private_key;
    const trader = new Account(s.accountId, provider, key);
    const res = await trader.callFunctionRaw({
      contractId: contractId!,
      methodName: "register_trader",
      args: { display_name: s.handle, price: s.priceYocto, period_days: s.periodDays },
      deposit: f.registerDeposit,
      gas: REGISTER_GAS,
    });
    const tx = res.transaction_outcome.id;
    if ((await view<unknown>(contractId!, "get_trader", { trader_id: s.accountId })) === null) {
      throw new Error(`register_trader for ${s.accountId} did not register it (tx ${tx}). Check ${explorerTx(tx)}`);
    }
    registerTxs.set(s.accountId, tx);
    console.log(`registered ${s.accountId}  tx ${tx}`);
  }

  // 5. Save account names and registration txs for the Verify panel, and print them.
  const file = writeSeedChainFile(contractId!, parent, version, plan.map((s) => ({ handle: s.handle, accountId: s.accountId })), registerTxs);
  console.log("\nDemo traders on testnet:");
  for (const t of file.traders) console.log(`  ${t.accountId.padEnd(42)} ${t.registerTx ? explorerTx(t.registerTx) : "(registered earlier, tx not recorded)"}`);
  console.log(`\nSaved to ${SEED_CHAIN_PATH} (public data: commit it).`);
  if (version && version !== config.SEED_ACCOUNT_VERSION) {
    console.log(`\nIMPORTANT: set SEED_ACCOUNT_VERSION=${version} in .env (and on the hosted server), or the app keeps using the old accounts.`);
  }
  console.log("Next: run the server with CLAVIS_CONTRACT_ID and COMMITTER_* set; it commits each trader's hash within a minute.");
}

function loadParentKey(keyFile: string | undefined, fromEnv: string | undefined): KeyPairString {
  if (keyFile) {
    const json = JSON.parse(readFileSync(resolve(keyFile), "utf8")) as { private_key?: string; secret_key?: string };
    const key = json.private_key ?? json.secret_key;
    if (!key) throw new Error(`${keyFile} has no "private_key".`);
    return key as KeyPairString;
  }
  if (fromEnv) return fromEnv as KeyPairString;
  throw new Error("No key for the parent account. Set SEED_PARENT_PRIVATE_KEY in .env or pass --parent-key-file.");
}

/** Merge with the existing file so skipped accounts keep their earlier registration tx. */
function writeSeedChainFile(
  contractId: string,
  parent: string,
  version: string | undefined,
  traders: { handle: string; accountId: string }[],
  newTxs: ReadonlyMap<string, string>,
): SeedChainFile {
  const previous = existsSync(SEED_CHAIN_PATH) ? (JSON.parse(readFileSync(SEED_CHAIN_PATH, "utf8")) as SeedChainFile) : null;
  const keys = (id: string) => {
    const f = resolve(KEYS_DIR, `${id}.json`);
    return existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as { public_key: string }).public_key : "";
  };
  const file: SeedChainFile = {
    network: "testnet",
    contractId,
    parent,
    version: version ?? null,
    traders: traders.map((t) => ({
      ...t,
      publicKey: keys(t.accountId),
      registerTx: newTxs.get(t.accountId) ?? previous?.traders.find((p) => p.accountId === t.accountId)?.registerTx ?? null,
    })),
  };
  writeFileSync(SEED_CHAIN_PATH, JSON.stringify(file, null, 2) + "\n");
  return file;
}

main().catch((err) => {
  console.error(`seed:chain stopped: ${(err as Error).message}`);
  process.exit(1);
});
