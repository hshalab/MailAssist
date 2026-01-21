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
    let targetEmail = businessSession
      ? businessSession.email
      : await getSessionUserEmail();

    if (businessSession) {
      console.log(`[Email Thread] Using business session tokens for: ${businessSession.email} (Agent: ${businessSession.name})`);
    } else {
      console.log(`[Email Thread] Personal account mode, targetEmail: ${targetEmail || 'NOT SET'}`);
    }

    let tokens = await getValidTokens(targetEmail, businessSession?.businessId || undefined);

    // FALLBACK: If no tokens found, try alternative methods
    // This triggers when:
    // 1. No business session at all (pure personal account)
    // 2. Business session exists but businessId is null (personal account using session auth)
    const needsFallback = !tokens?.access_token && (!businessSession || !businessSession.businessId);
    if (needsFallback) {
      console.log('[Email Thread] No tokens via getValidTokens, trying fallback methods...');

      // Method 1: Try loadBusinessTokens if we have an email
      if (targetEmail) {
        const { loadBusinessTokens } = await import('@/lib/storage');
        const connectedAccounts = await loadBusinessTokens(null, targetEmail);
        if (connectedAccounts.length > 0) {
          tokens = connectedAccounts[0].tokens;
          console.log(`[Email Thread] Found tokens via loadBusinessTokens for: ${connectedAccounts[0].email}`);
        }
      }

      // Method 2: If still no tokens, try to find ANY personal account tokens using Service Role
      if (!tokens?.access_token) {
        console.log('[Email Thread] Attempting direct query with Service Role client...');
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
            console.log('[Email Thread] Direct query error:', tokenError.message);
          } else if (tokenData?.access_token) {
            tokens = {
              access_token: tokenData.access_token,
              refresh_token: tokenData.refresh_token,
              expiry_date: tokenData.expiry_date,
              token_type: tokenData.token_type,
              scope: tokenData.scope,
            };
            console.log(`[Email Thread] Found personal account tokens via direct query for: ${tokenData.user_email}`);
          } else {
            console.log('[Email Thread] No personal account tokens found in database');
          }
        } else {
          console.log('[Email Thread] Missing Supabase Service Role credentials');
        }
      }
    }

    if (!tokens || !tokens.access_token) {
      console.log(`[Email Thread] No tokens found for targetEmail: ${targetEmail}, businessId: ${businessSession?.businessId}`);
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


