/**
 * POST /api/tickets/bulk - Bulk update tickets (status, assignee, tags, etc.)
 */

import { NextRequest, NextResponse } from 'next/server';
import { updateTicketStatus, assignTicket, updateTicketTags } from '@/lib/tickets';
import { getCurrentUserIdFromRequest } from '@/lib/permissions';
import { getUserEmailForTickets } from '@/lib/ticket-helpers';

export async function POST(request: NextRequest) {
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

    const body = await request.json();
    const { ticketIds, status, assigneeUserId, tags } = body;

    if (!ticketIds || !Array.isArray(ticketIds) || ticketIds.length === 0) {
      return NextResponse.json(
        { error: 'ticketIds must be a non-empty array' },
        { status: 400 }
      );
    }

    const results = [];
    const errors = [];

    for (const ticketId of ticketIds) {
      try {
        let updatedTicket = null;

        // Update status if provided
        if (status && ['open', 'pending', 'on_hold', 'closed'].includes(status)) {
          updatedTicket = await updateTicketStatus(ticketId, status, userEmail);
        }

        // Update assignee if provided
        if (assigneeUserId !== undefined) {
          const assigneeId = assigneeUserId === null || assigneeUserId === '' ? null : assigneeUserId;
          updatedTicket = await assignTicket(ticketId, assigneeId, userEmail, userId);
        }

        // Update tags if provided
        if (tags !== undefined && Array.isArray(tags)) {
          updatedTicket = await updateTicketTags(ticketId, tags, userEmail);
        }

        if (updatedTicket) {
          results.push({ ticketId, success: true, ticket: updatedTicket });
        } else {
          errors.push({ ticketId, error: 'Ticket not found or update failed' });
        }
      } catch (err) {
        errors.push({ 
          ticketId, 
          error: err instanceof Error ? err.message : 'Unknown error' 
        });
      }
    }

    return NextResponse.json({
      success: errors.length === 0,
      updated: results.length,
      failed: errors.length,
      results,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error('Error in bulk update:', error);
    return NextResponse.json(
      { error: 'Failed to update tickets', details: (error as Error).message },
      { status: 500 }
    );
  }
}

