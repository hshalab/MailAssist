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
 *
 * The pure ordering/fan-out logic lives in mailbox-fallback.ts (unit-tested).
 */

import { loadBusinessTokens } from './storage';
import { orderMailboxes, runMailboxFallback, MailboxAccountLike } from './mailbox-fallback';

export type MailboxAccount = MailboxAccountLike;

/**
 * Build the ordered list of mailbox accounts to try for a lookup (owner hint
 * first). Filters out rows with no usable tokens.
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

  return orderMailboxes(usable, ownerEmailHint);
}

/**
 * Try `attempt` against each candidate mailbox (owner hint first) until one
 * returns a truthy result. See runMailboxFallback for the per-account semantics.
 */
export async function withMailboxFallback<T>(
  opts: { ownerEmailHint?: string | null; businessId?: string | null; sessionEmail?: string | null },
  attempt: (tokens: MailboxAccount['tokens'], email: string) => Promise<T | null | undefined>
): Promise<{ result: T | null; accountEmail: string | null; candidateCount: number }> {
  const accounts = await getCandidateMailboxes(opts);
  return runMailboxFallback(accounts, attempt);
}
