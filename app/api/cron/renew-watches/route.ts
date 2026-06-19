/**
 * Cron endpoint to renew Gmail Watch subscriptions
 * 
 * Gmail Watch subscriptions expire after 7 days. This cron job
 * runs daily to renew watches for all connected accounts.
 * 
 * Vercel Cron: Schedule this to run daily
 * 
 * Last updated: 2026-02-05
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
// Vercel Hobby caps function runtime at 60s. The reconcile pass below is
// bounded by a wall-clock budget so this stays well under that limit.
export const maxDuration = 60;

export async function GET(request: NextRequest) {
    const startTime = Date.now();

    // Verify cron secret
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('[Watch Renewal] Starting Gmail watch renewal...');

    try {
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

        if (!supabaseUrl || !supabaseServiceKey) {
            throw new Error('Missing Supabase credentials');
        }

        const adminClient = createClient(supabaseUrl, supabaseServiceKey, {
            auth: { persistSession: false }
        });

        // Get all tokens. A refresh_token is REQUIRED: access tokens expire in
        // ~1h but this cron runs daily, so we rely on the OAuth client to
        // auto-refresh on demand. Rows without a refresh_token can never renew
        // and would silently fail — surface them as needs-reconnect instead.
        const { data: tokens, error: tokenError } = await adminClient
            .from('tokens')
            .select('user_email, access_token, refresh_token')
            .not('access_token', 'is', null);

        if (tokenError) throw tokenError;
        if (!tokens || tokens.length === 0) {
            return NextResponse.json({ message: 'No accounts to process' });
        }

        const { startHistoryWatch } = await import('@/lib/gmail');

        // Dedupe by mailbox — the same email can have personal + business rows.
        const byEmail = new Map<string, { access_token: string | null; refresh_token: string | null }>();
        for (const token of tokens) {
            if (!token.user_email) continue;
            const key = token.user_email.toLowerCase();
            const existing = byEmail.get(key);
            // Prefer a row that actually has a refresh_token.
            if (!existing || (!existing.refresh_token && token.refresh_token)) {
                byEmail.set(key, { access_token: token.access_token, refresh_token: token.refresh_token });
            }
        }

        const results: { email: string; success: boolean; needsReconnect?: boolean; error?: string }[] = [];

        for (const [email, token] of byEmail) {
            if (!token.refresh_token) {
                // No refresh token — the watch will lapse and cannot self-renew.
                results.push({ email, success: false, needsReconnect: true, error: 'missing refresh_token' });
                console.error(`[Watch Renewal] ${email}: NO refresh_token — watch cannot renew, user must reconnect Gmail`);
                continue;
            }

            try {
                await startHistoryWatch({
                    access_token: token.access_token,
                    refresh_token: token.refresh_token,
                });

                results.push({ email, success: true });
                console.log(`[Watch Renewal] Renewed watch for ${email}`);
            } catch (error: any) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                // invalid_grant => refresh token revoked/expired; user must reconnect.
                const needsReconnect =
                    errorMsg.includes('invalid_grant') ||
                    error?.response?.data?.error === 'invalid_grant';
                results.push({ email, success: false, needsReconnect, error: errorMsg });
                console.error(`[Watch Renewal] Failed for ${email}${needsReconnect ? ' (NEEDS RECONNECT)' : ''}:`, errorMsg);
            }
        }

        // --- Daily reconciliation pass ---
        // Folded into this cron so we stay within Hobby's 2-cron limit. After
        // renewing watches we sweep each mailbox's recent inbox and backfill any
        // thread that never became a ticket — the safety net for missed pushes.
        // Bounded by a wall-clock budget to stay under the 60s function cap;
        // any mailboxes not reached this run are covered tomorrow + by the
        // real-time webhook. Steady-state cost is tiny: a couple of list calls
        // per mailbox, with NO body fetches unless a ticket is actually missing.
        const RECONCILE_TOTAL_BUDGET_MS = 50_000;
        const RECONCILE_PER_ACCOUNT_MS = 8_000;
        const { reconcileAccountInbox } = await import('@/lib/reconcile');
        let reconciledAccounts = 0;
        let ticketsRecovered = 0;
        let reconcileSkippedForTime = 0;
        for (const [email, token] of byEmail) {
            if (Date.now() - startTime > RECONCILE_TOTAL_BUDGET_MS) {
                reconcileSkippedForTime++;
                continue;
            }
            if (!token.refresh_token) continue;
            try {
                const r = await reconcileAccountInbox(email, token, {
                    query: 'in:inbox newer_than:7d',
                    softDeadlineMs: RECONCILE_PER_ACCOUNT_MS,
                    maxCreatesPerRun: 100,
                });
                reconciledAccounts++;
                ticketsRecovered += r.ticketsCreated;
                if (r.ticketsCreated > 0) {
                    console.warn(`[Watch Renewal] Reconcile recovered ${r.ticketsCreated} missing ticket(s) for ${email}`);
                }
            } catch (reconcileErr) {
                console.error(`[Watch Renewal] Reconcile failed for ${email}:`, reconcileErr);
            }
        }

        const successCount = results.filter(r => r.success).length;
        const needsReconnectCount = results.filter(r => r.needsReconnect).length;
        const duration = Date.now() - startTime;

        console.log(`[Watch Renewal] Completed: ${successCount}/${results.length} renewed, ${needsReconnectCount} need reconnect; reconciled ${reconciledAccounts} mailbox(es), recovered ${ticketsRecovered} ticket(s), ${reconcileSkippedForTime} skipped for time, in ${duration}ms`);

        return NextResponse.json({
            success: true,
            renewed: successCount,
            needsReconnect: needsReconnectCount,
            total: results.length,
            reconciledAccounts,
            ticketsRecovered,
            reconcileSkippedForTime,
            duration,
            results,
        });

    } catch (error) {
        console.error('[Watch Renewal] Fatal error:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : String(error) },
            { status: 500 }
        );
    }
}
