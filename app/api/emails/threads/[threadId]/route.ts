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

    const tokens = await getValidTokens();

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

    const response = NextResponse.json({ thread });

    // PERFORMANCE: Cache thread details
    // Short cache time because threads get new messages
    // stale-while-revalidate allows instant load while fetching updates in background
    response.headers.set(
      'Cache-Control',
      'public, max-age=30, stale-while-revalidate=300'
    );

    return response;
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


