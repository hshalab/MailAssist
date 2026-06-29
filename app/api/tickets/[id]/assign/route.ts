/**
 * PATCH /api/tickets/[id]/assign - Assign ticket to a user
 * - Admin/Manager: Can assign to anyone or unassign
 * - Agent: Can only assign tickets to themselves (take ticket)
 */

import { NextRequest, NextResponse } from 'next/server';
import { assignTicket } from '@/lib/tickets';
import { getCurrentUserIdFromRequest } from '@/lib/permissions';
import { canReassignTickets } from '@/lib/permissions';
import { getUserEmailForTickets } from '@/lib/ticket-helpers';
import { isValidUUID } from '@/lib/validation';

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

    // Get current user ID
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

    // Parse request body
    const body = await request.json();
    const { assigneeUserId, priority } = body; // null to unassign, or UUID to assign

    // Check permissions
    const canReassign = await canReassignTickets(userId);
    const isAssigningToSelf = assigneeUserId === userId;
    
    // Agents can only assign tickets to themselves (not to others, not unassign)
    if (!canReassign) {
      if (!isAssigningToSelf) {
        return NextResponse.json(
          { error: 'Permission denied. Agents can only assign tickets to themselves.' },
          { status: 403 }
        );
      }
      // Agents cannot unassign tickets (only assign to themselves)
      if (assigneeUserId === null) {
        return NextResponse.json(
          { error: 'Permission denied. Agents cannot unassign tickets.' },
          { status: 403 }
        );
      }
    }

    // Validate assigneeUserId if provided
    if (assigneeUserId !== null && assigneeUserId !== undefined) {
      if (!isValidUUID(assigneeUserId)) {
        return NextResponse.json(
          { error: 'Invalid assignee user ID format' },
          { status: 400 }
        );
      }

      // CRITICAL: Verify the assignee user is active before assigning
      const { getUserById } = await import('@/lib/users');
      const assigneeUser = await getUserById(assigneeUserId);
      if (!assigneeUser || !assigneeUser.isActive) {
        console.error(`[Assign] Attempted to assign ticket to inactive user: ${assigneeUserId}`);
        return NextResponse.json(
          { error: 'Cannot assign ticket to inactive user' },
          { status: 400 }
        );
      }
    }

    // CRITICAL: Verify the current user is active before allowing assignment
    const { getUserById } = await import('@/lib/users');
    const currentUser = await getUserById(userId);
    if (!currentUser || !currentUser.isActive) {
      console.error(`[Assign] Inactive user attempting to assign ticket: ${userId}`);
      return NextResponse.json(
        { error: 'Your account has been deactivated' },
        { status: 403 }
      );
    }

    // Business-aware scoping: the ticket may belong to any connected mailbox,
    // so pass businessId (without it, assigning a non-primary-mailbox ticket fails).
    const { validateBusinessSession } = await import('@/lib/session');
    const businessId = (await validateBusinessSession())?.businessId || null;

    // Assign the ticket (and update priority if provided)
    const ticket = await assignTicket(ticketId, assigneeUserId || null, userEmail, userId, businessId);

    if (!ticket) {
      return NextResponse.json(
        { error: 'Ticket not found or assignment failed' },
        { status: 404 }
      );
    }
    
    // Update priority if provided (done after assignment for simplicity)
    if (priority && assigneeUserId) {
      const { updateTicketPriority } = await import('@/lib/tickets');
      await updateTicketPriority(ticketId, priority, userEmail, businessId);
      // Fetch updated ticket to return
      const { getTicketById } = await import('@/lib/tickets');
      const { canViewAllTickets } = await import('@/lib/permissions');
      const canViewAll = await canViewAllTickets(userId);
      const updatedTicket = await getTicketById(ticketId, userId, canViewAll, userEmail, businessId);
      return NextResponse.json({ ticket: updatedTicket });
    }

    return NextResponse.json({ ticket });
  } catch (error) {
    console.error('Error assigning ticket:', error);
    return NextResponse.json(
      { error: 'Failed to assign ticket', details: (error as Error).message },
      { status: 500 }
    );
  }
}
