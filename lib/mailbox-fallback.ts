/**
 * Pure (dependency-free) core of the mailbox resolver, split out so it can be
 * unit-tested without pulling in Supabase / next/cache. See mailbox-resolver.ts
 * for the storage-backed wrapper that feeds these functions.
 */

export interface MailboxAccountLike {
  email: string;
  tokens: { access_token?: string | null; refresh_token?: string | null;[k: string]: any };
}

/**
 * Order accounts so the owner-hint mailbox is tried first (keeps the common case
 * to a single API call). Stable for non-matching entries. Pure — no I/O.
 */
export function orderMailboxes<T extends { email: string }>(
  accounts: T[],
  ownerEmailHint?: string | null
): T[] {
  const ordered = [...accounts];
  if (ownerEmailHint) {
    const hint = ownerEmailHint.trim().toLowerCase();
    ordered.sort((a, b) => {
      const aHit = (a.email || '').toLowerCase() === hint ? 0 : 1;
      const bHit = (b.email || '').toLowerCase() === hint ? 0 : 1;
      return aHit - bHit;
    });
  }
  return ordered;
}

/**
 * Try `attempt` against each account in order until one returns a truthy result.
 * Per-account errors are swallowed so one bad token can't abort the sweep
 * (Gmail IDs are per-mailbox, so non-owner mailboxes legitimately 404 — we keep
 * going until the owner). Returns the result, which account produced it, and the
 * candidate count (0 ⇒ no connected mailboxes, so callers can return 401).
 */
export async function runMailboxFallback<T>(
  accounts: MailboxAccountLike[],
  attempt: (tokens: MailboxAccountLike['tokens'], email: string) => Promise<T | null | undefined>
): Promise<{ result: T | null; accountEmail: string | null; candidateCount: number }> {
  for (const acc of accounts) {
    try {
      const result = await attempt(acc.tokens, acc.email);
      if (result) return { result, accountEmail: acc.email, candidateCount: accounts.length };
    } catch (err) {
      console.warn(`[mailbox-resolver] attempt failed for ${acc.email}:`, err instanceof Error ? err.message : err);
    }
  }
  return { result: null, accountEmail: null, candidateCount: accounts.length };
}
