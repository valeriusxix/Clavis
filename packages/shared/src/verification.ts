/**
 * Which contract the browser checks a trader's head against. A contract pinned in the web build
 * (VITE_CLAVIS_CONTRACT_ID) wins, so a dishonest server can't point verification at another
 * contract or hide it. Without a pinned contract (local demo), the server's is used.
 */
export function verificationContract(
  pinned: string | null | undefined,
  reported: string | null | undefined,
): { contractId: string | null; mismatch: string | null } {
  const p = pinned?.trim() || null;
  const r = reported?.trim() || null;
  if (p && r && p !== r) return { contractId: p, mismatch: `The server reports contract ${r}, but this app is pinned to ${p}.` };
  return { contractId: p ?? r, mismatch: null };
}
