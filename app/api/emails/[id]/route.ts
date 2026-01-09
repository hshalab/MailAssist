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
    const targetEmail = businessSession
      ? businessSession.email
      : await getSessionUserEmail();

    if (businessSession) {
      console.log(`[Email Detail] Using business session tokens for: ${businessSession.email} (Agent: ${businessSession.name})`);
    }

    const tokens = await getValidTokens(targetEmail, businessSession?.businessId || undefined);

    if (!tokens || !tokens.access_token) {
      return NextResponse.json(
        { error: 'Not authenticated. Please connect Gmail first.' },
        { status: 401 }
      );
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
    ensureTicketForEmail(
      {
        id: email.id,
        threadId: email.threadId,
        subject: email.subject,
        from: email.from,
        to: email.to,
        date: email.date,
      },
      false
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


