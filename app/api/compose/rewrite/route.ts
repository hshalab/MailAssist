import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserIdFromRequest } from '@/lib/permissions';
import { getCurrentUserEmail } from '@/lib/storage';
import { rewriteAgentText, getOpenAIApiKey } from '@/lib/ai-draft';
import { checkRateLimit, checkDailyLimit, getRequestIdentity } from '@/lib/rate-limit';

export async function POST(request: NextRequest) {
  try {
    const userId = getCurrentUserIdFromRequest(request);
    if (!userId) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    const userEmail = await getCurrentUserEmail();
    if (!userEmail) {
      return NextResponse.json(
        { error: 'No Gmail account connected' },
        { status: 400 }
      );
    }

    const identity = userId || userEmail || getRequestIdentity(request.headers);

    // Short-window: max 5 rewrites per minute
    const shortWindow = checkRateLimit(`rewrite:${identity}`, 5, 60 * 1000);
    if (!shortWindow.allowed) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Please wait before rewriting again.' },
        { status: 429 }
      );
    }

    // Daily cap: max 20 rewrites per day
    const daily = await checkDailyLimit(`rewrite-daily:${identity}`, 20);
    if (!daily.allowed) {
      return NextResponse.json(
        { error: 'Daily rewrite limit reached for this account.' },
        { status: 429 }
      );
    }

    const apiKey = getOpenAIApiKey();
    if (!apiKey) {
      return NextResponse.json(
        { error: 'OpenAI API key not configured' },
        { status: 500 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const { text, tone, language } = body || {};

    if (!text || typeof text !== 'string' || !text.trim()) {
      return NextResponse.json(
        { error: 'Text is required for rewrite' },
        { status: 400 }
      );
    }

    const rewritten = await rewriteAgentText(
      text,
      {
        tone: tone === 'friendly' || tone === 'formal' || tone === 'neutral' ? tone : 'friendly',
        language: typeof language === 'string' ? language : undefined,
      },
      apiKey
    );

    return NextResponse.json({ rewritten });
  } catch (error) {
    console.error('[Compose Rewrite] Error rewriting text:', error);
    return NextResponse.json(
      { error: 'Failed to rewrite text' },
      { status: 500 }
    );
  }
}
