/**
 * PATCH /api/tickets/[id]/status - Update ticket status
 */

import { NextRequest, NextResponse } from 'next/server';
import { updateTicketStatus } from '@/lib/tickets';
import { getUserEmailForTickets } from '@/lib/ticket-helpers';
import { getCurrentUserIdFromRequest } from '@/lib/permissions';
import { isValidUUID, isValidTicketStatus } from '@/lib/validation';
import { validateBusinessSession } from '@/lib/session';

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

    // Try getting userId from cookie first, then fallback to business session
    let userId = getCurrentUserIdFromRequest(request);
    const businessSession = await validateBusinessSession();
    if (!userId) {
      userId = businessSession?.id || null;
    }

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
    const { status } = body;

    if (!isValidTicketStatus(status)) {
      return NextResponse.json(
        { error: 'Invalid status. Must be: open, pending, on_hold, or closed' },
        { status: 400 }
      );
    }

    // Pass businessId for proper multi-email account support
    const businessId = businessSession?.businessId || null;
    const ticket = await updateTicketStatus(ticketId, status, userEmail, businessId);

    if (!ticket) {
      return NextResponse.json(
        { error: 'Ticket not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ ticket }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      }
    });
  } catch (error) {
    console.error('Error updating ticket status:', error);
    return NextResponse.json(
      { error: 'Failed to update ticket status', details: (error as Error).message },
      { status: 500 }
    );
  }
}





