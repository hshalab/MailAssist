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

    let tokens: any = null;
    let targetEmail: string | null = null;

    // STRATEGY: Find the owner of this thread to use the correct tokens
    // 1. Check if there is a ticket for this thread
    const { supabase } = await import('@/lib/supabase');
    if (supabase) {
      // Use admin client if possible/needed, or just regular client
      // Check tickets table
      const { data: ticket } = await supabase
        .from('tickets')
        .select('owner_email, user_email')
        .eq('thread_id', threadId)
        .limit(1)
        .maybeSingle();

      if (ticket) {
        targetEmail = ticket.owner_email || ticket.user_email;
        console.log(`[Thread/Email API] Found ticket for thread ${threadId}, using email: ${targetEmail}`);
      } else {
        // 2. Check emails table
        const { data: email } = await supabase
          .from('emails')
          .select('owner_email')
          .or(`thread_id.eq.${threadId},id.eq.${threadId}`) // threadId might be emailId
          .not('owner_email', 'is', null) // Only valid owners
          .limit(1)
          .maybeSingle();

        if (email?.owner_email) {
          targetEmail = email.owner_email;
          console.log(`[Thread/Email API] Found email for thread ${threadId}, using owner: ${targetEmail}`);
        }
      }
    }

    // 3. If targetEmail found, use it
    if (targetEmail) {
      tokens = await getValidTokens(targetEmail);
    } else {
      // 4. Fallback to session user
      console.log(`[Thread/Email API] No owner found for thread ${threadId}, falling back to session user`);
      tokens = await getValidTokens();
    }

    if (!tokens || !tokens.access_token) {
      return NextResponse.json(
        { error: `Not authenticated. Please connect Gmail first.${targetEmail ? ` (Target: ${targetEmail})` : ''}` },
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


