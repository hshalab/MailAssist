/**
 * GET /api/users/me - Get current user info
 * Returns the current active user ID
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserIdFromRequest } from '@/lib/permissions';
import { getUserById } from '@/lib/users';
import { validateBusinessSession } from '@/lib/session';

export async function GET(request: NextRequest) {
  try {
    // First check for business session (new auth flow)
    const businessSession = await validateBusinessSession();
    if (businessSession) {
      // Business session users are always active
      return NextResponse.json({ id: businessSession.id });
    }

    // Fallback to cookie-based auth
    const userId = getCurrentUserIdFromRequest(request);

    if (!userId) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    // CRITICAL: Verify user is active before returning ID
    const user = await getUserById(userId);
    if (!user || !user.isActive) {
      console.log('[Users/Me] User not found or inactive:', userId);
      const response = NextResponse.json(
        { error: 'Your account has been deactivated' },
        { status: 403 }
      );
      // Clear the invalid user ID cookie
      response.cookies.delete('current_user_id');
      return response;
    }

    return NextResponse.json({ id: userId });
  } catch (error) {
    console.error('Error getting current user:', error);
    return NextResponse.json(
      { error: 'Failed to get current user' },
      { status: 500 }
    );
  }
}
