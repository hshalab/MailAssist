/**
 * GET /api/tickets/[id]/thread - Get conversation thread for a ticket
 */

import { NextRequest, NextResponse } from 'next/server';
import { getTicketById } from '@/lib/tickets';
import { getThreadById } from '@/lib/gmail';
import { getValidTokens } from '@/lib/token-refresh';
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
    const ticket = await getTicketById(ticketId, userId, canViewAll, userEmail);

    if (!ticket) {
      return NextResponse.json(
        { error: 'Ticket not found or access denied' },
        { status: 404 }
      );
    }

    // Get tokens and fetch thread
    // First try the ticket's user_email, then fallback to current user's email
    // Get tokens and fetch thread
    // CRITICAL FIX: Use ownerEmail (the connected account) to fetch the thread.
    // The thread ID corresponds to the mailbox of ownerEmail.
    const targetEmail = ticket.ownerEmail || ticket.userEmail;
    console.log(`[Thread API] Fetching tokens for ${targetEmail} (Owner: ${ticket.ownerEmail}, User: ${ticket.userEmail})`);

    let tokens = await getValidTokens(targetEmail);

    // Fallback: If target email doesn't have tokens, try current session email
    // (Only if it's different from what we already tried)
    if ((!tokens || !tokens.access_token) && userEmail && userEmail !== targetEmail) {
      console.log(`[Thread] Target email ${targetEmail} has no tokens, trying current user ${userEmail}`);
      tokens = await getValidTokens(userEmail);
    }

    if (!tokens || !tokens.access_token) {
      console.error(`[Thread API] Authentication failed for ${targetEmail}. Owner: ${ticket.ownerEmail}, User: ${ticket.userEmail}`);
      // DEBUG: Verify directly if tokens exist
      const { loadTokens } = await import('@/lib/storage');
      const directCheck = await loadTokens(targetEmail);
      console.log(`[Thread API] Direct token check for ${targetEmail}: ${directCheck ? 'Found' : 'Missing'}`);

      return NextResponse.json(
        { error: `No valid Gmail tokens found for ${targetEmail}. Please reconnect your Gmail account.` },
        { status: 401 }
      );
    }

    const thread = await getThreadById(tokens, ticket.threadId);

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





