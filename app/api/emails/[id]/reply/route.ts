/**
 * Send a previously generated draft as a reply via Gmail
 */

import { NextRequest, NextResponse } from 'next/server';
import { getValidTokens } from '@/lib/token-refresh';
import { getEmailById, getUserProfile, sendReplyMessage } from '@/lib/gmail';
import { storeSentEmail, loadDrafts, deleteDraft } from '@/lib/storage';
import { logAIUsage } from '@/lib/analytics';
import { getCurrentUserIdFromRequest, getSessionUserEmailFromRequest } from '@/lib/session';

function stripHtml(html: string) {
  if (!html) return ''
  return html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
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

    let body: { draftText?: string; draftHtml?: string; draftId?: string; attachments?: { filename: string; mimeType: string; data?: string; dataUrl?: string }[] } | null = null;
    try {
      body = await request.json();
    } catch {
      // ignore - body stays null
    }

    const sentDraftText = body?.draftText ?? '';
    const draftText = sentDraftText.trim();
    const draftHtml = (body?.draftHtml || '').trim();
    if (!draftText && !draftHtml) {
      return NextResponse.json(
        { error: 'Draft text is required to send a reply' },
        { status: 400 }
      );
    }

    // Normalize HTML fallback to text when only HTML provided
    const plainTextBody = draftText || stripHtml(draftHtml || '');

    // Attachments validation (optional)
    const maxAttachmentSizeBytes = 8 * 1024 * 1024; // 8 MB per file cap
    const attachments = (body?.attachments || []).map((att) => {
      if (!att?.filename || !att?.mimeType) {
        throw new Error('Invalid attachment metadata');
      }
      const rawData = att.data || (att.dataUrl ? att.dataUrl.split(',')[1] : '');
      if (!rawData) {
        throw new Error('Attachment data missing');
      }
      // Rough size check before decode
      const estimatedBytes = Math.ceil((rawData.length * 3) / 4);
      if (estimatedBytes > maxAttachmentSizeBytes) {
        throw new Error(`Attachment ${att.filename} exceeds 8MB limit`);
      }
      return {
        filename: att.filename,
        mimeType: att.mimeType,
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
      }
    }
    
    if (!tokens || !tokens.access_token) {
      return NextResponse.json(
        { error: 'Not authenticated. Please connect Gmail or ensure your business has connected email accounts.' },
        { status: 401 }
      );
    }

    const incomingEmail = await getEmailById(tokens, emailId);
    if (!incomingEmail) {
      return NextResponse.json(
        { error: 'Email not found' },
        { status: 404 }
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

    const replyRecipient = incomingEmail.from || incomingEmail.to;
    if (!replyRecipient) {
      return NextResponse.json(
        { error: 'Unable to determine reply recipient for this email' },
        { status: 400 }
      );
    }

    const baseSubject = incomingEmail.subject?.trim() || '(No subject)';
    const replySubject = /^re:/i.test(baseSubject)
      ? baseSubject
      : `Re: ${baseSubject}`;

    // CRITICAL FIX: Ensure fromAddress is the connected Gmail account, not the invited user's email
    // For business accounts, use the connected Gmail account email (e.g., support@company.com)
    // For personal accounts, use the user's Gmail email
    let fromAddress: string | undefined;
    try {
      // First try to get from userEmail (which is already set to connected Gmail account for business accounts)
      if (userEmail) {
        fromAddress = userEmail;
      } else {
        // Fallback: get from profile
      const profile = await getUserProfile(tokens);
      fromAddress = profile?.emailAddress || undefined;
      }
    } catch {
      // best-effort, fallback handled below
      if (userEmail) {
        fromAddress = userEmail;
      }
    }
    
    console.log(`[Reply API] Sending email FROM: ${fromAddress} (userEmail: ${userEmail})`);

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
    }

    return NextResponse.json({
      success: true,
      messageId: sentMessage?.id ?? null,
      threadId: sentMessage?.threadId ?? incomingEmail.threadId ?? null,
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


