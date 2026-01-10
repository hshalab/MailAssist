/**
 * PATCH /api/tickets/[id]/tags - Update ticket tags
 */

import { NextRequest, NextResponse } from 'next/server';
import { updateTicketTags } from '@/lib/tickets';
import { getUserEmailForTickets } from '@/lib/ticket-helpers';
import { getCurrentUserIdFromRequest } from '@/lib/permissions';
import { isValidUUID, sanitizeStringArray } from '@/lib/validation';

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

    const body = await request.json();
    const { tags } = body;

    if (!Array.isArray(tags)) {
      return NextResponse.json(
        { error: 'Tags must be an array' },
        { status: 400 }
      );
    }

    // Sanitize and validate tags
    const sanitizedTags = sanitizeStringArray(tags);
    
    // Limit to 20 tags max
    if (sanitizedTags.length > 20) {
      return NextResponse.json(
        { error: 'Maximum 20 tags allowed' },
        { status: 400 }
      );
    }

    // Limit tag length to 50 characters
    const invalidTags = sanitizedTags.filter(tag => tag.length > 50);
    if (invalidTags.length > 0) {
      return NextResponse.json(
        { error: 'Tags must be 50 characters or less' },
        { status: 400 }
      );
    }

    const ticket = await updateTicketTags(ticketId, sanitizedTags, userEmail);

    if (!ticket) {
      return NextResponse.json(
        { error: 'Ticket not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ ticket });
  } catch (error) {
    console.error('Error updating ticket tags:', error);
    return NextResponse.json(
      { error: 'Failed to update ticket tags', details: (error as Error).message },
      { status: 500 }
    );
  }
}





