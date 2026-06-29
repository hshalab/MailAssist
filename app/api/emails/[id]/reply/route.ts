/**
 * Send a previously generated draft as a reply via Gmail
 */

import { NextRequest, NextResponse } from 'next/server';
import { getValidTokens } from '@/lib/token-refresh';
import { getEmailById, getUserProfile, sendReplyMessage, getGmailClient } from '@/lib/gmail';
import { storeSentEmail, loadDrafts, deleteDraft } from '@/lib/storage';
import { logAIUsage } from '@/lib/analytics';
import { getCurrentUserIdFromRequest, getSessionUserEmailFromRequest } from '@/lib/session';

function stripHtml(html: string): string {
  if (!html) return ''
  // Remove script and style tags completely
  let cleaned = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
  // Convert common HTML entities to plain text
  cleaned = cleaned.replace(/&nbsp;?/gi, ' ')
    .replace(/\u00A0/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
  // Convert line breaks to newlines before removing tags
  cleaned = cleaned.replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
  // Remove all remaining HTML tags
  cleaned = cleaned.replace(/<[^>]+>/g, '')
  // Normalize whitespace but preserve line breaks
  cleaned = cleaned.replace(/[ \t]+/g, ' ') // Multiple spaces to single
    .replace(/\n{3,}/g, '\n\n') // Max 2 consecutive newlines
  return cleaned.trim()
}

type RouteContext =
  | { params: { id: string } }
  | { params: Promise<{ id: string }> };

export async function POST(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const paramsData = await Promise.resolve((context as any).params);
    let emailId = paramsData?.id;
    if (!emailId) {
      const segments = request.nextUrl.pathname.split('/');
      emailId = decodeURIComponent(segments[segments.length - 2] || '');
    }

    if (!emailId) {
      return NextResponse.json(
        { error: 'Missing email id' },
        { status: 400 }
      );
    }

    let body: {
      draftText?: string;
      draftHtml?: string;
      draftId?: string;
      attachments?: { filename?: string; mimeType?: string; name?: string; type?: string; data?: string; dataUrl?: string }[];
      closeTicket?: boolean;
      assignToUser?: boolean;
      to?: string;
      subject?: string;
      forwardAttachments?: { id: string; filename: string; mimeType: string }[];
    } | null = null;
    try {
      body = await request.json();
    } catch {
      // ignore - body stays null
    }

    const sentDraftText = body?.draftText ?? '';
    const draftText = sentDraftText.trim();
    // Normalize non-breaking spaces in HTML to regular spaces so they don't leak through
    const rawDraftHtml = (body?.draftHtml || '').trim();
    const draftHtml = rawDraftHtml.replace(/&nbsp;?/gi, ' ').replace(/\u00A0/g, ' ');
    if (!draftText && !draftHtml) {
      return NextResponse.json(
        { error: 'Draft text is required to send a reply' },
        { status: 400 }
      );
    }

    // CRITICAL: Always strip HTML tags from plain text body to prevent HTML from leaking through
    // If draftText is provided, clean it (might contain HTML). If only HTML provided, convert it.
    let plainTextBody = draftText ? stripHtml(draftText) : stripHtml(draftHtml || '');

    // Ensure plain text body has no HTML tags remaining
    if (plainTextBody && /<[^>]+>/.test(plainTextBody)) {
      plainTextBody = stripHtml(plainTextBody); // Double-check and clean again
    }

    // Convert custom attachments to Gmail format (AttachmentPayload)
    const attachments: { filename: string; mimeType: string; data: string }[] = (body?.attachments || []).map((att) => {
      const filename = att.filename || att.name || 'attachment';
      const mimeType = att.mimeType || att.type || 'application/octet-stream';

      let rawData = att.data || '';
      if (!rawData && att.dataUrl) {
        const parts = att.dataUrl.split(',');
        rawData = parts.length > 1 ? parts[1] : parts[0];
      }

      if (!rawData) {
        throw new Error(`Attachment ${filename} is missing data`);
      }

      return {
        filename,
        mimeType,
        data: rawData,
      };
    });


    // Get user info for logging
    let userEmail = getSessionUserEmailFromRequest(request as any);
    const userId = getCurrentUserIdFromRequest(request as any);

    // CRITICAL FIX: For invited users, get the connected Gmail account email
    if (!userEmail) {
      const { validateBusinessSession } = await import('@/lib/session');
      const businessSession = await validateBusinessSession();

      if (businessSession?.businessId) {
        const { loadBusinessTokens } = await import('@/lib/storage');
        const connectedAccounts = await loadBusinessTokens(businessSession.businessId, businessSession?.email || undefined);
        if (connectedAccounts.length > 0) {
          userEmail = connectedAccounts[0].email;
          console.log(`[Reply API] Invited user, using business account email: ${userEmail}`);
        }
      } else if (businessSession?.email) {
        // FALLBACK: Personal account using session auth (businessId is null)
        const { loadBusinessTokens } = await import('@/lib/storage');
        const connectedAccounts = await loadBusinessTokens(null, businessSession.email);
        if (connectedAccounts.length > 0) {
          userEmail = connectedAccounts[0].email;
          console.log(`[Reply API] Personal account via session, using email: ${userEmail}`);
        }
      }
    }

    // Find the original draft to compare if it was edited
    let originalDraftText = '';
    let draftId = body?.draftId || null;
    let wasEdited = false;

    if (draftId && userEmail) {
      try {
        const drafts = await loadDrafts(userId || null);
        const originalDraft = drafts.find(d => d.id === draftId);
        if (originalDraft) {
          originalDraftText = originalDraft.draftText;
          // Compare original vs sent to determine if edited
          wasEdited = originalDraftText.trim() !== draftText.trim();
        }
      } catch (error) {
        console.warn('[Reply] Could not load original draft for comparison:', error);
      }
    }

    // CRITICAL FIX: For invited users, get tokens from business-connected accounts
    let tokens = await getValidTokens();

    if (!tokens || !tokens.access_token) {
      // Check if this is a business account user (invited agent/manager)
      const { validateBusinessSession } = await import('@/lib/session');
      const businessSession = await validateBusinessSession();

      if (businessSession?.businessId) {
        // For business accounts, try to get tokens from business-connected accounts
        const { loadBusinessTokens } = await import('@/lib/storage');
        const connectedAccounts = await loadBusinessTokens(businessSession.businessId, businessSession?.email || undefined);
        if (connectedAccounts.length > 0) {
          // Use tokens from the first connected account
          tokens = connectedAccounts[0].tokens;
          console.log(`[Reply API] Using business account tokens for invited user`);
        }
      } else if (businessSession?.email) {
        // FALLBACK: Personal account using session auth (businessId is null)
        const { loadBusinessTokens } = await import('@/lib/storage');
        const connectedAccounts = await loadBusinessTokens(null, businessSession.email);
        if (connectedAccounts.length > 0) {
          tokens = connectedAccounts[0].tokens;
          console.log(`[Reply API] Using personal account tokens via session`);
        }
      }
    }

    if (!tokens || !tokens.access_token) {
      return NextResponse.json(
        { error: 'Not authenticated. Please connect Gmail or ensure your business has connected email accounts.' },
        { status: 401 }
      );
    }

    // MULTI-MAILBOX: the message/thread may belong to a NON-primary connected
    // mailbox. Resolve the email — and the tokens we must SEND with — across all
    // connected mailboxes. Without this, replying to e.g. a help@ thread using the
    // primary support@ tokens fails ("Email not found"), so send/close looked
    // broken for that mailbox.
    let incomingEmail = await getEmailById(tokens, emailId).catch(() => null);
    let sendFromEmail: string | undefined = userEmail || undefined;
    if (!incomingEmail) {
      const { validateBusinessSession } = await import('@/lib/session');
      const { withMailboxFallback } = await import('@/lib/mailbox-resolver');
      const bSession = await validateBusinessSession();
      const resolved = await withMailboxFallback<{ e: any; tok: any; email: string }>(
        { businessId: bSession?.businessId || null, sessionEmail: userEmail },
        async (tok, email) => {
          const e = await getEmailById(tok, emailId);
          return e ? { e, tok, email } : null;
        }
      );
      if (resolved.result) {
        incomingEmail = resolved.result.e;
        tokens = resolved.result.tok;          // send from the mailbox that OWNS the thread
        sendFromEmail = resolved.result.email;
      }
    }
    if (!incomingEmail) {
      return NextResponse.json(
        { error: 'Email not found' },
        { status: 404 }
      );
    }
    // Re-narrow after the possible token reassignment above so the send calls
    // below get a non-null token set.
    if (!tokens || !tokens.access_token) {
      return NextResponse.json(
        { error: 'No valid Gmail tokens for the mailbox that owns this thread.' },
        { status: 401 }
      );
    }

    // Try to find associated ticket for logging
    let ticketId: string | null = null;
    try {
      const { getTicketByThreadId } = await import('@/lib/tickets');
      if (incomingEmail.threadId && userEmail) {
        const ticket = await getTicketByThreadId(incomingEmail.threadId, userEmail);
        if (ticket) {
          ticketId = ticket.id;
        }
      }
    } catch (ticketError) {
      // Non-critical - continue without ticket ID
      console.warn('[Reply] Could not find ticket for logging:', ticketError);
    }

    const replyRecipient = body?.to || incomingEmail.from || incomingEmail.to;
    if (!replyRecipient) {
      return NextResponse.json(
        { error: 'Unable to determine reply recipient for this email' },
        { status: 400 }
      );
    }

    const baseSubject = incomingEmail.subject?.trim() || '(No subject)';
    let replySubject: string = body?.subject || '';
    if (!replySubject) {
      replySubject = /^re:/i.test(baseSubject)
        ? baseSubject
        : `Re: ${baseSubject}`;
    }

    // CRITICAL FIX: Ensure fromAddress is the connected Gmail account, not the invited user's email
    // For business accounts, use the connected Gmail account email (e.g., support@company.com)
    // For personal accounts, use the user's Gmail email
    let fromAddress: string | undefined;
    try {
      // Prefer the mailbox that actually owns the thread (resolved above), so the
      // From header matches the tokens we're sending with. Falls back to userEmail.
      if (sendFromEmail) {
        fromAddress = sendFromEmail;
      } else {
        // Fallback: get from profile
        const profile = await getUserProfile(tokens);
        fromAddress = profile?.emailAddress || undefined;
      }
    } catch {
      // best-effort, fallback handled below
      if (sendFromEmail) {
        fromAddress = sendFromEmail;
      }
    }

    console.log(`[Reply API] Sending email FROM: ${fromAddress} (userEmail: ${userEmail})`);

    // Handle forwarded attachments from original message
    if (body?.forwardAttachments && body.forwardAttachments.length > 0) {
      console.log(`[Reply] Fetching ${body.forwardAttachments.length} forwarded attachments from message ${emailId}`);
      const gmail = getGmailClient(tokens);

      for (const att of body.forwardAttachments) {
        try {
          const attResponse = await gmail.users.messages.attachments.get({
            userId: 'me',
            messageId: emailId,
            id: att.id,
          });

          if (attResponse.data.data) {
            // Gmail returns base64url, our AttachmentPayload expects base64
            const base64 = attResponse.data.data.replace(/-/g, '+').replace(/_/g, '/');
            attachments.push({
              filename: att.filename,
              mimeType: att.mimeType,
              data: base64,
            });
          }
        } catch (error) {
          console.warn(`[Reply] Failed to fetch forwarded attachment ${att.id}:`, error);
        }
      }
    }

    const sentMessage = await sendReplyMessage(tokens, {
      to: replyRecipient,
      from: fromAddress,
      subject: replySubject,
      body: plainTextBody,
      bodyHtml: draftHtml || undefined,
      attachments,
      threadId: incomingEmail.threadId,
      inReplyTo: incomingEmail.messageId,
      references: incomingEmail.messageId,
    });

    if (sentMessage?.id) {
      const storedFrom = fromAddress || incomingEmail.to || 'me';
      try {
        await storeSentEmail({
          id: sentMessage.id,
          threadId: sentMessage.threadId ?? incomingEmail.threadId,
          subject: replySubject,
          from: storedFrom,
          to: replyRecipient,
          body: plainTextBody,
          date: new Date().toISOString(),
          labels: sentMessage.labelIds ?? [],
          isReply: true,
        });
      } catch (storeError) {
        console.warn('[Reply] Unable to store sent email metadata:', storeError);
      }

      // Log AI usage: draft sent
      if (userEmail) {
        logAIUsage({
          userEmail,
          userId: userId || null,
          ticketId,
          action: 'draft_sent',
          draftId: draftId || null,
          wasEdited,
          wasSent: true,
          draftLength: draftText.length,
        }).catch((error) => {
          console.error('[Reply] Failed to log AI usage:', error);
          // Don't throw - logging failures shouldn't break the app
        });
      }

      // Delete the draft after successful send
      if (draftId) {
        try {
          await deleteDraft(draftId, userId || null);
        } catch (deleteError) {
          console.warn('[Reply] Failed to delete draft after sending:', deleteError);
          // Don't throw - draft deletion failure shouldn't break the send
        }
      }

      // Auto-assign ticket to replier if unassigned
      if (userId && incomingEmail.threadId) {
        try {
          const { getTicketById, assignTicket, ensureTicketForEmail, updateTicketStatus } = await import('@/lib/tickets');

          // Resolve the EXISTING ticket for this thread across ALL connected
          // mailboxes first. Without this, ensureTicketForEmail scopes to the
          // primary mailbox, fails to find a ticket owned by a non-primary
          // mailbox, and creates a DUPLICATE — so the subsequent auto-assign and
          // close hit the duplicate while the real ticket stays "pending" and
          // unassigned (the reported regression). Passing the real owner email
          // makes ensureTicketForEmail find and update the correct ticket.
          let resolvedOwnerEmail: string | undefined;
          try {
            const { supabase } = await import('@/lib/supabase');
            const { validateBusinessSession } = await import('@/lib/session');
            const bSession = await validateBusinessSession();
            if (supabase && incomingEmail.threadId) {
              let q = supabase
                .from('tickets')
                .select('id, owner_email, user_email')
                .eq('thread_id', incomingEmail.threadId);
              if (bSession?.businessId) {
                const { loadBusinessTokens } = await import('@/lib/storage');
                const conn = await loadBusinessTokens(bSession.businessId);
                const emails = conn.map((a: any) => a.email).filter(Boolean);
                if (emails.length) q = q.in('user_email', emails);
              }
              const { data: existing } = await q.order('created_at', { ascending: true }).limit(1).maybeSingle();
              if (existing) resolvedOwnerEmail = existing.owner_email || existing.user_email || undefined;
            }
          } catch (lookupErr) {
            console.warn('[Reply] Could not resolve existing ticket owner:', lookupErr);
          }

          // 1. Ensure ticket exists and has updated timestamps/status
          // This handles creating the ticket if missing, and updating lastAgentReplyAt/status
          const ticketEmailLike = {
            id: sentMessage?.id || `sent-${Date.now()}`,
            threadId: incomingEmail.threadId,
            subject: incomingEmail.subject || '(No Subject)',
            from: fromAddress || userEmail || 'me',
            to: replyRecipient,
            date: new Date().toISOString(),
            ownerEmail: resolvedOwnerEmail, // scope to the REAL ticket's mailbox
          };

          let ticket = await ensureTicketForEmail(ticketEmailLike, true); // true = isFromAgent
          if (ticket) {
            ticketId = ticket.id;

            // CRITICAL: If ticket is closed, reopen it when agent sends a reply
            // This allows agents to continue conversations on closed tickets
            if (ticket.status === 'closed') {
              console.log(`[Reply] Reopening closed ticket ${ticket.id} due to agent reply`);
              const { validateBusinessSession } = await import('@/lib/session');
              const businessSession = await validateBusinessSession();
              const businessId = businessSession?.businessId || null;
              await updateTicketStatus(ticket.id, 'open', userEmail, businessId);
              // Refresh ticket object after status update
              const { getTicketById } = await import('@/lib/tickets');
              // Correct arguments: ticketId, currentUserId, canViewAll, userEmail
              const refreshedTicket = await getTicketById(ticket.id, userId, true, userEmail);
              if (refreshedTicket) {
                ticket = refreshedTicket;
              }
            }
          }

          // 2. Auto-assign if unassigned OR if requested explicitly
          if (ticket) {
            const shouldAssign = body?.assignToUser || (!ticket.assigneeUserId);

            if (shouldAssign) {
              // CRITICAL: Verify user is active before auto-assigning
              const { getUserById } = await import('@/lib/users');
              const replierUser = await getUserById(userId);
              if (replierUser && replierUser.isActive) {
                console.log(`[Reply] Auto-assigning ticket ${ticket.id} to replier ${userId}`);
                const { validateBusinessSession } = await import('@/lib/session');
                const bId = (await validateBusinessSession())?.businessId || null;
                await assignTicket(ticket.id, userId, userEmail, userId, bId);
              } else {
                console.warn(`[Reply] Skipping auto-assignment - replier ${userId} is inactive`);
              }
            }
          }

          // 3. Close if requested
          if (ticket && body?.closeTicket) {
            console.log(`[Reply] Closing ticket ${ticket.id}`);
            // Get businessId for proper multi-email account support
            const { validateBusinessSession } = await import('@/lib/session');
            const businessSession = await validateBusinessSession();
            const businessId = businessSession?.businessId || null;
            await updateTicketStatus(ticket.id, 'closed', userEmail, businessId);
          }

        } catch (assignError) {
          console.warn('[Reply] Failed to auto-assign/update ticket:', assignError);
        }
      }
    }

    return NextResponse.json({
      success: true,
      messageId: sentMessage?.id ?? null,
      threadId: sentMessage?.threadId ?? incomingEmail.threadId ?? null,
      ticketId: ticketId
    });
  } catch (error) {
    console.error('[Reply] Failed to send draft reply:', error);
    return NextResponse.json(
      {
        error: 'Failed to send reply',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}


