/**
 * ONE-TIME Reclassification Endpoint
 * 
 * This endpoint reclassifies ALL tickets (including already classified ones)
 * using the enhanced classifier with sender domain, customer history, etc.
 * 
 * Usage: POST /api/reclassify-all
 * Query params:
 *   - limit: number of tickets to process (default: 100, max: 500)
 *   - dryRun: if "true", only show what would be classified without updating
 * 
 * After running this, the normal classification flow will only classify
 * unclassified tickets going forward.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { classifyTicketToDepartmentAsync } from '@/lib/tickets';
import { validateBusinessSession } from '@/lib/session';

export const maxDuration = 300; // 5 minutes for large batches

export async function POST(request: NextRequest) {
    try {
        // Validate session - only admins should be able to do this
        const session = await validateBusinessSession();
        if (!session) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        if (!supabase) {
            return NextResponse.json({ error: 'Database not available' }, { status: 500 });
        }

        const url = new URL(request.url);
        const limit = Math.min(parseInt(url.searchParams.get('limit') || '100'), 500);
        const dryRun = url.searchParams.get('dryRun') === 'true';
        const businessId = session.businessId;

        console.log(`[Reclassify-All] Starting reclassification for business ${businessId}, limit: ${limit}, dryRun: ${dryRun}`);

        // Fetch ALL tickets for this business (including already classified ones)
        let query = supabase
            .from('tickets')
            .select('id, subject, customer_email, thread_id, user_email, department_id, departments(name)')
            .order('created_at', { ascending: false })
            .limit(limit);

        // Filter by business if applicable
        if (businessId) {
            // For business accounts, get all tickets associated with connected accounts
            const { data: connectedAccounts } = await supabase
                .from('gmail_tokens')
                .select('email')
                .eq('business_id', businessId);

            if (connectedAccounts && connectedAccounts.length > 0) {
                const emails = connectedAccounts.map(a => a.email);
                query = query.in('user_email', emails);
            }
        }

        const { data: tickets, error } = await query;

        if (error) {
            console.error('[Reclassify-All] Query error:', error);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        if (!tickets || tickets.length === 0) {
            return NextResponse.json({
                message: 'No tickets found to reclassify',
                processed: 0
            });
        }

        console.log(`[Reclassify-All] Found ${tickets.length} tickets to reclassify`);

        if (dryRun) {
            // Just show what would be processed
            return NextResponse.json({
                dryRun: true,
                message: `Would reclassify ${tickets.length} tickets`,
                tickets: tickets.map(t => ({
                    id: t.id,
                    subject: t.subject,
                    currentDepartment: (t.departments as any)?.name || 'Unclassified',
                    customerEmail: t.customer_email
                }))
            });
        }

        // Clear existing department assignments so they get reclassified
        // This triggers the normal classification flow
        const ticketIds = tickets.map(t => t.id);

        await supabase
            .from('tickets')
            .update({
                department_id: null,
                classification_confidence: null,
                updated_at: new Date().toISOString()
            })
            .in('id', ticketIds);

        console.log(`[Reclassify-All] Cleared department assignments for ${ticketIds.length} tickets`);

        // Now trigger reclassification for each
        const results: { id: string; subject: string; status: string }[] = [];

        for (const ticket of tickets) {
            try {
                // Fetch email body for this ticket
                let bodyText = '';
                if (ticket.thread_id) {
                    const { data: emails } = await supabase
                        .from('emails')
                        .select('body')
                        .eq('thread_id', ticket.thread_id)
                        .order('date', { ascending: true })
                        .limit(1);

                    if (emails && emails[0]?.body) {
                        bodyText = emails[0].body;
                    }
                }

                // Trigger async classification with enhanced context
                await classifyTicketToDepartmentAsync(
                    ticket.id,
                    ticket.subject,
                    bodyText || 'No content available',
                    ticket.user_email || null,
                    ticket.customer_email || null,
                    ticket.thread_id || null
                );

                results.push({
                    id: ticket.id,
                    subject: ticket.subject,
                    status: 'Reclassification triggered'
                });
            } catch (ticketError) {
                console.error(`[Reclassify-All] Error processing ticket ${ticket.id}:`, ticketError);
                results.push({
                    id: ticket.id,
                    subject: ticket.subject,
                    status: `Error: ${ticketError instanceof Error ? ticketError.message : 'Unknown'}`
                });
            }
        }

        const successCount = results.filter(r => r.status === 'Reclassification triggered').length;

        console.log(`[Reclassify-All] Completed: ${successCount}/${tickets.length} tickets`);

        return NextResponse.json({
            message: `Reclassification triggered for ${successCount} tickets`,
            processed: tickets.length,
            success: successCount,
            failed: tickets.length - successCount,
            results
        });

    } catch (error) {
        console.error('[Reclassify-All] Unexpected error:', error);
        return NextResponse.json({
            error: 'Reclassification failed',
            details: error instanceof Error ? error.message : 'Unknown error'
        }, { status: 500 });
    }
}

// GET to check status / info
export async function GET() {
    return NextResponse.json({
        endpoint: '/api/reclassify-all',
        description: 'Reclassifies ALL tickets using the enhanced AI classifier',
        usage: {
            method: 'POST',
            queryParams: {
                limit: 'Number of tickets to process (default: 100, max: 500)',
                dryRun: 'Set to "true" to see what would be classified without making changes'
            }
        },
        warning: 'This will clear and re-run classification on existing tickets. Use with caution.'
    });
}
