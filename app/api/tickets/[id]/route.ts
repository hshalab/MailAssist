/**
 * GET /api/tickets/[id] - Get a single ticket by ID
 * Role-based access: Agents can only view their own tickets or unassigned tickets
 */

import { NextRequest, NextResponse } from 'next/server';
import { getTicketById } from '@/lib/tickets';
import { getCurrentUserIdFromRequest } from '@/lib/permissions';
import { canViewAllTickets } from '@/lib/permissions';
import { getUserEmailForTickets } from '@/lib/ticket-helpers';

type RouteContext =
  | { params: { id: string } }
  | { params: Promise<{ id: string }> };

export async function GET(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const paramsData = await Promise.resolve((context as any).params);
    const ticketId = paramsData?.id;

    if (!ticketId) {
      return NextResponse.json(
        { error: 'Missing ticket ID' },
        { status: 400 }
      );
    }

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

    // Check if user can view all tickets (Admin/Manager)
    const canViewAll = await canViewAllTickets(userId);

    // Get ticket (with permission check built-in)
    const ticket = await getTicketById(ticketId, userId, canViewAll, userEmail);

    if (!ticket) {
      return NextResponse.json(
        { error: 'Ticket not found or access denied' },
        { status: 404 }
      );
    }

    return NextResponse.json({ ticket });
  } catch (error) {
    console.error('Error fetching ticket:', error);
    return NextResponse.json(
      { error: 'Failed to fetch ticket', details: (error as Error).message },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/tickets/[id] - Update ticket (e.g., department)
 */
export async function PATCH(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const paramsData = await Promise.resolve((context as any).params);
    const ticketId = paramsData?.id;

    if (!ticketId) {
      return NextResponse.json(
        { error: 'Missing ticket ID' },
        { status: 400 }
      );
    }

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

    const body = await request.json();
    const { departmentId } = body;

    // Import supabase for the update
    const { createServerClient } = await import('@/lib/supabase-client');
    const supabase = createServerClient();

    // Update the ticket's department
    const { data: ticket, error: updateError } = await supabase
      .from('tickets')
      .update({
        department_id: departmentId || null,
        updated_at: new Date().toISOString()
      })
      .eq('id', ticketId)
      .eq('user_email', userEmail)
      .select(`
        *,
        departments:department_id (
          id,
          name
        )
      `)
      .single();

    if (updateError) {
      console.error('Error updating ticket department:', updateError);
      return NextResponse.json(
        { error: 'Failed to update ticket', details: updateError.message },
        { status: 500 }
      );
    }

    // Transform to match expected format
    const transformedTicket = {
      ...ticket,
      id: ticket.id,
      emailId: ticket.email_id,
      threadId: ticket.thread_id,
      subject: ticket.subject,
      customerEmail: ticket.customer_email,
      customerName: ticket.customer_name,
      status: ticket.status,
      priority: ticket.priority,
      tags: ticket.tags || [],
      assigneeUserId: ticket.assignee_user_id,
      userEmail: ticket.user_email,
      createdAt: ticket.created_at,
      updatedAt: ticket.updated_at,
      lastCustomerReplyAt: ticket.last_customer_reply_at,
      departmentId: ticket.department_id,
      departmentName: ticket.departments?.name || null,
    };

    return NextResponse.json({ ticket: transformedTicket });
  } catch (error) {
    console.error('Error updating ticket:', error);
    return NextResponse.json(
      { error: 'Failed to update ticket', details: (error as Error).message },
      { status: 500 }
    );
  }
}

