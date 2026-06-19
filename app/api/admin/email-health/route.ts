/**
 * Email pipeline health check.
 *
 * Returns a single JSON view of whether real-time Gmail Pub/Sub email delivery
 * is currently healthy. Bookmark this URL — if customers start complaining
 * about missed emails, hit this first to see which layer is failing without
 * digging through Vercel/GCP/Supabase consoles.
 *
 * Layers checked:
 *  - GMAIL_HISTORY_TOPIC env var presence
 *  - sync_state freshness per account (when did each account last receive a webhook?)
 *  - tokens vs sync_state correlation (orphaned watches with no token)
 *
 * Auth: requires a logged-in admin session (validateBusinessSession).
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { validateBusinessSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

interface AccountHealth {
    user_email: string;
    has_token: boolean;
    last_sync_at: string | null;
    last_history_id: string | null;
    minutes_since_last_sync: number | null;
    status: 'ok' | 'stale' | 'never_synced' | 'orphaned_no_token';
}

const STALE_THRESHOLD_MINUTES = 60 * 6; // 6 hours

export async function GET(request: NextRequest) {
    const businessSession = await validateBusinessSession();
    if (!businessSession) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseServiceKey) {
        return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
    }

    const adminClient = createClient(supabaseUrl, supabaseServiceKey, {
        auth: { persistSession: false },
    });

    // SECURITY: scope strictly to the caller's tenant. This endpoint uses the
    // service-role client (bypasses RLS); without an explicit tenant filter it
    // would leak EVERY business's connected email addresses and sync timing to
    // any logged-in user (cross-tenant information disclosure).
    const businessId = businessSession.businessId;
    let tokensQuery = adminClient
        .from('tokens')
        .select('user_email, business_id')
        .not('user_email', 'is', null);
    if (businessId) {
        tokensQuery = tokensQuery.eq('business_id', businessId);
    } else {
        // Personal account: restrict to its own mailbox only.
        tokensQuery = tokensQuery.eq('user_email', businessSession.email).is('business_id', null);
    }
    const { data: tokens, error: tokensError } = await tokensQuery;
    if (tokensError) {
        return NextResponse.json({ error: tokensError.message }, { status: 500 });
    }

    // sync_state has no business_id column, so scope it to this tenant's mailboxes.
    const tenantEmails = (tokens || [])
        .map(t => t.user_email as string)
        .filter(Boolean);
    let syncStates: { user_email: string; last_history_id: string | null; last_sync_at: string | null }[] = [];
    if (tenantEmails.length > 0) {
        const { data: syncData, error: syncError } = await adminClient
            .from('sync_state')
            .select('user_email, last_history_id, last_sync_at')
            .in('user_email', tenantEmails);
        if (syncError) {
            return NextResponse.json({ error: syncError.message }, { status: 500 });
        }
        syncStates = syncData || [];
    }

    const tokenEmails = new Set((tokens || []).map(t => (t.user_email as string).toLowerCase()));
    const syncByEmail = new Map<string, { last_history_id: string | null; last_sync_at: string | null }>();
    for (const s of syncStates || []) {
        if (s.user_email) {
            syncByEmail.set((s.user_email as string).toLowerCase(), {
                last_history_id: s.last_history_id,
                last_sync_at: s.last_sync_at,
            });
        }
    }

    const allEmails = new Set<string>([...tokenEmails, ...syncByEmail.keys()]);
    const now = Date.now();

    const accounts: AccountHealth[] = [];
    for (const email of allEmails) {
        const sync = syncByEmail.get(email);
        const hasToken = tokenEmails.has(email);
        const lastSyncMs = sync?.last_sync_at ? new Date(sync.last_sync_at).getTime() : null;
        const minutesSince = lastSyncMs ? Math.round((now - lastSyncMs) / 60000) : null;

        let status: AccountHealth['status'];
        if (!hasToken) {
            status = 'orphaned_no_token';
        } else if (!lastSyncMs) {
            status = 'never_synced';
        } else if (minutesSince !== null && minutesSince > STALE_THRESHOLD_MINUTES) {
            status = 'stale';
        } else {
            status = 'ok';
        }

        accounts.push({
            user_email: email,
            has_token: hasToken,
            last_sync_at: sync?.last_sync_at || null,
            last_history_id: sync?.last_history_id || null,
            minutes_since_last_sync: minutesSince,
            status,
        });
    }

    accounts.sort((a, b) => a.user_email.localeCompare(b.user_email));

    const summary = {
        total_accounts: accounts.length,
        ok: accounts.filter(a => a.status === 'ok').length,
        stale: accounts.filter(a => a.status === 'stale').length,
        never_synced: accounts.filter(a => a.status === 'never_synced').length,
        orphaned: accounts.filter(a => a.status === 'orphaned_no_token').length,
    };

    const overallHealthy = summary.stale === 0 && summary.never_synced === 0 && summary.orphaned === 0;

    return NextResponse.json({
        overall: overallHealthy ? 'healthy' : 'degraded',
        checked_at: new Date().toISOString(),
        config: {
            gmail_history_topic_set: !!process.env.GMAIL_HISTORY_TOPIC,
            cron_secret_set: !!process.env.CRON_SECRET,
            supabase_service_role_set: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
            stale_threshold_minutes: STALE_THRESHOLD_MINUTES,
        },
        summary,
        accounts,
    });
}
