import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

/** Repo root (apps/server/src -> ../../..). */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/** Load <repo>/.env once if it exists. Real env vars win over the file. */
export function loadDotEnv(path = resolve(REPO_ROOT, ".env")): void {
  if (existsSync(path)) process.loadEnvFile(path);
}

const emptyToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const optionalString = z.preprocess(emptyToUndefined, z.string().optional());
const boolString = z
  .preprocess(emptyToUndefined, z.enum(["true", "false"]).default("true"))
  .transform((v) => v === "true");

const EnvSchema = z.object({
  DEMO_MODE: boolString,
  NETWORK: z.preprocess(emptyToUndefined, z.enum(["testnet", "mainnet"]).default("testnet")),

  ONECLICK_BASE_URL: z.preprocess(emptyToUndefined, z.url().default("https://1click.chaindefuser.com")),
  ONECLICK_API_KEY: optionalString,

  CLAVIS_CONTRACT_ID: optionalString,
  COMMITTER_ACCOUNT_ID: optionalString,
  COMMITTER_PRIVATE_KEY: optionalString,
  NEAR_RPC_URL: optionalString,

  PORT: z.preprocess(emptyToUndefined, z.coerce.number().int().positive().default(8787)),
  SESSION_SECRET: optionalString,
  DATABASE_PATH: z.preprocess(emptyToUndefined, z.string().default("./data/clavis.db")),
  /** Comma-separated browser origins allowed to call the API with cookies (CORS). */
  WEB_ORIGIN: z.preprocess(emptyToUndefined, z.string().default("http://localhost:5173,http://127.0.0.1:5173")),
  NODE_ENV: z.preprocess(emptyToUndefined, z.string().default("development")),

  /** Real mode (Phase 4): the testnet trader identity and the mainnet account allowed to trade as it. */
  REAL_TRADER_ID: optionalString,
  REAL_TRADER_MAINNET_ACCOUNT: optionalString,
  /** Hard cap per real trade in USD (AGENT.md hard rule 7: <= $2). */
  REAL_TRADE_MAX_USD: z.preprocess(emptyToUndefined, z.coerce.number().positive().max(2).default(2)),
  NEAR_MAINNET_RPC_URL: optionalString,
});

export type Config = z.infer<typeof EnvSchema>;

export function parseConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = EnvSchema.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
