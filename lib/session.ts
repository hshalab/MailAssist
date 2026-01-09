/**
 * Session management utilities
 * Uses cookies to track which user is logged in on each device
 * Updated: Fixed supabase imports
 */

import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { getCookieOptions, getClientCookieOptions } from '@/lib/cookie-config';

const SESSION_COOKIE_NAME = 'gmail_user_email';
const CURRENT_USER_ID_COOKIE_NAME = 'current_user_id';

/**
 * Get the current user's email from the session cookie
 */
export async function getSessionUserEmail(): Promise<string | null> {
  try {
    const cookieStore = await cookies();
    const userEmail = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    return userEmail || null;
  } catch (error) {
    // Cookies might not be available in all contexts
    return null;
  }
}

/**
 * Get the current user's email from request cookies (for use in API routes)
 */
export function getSessionUserEmailFromRequest(request: NextRequest): string | null {
  try {
    const userEmail = request.cookies.get(SESSION_COOKIE_NAME)?.value;
    return userEmail || null;
  } catch (error) {
    return null;
  }
}

/**
 * Set the session cookie with user email
 * Works in both development and production (Vercel)
 */
export async function setSessionUserEmail(userEmail: string): Promise<void> {
  try {
    const cookieStore = await cookies();
    cookieStore.set(SESSION_COOKIE_NAME, userEmail, getCookieOptions({
      httpOnly: true,
      maxAge: 60 * 60 * 24 * 365, // 1 year
    }));
  } catch (error) {
    console.error('Error setting session cookie:', error);
  }
}

/**
 * Set the session cookie from a NextResponse (for use in API routes)
 * Works in both development and production (Vercel)
 */
export function setSessionUserEmailInResponse(
  response: NextResponse,
  userEmail: string
): NextResponse {
  try {
    response.cookies.set(SESSION_COOKIE_NAME, userEmail, getCookieOptions({
      httpOnly: true,
      maxAge: 60 * 60 * 24 * 365, // 1 year
    }));
  } catch (error) {
    console.error('Error setting session cookie in response:', error);
  }
  return response;
}

/**
 * Clear the session cookie (logout)
 */
export async function clearSession(): Promise<void> {
  try {
    const cookieStore = await cookies();
    cookieStore.delete(SESSION_COOKIE_NAME);
  } catch (error) {
    console.error('Error clearing session cookie:', error);
  }
}

/**
 * Clear the session cookie from a NextResponse (for use in API routes)
 */
export function clearSessionInResponse(response: NextResponse): NextResponse {
  try {
    response.cookies.delete(SESSION_COOKIE_NAME);
    response.cookies.delete(CURRENT_USER_ID_COOKIE_NAME);
  } catch (error) {
    console.error('Error clearing session cookie in response:', error);
  }
  return response;
}

/**
 * Get current user ID from session cookie
 */
export async function getCurrentUserId(): Promise<string | null> {
  try {
    const cookieStore = await cookies();
    const userId = cookieStore.get(CURRENT_USER_ID_COOKIE_NAME)?.value;
    return userId || null;
  } catch (error) {
    return null;
  }
}

/**
 * Get current user ID from request cookies
 */
export function getCurrentUserIdFromRequest(request: NextRequest): string | null {
  try {
    const userId = request.cookies.get(CURRENT_USER_ID_COOKIE_NAME)?.value;
    return userId || null;
  } catch (error) {
    return null;
  }
}

/**
 * Set current user ID in session cookie
 */
export async function setCurrentUserId(userId: string): Promise<void> {
  try {
    const cookieStore = await cookies();
    cookieStore.set(CURRENT_USER_ID_COOKIE_NAME, userId, getClientCookieOptions({
      maxAge: 60 * 60 * 24 * 365, // 1 year
    }));
  } catch (error) {
    console.error('Error setting current user ID cookie:', error);
  }
}

/**
 * Set current user ID in NextResponse
 */
export function setCurrentUserIdInResponse(
  response: NextResponse,
  userId: string
): NextResponse {
  try {
    response.cookies.set(CURRENT_USER_ID_COOKIE_NAME, userId, getClientCookieOptions({
      maxAge: 60 * 60 * 24 * 365, // 1 year
    }));
  } catch (error) {
    console.error('Error setting current user ID in response:', error);
  }
  return response;
}

