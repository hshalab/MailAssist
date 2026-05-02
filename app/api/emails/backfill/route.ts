/**
 * Recovery endpoint to backfill tickets from inbox messages.
 *
 * The regular /api/emails/sync endpoint short-circuits with "all processed" when
 * AI drafts are disabled (it gates on sent-email embedding work). This endpoint
 * exists to recover from missed Pub/Sub deliveries by walking the inbox
 * directly with proper pagination and calling ensureTicketForEmail per message.
 *
 * Safe to run repeatedly — ensureTicketForEmail dedupes by threadId.
 *
 * Usage:
 *   // Backfill recent inbox until time deadline
 *   fetch('/api/emails/backfill', { method: 'POST', credentials: 'include' })
 *     .then(r => r.json()).then(console.log)
 *
 *   // Resume from prior call's nextPageToken
 *   fetch('/api/emails/backfill?pageToken=ABC123', { method: 'POST', credentials: 'include' })
 *
 *   // Scope by Gmail search query (for older mail)
 *   fetch('/api/emails/backfill?q=in:inbox after:2026/03/01 before:2026/04/15', { method: 'POST', credentials: 'include' })
 */

import { NextRequest, NextResponse } from 'next/server';
import { getGmailClient, parseEmailMessage } from '@/lib/gmail';
import { ensureTicketForEmail } from '@/lib/tickets';
import { getValidTokens } from '@/lib/token-refresh';
import { loadBusinessTokens, getCurrentUserEmail } from '@/lib/storage';
import { validateBusinessSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

/**
 * Given a list of Gmail threadIds, return the subset that already have a ticket
 * for the given owner email. Used to skip already-ticketed threads without
 * paying to fetch the full message body from Gmail.
 */
async function getExistingTicketThreadIds(threadIds: string[], userEmail: string): Promise<Set<string>> {
    if (!supabase || threadIds.length === 0) return new Set();
    const { data, error } = await supabase
        .from('tickets')
        .select('thread_id')
        .in('thread_id', threadIds)
        .eq('user_email', userEmail);
    if (error) {
        console.warn('[Backfill] thread-id pre-check failed (will fall back to per-email dedupe):', error.message);
        return new Set();
    }
    return new Set((data || []).map(r => r.thread_id as string));
}

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Vercel kills functions hard at maxDuration. Bail out earlier so we can
// return a clean response with a resumption token instead of a 504.
const SOFT_DEADLINE_MS = 50_000;
const PAGE_SIZE = 100;
// Safety cap: never create more than this many tickets in a single HTTP call.
// Prevents a runaway loop from spamming inserts. Resume token is returned so
// the client can call again to continue.
const MAX_CREATES_PER_CALL = 500;

interface AccountResult {
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

export async function POST(request: NextRequest) {
    const startTime = Date.now();
    const searchParams = request.nextUrl.searchParams;
    const query = searchParams.get('q') || 'in:inbox';
    const initialPageToken = searchParams.get('pageToken') || undefined;
    // dryRun=true does the entire pre-check + identification flow but skips
    // ensureTicketForEmail. Use this to preview how many tickets WOULD be
    // created before actually writing anything.
    const dryRun = searchParams.get('dryRun') === 'true';
    let totalCreatedThisCall = 0;

    try {
        const businessSession = await validateBusinessSession();
        const accounts: { email: string; tokens: { access_token?: string | null; refresh_token?: string | null } }[] = [];

        if (businessSession?.businessId) {
            const businessAccounts = await loadBusinessTokens(businessSession.businessId, businessSession.email);
            for (const acc of businessAccounts) {
                accounts.push({ email: acc.email, tokens: acc.tokens });
            }
        } else {
            const tokens = await getValidTokens();
            const sessionEmail = await getCurrentUserEmail();
            if (tokens?.access_token && sessionEmail) {
                accounts.push({ email: sessionEmail, tokens });
            } else if (businessSession?.email) {
                const personalAccounts = await loadBusinessTokens(null, businessSession.email);
                for (const acc of personalAccounts) {
                    accounts.push({ email: acc.email, tokens: acc.tokens });
                }
            }
        }

        if (accounts.length === 0) {
            return NextResponse.json(
                { error: 'No connected Gmail accounts found for this session.' },
                { status: 401 }
            );
        }

        const results: AccountResult[] = [];

        for (const { email, tokens } of accounts) {
            const result: AccountResult = {
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
                const lowerEmail = email.toLowerCase();
                let pageToken: string | undefined = initialPageToken;

                pageLoop: while (true) {
                    if (Date.now() - startTime > SOFT_DEADLINE_MS) {
                        result.nextPageToken = pageToken || null;
                        break;
                    }

                    const listRes = await gmail.users.messages.list({
                        userId: 'me',
                        maxResults: PAGE_SIZE,
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

                    // Pre-filter: skip messages whose threadId already has a ticket for
                    // this account. This is the whole point of the backfill — recover
                    // emails that never became tickets, not re-process closed ones.
                    const uniqueThreadIds = Array.from(new Set(
                        messageRefs.map(m => m.threadId).filter((t): t is string => !!t)
                    ));
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

                    const fetched = await Promise.all(
                        idsToFetch.map(async (id) => {
                            try {
                                const r = await gmail.users.messages.get({
                                    userId: 'me',
                                    id,
                                    format: 'full',
                                });
                                return parseEmailMessage(r.data, false);
                            } catch (err) {
                                console.warn(`[Backfill] ${email}: failed to fetch ${id}:`, err);
                                return null;
                            }
                        })
                    );

                    for (const e of fetched) {
                        if (!e) {
                            result.errors++;
                            continue;
                        }
                        result.fetched++;

                        if (Date.now() - startTime > SOFT_DEADLINE_MS) {
                            result.nextPageToken = pageToken || null;
                            break pageLoop;
                        }

                        try {
                            const labels = (e as any).labels || [];
                            if (labels.includes('SPAM') || labels.includes('TRASH')) continue;

                            const fromMatch = (e.from || '').match(/<([^>]+)>/) || (e.from || '').match(/([^\s<>]+@[^\s<>]+)/);
                            const fromEmail = fromMatch ? fromMatch[1].toLowerCase() : (e.from || '').toLowerCase();
                            const isFromAgent = fromEmail === lowerEmail || fromEmail.includes(lowerEmail);

                            // Hard cap protection: never create more than MAX_CREATES_PER_CALL
                            // tickets in a single HTTP call. Stops a runaway from spamming inserts.
                            if (totalCreatedThisCall >= MAX_CREATES_PER_CALL && !dryRun) {
                                result.nextPageToken = pageToken || null;
                                console.warn(`[Backfill] Hit MAX_CREATES_PER_CALL (${MAX_CREATES_PER_CALL}). Returning resume token.`);
                                break pageLoop;
                            }

                            if (dryRun) {
                                // Identification only — no DB writes.
                                result.ticketsCreated++;
                                totalCreatedThisCall++;
                                continue;
                            }

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
                                const ticketCreatedAt = new Date(ticket.created_at || 0).getTime();
                                const isNew = Date.now() - ticketCreatedAt < 5000;
                                if (isNew) {
                                    result.ticketsCreated++;
                                    totalCreatedThisCall++;
                                } else {
                                    // Defense-in-depth: pre-filter should have caught this.
                                    // If we land here, log loudly so we can investigate scoping mismatches.
                                    result.ticketsExisting++;
                                    console.warn(`[Backfill] ${email}: pre-filter miss — thread ${e.threadId} already had ticket, dedup'd by ensureTicketForEmail`);
                                }
                            } else {
                                result.ticketsExisting++;
                            }
                        } catch (perEmailError) {
                            result.errors++;
                            console.warn(`[Backfill] ${email}: error on message ${e.id}:`, perEmailError);
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
                console.error(`[Backfill] ${email}: account-level error:`, accountError);
                result.errors++;
            }

            results.push(result);
        }

        const totalCreated = results.reduce((s, r) => s + r.ticketsCreated, 0);
        const totalExisting = results.reduce((s, r) => s + r.ticketsExisting, 0);
        const totalFetched = results.reduce((s, r) => s + r.fetched, 0);
        const totalErrors = results.reduce((s, r) => s + r.errors, 0);
        const allCompleted = results.every(r => r.completed);
        const duration = Date.now() - startTime;

        const firstResume = results.find(r => r.nextPageToken)?.nextPageToken || null;

        console.log(`[Backfill] Done in ${duration}ms — fetched ${totalFetched}, created ${totalCreated}, existing ${totalExisting}, errors ${totalErrors}, completed=${allCompleted}`);

        return NextResponse.json({
            success: true,
            dryRun,
            durationMs: duration,
            completed: allCompleted,
            resumePageToken: firstResume,
            accounts: results,
            totals: {
                fetched: totalFetched,
                ticketsCreated: totalCreated,
                ticketsExisting: totalExisting,
                errors: totalErrors,
            },
        });
    } catch (error) {
        console.error('[Backfill] Fatal error:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : String(error) },
            { status: 500 }
        );
    }
}
