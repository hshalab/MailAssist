import { NextRequest, NextResponse } from 'next/server';
import { getValidTokens } from '@/lib/token-refresh';
import { getThreadById } from '@/lib/gmail';

type RouteContext =
  | { params: { threadId: string } }
  | { params: Promise<{ threadId: string }> };

export async function GET(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const paramsData = await Promise.resolve((context as any).params);
    let threadId = paramsData?.threadId;

    if (!threadId) {
      const segments = request.nextUrl.pathname.split('/');
      threadId = decodeURIComponent(segments[segments.length - 1] || '');
    }

    if (!threadId) {
      return NextResponse.json(
        { error: 'Missing thread id' },
        { status: 400 }
      );
    }


    // Check for business session to determine which tokens to use
    const { validateBusinessSession, getSessionUserEmail } = await import('@/lib/session');
    const businessSession = await validateBusinessSession();

    // If business session exists, use the business email (shared account)
    // Otherwise fallback to personal session email
    const targetEmail = businessSession
      ? businessSession.email
      : await getSessionUserEmail();

    if (businessSession) {
      console.log(`[Email Thread] Using business session tokens for: ${businessSession.email} (Agent: ${businessSession.name})`);
    }

    const tokens = await getValidTokens(targetEmail, businessSession?.businessId || undefined);

    if (!tokens || !tokens.access_token) {
      return NextResponse.json(
        { error: 'Not authenticated. Please connect Gmail first.' },
        { status: 401 }
      );
    }

    const thread = await getThreadById(tokens, threadId);

    if (!thread) {
      return NextResponse.json(
        { error: 'Thread not found' },
        { status: 404 }
      );
    }

    // Debug: Log attachment info for each message
    console.log('[Email Thread API] Thread messages with attachments:');
    thread.messages?.forEach((msg, i) => {
      console.log(`  Message ${i}: ${msg.id}, attachments:`, msg.attachments?.length || 0, msg.attachments);
    });

    return NextResponse.json({ thread });
  } catch (error) {
    console.error('Error fetching email thread:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch email thread',
        details: (error as Error).message,
      },
      { status: 500 }
    );
  }
}


