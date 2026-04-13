import { NextRequest, NextResponse } from 'next/server';
import { validateBusinessSession, getSessionUserEmail } from '@/lib/session';
import { loadBusinessTokens } from '@/lib/storage';
import { moveMessagesOutOfSpam, getEmailById } from '@/lib/gmail';
import { ensureTicketForEmail, updateTicketTags } from '@/lib/tickets';
import { runAutoClassify } from '@/lib/auto-classify';

export const dynamic = 'force-dynamic';

type BulkUnspamItem = {
  id: string;
  ownerEmail?: string;
};

export async function POST(request: NextRequest) {
  try {
    const businessSession = await validateBusinessSession();
    const sessionEmail = await getSessionUserEmail();

    if (!businessSession && !sessionEmail) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const body = await request.json();
    const items = (body?.items || []) as BulkUnspamItem[];

    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'items must be a non-empty array' }, { status: 400 });
    }

    const validItems = items.filter((item) => item?.id && typeof item.id === 'string');
    if (validItems.length === 0) {
      return NextResponse.json({ error: 'No valid message IDs provided' }, { status: 400 });
    }

    const businessId = businessSession?.businessId || null;
    const effectiveSessionEmail = businessSession?.email || sessionEmail || undefined;
    const accounts = await loadBusinessTokens(businessId, effectiveSessionEmail);

    if (!accounts.length) {
      return NextResponse.json({ error: 'No connected email accounts found' }, { status: 400 });
    }

    const accountMap = new Map<string, any>();
    for (const account of accounts) {
      if (account?.email) {
        accountMap.set(account.email.toLowerCase(), account);
      }
    }

    const grouped = new Map<string, string[]>();

    for (const item of validItems) {
      const owner = (item.ownerEmail || '').toLowerCase();
      const resolvedOwner = owner && accountMap.has(owner)
        ? owner
        : accounts[0].email.toLowerCase();

      const list = grouped.get(resolvedOwner) || [];
      list.push(item.id);
      grouped.set(resolvedOwner, list);
    }

    const results: Array<{ id: string; ownerEmail: string; success: boolean; error?: string; ticketId?: string | null }> = [];
    let processedCount = 0;

    for (const [ownerEmail, messageIds] of grouped.entries()) {
      const account = accountMap.get(ownerEmail);
      if (!account?.tokens) {
        for (const id of messageIds) {
          results.push({ id, ownerEmail, success: false, error: 'No tokens for selected account' });
        }
        continue;
      }

      try {
        await moveMessagesOutOfSpam(account.tokens, messageIds);
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Failed to move messages out of spam';
        for (const id of messageIds) {
          results.push({ id, ownerEmail, success: false, error: msg });
        }
        continue;
      }

      for (const id of messageIds) {
        try {
          const email = await getEmailById(account.tokens, id);
          if (!email) {
            results.push({ id, ownerEmail, success: false, error: 'Email not found after move' });
            continue;
          }

          const ticket = await ensureTicketForEmail(
            {
              id: email.id,
              threadId: email.threadId,
              subject: email.subject,
              from: email.from,
              to: email.to,
              date: email.date,
              ownerEmail,
            },
            false,
            email.body,
            false
          );

          if (ticket?.id && Array.isArray(ticket.tags) && ticket.tags.includes('spam')) {
            const cleanedTags = ticket.tags.filter((t) => t !== 'spam');
            await updateTicketTags(ticket.id, cleanedTags, ownerEmail);
          }

          processedCount++;
          results.push({ id, ownerEmail, success: true, ticketId: ticket?.id || null });
        } catch (error) {
          results.push({
            id,
            ownerEmail,
            success: false,
            error: error instanceof Error ? error.message : 'Failed to create/update ticket',
          });
        }
      }
    }

    if (processedCount > 0) {
      try {
        await runAutoClassify({
          limit: Math.min(processedCount, 30),
          businessId,
          userEmail: effectiveSessionEmail || null,
          days: 7,
        });
      } catch (classifyError) {
        console.warn('[Bulk Unspam] Auto classify failed (non-blocking):', classifyError);
      }
    }

    const successCount = results.filter((r) => r.success).length;
    const failureCount = results.length - successCount;

    return NextResponse.json({
      success: failureCount === 0,
      total: results.length,
      moved: successCount,
      failed: failureCount,
      results,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Failed to process bulk unspam',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
