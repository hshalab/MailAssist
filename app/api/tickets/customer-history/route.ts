/**
 * GET /api/tickets/customer-history - Get ticket history for a specific customer
 * Returns previous tickets from the same customer email for timeline view
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserIdFromRequest, canViewAllTickets } from '@/lib/permissions';
import { getUserEmailForTickets } from '@/lib/ticket-helpers';
import { supabase } from '@/lib/supabase';

export async function GET(request: NextRequest) {
    try {
        const userId = getCurrentUserIdFromRequest(request);

        if (!userId) {
            return NextResponse.json(
                { error: 'Not authenticated' },
                { status: 401 }
            );
        }

        const userEmail = await getUserEmailForTickets();
        if (!userEmail) {
            return NextResponse.json(
                { error: 'No Gmail account connected' },
                { status: 400 }
            );
        }

        // Get customer email from query params
        const { searchParams } = new URL(request.url);
        const customerEmail = searchParams.get('email');
        const excludeTicketId = searchParams.get('excludeTicketId'); // Current ticket to exclude

        if (!customerEmail) {
            return NextResponse.json(
                { error: 'Customer email is required' },
                { status: 400 }
            );
        }

        if (!supabase) {
            return NextResponse.json(
                { error: 'Database not configured' },
                { status: 500 }
            );
        }

        // Check if user can view all tickets
        const canViewAll = await canViewAllTickets(userId);

        // Build query for customer's previous tickets
        let query = supabase
            .from('tickets')
            .select(`
        id,
        thread_id,
        subject,
        status,
        priority,
        created_at,
        updated_at,
        last_customer_reply_at,
        assignee_user_id,
        department_id,
        departments:department_id (
          id,
          name
        ),
        assignee:users!tickets_assignee_user_id_fkey (
          id,
          name
        )
      `)
            .eq('customer_email', customerEmail)
            .eq('user_email', userEmail)
            .order('last_customer_reply_at', { ascending: false, nullsFirst: false })
            .limit(50);

        // Exclude current ticket if provided
        if (excludeTicketId) {
            query = query.neq('id', excludeTicketId);
        }

        // Apply role-based filtering for agents
        if (!canViewAll) {
            // Agents can only see tickets they own or unassigned tickets
            const { data: userDepts } = await supabase
                .from('user_departments')
                .select('department_id')
                .eq('user_id', userId);

            const deptIds = userDepts?.map((ud: any) => ud.department_id) || [];

            if (deptIds.length > 0) {
                query = query.or(`assignee_user_id.eq.${userId},and(assignee_user_id.is.null,department_id.in.(${deptIds.join(',')}))`);
            } else {
                query = query.or(`assignee_user_id.eq.${userId},assignee_user_id.is.null`);
            }
        }

        const { data: tickets, error } = await query;

        if (error) {
            console.error('Error fetching customer history:', error);
            return NextResponse.json(
                { error: 'Failed to fetch customer history', details: error.message },
                { status: 500 }
            );
        }

        // Transform tickets to a cleaner format
        const history = (tickets || []).map((ticket: any) => ({
            id: ticket.id,
            threadId: ticket.thread_id,
            subject: ticket.subject,
            status: ticket.status,
            priority: ticket.priority,
            createdAt: ticket.created_at,
            updatedAt: ticket.updated_at,
            lastCustomerReplyAt: ticket.last_customer_reply_at,
            assigneeUserId: ticket.assignee_user_id,
            assigneeName: ticket.assignee?.name || null,
            departmentId: ticket.department_id,
            departmentName: ticket.departments?.name || null,
        }));

        return NextResponse.json({
            customerEmail,
            ticketCount: history.length,
            tickets: history,
        });
    } catch (error) {
        console.error('Error in customer-history API:', error);
        return NextResponse.json(
            { error: 'Failed to fetch customer history', details: (error as Error).message },
            { status: 500 }
        );
    }
}
