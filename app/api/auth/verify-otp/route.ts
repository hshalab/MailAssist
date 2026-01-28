/**
 * OTP Verification API Endpoint
 * POST /api/auth/verify-otp
 * 
 * Flow:
 * 1. Validate OTP code format
 * 2. Find verification token and check expiry
 * 3. Verify OTP matches
 * 4. Mark business as verified
 * 5. Create first admin user for the business
 * 6. Create session for auto-login
 * 7. Mark token as verified
 * 8. Return success with session
 */

import { NextRequest, NextResponse } from 'next/server'
import { setSessionUserEmailInResponse } from '@/lib/session';
import { createClient } from '@supabase/supabase-js'
import { validateOTPCode, isOTPExpired, generateSession } from '@/lib/auth-utils'
import { cookies } from 'next/headers'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { otpCode, verificationToken, email } = body

    // 1. Validate input
    if (!otpCode || !validateOTPCode(otpCode)) {
      return NextResponse.json(
        { error: 'Invalid OTP format. Please enter a 6-digit code.' },
        { status: 400 }
      )
    }

    if (!verificationToken) {
      return NextResponse.json(
        { error: 'Verification token is required.' },
        { status: 400 }
      )
    }

    // 2. Find verification token
    const { data: verificationRecord, error: tokenError } = await supabase
      .from('email_verification_tokens')
      .select('*')
      .eq('token', verificationToken)
      .eq('otp_code', otpCode)
      .is('verified_at', null)
      .single()

    if (tokenError || !verificationRecord) {
      console.error('[VerifyOTP] Token not found or already used:', tokenError)
      return NextResponse.json(
        { error: 'Invalid or expired verification code. Please request a new one.' },
        { status: 400 }
      )
    }

    // 3. Check if OTP has expired
    if (isOTPExpired(verificationRecord.expires_at)) {
      return NextResponse.json(
        { error: 'Verification code has expired. Please request a new one.' },
        { status: 400 }
      )
    }

    // 4. Get business record
    const { data: business, error: businessError } = await supabase
      .from('businesses')
      .select('*')
      .eq('id', verificationRecord.business_id)
      .single()

    if (businessError || !business) {
      console.error('[VerifyOTP] Business not found:', businessError)
      return NextResponse.json(
        { error: 'Business account not found.' },
        { status: 404 }
      )
    }

    if (business.is_email_verified) {
      return NextResponse.json(
        { error: 'This email is already verified. Please login instead.' },
        { status: 400 }
      )
    }

    // 5. Mark business as verified
    const { error: updateError } = await supabase
      .from('businesses')
      .update({ is_email_verified: true, updated_at: new Date().toISOString() })
      .eq('id', business.id)

    if (updateError) {
      console.error('[VerifyOTP] Error verifying business:', updateError)
      return NextResponse.json(
        { error: 'Failed to verify account. Please try again.' },
        { status: 500 }
      )
    }

    console.log('[VerifyOTP] Business verified:', business.id)

    // 6. Create first admin user for this business
    const { data: adminUser, error: userError } = await supabase
      .from('users')
      .insert({
        business_id: business.id,
        name: business.owner_name,
        email: business.business_email,
        role: 'admin',
        is_active: true,
        is_email_verified: true,
        user_email: business.business_email, // For backward compatibility
        shared_gmail_email: business.business_email,
      })
      .select()
      .single()

    if (userError || !adminUser) {
      console.error('[VerifyOTP] Error creating admin user:', userError)
      return NextResponse.json(
        { error: 'Failed to create admin user. Please contact support.' },
        { status: 500 }
      )
    }

    console.log('[VerifyOTP] Admin user created:', adminUser.id)

    // 7. Create session for auto-login
    const { token: sessionToken, expiresAt } = generateSession(30) // 30 days

    const { error: sessionError } = await supabase
      .from('user_sessions')
      .insert({
        user_id: adminUser.id,
        business_id: business.id,
        session_token: sessionToken,
        expires_at: expiresAt.toISOString(),
      })

    if (sessionError) {
      console.error('[VerifyOTP] Error creating session:', sessionError)
      // Don't fail - user can login manually
    }

    // 8. Mark verification token as used
    await supabase
      .from('email_verification_tokens')
      .update({ verified_at: new Date().toISOString() })
      .eq('id', verificationRecord.id)

    // 9. Set session cookie
    const cookieStore = await cookies()
    cookieStore.set('session_token', sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60, // 30 days
      path: '/',
    })

    // Set user_id and current_user_id for backward compatibility
    cookieStore.set('user_id', adminUser.id, {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60,
      path: '/',
    })
    
    cookieStore.set('current_user_id', adminUser.id, {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60,
      path: '/',
    })

    console.log('[VerifyOTP] Session created and cookies set')

    // 10. Return success
    let response = NextResponse.json({
      success: true,
      message: 'Email verified successfully! Welcome to your new account.',
      user: {
        id: adminUser.id,
        name: adminUser.name,
        email: adminUser.email,
        role: adminUser.role,
      },
      business: {
        id: business.id,
        name: business.business_name,
        email: business.business_email,
      },
      sessionToken,
    });
    // Set gmail_user_email session cookie for business login
    setSessionUserEmailInResponse(response, business.business_email);
    return response;
  } catch (error) {
    console.error('[VerifyOTP] Unexpected error:', error)
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
