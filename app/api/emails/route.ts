/**
 * Email fetching endpoint
 * Fetches inbox emails and sent emails from Gmail
 */

import { NextRequest, NextResponse } from 'next/server';
import { getValidTokens } from '@/lib/token-refresh';
import { fetchInboxEmails, fetchSentEmails } from '@/lib/gmail';
import { storeSentEmail, storeReceivedEmail } from '@/lib/storage';
import { ensureTicketForEmail } from '@/lib/tickets';
import { validateBusinessSession, isAuthenticated } from '@/lib/session';

// Force dynamic rendering for this route
export const dynamic = 'force-dynamic';
// Cache configuration: revalidate every 30 seconds
export const revalidate = 30;

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const type = searchParams.get('type') || 'inbox'; // 'inbox' or 'sent'
    const q = searchParams.get('q'); // optional Gmail query (labels etc.)
    const accountFilter = searchParams.get('account'); // NEW: Filter by specific account email

    // Safely parse maxResults to avoid NaN/invalid values (e.g., "[object Object]")
    const maxResultsRaw = searchParams.get('maxResults');
    const parsedMax = maxResultsRaw ? Number(maxResultsRaw) : 150;
    const maxResults = Number.isFinite(parsedMax)
      ? Math.min(Math.max(parsedMax, 1), 300) // clamp between 1 and 300 for faster initial load
      : 150;

    let emails;

    // Check for business session first
    const businessSession = await validateBusinessSession();
    const { getSessionUserEmail } = await import('@/lib/session');
    const sessionEmail = await getSessionUserEmail();

    if (businessSession) {
      console.log(`[API] Valid business session found: ${businessSession.businessId} (${businessSession.email})`);
    } else {
      console.log(`[API] No business session found. Session email: ${sessionEmail}`);
    }

    // If business session exists, fetch from ALL connected accounts
    // If business session exists, fetch from ALL connected accounts
    if (businessSession) {
      const { fetchAllInboxEmails, fetchAllSentEmails } = await import('@/lib/email-service');

      // For personal accounts (no businessId), use sessionEmail if businessSession.email is not what we want
      const effectiveEmail = businessSession.businessId ? businessSession.email : (sessionEmail || businessSession.email);

      if (type === 'sent') {
        emails = await fetchAllSentEmails(businessSession.businessId, maxResults, effectiveEmail);
      } else {
        emails = await fetchAllInboxEmails(businessSession.businessId, maxResults, q || undefined, effectiveEmail);

        // Apply spam/trash filters (same logic as before)
        const isViewingSpam = q?.includes('label:SPAM') || q?.includes('in:spam');
        const isViewingTrash = q?.includes('label:TRASH') || q?.includes('in:trash');

        if (!isViewingSpam && !isViewingTrash) {
          emails = emails.filter((email: any) => {
            const labels = email.labels || [];
            const blockedLabels = ['SPAM', 'TRASH'];
            return !labels.some((label: string) => blockedLabels.includes(label));
          });
        }
      }

      // NEW: Filter by account if specified
      if (accountFilter) {
        console.log(`[API] Filtering emails by account: ${accountFilter}`);
        emails = emails.filter((email: any) => {
          // Check ownerEmail field (the account that received/sent this email)
          return email.ownerEmail === accountFilter;
        });
        console.log(`[API] After account filter: ${emails.length} emails`);
      }
    } else {
      // Legacy flow: Single account (Gmail tokens)
      const tokens = await getValidTokens();

      if (!tokens || !tokens.access_token) {
        // Check if user is logged in via business session (but no tokens found)
        const isAuth = await isAuthenticated();

        if (isAuth) {
          // User is logged in but hasn't connected Gmail yet
          return NextResponse.json(
            { error: 'Gmail not connected. Please connect your Gmail account.', code: 'GMAIL_NOT_CONNECTED' },
            { status: 400 } // Bad Request instead of Unauthorized
          );
        }

        return NextResponse.json(
          { error: 'Not authenticated. Please connect Gmail first.' },
          { status: 401 }
        );
      }

      if (type === 'sent') {
        emails = await fetchSentEmails(tokens, maxResults, false);
      } else {
        if (q) {
          emails = await fetchInboxEmails(tokens, maxResults, q, false);
        } else {
          emails = await fetchInboxEmails(tokens, maxResults, undefined, false);
        }

        const isViewingSpam = q?.includes('label:SPAM') || q?.includes('in:spam');
        const isViewingTrash = q?.includes('label:TRASH') || q?.includes('in:trash');

        if (!isViewingSpam && !isViewingTrash) {
          emails = emails.filter((email: any) => {
            const labels = email.labels || [];
            const blockedLabels = ['SPAM', 'TRASH'];
            return !labels.some((label: string) => blockedLabels.includes(label));
          });
        }
      }

      // For personal accounts with account filter, filter by ownerEmail
      if (accountFilter) {
        console.log(`[API] Filtering personal account emails by: ${accountFilter}`);
        emails = emails.filter((email: any) => email.ownerEmail === accountFilter);
      }
    }

    // ============================================================
    // REMOVED: Background ticket processing
    // ============================================================
    // This was causing tickets to reopen on every page load because
    // ensureTicketForEmail was being called for ALL emails each time
    // the inbox was fetched. Ticket creation should ONLY happen:
    // 1. During initial email sync (sync/route.ts)
    // 2. When viewing a specific email (/emails/[id])
    // 3. When receiving push notifications from Gmail
    // ============================================================

    // Enrich emails with department info if available
    if (emails && emails.length > 0) {
      const threadIds = Array.from(new Set(emails.map((e: any) => e.threadId)));
      const { supabase } = await import('@/lib/supabase');

      if (supabase) {
        const { data: threadTickets } = await supabase
          .from('tickets')
          .select(`
            thread_id,
            department:departments(name)
          `)
          .in('thread_id', threadIds);

        if (threadTickets) {
          const deptMap = new Map();
          threadTickets.forEach((t: any) => {
            if (t.department?.name) {
              deptMap.set(t.thread_id, t.department.name);
            }
          });

          emails = emails.map((e: any) => ({
            ...e,
            departmentName: deptMap.get(e.threadId) || null
          }));
        }
      }
    }

    // Return emails immediately - ticket creation happens in background
    console.log(`[EMAILS] Successfully fetched ${emails.length} emails`);
    const response = NextResponse.json({ emails, count: emails.length });

    // Add cache headers for client-side and CDN caching
    // Cache for 30 seconds, allow stale-while-revalidate for up to 60 seconds
    response.headers.set(
      'Cache-Control',
      'public, s-maxage=30, stale-while-revalidate=60, max-age=0'
    );

    return response;
  } catch (error) {
    console.error('[EMAILS] Error fetching emails:', error);
    return NextResponse.json(
      { error: 'Failed to fetch emails', details: (error as Error).message },
      { status: 500 }
    );
  }
}

