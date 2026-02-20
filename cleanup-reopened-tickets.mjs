/**
 * cleanup-reopened-tickets.mjs
 * Run with: node cleanup-reopened-tickets.mjs
 *
 * Targets ONLY tickets that the bug incorrectly reopened, using TWO conditions:
 *
 *   1. updated_at is RECENT  (within last 6 hours — when the bug was running)
 *   2. last_customer_reply_at is OLD  (older than STALE_REPLY_DAYS)
 *
 * This means:
 *  - "System just touched it today, but the last customer message was days ago"
 *    → definitely a bug victim, NOT a real new reply.
 *
 * Tickets legitimately reopened by a real customer reply will have
 * last_customer_reply_at = very recent, so they are SAFE.
 *
 * Tickets that were already open for a long time (not reopened today) will have
 * updated_at = old, so they are SAFE too.
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// ---- Load .env.local manually ----
function loadEnv() {
    const envPaths = ['.env.local', '.env'];
    for (const envPath of envPaths) {
        try {
            const content = readFileSync(resolve(process.cwd(), envPath), 'utf8');
            for (const line of content.split('\n')) {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith('#')) continue;
                const eqIdx = trimmed.indexOf('=');
                if (eqIdx < 0) continue;
                const key = trimmed.slice(0, eqIdx).trim();
                const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
                if (!process.env[key]) process.env[key] = val;
            }
            console.log(`Loaded env from ${envPath}`);
            break;
        } catch {
            // file not found, try next
        }
    }
}

loadEnv();

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('ERROR: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars.');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

// ---- Config ----

// Condition 1: How recently the bug touched the ticket.
// 6 hours covers the window from when this bug was active today.
// Increase to 24 if you want to be safe and catch any from earlier today too.
const RECENT_UPDATE_HOURS = 24;

// Condition 2: How old the last customer reply must be to be considered stale.
// 2 days = catches the 2-3 day old cases the bug triggered.
// If the customer ACTUALLY replied 2 days ago, the ticket should stay closed anyway
// (they can send another reply to reopen it, and the fix is now in place).
const STALE_REPLY_DAYS = 2;

// ---- Compute cutoffs ----
const recentUpdateCutoff = new Date();
recentUpdateCutoff.setHours(recentUpdateCutoff.getHours() - RECENT_UPDATE_HOURS);

const staleReplyCutoff = new Date();
staleReplyCutoff.setDate(staleReplyCutoff.getDate() - STALE_REPLY_DAYS);

console.log(`\n=== Cleanup: re-close incorrectly reopened tickets ===`);
console.log(`Condition 1 — updated_at AFTER:      ${recentUpdateCutoff.toISOString()} (last ${RECENT_UPDATE_HOURS}h)`);
console.log(`Condition 2 — last_customer_reply BEFORE: ${staleReplyCutoff.toISOString()} (older than ${STALE_REPLY_DAYS} days)`);
console.log('');

// ---- Find affected tickets ----
const { data: bugVictims, error: queryError } = await supabase
    .from('tickets')
    .select('id, subject, customer_email, owner_email, status, last_customer_reply_at, updated_at')
    .eq('status', 'open')
    .gt('updated_at', recentUpdateCutoff.toISOString())       // recently touched by bug
    .lt('last_customer_reply_at', staleReplyCutoff.toISOString()) // but old customer reply
    .not('last_customer_reply_at', 'is', null);

if (queryError) {
    console.error('Query failed:', queryError.message);
    process.exit(1);
}

if (!bugVictims || bugVictims.length === 0) {
    console.log('✅ No affected tickets found. Nothing to do.');
    process.exit(0);
}

console.log(`Found ${bugVictims.length} ticket(s) to re-close:\n`);
for (const t of bugVictims) {
    const replyAge = Math.round((Date.now() - new Date(t.last_customer_reply_at).getTime()) / (1000 * 60 * 60 * 24));
    console.log(`  [${t.id}]  "${t.subject?.slice(0, 55)}" | ${t.customer_email} | last reply: ${replyAge} day(s) ago`);
}

// ---- Re-close them ----
const ids = bugVictims.map(t => t.id);
const nowIso = new Date().toISOString();

const { error: updateError } = await supabase
    .from('tickets')
    .update({ status: 'closed', updated_at: nowIso })
    .in('id', ids);

if (updateError) {
    console.error('\nFailed to close tickets:', updateError.message);
    process.exit(1);
}

console.log(`\n✅ Successfully re-closed ${ids.length} ticket(s).`);
console.log('   These had: status=open, updated today, but last_customer_reply > 2 days ago.');
console.log('   Any future genuine reply from the customer will correctly reopen them.');
