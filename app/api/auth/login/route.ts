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
    const { email, password } = body

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

    // If multiple users found, prioritize business accounts over personal
    if (users && users.length > 0) {
      // Prefer business accounts
      const businessUser = users.find(u => u.business_id !== null)
      targetUser = businessUser || users[0]
      targetBusiness = targetUser?.businesses

      // CRITICAL: Check if user is inactive (removed from business)
      if (targetUser && !targetUser.is_active) {
        console.error('[Login] Inactive user attempting login:', normalizedEmail)
        return NextResponse.json(
          { error: 'Your account has been deactivated. Please contact your administrator for more information.' },
          { status: 403 }
        )
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
    const { token: sessionToken, expiresAt } = generateSession(30) // 30 days

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
    const cookieMaxAge = 30 * 24 * 60 * 60 // 30 days

    // Set session token
    cookieStore.set('session_token', sessionToken, getCookieOptions({
      httpOnly: true,
      maxAge: cookieMaxAge,
    }))

    // Set current_user_id (CRITICAL: Must match CURRENT_USER_ID_COOKIE_NAME in lib/session.ts)
    cookieStore.set('current_user_id', targetUser.id, getClientCookieOptions({
      maxAge: cookieMaxAge,
    }))

    // Set gmail_user_email (CRITICAL: Must match SESSION_COOKIE_NAME in lib/session.ts)
    // This is required for getSessionUserEmailFromRequest to work
    cookieStore.set('gmail_user_email', targetUser.email || targetUser.user_email, getCookieOptions({
      httpOnly: true,
      maxAge: cookieMaxAge,
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
