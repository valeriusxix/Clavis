// One demo account per visitor (AUDIT M3). The id lives in the signed, http-only session cookie,
// keys and simulated trades belong to it alone, and everything is deleted after 24 hours.
//
// Id format: "demo-" + creation time (8 base-36 digits, ms) + 8 random hex digits, e.g.
// demo-mhk3x9z0a1b2c3d4. It has no dot and is shorter than 32 characters, so it can never be a
// NEAR account a wallet could log in as, and its age can be read from the id itself.
import { randomBytes } from "node:crypto";
import type { Repo } from "../db/db";

export const DEMO_TTL_MS = 24 * 3_600_000;
/** Simulated trades one demo account may record. */
export const DEMO_SIM_CAP = 20;

const DEMO_ID = /^demo-([0-9a-z]{8})([0-9a-f]{8})$/;

export const newDemoId = (now: number) => `demo-${now.toString(36).padStart(8, "0")}${randomBytes(4).toString("hex")}`;
export const isDemoId = (id: string) => DEMO_ID.test(id);
export function demoIdCreatedAt(id: string): number | null {
  const m = DEMO_ID.exec(id);
  return m ? parseInt(m[1]!, 36) : null;
}
/** When the demo account and its keys expire. */
export const demoExpiresAt = (id: string) => (demoIdCreatedAt(id) ?? 0) + DEMO_TTL_MS;

/** Delete one demo account's keys, trades, chain head and profile. */
export function deleteDemoAccount(repo: Repo, id: string): void {
  if (!isDemoId(id)) return;
  repo.transaction(() => {
    repo.db.prepare(`DELETE FROM demo_access WHERE holder_id = ?`).run(id);
    repo.db.prepare(`DELETE FROM trades WHERE trader_id = ?`).run(id);
    repo.db.prepare(`DELETE FROM chain_heads WHERE trader_id = ?`).run(id);
    repo.db.prepare(`DELETE FROM traders WHERE account_id = ?`).run(id);
  });
}

/** Delete every demo account older than 24 hours. Returns how many were deleted. */
export function purgeExpiredDemoData(repo: Repo, now: number): number {
  const ids = new Set<string>();
  for (const r of repo.db.prepare(`SELECT DISTINCT holder_id AS id FROM demo_access`).all() as { id: string }[]) ids.add(r.id);
  for (const r of repo.db.prepare(`SELECT account_id AS id FROM traders`).all() as { id: string }[]) ids.add(r.id);
  let deleted = 0;
  for (const id of ids) {
    if (isDemoId(id) && demoExpiresAt(id) <= now) {
      deleteDemoAccount(repo, id);
      deleted++;
    }
  }
  return deleted;
}
