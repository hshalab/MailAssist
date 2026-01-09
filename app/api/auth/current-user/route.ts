/**
 * Get current user from session
 * Verifies that the user belongs to the current Gmail account
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSessionUserEmailFromRequest, getCurrentUserIdFromRequest } from '@/lib/session';
import { getUserById } from '@/lib/users';
import { supabase } from '@/lib/supabase';

import { validateBusinessSession } from '@/lib/session';

export async function GET(request: NextRequest) {
  try {
    // 1. Check for valid business session (new auth flow)
    const businessSession = await validateBusinessSession();
    if (businessSession) {
      return NextResponse.json({
        user: {
          id: businessSession.id,
          name: businessSession.name,
          email: businessSession.email,
          role: businessSession.role,
          businessId: businessSession.businessId,
          businessName: businessSession.businessName,
          isActive: true,
        }
      });
    }

    // 2. Fallback: Legacy Gmail session check
    const userId = getCurrentUserIdFromRequest(request);

    if (!userId) {
      console.log('[Current User] No userId cookie found.');
      return NextResponse.json(
        { error: 'No user selected' },
        { status: 404 }
      );
    }

    // Get current Gmail account from session
    const sessionGmailEmail = getSessionUserEmailFromRequest(request);
    console.log(`[Current User] Check for userId: ${userId}, gmail: ${sessionGmailEmail}`);

    if (!sessionGmailEmail) {
      console.log('[Current User] No gmail session cookie.');
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    const user = await getUserById(userId);
    if (!user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    // CRITICAL: Verify user belongs to current Gmail account
    // For personal accounts, we allow the session Gmail to be different from the login email
    // as long as they are linked or it's a personal account (where the user IS the account)
    const isPersonalAccount = !user.businessId;
    const emailMatches = user.userEmail === sessionGmailEmail ||
      user.email === sessionGmailEmail ||
      (user as any).sharedGmailEmail === sessionGmailEmail;

    if (!emailMatches && !isPersonalAccount) {
      // For business accounts, the mismatch is still an error
      console.log('[Current User] Unauthorized access attempt:', { userId: user.id, userEmail: user.userEmail, sessionEmail: sessionGmailEmail });
      const response = NextResponse.json(
        { error: 'User does not belong to current account' },
        { status: 403 }
      );
      // Clear the invalid user ID cookie
      response.cookies.delete('current_user_id');
      return response;
    }

    // Get business name if user belongs to a business
    let businessName = null;
    if (user.businessId && supabase) {
      const { data: business } = await supabase
        .from('businesses')
        .select('name')
        .eq('id', user.businessId)
        .single();
      if (business) {
        businessName = business.name;
      }
    }

    // Return user with businessId and businessName explicitly set
    return NextResponse.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        businessId: user.businessId,
        businessName: businessName, // Added businessName
        isActive: user.isActive,
      }
    });
  } catch (error) {
    console.error('Error fetching current user:', error);
    return NextResponse.json(
      { error: 'Failed to fetch current user', details: (error as Error).message },
      { status: 500 }
    );
  }
}

