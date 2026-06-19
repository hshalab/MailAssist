/**
 * GET /api/tickets/[id]/thread - Get conversation thread for a ticket
 */

import { NextRequest, NextResponse } from 'next/server';
import { getTicketById } from '@/lib/tickets';
import { getThreadById } from '@/lib/gmail';
import { getCurrentUserIdFromRequest } from '@/lib/permissions';
import { canViewAllTickets } from '@/lib/permissions';
import { getCurrentUserEmail } from '@/lib/storage';

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
    const userEmail = await getCurrentUserEmail();

    if (!userId || !userEmail) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    // Check permissions
    const canViewAll = await canViewAllTickets(userId);
    // Pass businessId so business accounts can open tickets owned by ANY of
    // their connected mailboxes (not just the primary) — otherwise the list
    // shows the ticket but the thread fetch returns "Ticket not found".
    const { validateBusinessSession } = await import('@/lib/session');
    const businessSession = await validateBusinessSession();
    const ticket = await getTicketById(ticketId, userId, canViewAll, userEmail, businessSession?.businessId || null);

    if (!ticket) {
      return NextResponse.json(
        { error: 'Ticket not found or access denied' },
        { status: 404 }
      );
    }

    // Fetch the conversation. The thread may live in ANY connected mailbox, so
    // resolve via fan-out (the ticket's owner mailbox first) rather than a single
    // primary token — this is what fixes "Failed to fetch thread" for tickets
    // owned by a non-primary mailbox.
    const ownerHint = ticket.ownerEmail || ticket.userEmail;
    const { withMailboxFallback } = await import('@/lib/mailbox-resolver');
    const { result: fetched, candidateCount } = await withMailboxFallback<{ messages: any[] }>(
      { ownerEmailHint: ownerHint, businessId: businessSession?.businessId || null, sessionEmail: userEmail },
      async (tok) => {
        const t = await getThreadById(tok, ticket.threadId);
        return (t && t.messages?.length) ? t : null;
      }
    );

    // No connected mailbox at all → tell the user to reconnect (don't silently
    // show "No messages yet", which hides a revoked/expired Gmail connection).
    if (candidateCount === 0) {
      return NextResponse.json(
        { error: 'No connected Gmail account for this ticket. Please reconnect Gmail.' },
        { status: 401 }
      );
    }

    let thread: { messages: any[] } | null = fetched;

    // Graceful: if still nothing, return empty messages (client shows
    // "No messages yet") rather than a hard "Failed to fetch thread".
    if (!thread) {
      thread = { messages: [] };
    }

    console.log('[Thread API] Fetched thread with', thread.messages?.length || 0, 'messages');

    // PERFORMANCE: Do NOT download attachment binaries here.
    // Previously this made one extra Gmail API call per attachment (downloading
    // full base64 data) BEFORE the conversation could render. On threads with
    // attachments that was slow and could exceed the serverless function timeout,
    // failing the whole request — so the user saw "No messages yet" and a long
    // spinner. We now return messages with attachment METADATA immediately; the
    // client lazy-loads each attachment's bytes on demand via
    // /api/emails/[id]/attachments/[attachmentId] (already used by the email
    // viewer for inline images and by the download links).
    const response = NextResponse.json({ messages: thread.messages || [] });

    // PERFORMANCE: Cache thread details
    // Short cache time because threads get new messages
    // stale-while-revalidate allows instant load while fetching updates in background
    response.headers.set(
      'Cache-Control',
      'public, max-age=30, stale-while-revalidate=300'
    );

    return response;
  } catch (error) {
    console.error('Error fetching ticket thread:', error);
    return NextResponse.json(
      { error: 'Failed to fetch thread', details: (error as Error).message },
      { status: 500 }
    );
  }
}





