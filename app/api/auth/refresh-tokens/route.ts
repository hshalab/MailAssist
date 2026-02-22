/**
 * Proactive Gmail token refresh endpoint
 * Called periodically from the frontend to keep all OAuth tokens fresh.
 * Refreshes any access token that expires within the next 30 minutes.
 */

import { NextResponse } from 'next/server';
import { validateBusinessSession, getSessionUserEmail } from '@/lib/session';
import { loadBusinessTokens, saveTokens } from '@/lib/storage';
import { getOAuth2Client } from '@/lib/gmail';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    // Must have a valid business session
    const session = await validateBusinessSession();
    const sessionEmail = await getSessionUserEmail();

    if (!session && !sessionEmail) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const effectiveEmail = session?.email ?? sessionEmail ?? undefined;
    const businessId = session?.businessId ?? null;

    // Load all connected Gmail accounts for this user/business
    const accounts = await loadBusinessTokens(businessId, effectiveEmail);

    if (accounts.length === 0) {
      return NextResponse.json({ refreshed: 0, message: 'No connected accounts' });
    }

    const REFRESH_THRESHOLD_MS = 30 * 60 * 1000; // Refresh if expiring within 30 minutes
    const now = Date.now();
    let refreshed = 0;
    let failed = 0;

    for (const { email, tokens } of accounts) {
      // Only refresh Gmail OAuth tokens (not IMAP)
      const provider = (tokens as any).provider || 'gmail';
      if (provider !== 'gmail') continue;

      // Check if token needs refresh (expiring within 30 minutes or already expired)
      const needsRefresh =
        !tokens.expiry_date || // No expiry set → assume needs refresh
        now >= tokens.expiry_date - REFRESH_THRESHOLD_MS;

      if (!needsRefresh) {
        console.log(`[refresh-tokens] Token for ${email} is still fresh, skipping`);
        continue;
      }

      if (!tokens.refresh_token) {
        console.warn(`[refresh-tokens] No refresh token for ${email}, cannot refresh`);
        continue;
      }

      try {
        console.log(`[refresh-tokens] Refreshing token for ${email} (expires at ${tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : 'unknown'})`);

        const oauth2Client = getOAuth2Client();
        oauth2Client.setCredentials({ refresh_token: tokens.refresh_token });

        const { credentials } = await oauth2Client.refreshAccessToken();

        const updatedTokens = {
          ...tokens,
          access_token: credentials.access_token!,
          expiry_date: credentials.expiry_date ?? (now + 3600 * 1000),
        };

        await saveTokens(updatedTokens, businessId, email);
        refreshed++;
        console.log(`[refresh-tokens] Successfully refreshed token for ${email}`);
      } catch (error: any) {
        failed++;
        const isRevoked =
          error?.message?.includes('invalid_grant') ||
          error?.error === 'invalid_grant' ||
          error?.response?.data?.error === 'invalid_grant';

        if (isRevoked) {
          console.error(`[refresh-tokens] Token for ${email} has been revoked (invalid_grant). User needs to reconnect.`);
        } else {
          console.error(`[refresh-tokens] Failed to refresh token for ${email}:`, error?.message);
        }
      }
    }

    return NextResponse.json({
      refreshed,
      failed,
      total: accounts.length,
      message: `Refreshed ${refreshed}/${accounts.length} tokens`,
    });
  } catch (error) {
    console.error('[refresh-tokens] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Failed to refresh tokens', details: (error as Error).message },
      { status: 500 }
    );
  }
}
