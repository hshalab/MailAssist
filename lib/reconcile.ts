/**
 * Inbox reconciliation — the safety net that guarantees no email stays missing.
 *
 * Push notifications (the Gmail Pub/Sub webhook) are the fast path, but they can
 * be missed: the historyId expires, a watch lapses, a delivery is dropped, or a
 * burst overflows the page budget. Reconciliation walks an account's recent
 * inbox directly and ensures every thread without a ticket gets one. It is the
 * eventual-consistency guarantee behind "no email is ever lost".
 *
 * This module is intentionally session-agnostic: it operates on an (email,
 * tokens) pair so it can run from a cron (all accounts) or from a user-scoped
 * request. It is safe to run repeatedly — ensureTicketForEmail() dedupes by
 * threadId, and we pre-filter already-ticketed threads to avoid wasted fetches.
 */

import { getGmailClient, getMessagesByIds } from './gmail';
import { ensureTicketForEmail } from './tickets';
import { supabase } from './supabase';

export interface ReconcileOptions {
  /** Gmail search query. Defaults to recent inbox only. */
  query?: string;
  /** Page size for messages.list. */
  pageSize?: number;
  /** Stop creating tickets once this many are created in a single run. */
  maxCreatesPerRun?: number;
  /** Wall-clock budget in ms; we bail cleanly before serverless timeouts. */
  softDeadlineMs?: number;
  /** Resume token from a prior run. */
  pageToken?: string;
}

export interface ReconcileResult {
  email: string;
  pagesScanned: number;
  threadsSeen: number;
  threadsAlreadyTicketed: number;
  fetched: number;
  ticketsCreated: number;
  ticketsExisting: number;
  errors: number;
  nextPageToken: string | null;
  completed: boolean;
}

const DEFAULTS = {
  query: 'in:inbox newer_than:14d',
  pageSize: 100,
  maxCreatesPerRun: 500,
  softDeadlineMs: 50_000,
};

/**
 * Given a list of Gmail threadIds, return the subset that already have a ticket
 * for the given owner email — so we can skip fetching their bodies entirely.
 */
async function getExistingTicketThreadIds(
  threadIds: string[],
  userEmail: string
): Promise<Set<string>> {
  if (!supabase || threadIds.length === 0) return new Set();
  const { data, error } = await supabase
    .from('tickets')
    .select('thread_id')
    .in('thread_id', threadIds)
    .eq('user_email', userEmail);
  if (error) {
    console.warn('[Reconcile] thread-id pre-check failed (falling back to per-email dedupe):', error.message);
    return new Set();
  }
  return new Set((data || []).map((r: any) => r.thread_id as string));
}

const extractBareEmail = (s: string): string => {
  if (!s) return '';
  const m = s.match(/<([^>]+)>/) || s.match(/([^\s<>]+@[^\s<>]+)/);
  return m ? m[1].toLowerCase() : s.toLowerCase();
};

/**
 * Reconcile a single connected account's inbox: ensure every recent thread that
 * lacks a ticket gets one. Returns a structured summary and a resume token if
 * the run was cut short by the time/create budget.
 */
export async function reconcileAccountInbox(
  email: string,
  tokens: { access_token?: string | null; refresh_token?: string | null },
  options: ReconcileOptions = {}
): Promise<ReconcileResult> {
  const query = options.query ?? DEFAULTS.query;
  const pageSize = options.pageSize ?? DEFAULTS.pageSize;
  const maxCreates = options.maxCreatesPerRun ?? DEFAULTS.maxCreatesPerRun;
  const softDeadlineMs = options.softDeadlineMs ?? DEFAULTS.softDeadlineMs;

  const startTime = Date.now();
  const lowerEmail = email.toLowerCase();

  const result: ReconcileResult = {
    email,
    pagesScanned: 0,
    threadsSeen: 0,
    threadsAlreadyTicketed: 0,
    fetched: 0,
    ticketsCreated: 0,
    ticketsExisting: 0,
    errors: 0,
    nextPageToken: null,
    completed: false,
  };

  try {
    const gmail = getGmailClient(tokens);
    let pageToken: string | undefined = options.pageToken;

    pageLoop: while (true) {
      if (Date.now() - startTime > softDeadlineMs) {
        result.nextPageToken = pageToken || null;
        break;
      }

      const listRes = await gmail.users.messages.list({
        userId: 'me',
        maxResults: pageSize,
        q: query,
        pageToken,
      });
      result.pagesScanned++;

      const messageRefs = (listRes.data.messages || []).filter(m => m.id);
      const nextToken = listRes.data.nextPageToken || undefined;

      if (messageRefs.length === 0) {
        result.completed = true;
        result.nextPageToken = null;
        break;
      }

      // Skip threads that already have a ticket for this account — the whole
      // point is recovering emails that never became tickets.
      const uniqueThreadIds = Array.from(
        new Set(messageRefs.map(m => m.threadId).filter((t): t is string => !!t))
      );
      result.threadsSeen += uniqueThreadIds.length;
      const ticketedThreadIds = await getExistingTicketThreadIds(uniqueThreadIds, email);
      result.threadsAlreadyTicketed += ticketedThreadIds.size;

      const idsToFetch = messageRefs
        .filter(m => m.threadId && !ticketedThreadIds.has(m.threadId))
        .map(m => m.id!);

      if (idsToFetch.length === 0) {
        if (!nextToken) {
          result.completed = true;
          result.nextPageToken = null;
          break;
        }
        pageToken = nextToken;
        continue;
      }

      const fetched = await getMessagesByIds(tokens, idsToFetch);

      for (const e of fetched) {
        if (!e) {
          result.errors++;
          continue;
        }
        result.fetched++;

        if (Date.now() - startTime > softDeadlineMs) {
          result.nextPageToken = pageToken || null;
          break pageLoop;
        }

        if (result.ticketsCreated >= maxCreates) {
          result.nextPageToken = pageToken || null;
          console.warn(`[Reconcile] ${email}: hit maxCreatesPerRun (${maxCreates}); returning resume token`);
          break pageLoop;
        }

        try {
          const labels = (e as any).labels || [];
          if (labels.includes('SPAM') || labels.includes('TRASH')) continue;

          const fromEmail = extractBareEmail(e.from || '');
          const isFromAgent = fromEmail === lowerEmail || fromEmail.includes(lowerEmail);

          const ticket = await ensureTicketForEmail(
            {
              id: e.id,
              threadId: e.threadId,
              subject: e.subject,
              from: e.from,
              to: e.to,
              date: e.date,
              ownerEmail: email,
            },
            isFromAgent,
            e.body,
            false
          );

          if (ticket) {
            // "New" = created during this run. Window must cover the whole run,
            // not 5s, or tickets created early are miscounted as pre-existing in
            // long sweeps (skewing the "recovered N tickets" log to 0).
            const createdAt = new Date((ticket as any).createdAt || (ticket as any).created_at || 0).getTime();
            const isNew = Date.now() - createdAt < (options.softDeadlineMs ?? DEFAULTS.softDeadlineMs) + 5000;
            if (isNew) result.ticketsCreated++;
            else result.ticketsExisting++;
          } else {
            result.ticketsExisting++;
          }
        } catch (perEmailError) {
          result.errors++;
          console.warn(`[Reconcile] ${email}: error on message ${e.id}:`, perEmailError);
        }
      }

      if (!nextToken) {
        result.completed = true;
        result.nextPageToken = null;
        break;
      }
      pageToken = nextToken;
    }
  } catch (accountError) {
    console.error(`[Reconcile] ${email}: account-level error:`, accountError);
    result.errors++;
  }

  return result;
}
