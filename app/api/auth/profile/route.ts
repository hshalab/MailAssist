/**
 * Returns the authenticated user's profile info
 */

import { NextResponse } from 'next/server';
import { getValidTokens } from '@/lib/token-refresh';
import { getUserProfile } from '@/lib/gmail';
import { supabase } from '@/lib/supabase';

export async function GET() {
  try {
    // 1. Try to get user from business session first
    const { getCurrentUser, validateBusinessSession } = await import('@/lib/session');
    const user = await getCurrentUser();

    if (user) {
      console.log('[Profile] Using getCurrentUser:', user.email, 'role:', user.role);
      return NextResponse.json({
        emailAddress: user.email,
        displayName: user.name,
        picture: null, // Business users might not have a picture yet
        role: user.role,
        businessName: user.businessName
      });
    }

    // 2. Try business session directly (production cookie fallback)
    const businessSession = await validateBusinessSession();
    if (businessSession) {
      console.log('[Profile] Using validateBusinessSession:', businessSession.email, 'role:', businessSession.role);
      return NextResponse.json({
        emailAddress: businessSession.email,
        displayName: businessSession.name,
        picture: null,
        role: businessSession.role,
        businessName: businessSession.businessName
      });
    }

    // 3. Fall back to Gmail tokens (legacy flow)
    console.log('[Profile] Falling back to Gmail tokens');
    const tokens = await getValidTokens();

    if (!tokens || !tokens.access_token) {
      console.log('[Profile] No tokens found');
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    const profile = await getUserProfile(tokens);
    console.log('[Profile] Got Gmail profile:', profile?.emailAddress);

    // Look up user in database to get their role
    let role = undefined;
    let businessName = undefined;
    if (profile?.emailAddress && supabase) {
      const { data: dbUser, error: dbError } = await supabase
        .from('users')
        .select(`
          role,
          businesses (
            business_name
          )
        `)
        .eq('email', profile.emailAddress.toLowerCase())
        .maybeSingle();

      console.log('[Profile] DB lookup result:', { email: profile.emailAddress, dbUser, dbError });

      if (dbUser) {
        role = dbUser.role;
        const business = Array.isArray(dbUser.businesses) ? dbUser.businesses[0] : dbUser.businesses;
        businessName = business?.business_name;
      }
    }

    console.log('[Profile] Returning with role:', role);
    return NextResponse.json({
      ...profile,
      role,
      businessName
    });
  } catch (error) {
    console.error('Error fetching profile:', error);
    return NextResponse.json(
      { error: 'Failed to fetch profile', details: (error as Error).message },
      { status: 500 }
    );
  }
}

































