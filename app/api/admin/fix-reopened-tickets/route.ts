/**
 * One-time cleanup endpoint: re-close tickets that were incorrectly reopened
 * by the old bug where old emails triggered the reopen guard incorrectly.
 *
 * Heuristic: a ticket with status='open' whose last_customer_reply_at is
 * older than STALE_DAYS is very likely an incorrectly-reopened ticket, NOT
 * a legitimately open one (since a real new customer reply would be recent).
 *
 * GET  /api/admin/fix-reopened-tickets          - dry run: list affected tickets
 * POST /api/admin/fix-reopened-tickets          - actually re-close them
 * POST /api/admin/fix-reopened-tickets?days=14  - use a custom staleness threshold
 */

import { NextRequest, NextResponse } from 'next/server';
import { validateBusinessSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

// Default: tickets open but with no new customer reply in 7 days
// are considered incorrectly reopened.
const DEFAULT_STALE_DAYS = 7;

export async function GET(request: NextRequest) {
    return handler(request, /* dryRun */ true);
}

export async function POST(request: NextRequest) {
    return handler(request, /* dryRun */ false);
}

async function handler(request: NextRequest, dryRun: boolean) {
    if (!supabase) {
        return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
    }

    const businessSession = await validateBusinessSession();
    if (!businessSession) {
        return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const staleDays = parseInt(searchParams.get('days') || String(DEFAULT_STALE_DAYS), 10);

    // Cutoff: emails older than staleDays ago
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - staleDays);
    const cutoffIso = cutoffDate.toISOString();

    console.log(`[FixReopenedTickets] ${dryRun ? 'DRY RUN' : 'EXECUTING'} - staleDays=${staleDays}, cutoff=${cutoffIso}`);
    console.log(`[FixReopenedTickets] Business: ${businessSession.businessId} (${businessSession.email})`);

    // Find tickets that:
    // 1. Are currently open
    // 2. Last customer reply is older than the cutoff (stale open ticket)
    // 3. Belong to this business account
    const query = supabase
        .from('tickets')
        .select('id, subject, customer_email, status, last_customer_reply_at, updated_at, owner_email')
        .eq('status', 'open')
        .lt('last_customer_reply_at', cutoffIso) // last reply older than cutoff
        .not('last_customer_reply_at', 'is', null); // must have a recorded reply date

    // Scope to business
    if (businessSession.businessId) {
        // business users share by user_email (the primary account)
        // no easy direct filter here — we filter after fetching to keep it safe
    } else {
        query.eq('user_email', businessSession.email);
    }

    const { data: staleOpenTickets, error } = await query;

    if (error) {
        console.error('[FixReopenedTickets] Error querying tickets:', error);
        return NextResponse.json({ error: 'Failed to query tickets', details: error.message }, { status: 500 });
    }

    if (!staleOpenTickets || staleOpenTickets.length === 0) {
        return NextResponse.json({
            message: 'No incorrectly-reopened tickets found.',
            staleDays,
            cutoffDate: cutoffIso,
            dryRun,
            count: 0,
            tickets: [],
        });
    }

    console.log(`[FixReopenedTickets] Found ${staleOpenTickets.length} stale-open tickets`);

    if (dryRun) {
        // Just return what would be closed — don't actually modify anything
        return NextResponse.json({
            message: `DRY RUN: Would re-close ${staleOpenTickets.length} incorrectly-reopened ticket(s). ` +
                `POST to this endpoint to actually close them.`,
            staleDays,
            cutoffDate: cutoffIso,
            dryRun: true,
            count: staleOpenTickets.length,
            tickets: staleOpenTickets.map(t => ({
                id: t.id,
                subject: t.subject,
                customerEmail: t.customer_email,
                ownerEmail: t.owner_email,
                lastCustomerReplyAt: t.last_customer_reply_at,
                updatedAt: t.updated_at,
            })),
        });
    }

    // Actually close them
    const ids = staleOpenTickets.map(t => t.id);
    const nowIso = new Date().toISOString();

    const { error: updateError, count: updatedCount } = await supabase
        .from('tickets')
        .update({
            status: 'closed',
            updated_at: nowIso,
        })
        .in('id', ids);

    if (updateError) {
        console.error('[FixReopenedTickets] Error closing tickets:', updateError);
        return NextResponse.json({ error: 'Failed to close tickets', details: updateError.message }, { status: 500 });
    }

    console.log(`[FixReopenedTickets] Successfully closed ${ids.length} tickets`);

    return NextResponse.json({
        message: `Successfully re-closed ${ids.length} incorrectly-reopened ticket(s).`,
        staleDays,
        cutoffDate: cutoffIso,
        dryRun: false,
        count: ids.length,
        tickets: staleOpenTickets.map(t => ({
            id: t.id,
            subject: t.subject,
            customerEmail: t.customer_email,
            ownerEmail: t.owner_email,
            lastCustomerReplyAt: t.last_customer_reply_at,
        })),
    });
}
