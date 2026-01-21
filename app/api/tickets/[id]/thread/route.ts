/**
 * GET /api/tickets/[id]/thread - Get conversation thread for a ticket
 */

import { NextRequest, NextResponse } from 'next/server';
import { getTicketById } from '@/lib/tickets';
import { getThreadById } from '@/lib/gmail';
import { getValidTokens } from '@/lib/token-refresh';
import { getCurrentUserIdFromRequest } from '@/lib/permissions';
import { canViewAllTickets } from '@/lib/permissions';
import { getUserEmailForTickets } from '@/lib/ticket-helpers';
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
    let tokens = await getValidTokens(ticket.userEmail);

    // Fallback: If ticket's userEmail doesn't have tokens, try current user's email
    if ((!tokens || !tokens.access_token) && userEmail && userEmail !== ticket.userEmail) {
      console.log(`[Thread] Ticket userEmail ${ticket.userEmail} has no tokens, trying current user ${userEmail}`);
      tokens = await getValidTokens(userEmail);
    }

    // FALLBACK: For personal accounts using session auth (businessId is null)
    if (!tokens || !tokens.access_token) {
      const { validateBusinessSession } = await import('@/lib/session');
      const businessSession = await validateBusinessSession();

      if (!businessSession || !businessSession.businessId) {
        console.log('[Thread] Trying loadBusinessTokens fallback for personal account...');
        const { loadBusinessTokens } = await import('@/lib/storage');
        const targetEmail = businessSession?.email || userEmail;

        if (targetEmail) {
          const connectedAccounts = await loadBusinessTokens(null, targetEmail);
          if (connectedAccounts.length > 0) {
            tokens = connectedAccounts[0].tokens;
            console.log(`[Thread] Found tokens via loadBusinessTokens for: ${connectedAccounts[0].email}`);
          }
        }
      }
    }

    if (!tokens || !tokens.access_token) {
      return NextResponse.json(
        { error: `No valid Gmail tokens found. Please reconnect your Gmail account.` },
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

    return NextResponse.json({ messages: messagesWithAttachmentData || [] });
  } catch (error) {
    console.error('Error fetching ticket thread:', error);
    return NextResponse.json(
      { error: 'Failed to fetch thread', details: (error as Error).message },
      { status: 500 }
    );
  }
}





