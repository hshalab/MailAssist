/**
 * GET /api/users/me - Get current user info
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserIdFromRequest } from '@/lib/permissions';
import { supabase } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  try {
    // First try business session (most reliable in production)
    const { validateBusinessSession } = await import('@/lib/session');
    const businessSession = await validateBusinessSession();

    if (businessSession) {
      // Return full user info from business session
      return NextResponse.json({
        user: {
          id: businessSession.id,
          name: businessSession.name,
          email: businessSession.email,
          role: businessSession.role,
          businessId: businessSession.businessId,
          businessName: businessSession.businessName,
        }
      });
    }

    // Fallback to cookie-based userId
    const userId = getCurrentUserIdFromRequest(request);

    if (!userId) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    // Look up user from database
    if (supabase) {
      const { data: user } = await supabase
        .from('users')
        .select(`
          id,
          name,
          email,
          role,
          business_id,
          businesses (
            id,
            business_name
          )
        `)
        .eq('id', userId)
        .maybeSingle();

      if (user) {
        const business = Array.isArray(user.businesses) ? user.businesses[0] : user.businesses;
        return NextResponse.json({
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            businessId: user.business_id,
            businessName: business?.business_name || null,
          }
        });
      }
    }

    // Last resort - just return the ID
    return NextResponse.json({ user: { id: userId } });
  } catch (error) {
    console.error('Error getting current user:', error);
    return NextResponse.json(
      { error: 'Failed to get current user' },
      { status: 500 }
    );
  }
}
