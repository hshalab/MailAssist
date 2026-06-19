/**
 * Mailbox resolver — the single place we solve "this message/thread/attachment
 * may live in ANY connected mailbox, not just the primary one".
 *
 * Background: a business connects several Gmail accounts. Tickets and emails in
 * the unified list span all of them, but the per-id endpoints (thread, email
 * detail, attachment download) used to resolve only ONE account's tokens — the
 * session's "primary" mailbox. Opening anything owned by a different mailbox
 * then failed with "Ticket not found", "Failed to fetch email/thread", or broken
 * inline images. Rather than patch each endpoint separately, every Gmail-by-id
 * lookup should go through withMailboxFallback(): it tries the most likely
 * mailbox first (an owner hint), then falls back across the rest until one works.
 */

import { loadBusinessTokens } from './storage';

export interface MailboxAccount {
  email: string;
  tokens: { access_token?: string | null; refresh_token?: string | null;[k: string]: any };
}

/**
 * Build the ordered list of mailbox accounts to try for a lookup. The owner hint
 * (e.g. a ticket's owner_email) is tried first so the common case is a single
 * Gmail call; the rest are the fallback.
 */
export async function getCandidateMailboxes(opts: {
  ownerEmailHint?: string | null;
  businessId?: string | null;
  sessionEmail?: string | null;
}): Promise<MailboxAccount[]> {
  const { ownerEmailHint, businessId, sessionEmail } = opts;

  const accounts = (await loadBusinessTokens(
    businessId || null,
    sessionEmail || ownerEmailHint || undefined
  )) as MailboxAccount[];

  const usable = (accounts || []).filter(
    a => a?.tokens?.access_token || a?.tokens?.refresh_token
  );

  if (ownerEmailHint) {
    const hint = ownerEmailHint.trim().toLowerCase();
    usable.sort((a, b) => {
      const aHit = (a.email || '').toLowerCase() === hint ? 0 : 1;
      const bHit = (b.email || '').toLowerCase() === hint ? 0 : 1;
      return aHit - bHit;
    });
  }

  return usable;
}

/**
 * Try `attempt` against each candidate mailbox (owner hint first) until one
 * returns a truthy result. Returns the result and which account produced it.
 * Per-account errors are swallowed so one bad token can't abort the sweep.
 */
export async function withMailboxFallback<T>(
  opts: { ownerEmailHint?: string | null; businessId?: string | null; sessionEmail?: string | null },
  attempt: (tokens: MailboxAccount['tokens'], email: string) => Promise<T | null | undefined>
): Promise<{ result: T | null; accountEmail: string | null; candidateCount: number }> {
  const accounts = await getCandidateMailboxes(opts);

  // NOTE on cost: Gmail message/thread/attachment IDs are PER-MAILBOX, so a
  // non-owner mailbox legitimately 404s for an ID — we must keep trying until we
  // hit the owner. (Don't "stop on first 404"; that would break the lookup.) The
  // ownerEmailHint keeps the common case to a single call by trying the owner first.
  for (const acc of accounts) {
    try {
      const result = await attempt(acc.tokens, acc.email);
      if (result) return { result, accountEmail: acc.email, candidateCount: accounts.length };
    } catch (err) {
      console.warn(`[mailbox-resolver] attempt failed for ${acc.email}:`, err instanceof Error ? err.message : err);
    }
  }

  // candidateCount === 0 lets callers distinguish "no connected mailboxes /
  // needs reconnect" (→ 401) from "tried everything, not found" (→ empty/404).
  return { result: null, accountEmail: null, candidateCount: accounts.length };
}
