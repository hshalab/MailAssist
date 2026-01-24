/**
 * Login API Endpoint
 * POST /api/auth/login
 * 
 * Flow:
 * 1. Validate input (email, password)
 * 2. Find business by email
 * 3. Verify password
 * 4. Check if email is verified
 * 5. Find or create user for this business
 * 6. Create session
 * 7. Set cookies
 * 8. Return success
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { validateLoginInput, verifyPassword, generateSession } from '@/lib/auth-utils'
import { cookies } from 'next/headers'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { email, password, rememberMe = false } = body

    // 1. Validate input
    const validation = validateLoginInput({ email, password })
    if (!validation.isValid) {
      return NextResponse.json(
        { error: 'Validation failed', errors: validation.errors },
        { status: 400 }
      )
    }

    const normalizedEmail = email.toLowerCase().trim()

    // 2. Try to find user in 'users' table first (Agents & Admins)
    // IMPORTANT: Check for ALL users with this email, prioritize business accounts
    const { data: users, error: userError } = await supabase
      .from('users')
      .select('*, businesses(*)')
      .eq('email', normalizedEmail)
    // Don't filter by is_active yet - we want to give a specific error message

    let targetUser = null
    let targetBusiness = null

    // If multiple users found, prioritize active business accounts
    if (users && users.length > 0) {
      // 1. First priority: Active users with a business ID
      let bestMatch = users.find(u => u.business_id !== null && u.is_active === true);

      // 2. Second priority: Any active user
      if (!bestMatch) {
        bestMatch = users.find(u => u.is_active === true);
      }

      // 3. Fallback: Any user with business ID (likely inactive/removed)
      if (!bestMatch) {
        bestMatch = users.find(u => u.business_id !== null);
      }

      // 4. Default: First found user
      if (!bestMatch) {
        bestMatch = users[0];
      }

      targetUser = bestMatch;
      // Handle potential array response for businesses
      const rawBusiness = targetUser?.businesses;
      targetBusiness = Array.isArray(rawBusiness) ? rawBusiness[0] : rawBusiness;

      console.log('[Login] Selected user:', targetUser?.id, 'Active:', targetUser?.is_active, 'BusinessId:', targetBusiness?.id);

      // CRITICAL: Check if the SELECTED user is inactive
      if (targetUser && !targetUser.is_active) {
        console.error('[Login] Inactive user attempting login:', normalizedEmail);
        return NextResponse.json(
          { error: 'You have been removed from this team by an administrator. If you believe this is a mistake, please contact your team administrator.' },
          { status: 403 }
        );
      }
    }

    // If user found in users table, verify password there
    if (targetUser && targetUser.password_hash) {
      const isPasswordValid = await verifyPassword(password, targetUser.password_hash)
      if (!isPasswordValid) {
        console.error('[Login] Invalid password for user:', normalizedEmail)
        return NextResponse.json(
          { error: 'Invalid email or password.' },
          { status: 401 }
        )
      }
    } else {
      // Fallback: Check businesses table (Legacy/Owner flow)
      const { data: business, error: businessError } = await supabase
        .from('businesses')
        .select('*')
        .eq('business_email', normalizedEmail)
        .single()

      if (businessError || !business) {
        console.error('[Login] User/Business not found:', normalizedEmail)
        return NextResponse.json(
          { error: 'Invalid email or password.' },
          { status: 401 }
        )
      }

      // Check if email is verified
      if (!business.is_email_verified) {
        return NextResponse.json(
          {
            error: 'Email not verified. Please check your email for the verification code.',
            requiresVerification: true,
            businessId: business.id,
          },
          { status: 403 }
        )
      }

      // Verify password against business record
      const isPasswordValid = await verifyPassword(password, business.password_hash)
      if (!isPasswordValid) {
        console.error('[Login] Invalid password for business:', normalizedEmail)
        return NextResponse.json(
          { error: 'Invalid email or password.' },
          { status: 401 }
        )
      }

      targetBusiness = business

      // CRITICAL FIX: If we found a business but no user with password,
      // we need to find/create the user and sync the password
      // This handles the case where user was created via OAuth but business has password
    }

    // 5. Find admin user for this business (if we are in legacy flow)
    if (!targetUser && targetBusiness) {
      const { data: users, error: usersError } = await supabase
        .from('users')
        .select('*')
        .eq('business_id', targetBusiness.id)
        .eq('is_active', true)
        .order('created_at', { ascending: true })

      if (usersError) {
        console.error('[Login] Error fetching users:', usersError)
        return NextResponse.json(
          { error: 'Failed to fetch user data.' },
          { status: 500 }
        )
      }

      // Find admin user or first active user
      targetUser = users?.find(u => u.role === 'admin')
      if (!targetUser) {
        targetUser = users?.[0]
      }

      if (!targetUser) {
        // No users exist - create admin user
        const { data: newUser, error: createUserError } = await supabase
          .from('users')
          .insert({
            business_id: targetBusiness.id,
            name: targetBusiness.owner_name,
            email: targetBusiness.business_email,
            role: 'admin',
            is_active: true,
            is_email_verified: true,
            user_email: targetBusiness.business_email,
            shared_gmail_email: targetBusiness.business_email,
          })
          .select()
          .single()

        if (createUserError || !newUser) {
          console.error('[Login] Error creating admin user:', createUserError)
          return NextResponse.json(
            { error: 'Failed to create user account.' },
            { status: 500 }
          )
        }

        targetUser = newUser
        console.log('[Login] Created admin user:', targetUser.id)
      }

      // CRITICAL FIX: If user exists but has no password, sync from business
      if (targetUser && targetBusiness.password_hash && (!targetUser.password_hash || targetUser.password_hash === 'GOOGLE_OAUTH' || targetUser.password_hash === 'CONNECTED_ACCOUNT')) {
        console.log('[Login] Syncing password from business to user:', targetUser.id);
        const { error: syncError } = await supabase
          .from('users')
          .update({ password_hash: targetBusiness.password_hash })
          .eq('id', targetUser.id);

        if (!syncError) {
          targetUser.password_hash = targetBusiness.password_hash;
          console.log('[Login] Password synced successfully');
        } else {
          console.error('[Login] Failed to sync password:', syncError);
        }
      }
    }

    if (!targetUser || !targetBusiness) {
      return NextResponse.json(
        { error: 'Login failed. User or Business not found.' },
        { status: 500 }
      )
    }

    // 6. Update last login
    await supabase
      .from('users')
      .update({ last_login_at: new Date().toISOString() })
      .eq('id', targetUser.id)

    // 7. Create session
    // If rememberMe is true, use 90 days; otherwise use 7 days
    const sessionDays = rememberMe ? 90 : 7 // 7 days default, 90 days for remember me
    const { token: sessionToken, expiresAt } = generateSession(sessionDays)

    const { error: sessionError } = await supabase
      .from('user_sessions')
      .insert({
        user_id: targetUser.id,
        business_id: targetBusiness.id,
        session_token: sessionToken,
        expires_at: expiresAt.toISOString(),
      })

    if (sessionError) {
      console.error('[Login] Error creating session:', sessionError)
      return NextResponse.json(
        { error: 'Failed to create session.' },
        { status: 500 }
      )
    }

    console.log('[Login] Session created for user:', targetUser.id)

    // 8. Set session cookies
    const cookieStore = await cookies()
    const { getCookieOptions, getClientCookieOptions } = await import('@/lib/cookie-config')

    // If rememberMe is true, use 90 days; otherwise use 7 days for cookie expiry
    const cookieOptions = rememberMe
      ? { maxAge: 90 * 24 * 60 * 60 } // 90 days
      : { maxAge: 7 * 24 * 60 * 60 } // 7 days

    // Set session token
    cookieStore.set('session_token', sessionToken, getCookieOptions({
      httpOnly: true,
      ...cookieOptions,
    }))

    // Set current_user_id (CRITICAL: Must match CURRENT_USER_ID_COOKIE_NAME in lib/session.ts)
    cookieStore.set('current_user_id', targetUser.id, getClientCookieOptions({
      ...cookieOptions,
    }))

    // Set gmail_user_email (CRITICAL: Must match SESSION_COOKIE_NAME in lib/session.ts)
    // This is required for getSessionUserEmailFromRequest to work
    cookieStore.set('gmail_user_email', targetUser.email || targetUser.user_email, getCookieOptions({
      httpOnly: true,
      ...cookieOptions,
    }))

    // 9. Return success
    return NextResponse.json({
      success: true,
      message: 'Login successful!',
      user: {
        id: targetUser.id,
        name: targetUser.name,
        email: targetUser.email,
        role: targetUser.role,
      },
      business: {
        id: targetBusiness.id,
        name: targetBusiness.business_name || targetBusiness.name, // Handle both schema variations if needed
        email: targetBusiness.business_email,
      },
      sessionToken,
    })
  } catch (error) {
    console.error('[Login] Unexpected error:', error)
    return NextResponse.json(
      { error: 'An unexpected error occurred. Please try again.' },
      { status: 500 }
    )
  }
}

// Handle OPTIONS request for CORS
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  })
}
