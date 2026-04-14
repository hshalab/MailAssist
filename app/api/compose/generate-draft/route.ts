/**
 * Generate AI draft for new email composition
 */

import { NextRequest, NextResponse } from 'next/server';
import { generateNewEmailDraft } from '@/lib/ai-draft';
import { getCurrentUserIdFromRequest } from '@/lib/permissions';
import { getCurrentUserEmail } from '@/lib/storage';
import { loadStoredEmails } from '@/lib/storage';
import { listKnowledge } from '@/lib/knowledge';
import { getGuardrails } from '@/lib/guardrails';
import { getOpenAIApiKey } from '@/lib/ai-draft';
import { checkDailyLimit, checkRateLimit, getRequestIdentity } from '@/lib/rate-limit';

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
    const shortWindow = checkRateLimit(`compose-draft:${identity}`, 20, 60 * 1000);
    if (!shortWindow.allowed) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Please wait before generating another draft.' },
        { status: 429 }
      );
    }
    const daily = checkDailyLimit(`compose-draft-daily:${identity}`, 150);
    if (!daily.allowed) {
      return NextResponse.json(
        { error: 'Daily draft limit reached for this account. Please try again tomorrow.' },
        { status: 429 }
      );
    }

    // Get current user's name for replacing placeholders in draft
    let userName: string | null = null;
    try {
      const { validateBusinessSession } = await import('@/lib/session');
      const businessSession = await validateBusinessSession();
      if (businessSession?.name) {
        userName = businessSession.name;
      } else if (userId) {
        const { getUserById } = await import('@/lib/users');
        const user = await getUserById(userId);
        if (user?.name) {
          userName = user.name;
        }
      }
    } catch (nameError) {
      console.warn('[Compose Draft] Could not get user name for placeholder replacement:', nameError);
    }

    const body = await request.json();
    const { recipientEmail, recipientName, subject, context } = body;

    if (!recipientEmail || !subject || !context) {
      return NextResponse.json(
        { error: 'Missing required fields: recipientEmail, subject, context' },
        { status: 400 }
      );
    }

    // Load required data
    const [pastEmails, knowledgeItems, guardrails, openaiApiKey] = await Promise.all([
      loadStoredEmails({ limit: 100 }),
      listKnowledge(userEmail),
      getGuardrails(userEmail),
      getOpenAIApiKey(),
    ]);

    if (!openaiApiKey) {
      return NextResponse.json(
        { error: 'OpenAI API key not configured' },
        { status: 500 }
      );
    }

    // Generate AI draft for new email
    const draft = await generateNewEmailDraft(
      recipientEmail,
      recipientName || null,
      subject,
      context,
      pastEmails,
      openaiApiKey,
      knowledgeItems,
      guardrails,
      {
        userEmail,
        userId,
        userName, // Pass user name for placeholder replacement
      }
    );

    return NextResponse.json({ draft });
  } catch (error) {
    console.error('Error generating draft:', error);
    return NextResponse.json(
      { error: 'Failed to generate draft', details: (error as Error).message },
      { status: 500 }
    );
  }
}