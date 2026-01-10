/**
 * PATCH /api/tickets/[id]/priority - Update ticket priority
 */

import { NextRequest, NextResponse } from 'next/server';
import { updateTicketPriority } from '@/lib/tickets';
import { getUserEmailForTickets } from '@/lib/ticket-helpers';
import { getCurrentUserIdFromRequest, canReassignTickets } from '@/lib/permissions';
import { isValidUUID, isValidTicketPriority } from '@/lib/validation';

type RouteContext =
  | { params: { id: string } }
  | { params: Promise<{ id: string }> };

export async function PATCH(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const paramsData = await Promise.resolve((context as any).params);
    const ticketId = paramsData?.id;

    if (!ticketId || !isValidUUID(ticketId)) {
      return NextResponse.json(
        { error: 'Invalid or missing ticket ID' },
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

    // Check permissions - Admin/Manager can always update priority
    // Agents can update priority when taking/assigning tickets to themselves
    const canEdit = await canReassignTickets(userId);
    
    if (!canEdit) {
      // For Agents, allow setting priority when taking a ticket
      // Check if ticket is unassigned (they're taking it) or already assigned to them
      const { getTicketById } = await import('@/lib/tickets');
      const ticket = await getTicketById(ticketId, userId, false, userEmail);
      
      if (!ticket) {
        return NextResponse.json(
          { error: 'Ticket not found' },
          { status: 404 }
        );
      }
      
      // Allow if ticket is unassigned (they're taking it) or already assigned to them
      const isUnassigned = !ticket.assigneeUserId;
      const isAssignedToSelf = ticket.assigneeUserId === userId;
      
      if (!isUnassigned && !isAssignedToSelf) {
        return NextResponse.json(
          { error: 'Permission denied. You can only set priority for tickets assigned to you.' },
          { status: 403 }
        );
      }
    }

    const body = await request.json();
    const { priority } = body;

    if (!isValidTicketPriority(priority)) {
      return NextResponse.json(
        { error: 'Invalid priority. Must be: low, medium, high, or urgent' },
        { status: 400 }
      );
    }

    const ticket = await updateTicketPriority(ticketId, priority, userEmail);

    if (!ticket) {
      return NextResponse.json(
        { error: 'Ticket not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ ticket });
  } catch (error) {
    console.error('Error updating ticket priority:', error);
    return NextResponse.json(
      { error: 'Failed to update ticket priority', details: (error as Error).message },
      { status: 500 }
    );
  }
}





