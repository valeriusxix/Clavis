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
});

export type Config = z.infer<typeof EnvSchema>;

export function parseConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = EnvSchema.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
