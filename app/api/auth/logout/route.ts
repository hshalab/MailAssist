/**
 * Logout endpoint - clears stored tokens and all user data
 */

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { clearAllData } from '@/lib/storage';
import { clearSessionInResponse, getSessionUserEmail } from '@/lib/session';
import { supabase } from '@/lib/supabase';

export async function POST() {
  try {
    const cookieStore = await cookies();
    const sessionToken = cookieStore.get('session_token')?.value;
    const currentUserId = cookieStore.get('current_user_id')?.value;

    // CRITICAL: Delete session from database before clearing cookies
    // This ensures the session cannot be reused even if cookies are somehow restored
    if (sessionToken && supabase) {
      console.log('[Logout] Deleting session from database:', sessionToken);
      const { error: deleteError } = await supabase
        .from('user_sessions')
        .delete()
        .eq('session_token', sessionToken);
      
      if (deleteError) {
        console.error('[Logout] Error deleting session from database:', deleteError);
      } else {
        console.log('[Logout] Session deleted from database successfully');
      }
    }

    // Also delete all sessions for this user (in case of multiple sessions)
    if (currentUserId && supabase) {
      console.log('[Logout] Deleting all sessions for user:', currentUserId);
      const { error: deleteAllError } = await supabase
        .from('user_sessions')
        .delete()
        .eq('user_id', currentUserId);
      
      if (deleteAllError) {
        console.error('[Logout] Error deleting all user sessions:', deleteAllError);
      } else {
        console.log('[Logout] All user sessions deleted successfully');
      }
    }

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


