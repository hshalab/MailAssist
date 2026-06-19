/**
 * Cron endpoint: reconcile every connected mailbox against its tickets.
 *
 * This is the safety net that makes ingestion self-healing. The Gmail Pub/Sub
 * webhook is the real-time path, but deliveries can be missed (expired
 * historyId, lapsed watch, dropped push, burst overflow). This job periodically
 * re-scans each account's recent inbox and backfills any thread that never
 * became a ticket — so a missed push self-corrects on the next run instead of
 * an email staying lost forever.
 *
 * Safe to run repeatedly: reconcileAccountInbox() pre-filters already-ticketed
 * threads and ensureTicketForEmail() dedupes by threadId.
 *
 * Configured in vercel.json to run on a recurring schedule.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { reconcileAccountInbox, ReconcileResult } from '@/lib/reconcile';

export const dynamic = 'force-dynamic';
// NOTE: This endpoint is no longer on a schedule — the daily reconcile pass is
// folded into /api/cron/renew-watches to stay within Vercel Hobby's 2-cron
// limit. It remains as a manually-triggerable "sweep all mailboxes" endpoint
// (cron-secret protected). maxDuration capped at 60s for Hobby compatibility.
export const maxDuration = 60;

// Per-account wall-clock budget so one large mailbox can't starve the rest.
const PER_ACCOUNT_DEADLINE_MS = 12_000;
// Overall budget; leave headroom under maxDuration for the response.
const TOTAL_DEADLINE_MS = 50_000;
// Look back far enough to recover gaps from multi-day webhook outages.
const RECONCILE_QUERY = 'in:inbox newer_than:14d';

export async function GET(request: NextRequest) {
  const startTime = Date.now();

  // Verify cron secret (same scheme as the other cron routes).
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  console.log('[Reconcile Cron] Starting inbox reconciliation sweep...');

  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Missing Supabase credentials');
    }

    const adminClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    });

    // One reconciliation per distinct mailbox. A refresh_token is required —
    // getGmailClient auto-refreshes the access token on demand, so a stale
    // access_token is fine as long as the refresh_token is valid.
    const { data: tokens, error: tokenError } = await adminClient
      .from('tokens')
      .select('user_email, access_token, refresh_token, provider')
      .not('refresh_token', 'is', null);

    if (tokenError) throw tokenError;
    if (!tokens || tokens.length === 0) {
      return NextResponse.json({ message: 'No accounts to reconcile' });
    }

    // Dedupe by email — the same mailbox can have personal + business rows.
    const byEmail = new Map<string, { access_token: string | null; refresh_token: string | null }>();
    for (const t of tokens) {
      if (!t.user_email) continue;
      if ((t.provider || 'gmail') !== 'gmail') continue; // reconcile only handles Gmail
      const key = t.user_email.toLowerCase();
      if (!byEmail.has(key)) {
        byEmail.set(key, { access_token: t.access_token, refresh_token: t.refresh_token });
      }
    }

    const results: ReconcileResult[] = [];
    let skipped = 0;

    for (const [email, tok] of byEmail) {
      if (Date.now() - startTime > TOTAL_DEADLINE_MS) {
        skipped++;
        continue;
      }
      try {
        const result = await reconcileAccountInbox(email, tok, {
          query: RECONCILE_QUERY,
          softDeadlineMs: PER_ACCOUNT_DEADLINE_MS,
        });
        results.push(result);
        if (result.ticketsCreated > 0) {
          console.warn(`[Reconcile Cron] ${email}: recovered ${result.ticketsCreated} missing ticket(s)`);
        }
      } catch (err) {
        console.error(`[Reconcile Cron] ${email}: failed:`, err);
        results.push({
          email, pagesScanned: 0, threadsSeen: 0, threadsAlreadyTicketed: 0,
          fetched: 0, ticketsCreated: 0, ticketsExisting: 0, errors: 1,
          nextPageToken: null, completed: false,
        });
      }
    }

    const totalCreated = results.reduce((s, r) => s + r.ticketsCreated, 0);
    const totalErrors = results.reduce((s, r) => s + r.errors, 0);
    const duration = Date.now() - startTime;

    console.log(`[Reconcile Cron] Done in ${duration}ms — accounts=${results.length}, recovered=${totalCreated}, errors=${totalErrors}, skipped(time)=${skipped}`);

    return NextResponse.json({
      success: true,
      durationMs: duration,
      accountsProcessed: results.length,
      accountsSkippedForTime: skipped,
      ticketsRecovered: totalCreated,
      errors: totalErrors,
      results,
    });
  } catch (error) {
    console.error('[Reconcile Cron] Fatal error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