/**
 * Business session validation utilities
 */

export interface SessionUser {
  id: string
  name: string
  email: string
  role: 'admin' | 'manager' | 'agent'
  businessId: string | null
  businessName: string
  accountType: 'business' | 'personal'
}

/**
 * Check if user has valid business session
 * Returns user data if session is valid, null otherwise
 */
export async function validateBusinessSession(): Promise<SessionUser | null> {
  try {
    const cookieStore = await cookies()
    const sessionToken = cookieStore.get('session_token')?.value

    if (!sessionToken) {
      return null
    }

    if (!supabase) {
      console.error('[Session] Supabase client not initialized')
      return null
    }

    // Check if session exists and is not expired
    const { data: session, error: sessionError } = await supabase
      .from('user_sessions')
      .select('user_id, expires_at')
      .eq('session_token', sessionToken)
      .single()

    if (sessionError || !session) {
      console.log('[Session] Invalid or missing session')
      return null
    }

    // Check if session is expired
    if (new Date(session.expires_at) < new Date()) {
      console.log('[Session] Session expired')
      return null
    }

    // Get user details
    const { data: user, error: userError } = await supabase
      .from('users')
      .select(`
        id,
        name,
        email,
        role,
        business_id,
        businesses (
          id,
          business_name,
          business_email
        )
      `)
      .eq('id', session.user_id)
      .single()

    if (userError || !user) {
      console.log('[Session] User not found')
      return null
    }

    // CRITICAL FIX: If user is business owner (email matches business_email), ensure they're admin
    const business = Array.isArray(user.businesses) ? user.businesses[0] : user.businesses
    let userRole = user.role as 'admin' | 'manager' | 'agent'
    // Case-insensitive email comparison for business owner promotion
    if (business && business.business_email && 
        business.business_email.toLowerCase() === user.email?.toLowerCase() && 
        userRole !== 'admin') {
      console.log('[Session] Business owner detected, promoting to admin:', user.id, 'email:', user.email, 'business_email:', business.business_email)
      const { error: updateError } = await supabase
        .from('users')
        .update({ role: 'admin' })
        .eq('id', user.id)
      
      if (updateError) {
        console.error('[Session] Error promoting user to admin:', updateError)
      } else {
        console.log('[Session] User promoted to admin successfully')
        // Refresh user role
        userRole = 'admin'
        user.role = 'admin'
      }
    }

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: userRole,
      businessId: user.business_id,
      businessName: business?.business_name || 'Unknown Business',
      accountType: user.business_id !== null ? 'business' : 'personal',
    }
  } catch (error) {
    console.error('[Session] Validation error:', error)
    return null
  }
}

/**
 * Check if user is authenticated (either via business session or Gmail OAuth)
 */
export async function isAuthenticated(): Promise<boolean> {
  const businessSession = await validateBusinessSession()
  if (businessSession) {
    return true
  }

  // Check for Gmail OAuth tokens (existing logic)
  const cookieStore = await cookies()
  const accessToken = cookieStore.get('gmail_access_token')?.value
  return !!accessToken
}

/**
 * Get current user from session or cookies
 */
export async function getCurrentUser(): Promise<SessionUser | null> {
  // First check business session
  const businessSession = await validateBusinessSession()
  if (businessSession) {
    return businessSession
  }

  // Fall back to checking cookies for current_user_id (from user selector)
  const cookieStore = await cookies()
  const userId = cookieStore.get('current_user_id')?.value

  if (!userId) {
    return null
  }

  if (!supabase) {
    console.error('[Session] Supabase client not initialized')
    return null
  }

  const { data: user, error } = await supabase
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
    .single()

  if (error || !user) {
    return null
  }

  const business = Array.isArray(user.businesses) ? user.businesses[0] : user.businesses

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role as 'admin' | 'manager' | 'agent',
    businessId: user.business_id,
    businessName: business?.business_name || 'Unknown Business',
    accountType: user.business_id !== null ? 'business' : 'personal',
  }
}

