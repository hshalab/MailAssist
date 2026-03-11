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
import { supabase } from '@/lib/supabase';

// Force dynamic rendering for this route
export const dynamic = 'force-dynamic';
// Cache configuration: revalidate every 0 seconds (instant)
export const revalidate = 0;

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const type = searchParams.get('type') || 'inbox'; // 'inbox' or 'sent'
    const q = searchParams.get('q'); // optional Gmail query (labels etc.)
    const accountFilter = searchParams.get('account'); // NEW: Filter by specific account email

    // Safely parse maxResults to avoid NaN/invalid values (e.g., "[object Object]")
    // CRITICAL: Reduce initial limit for faster loading - start with 50 instead of 150
    const maxResultsRaw = searchParams.get('maxResults');
    const parsedMax = maxResultsRaw ? Number(maxResultsRaw) : 50; // Reduced from 150 to 50 for faster initial load
    const maxResults = Number.isFinite(parsedMax)
      ? Math.min(Math.max(parsedMax, 1), 300) // clamp between 1 and 300
      : 50; // Default to 50 for faster initial load

    let emails: any[] = [];

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
    if (businessSession) {
      const { fetchAllInboxEmails, fetchAllSentEmails } = await import('@/lib/email-service');
      const { loadBusinessTokens } = await import('@/lib/storage');

      // For personal accounts (no businessId), use sessionEmail if businessSession.email is not what we want
      const effectiveEmail = businessSession.businessId ? businessSession.email : (sessionEmail || businessSession.email);

      // CRITICAL FIX: Get list of connected accounts FIRST to filter emails
      // This ensures we only show emails from accounts that are still connected
      const connectedAccounts = await loadBusinessTokens(businessSession.businessId, effectiveEmail);
      const connectedEmails = new Set(connectedAccounts.map(acc => acc.email));

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

      // CRITICAL FIX: Filter out emails from disconnected accounts
      // Only show emails from accounts that are still connected
      if (connectedEmails.size > 0) {
        emails = emails.filter((email: any) => {
          // If email has ownerEmail, it must be in connected accounts
          // If no ownerEmail, allow it (legacy emails)
          return !email.ownerEmail || connectedEmails.has(email.ownerEmail);
        });
        console.log(`[API] Filtered emails to ${emails.length} from ${connectedEmails.size} connected accounts`);
      } else {
        // No connected accounts, return empty
        console.log('[API] No connected accounts found, returning empty email list');
        emails = [];
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
      // No business session - check if user is authenticated at all
      const isAuth = await isAuthenticated();

      if (!isAuth) {
        // User is not logged in at all
        return NextResponse.json(
          { error: 'Not authenticated. Please log in first.' },
          { status: 401 }
        );
      }

      // User is authenticated but might not have connected accounts yet
      // Try to fetch from connected accounts anyway (for business users without session)
      const { fetchAllInboxEmails, fetchAllSentEmails } = await import('@/lib/email-service');
      const { loadBusinessTokens } = await import('@/lib/storage');

      // Try to load tokens for this user
      const connectedAccounts = await loadBusinessTokens(null, sessionEmail || undefined);

      if (connectedAccounts.length === 0) {
        // No connected accounts found - return helpful error
        return NextResponse.json(
          { error: 'No email accounts connected. Please connect your Gmail account.', code: 'GMAIL_NOT_CONNECTED' },
          { status: 400 } // Bad Request instead of Unauthorized
        );
      }

      // Fetch emails from connected accounts
      if (type === 'sent') {
        emails = await fetchAllSentEmails(null, maxResults, sessionEmail || undefined);
      } else {
        emails = await fetchAllInboxEmails(null, maxResults, q || undefined, sessionEmail || undefined);

        // Apply spam/trash filters
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

      // Filter by account if specified
      if (accountFilter) {
        console.log(`[API] Filtering emails by account: ${accountFilter}`);
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

    // CRITICAL FIX: Re-add department enrichment to sync labels between Tickets and Inbox
    // Use efficient batch query to get department info for all emails at once
    // This adds minimal overhead (~50ms) but keeps labels in sync
    if (emails.length > 0 && supabase) {
      try {
        // Get thread IDs for all emails
        const threadIds = emails
          .map((email: any) => email.threadId || email.id)
          .filter(Boolean);

        if (threadIds.length > 0) {
          // Batch query to get department info for all threads at once
          const { data: tickets } = await supabase
            .from('tickets')
            .select(`
              thread_id,
              department:departments(name)
            `)
            .in('thread_id', threadIds);

          if (tickets && tickets.length > 0) {
            // Create a map of threadId -> departmentName for fast lookup
            const deptMap = new Map<string, string>();
            tickets.forEach((ticket: any) => {
              if (ticket.department && ticket.department.name) {
                deptMap.set(ticket.thread_id, ticket.department.name);
              }
            });

            // Enrich emails with department names
            emails = emails.map((email: any) => {
              const threadId = email.threadId || email.id;
              const departmentName = deptMap.get(threadId);
              return {
                ...email,
                departmentName: departmentName || null
              };
            });

            console.log(`[EMAILS] Enriched ${emails.length} emails with department info (${deptMap.size} have departments)`);
          }
        }
      } catch (enrichError) {
        // Non-blocking - if enrichment fails, still return emails without department info
        console.error('[EMAILS] Department enrichment failed (non-blocking):', enrichError);
      }
    }

    // ============================================================
    // SMART SYNC: Immediate Ticket Creation (recent emails only)
    // ============================================================
    // Only process emails that arrived within the last 7 days.
    // This prevents old emails (10-34 days old) from being fed into
    // ensureTicketForEmail on every page load, which was causing closed
    // tickets to randomly reopen via the reopen guard in lib/tickets.ts.
    if (emails.length > 0) {
      try {
        const { ensureTicketForEmail } = await import('@/lib/tickets');

        // Compute cutoff: only emails newer than 7 days ago
        const SMART_SYNC_MAX_AGE_DAYS = 7;
        const smartSyncCutoff = new Date();
        smartSyncCutoff.setDate(smartSyncCutoff.getDate() - SMART_SYNC_MAX_AGE_DAYS);

        // Check up to the 10 newest emails, but filter to only those within the cutoff window
        const recentEmails = emails
          .slice(0, 10)
          .filter((email: any) => {
            try {
              return new Date(email.date) >= smartSyncCutoff;
            } catch {
              return false; // Skip emails with unparseable dates
            }
          });

        if (recentEmails.length === 0) {
          console.log('[EMAILS] Smart Sync: no emails newer than 7 days in top 10, skipping ticket creation');
        } else {
          // CRITICAL FIX: Deduplicate by threadId BEFORE running in parallel.
          // Without this, two emails from the same thread would both pass the existence
          // check simultaneously and BOTH create a ticket (race condition).
          const latestByThread = new Map<string, any>();
          recentEmails.forEach((email: any) => {
            const threadId = email.threadId || email.id;
            const existing = latestByThread.get(threadId);
            if (!existing || new Date(email.date) > new Date(existing.date)) {
              latestByThread.set(threadId, email);
            }
          });
          const uniqueRecentEmails = Array.from(latestByThread.values());
          console.log(`[EMAILS] Smart Sync: processing ${uniqueRecentEmails.length} unique threads (from ${recentEmails.length} emails) newer than ${SMART_SYNC_MAX_AGE_DAYS} days`);

          // Process in parallel for speed
          await Promise.all(uniqueRecentEmails.map(async (email: any) => {
            // If we already found a department name, the ticket definitely exists and is classified
            // If not, it might be missing OR just unclassified.
            // ensureTicketForEmail is safe to call (idempotent-ish) - it checks existence first.
            if (!email.departmentName) {
              // Skip spam emails in the smart sync path — the Gmail webhook handles
              // spam ticket creation in real-time going forward. We never backfill
              // old spam here so agents don't get flooded with historical junk.
              const emailLabels: string[] = email.labels || [];
              if (emailLabels.includes('SPAM')) return;

              // Extract bare email address from "Name <email@domain.com>" format before comparing.
              // Raw .includes() on the full FROM string is unreliable and can throw on null.
              const extractBareEmail = (s: string) => {
                if (!s) return '';
                const m = s.match(/<([^>]+)>/) || s.match(/([^\s<>]+@[^\s<>]+)/);
                return m ? m[1].toLowerCase() : s.toLowerCase();
              };
              const fromBare = extractBareEmail(email.from || '');
              const ownerBare = extractBareEmail(email.ownerEmail || '');
              const isFromAgent = ownerBare && fromBare === ownerBare;

              await ensureTicketForEmail({
                id: email.id,
                threadId: email.threadId || email.id,
                subject: email.subject,
                from: email.from,
                to: email.to,
                date: email.date,
                ownerEmail: email.ownerEmail
              }, !!isFromAgent, email.body);
            }
          }));
        }
      } catch (smartSyncError) {
        // Non-blocking error handling
        console.error('[EMAILS] Smart Sync failed:', smartSyncError);
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

