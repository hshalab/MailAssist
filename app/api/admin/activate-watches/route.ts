/**
 * Activate Gmail Pub/Sub watch for every connected account in the current session.
 *
 * Use this to recover accounts whose watch was never set up (e.g. they were
 * connected before OAuth auto-activate shipped, and the daily renew-watches
 * cron hasn't run yet). Idempotent: calling startHistoryWatch on an account
 * that already has an active watch just resets the 7-day expiration.
 *
 * Auth: requires a logged-in session.
 *
 * Usage:
 *   fetch('/api/admin/activate-watches', { method: 'POST', credentials: 'include' })
 *     .then(r => r.json()).then(console.log)
 */

import { NextRequest, NextResponse } from 'next/server';
import { startHistoryWatch } from '@/lib/gmail';
import { validateBusinessSession } from '@/lib/session';
import { loadBusinessTokens, getCurrentUserEmail } from '@/lib/storage';
import { getValidTokens } from '@/lib/token-refresh';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface ActivateResult {
    email: string;
    success: boolean;
    historyId?: string | null;
    expiration?: string | null;
    error?: string;
}

export async function POST(request: NextRequest) {
    if (!process.env.GMAIL_HISTORY_TOPIC) {
        return NextResponse.json(
            { error: 'GMAIL_HISTORY_TOPIC env var is not set. Cannot activate watches.' },
            { status: 500 }
        );
    }

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

        const results: ActivateResult[] = [];

        for (const { email, tokens } of accounts) {
            try {
                const watchInfo = await startHistoryWatch(tokens);
                results.push({
                    email,
                    success: true,
                    historyId: watchInfo.historyId || null,
                    expiration: watchInfo.expiration || null,
                });
                console.log(`[ActivateWatches] ${email}: activated. historyId=${watchInfo.historyId} expiration=${watchInfo.expiration}`);
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                results.push({ email, success: false, error: message });
                console.error(`[ActivateWatches] ${email}: failed`, err);
            }
        }

        const ok = results.filter(r => r.success).length;
        const failed = results.filter(r => !r.success).length;

        return NextResponse.json({
            success: failed === 0,
            total: results.length,
            activated: ok,
            failed,
            results,
        });
    } catch (error) {
        console.error('[ActivateWatches] Fatal:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : String(error) },
            { status: 500 }
        );
    }
}
