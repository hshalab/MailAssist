/**
 * Get a specific email by ID
 */

import { NextRequest, NextResponse } from 'next/server';
import { getValidTokens } from '@/lib/token-refresh';
import { getEmailById } from '@/lib/gmail';
import { storeReceivedEmail } from '@/lib/storage';
import { ensureTicketForEmail } from '@/lib/tickets';

type RouteContext =
  | { params: { id: string } }
  | { params: Promise<{ id: string }> };

export async function GET(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const paramsData = await Promise.resolve((context as any).params);
    let emailId = paramsData?.id;
    if (!emailId) {
      const segments = request.nextUrl.pathname.split('/');
      emailId = decodeURIComponent(segments[segments.length - 1] || '');
    }
    if (!emailId) {
      return NextResponse.json(
        { error: 'Missing email id' },
        { status: 400 }
      );
    }



    // Always fetch fresh from Gmail to get attachments
    // (Cached emails don't have attachment metadata)

    // Check for business session to determine which tokens to use
    const { validateBusinessSession, getSessionUserEmail } = await import('@/lib/session');
    const businessSession = await validateBusinessSession();

    // If business session exists, use the business email (shared account)
    // Otherwise fallback to personal session email
    let targetEmail = businessSession
      ? businessSession.email
      : await getSessionUserEmail();

    if (businessSession) {
      console.log(`[Email Detail] Using business session tokens for: ${businessSession.email} (Agent: ${businessSession.name})`);
    } else {
      console.log(`[Email Detail] Personal account mode, targetEmail: ${targetEmail || 'NOT SET'}`);
    }

    let tokens = await getValidTokens(targetEmail, businessSession?.businessId || undefined);

    // FALLBACK: If no tokens found, try alternative methods
    // This triggers when:
    // 1. No business session at all (pure personal account)
    // 2. Business session exists but businessId is null (personal account using session auth)
    const needsFallback = !tokens?.access_token && (!businessSession || !businessSession.businessId);
    if (needsFallback) {
      console.log('[Email Detail] No tokens via getValidTokens, trying fallback methods...');

      // Method 1: Try loadBusinessTokens if we have an email
      if (targetEmail) {
        const { loadBusinessTokens } = await import('@/lib/storage');
        const connectedAccounts = await loadBusinessTokens(null, targetEmail);
        if (connectedAccounts.length > 0) {
          tokens = connectedAccounts[0].tokens;
          console.log(`[Email Detail] Found tokens via loadBusinessTokens for: ${connectedAccounts[0].email}`);
        }
      }

      // Method 2: If still no tokens, try to find ANY personal account tokens using Service Role
      // This handles the case where session cookie isn't set
      // CRITICAL: Use Service Role client to bypass RLS (same as loadBusinessTokens)
      if (!tokens?.access_token) {
        console.log('[Email Detail] Attempting direct query with Service Role client...');
        const { createClient } = await import('@supabase/supabase-js');
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
        const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

        if (supabaseUrl && serviceRoleKey) {
          const adminClient = createClient(supabaseUrl, serviceRoleKey, {
            auth: { persistSession: false }
          });

          const { data: tokenData, error: tokenError } = await adminClient
            .from('tokens')
            .select('*')
            .is('business_id', null)
            .order('updated_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (tokenError) {
            console.log('[Email Detail] Direct query error:', tokenError.message);
          } else if (tokenData?.access_token) {
            tokens = {
              access_token: tokenData.access_token,
              refresh_token: tokenData.refresh_token,
              expiry_date: tokenData.expiry_date,
              token_type: tokenData.token_type,
              scope: tokenData.scope,
            };
            console.log(`[Email Detail] Found personal account tokens via direct query for: ${tokenData.user_email}`);
          } else {
            console.log('[Email Detail] No personal account tokens found in database');
          }
        } else {
          console.log('[Email Detail] Missing Supabase Service Role credentials');
        }
      }
    }

    if (!tokens || !tokens.access_token) {
      console.log(`[Email Detail] No tokens found for targetEmail: ${targetEmail}, businessId: ${businessSession?.businessId}`);
      return NextResponse.json(
        { error: 'Not authenticated. Please connect Gmail first.' },
        { status: 401 }
      );
    }

    // CRITICAL FIX: Handle Ticket ID (UUID) provided instead of Gmail Message ID
    // If input looks like UUID, find the ticket first
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (uuidRegex.test(emailId)) {
      console.log(`[Email Detail] Detected UUID (Ticket ID): ${emailId}, resolving to Gmail Message ID...`);
      const { getTicketById } = await import('@/lib/tickets');
      const { getThreadById } = await import('@/lib/gmail');

      const ticket = await getTicketById(emailId, null, true, null); // viewAll=true to bypass permission checks for resolution

      if (ticket && ticket.threadId) {
        // We have the thread ID, now we need to find the LATEST message in this thread
        // to show as the "main" email content.
        console.log(`[Email Detail] Resolved to Thread ID: ${ticket.threadId}`);

        try {
          const thread = await getThreadById(tokens, ticket.threadId);
          if (thread && thread.messages && thread.messages.length > 0) {
            // Use the last message (newest) as the reference
            // Gmail API returns messages in chronological order (oldest first)
            const latestMessage = thread.messages[thread.messages.length - 1];
            emailId = latestMessage.id;
            console.log(`[Email Detail] Resolved to latest Gmail Message ID: ${emailId}`);
          } else {
            console.warn(`[Email Detail] Ticket ${ticket.id} has thread ${ticket.threadId} but no messages found`);
          }
        } catch (threadError) {
          console.error('[Email Detail] Failed to resolve thread for ticket:', threadError);
          // Fallback: Continue with original ID (will likely fail but safe fallback)
        }
      } else {
        console.warn(`[Email Detail] Ticket ${emailId} not found or has no thread ID`);
      }
    }

    // Fetch the specific email with full content including attachments
    const email = await getEmailById(tokens, emailId);

    if (!email) {
      return NextResponse.json(
        { error: 'Email not found' },
        { status: 404 }
      );
    }

    // Store for future requests (without attachments/embeddings) - non-blocking
    storeReceivedEmail(email).catch(err => console.error('Error storing email:', err));

    // OPTIMIZED: Ensure ticket exists/updated in background (non-blocking)
    // Derive isFromAgent: if email is FROM the connected account, it's an agent email.
    // Do NOT hardcode false — an old agent reply incorrectly treated as customer could reopen a closed ticket.
    const emailFromLower = (email.from || '').toLowerCase();
    const isEmailFromAgent = targetEmail ? emailFromLower.includes(targetEmail.toLowerCase()) : false;

    ensureTicketForEmail(
      {
        id: email.id,
        threadId: email.threadId,
        subject: email.subject,
        from: email.from,
        to: email.to,
        date: email.date,
        ownerEmail: targetEmail || undefined, // Scope ticket lookup to the right account
      },
      isEmailFromAgent
    ).catch(err => console.error('Error creating ticket:', err));

    // Return email with attachments
    const response = NextResponse.json({ email });

    // PERFORMANCE: Aggressive caching for email details
    // Cache for 5 minutes, allow stale content for 10 minutes while revalidating
    response.headers.set(
      'Cache-Control',
      'public, s-maxage=300, stale-while-revalidate=600, max-age=60'
    );

    return response;
  } catch (error) {
    console.error('Error fetching email:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch email',
        details: (error as Error).message,
      },
      { status: 500 }
    );
  }
}


