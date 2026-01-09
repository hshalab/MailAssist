/**
 * Token refresh utilities for Gmail OAuth2
 * Handles automatic token refresh when access tokens expire
 */

import { getOAuth2Client } from './gmail';
import { loadTokens, saveTokens, StoredTokens } from './storage';
import { getSessionUserEmail } from './session';

/**
 * Refresh access token if expired
 * @param userEmail - Optional user email to filter tokens. If not provided, uses session cookie.
 * @param businessId - Optional business ID to filter tokens for business accounts.
 */
export async function refreshTokenIfNeeded(userEmail?: string | null, businessId?: string): Promise<StoredTokens | null> {
  // Get user email from parameter or session
  const targetUserEmail = userEmail || await getSessionUserEmail();
  const tokens = await loadTokens(targetUserEmail, businessId);

  if (!tokens || !tokens.refresh_token) {
    return null;
  }

  // Check if token is expired (with 5 minute buffer)
  const expiryDate = tokens.expiry_date;
  const now = Date.now();

  if (expiryDate && now < expiryDate - 5 * 60 * 1000) {
    // Token is still valid
    return tokens;
  }

  // Token expired or about to expire, refresh it
  try {
    const oauth2Client = getOAuth2Client();
    oauth2Client.setCredentials({
      refresh_token: tokens.refresh_token,
    });

    const { credentials } = await oauth2Client.refreshAccessToken();

    // Update tokens with new access token
    const updatedTokens: StoredTokens = {
      ...tokens,
      access_token: credentials.access_token,
      expiry_date: credentials.expiry_date,
    };

    await saveTokens(updatedTokens);
    return updatedTokens;
  } catch (error) {
    console.error('Error refreshing token:', error);
    // Return null to indicate refresh failed
    return null;
  }
}

/**
 * Get valid tokens, refreshing if necessary
 * @param userEmail - Optional user email to filter tokens. If not provided, uses session cookie.
 * @param businessId - Optional business ID to filter tokens for business accounts.
 */
export async function getValidTokens(userEmail?: string | null, businessId?: string): Promise<StoredTokens | null> {
  return await refreshTokenIfNeeded(userEmail, businessId);
}


