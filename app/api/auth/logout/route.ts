/**
 * Logout endpoint - clears stored tokens and all user data
 */

import { NextResponse } from 'next/server';
import { clearAllData } from '@/lib/storage';
import { clearSessionInResponse, getSessionUserEmail } from '@/lib/session';

export async function POST() {
  try {
    // Clear session only - DO NOT wipe data on logout
    // await clearAllData();

    // Create response
    const response = NextResponse.json({
      success: true,
      message: 'Logged out successfully.'
    });

    // CRITICAL: Clear session cookie to prevent access to this user's data
    clearSessionInResponse(response);

    return response;
  } catch (error) {
    console.error('Error during logout:', error);
    const response = NextResponse.json(
      { error: 'Failed to logout', details: (error as Error).message },
      { status: 500 }
    );
    // Still try to clear session cookie even if there was an error
    clearSessionInResponse(response);
    return response;
  }
}


