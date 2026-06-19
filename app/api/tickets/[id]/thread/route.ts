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

    // MULTI-MAILBOX: the thread may live in a different connected mailbox than
    // the one we resolved tokens for. If the primary fetch fails or comes back
    // empty, try each connected account's tokens until the thread is found —
    // otherwise the user sees "Failed to fetch thread" for non-primary mailboxes.
    let thread: { messages: any[] } | null = null;
    try {
      thread = await getThreadById(tokens, ticket.threadId);
    } catch (primaryErr) {
      console.warn('[Thread API] Primary tokens failed to fetch thread, trying other connected accounts:', primaryErr instanceof Error ? primaryErr.message : primaryErr);
    }

    if (!thread || !(thread.messages?.length)) {
      try {
        const { loadBusinessTokens } = await import('@/lib/storage');
        const accounts = await loadBusinessTokens(businessSession?.businessId || null, targetEmail || undefined);
        for (const acc of accounts) {
          if (acc.tokens?.access_token === tokens.access_token) continue; // already tried
          try {
            const t = await getThreadById(acc.tokens, ticket.threadId);
            if (t && t.messages?.length) { thread = t; break; }
          } catch { /* try next account */ }
        }
      } catch (fanoutErr) {
        console.warn('[Thread API] Cross-account thread fetch fallback failed:', fanoutErr);
      }
    }

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





