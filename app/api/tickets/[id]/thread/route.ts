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
import { getGmailClient } from '@/lib/gmail';

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

    // Log initial thread data
    console.log('[Thread API] Fetched thread with', thread.messages?.length || 0, 'messages');
    thread.messages?.forEach((msg: any, i: number) => {
      console.log(`  Message ${i}: has ${msg.attachments?.length || 0} attachments`, msg.attachments?.map((a: any) => a.filename));
    });

    // Fetch attachment data for all messages
    const gmail = getGmailClient(tokens);
    const messagesWithAttachmentData = await Promise.all(
      (thread.messages || []).map(async (msg: any) => {
        if (!msg.attachments || msg.attachments.length === 0) {
          return msg;
        }

        console.log(`[Thread API] Fetching attachment data for message ${msg.id}`);

        const attachmentResults = await Promise.allSettled(
          msg.attachments.map(async (att: any) => {
            try {
              console.log(`[Thread API] Fetching attachment ${att.id} (${att.filename}) from message ${msg.id}`);
              const response = await gmail.users.messages.attachments.get({
                userId: 'me',
                messageId: msg.id,
                id: att.id,
              });

              const attachmentData = response.data.data;
              console.log(`[Thread API] Got attachment data for ${att.filename}: ${attachmentData ? `${attachmentData.length} chars` : 'no data'}`);
              return {
                ...att,
                data: attachmentData || undefined, // base64url encoded
              };
            } catch (error) {
              console.error(`[Thread API] Failed to fetch attachment ${att.id} (${att.filename}) from message ${msg.id}:`, error instanceof Error ? error.message : String(error));
              return att; // Return without data if fetch fails
            }
          })
        );

        const attachmentsWithData = attachmentResults.map((result, idx) => {
          if (result.status === 'fulfilled') {
            return result.value;
          } else {
            console.error('[Thread API] Attachment fetch promise rejected:', result.reason);
            return msg.attachments[idx]; // Return original attachment if promise rejected
          }
        });

        return {
          ...msg,
          attachments: attachmentsWithData,
        };
      })
    );

    // Debug: Log attachment info for each message
    console.log('[Thread API] Returning thread messages with attachments:');
    messagesWithAttachmentData?.forEach((msg: any, i: number) => {
      console.log(`  Message ${i}: ${msg.id}, attachments:`, msg.attachments?.length || 0, msg.attachments?.map((a: any) => ({ id: a.id, filename: a.filename, hasData: !!a.data })));
    });

    const response = NextResponse.json({ messages: messagesWithAttachmentData || [] });

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





