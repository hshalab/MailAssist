/**
 * Cleanup for the runaway "Recover" incident: remove/close tickets that were
 * just created from OLD mail when recovery walked the full inbox history.
 *
 * Targets precisely: tickets created very recently (the recovery window) whose
 * last customer reply is far in the past — i.e. freshly-created tickets for
 * year-old emails. This will NOT touch:
 *   - legitimate recent tickets (recent last_customer_reply_at), or
 *   - pre-existing old tickets (created_at not recent).
 *
 * Safe by default: dryRun returns a count + sample and changes nothing. Pass
 * ?confirm=true to act. Default action is "close" (reversible); ?action=delete
 * removes them. Admin (business session) only.
 *
 * Examples:
 *   POST /api/admin/cleanup-recovered-old                      (preview)
 *   POST /api/admin/cleanup-recovered-old?confirm=true         (close them)
 *   POST /api/admin/cleanup-recovered-old?confirm=true&action=delete
 *   POST /api/admin/cleanup-recovered-old?createdWithinMins=360&olderThanDays=60
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { validateBusinessSession } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const businessSession = await validateBusinessSession();
  if (!businessSession) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  }
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  const sp = request.nextUrl.searchParams;
  const dryRun = sp.get('confirm') !== 'true';
  const action = sp.get('action') === 'delete' ? 'delete' : 'close';
  const createdWithinMins = Math.min(parseInt(sp.get('createdWithinMins') || '240'), 1440);
  const olderThanDays = Math.max(parseInt(sp.get('olderThanDays') || '45'), 14);

  const createdAfter = new Date(Date.now() - createdWithinMins * 60_000).toISOString();
  const replyBefore = new Date(Date.now() - olderThanDays * 24 * 60 * 60_000).toISOString();

  // Scope to this business's connected mailboxes.
  let connectedEmails: string[] = [];
  try {
    const { loadBusinessTokens } = await import('@/lib/storage');
    const accounts = await loadBusinessTokens(businessSession.businessId || null, businessSession.email);
    connectedEmails = accounts.map((a: any) => a.email).filter(Boolean);
  } catch { /* fall through to email scope */ }

  // Freshly-created tickets representing old mail.
  let q = admin
    .from('tickets')
    .select('id, subject, customer_email, created_at, last_customer_reply_at, status, user_email')
    .gte('created_at', createdAfter)
    .lt('last_customer_reply_at', replyBefore)
    .order('created_at', { ascending: false })
    .limit(5000);

  if (connectedEmails.length > 0) q = q.in('user_email', connectedEmails);
  else if (businessSession.email) q = q.eq('user_email', businessSession.email);

  const { data: matches, error } = await q;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const ids = (matches || []).map(m => m.id);

  if (dryRun) {
    return NextResponse.json({
      dryRun: true,
      wouldAffect: ids.length,
      action,
      window: { createdWithinMins, olderThanDays },
      sample: (matches || []).slice(0, 10).map(m => ({
        subject: m.subject,
        customer: m.customer_email,
        lastCustomerReply: m.last_customer_reply_at,
        createdAt: m.created_at,
        status: m.status,
      })),
      note: 'Nothing changed. Re-POST with ?confirm=true to apply (default action=close; add &action=delete to remove).',
    });
  }

  if (ids.length === 0) {
    return NextResponse.json({ done: true, affected: 0, action });
  }

  // Apply in chunks to stay well within limits.
  let affected = 0;
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    if (action === 'delete') {
      const { error: delErr } = await admin.from('tickets').delete().in('id', chunk);
      if (delErr) return NextResponse.json({ error: delErr.message, affectedSoFar: affected }, { status: 500 });
    } else {
      const { error: updErr } = await admin
        .from('tickets')
        .update({ status: 'closed', updated_at: new Date().toISOString() })
        .in('id', chunk);
      if (updErr) return NextResponse.json({ error: updErr.message, affectedSoFar: affected }, { status: 500 });
    }
    affected += chunk.length;
  }

  return NextResponse.json({ done: true, affected, action, window: { createdWithinMins, olderThanDays } });
}
