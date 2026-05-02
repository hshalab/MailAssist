/**
 * Recovery endpoint to backfill tickets from recent inbox messages.
 *
 * The regular /api/emails/sync endpoint short-circuits with "all processed" when
 * AI drafts are disabled (because it gates on sent-email embedding work). This
 * endpoint exists to recover from missed Pub/Sub deliveries by walking the
 * inbox directly and calling ensureTicketForEmail per message.
 *
 * Safe to run repeatedly — ensureTicketForEmail dedupes by threadId.
 *
 * Usage:
 *   fetch('/api/emails/backfill?maxResults=200', { method: 'POST', credentials: 'include' })
 *     .then(r => r.json()).then(console.log)
 */

import { NextRequest, NextResponse } from 'next/server';
import { fetchInboxEmails } from '@/lib/gmail';
import { ensureTicketForEmail } from '@/lib/tickets';
import { getValidTokens } from '@/lib/token-refresh';
import { loadBusinessTokens, getCurrentUserEmail } from '@/lib/storage';
import { validateBusinessSession } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface AccountResult {
    email: string;
    fetched: number;
    ticketsCreated: number;
    ticketsExisting: number;
    errors: number;
}

export async function POST(request: NextRequest) {
    const startTime = Date.now();
    const searchParams = request.nextUrl.searchParams;
    const maxResults = Math.min(parseInt(searchParams.get('maxResults') || '200'), 500);
    const query = searchParams.get('q') || 'in:inbox';

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
                fetched: 0,
                ticketsCreated: 0,
                ticketsExisting: 0,
                errors: 0,
            };

            try {
                const emails = await fetchInboxEmails(tokens, maxResults, query, true);
                result.fetched = emails.length;
                console.log(`[Backfill] ${email}: fetched ${emails.length} inbox messages`);

                const lowerEmail = email.toLowerCase();

                for (const e of emails) {
                    try {
                        const labels = (e as any).labels || [];
                        if (labels.includes('SPAM') || labels.includes('TRASH')) continue;

                        const fromMatch = (e.from || '').match(/<([^>]+)>/) || (e.from || '').match(/([^\s<>]+@[^\s<>]+)/);
                        const fromEmail = fromMatch ? fromMatch[1].toLowerCase() : (e.from || '').toLowerCase();
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
                            const ticketCreatedAt = new Date(ticket.created_at || 0).getTime();
                            const isNew = Date.now() - ticketCreatedAt < 5000;
                            if (isNew) result.ticketsCreated++;
                            else result.ticketsExisting++;
                        } else {
                            result.ticketsExisting++;
                        }
                    } catch (perEmailError) {
                        result.errors++;
                        console.warn(`[Backfill] ${email}: error on message ${e.id}:`, perEmailError);
                    }
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
        const duration = Date.now() - startTime;

        console.log(`[Backfill] Done in ${duration}ms — fetched ${totalFetched}, created ${totalCreated}, existing ${totalExisting}, errors ${totalErrors}`);

        return NextResponse.json({
            success: true,
            durationMs: duration,
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
