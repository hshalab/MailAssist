/**
 * POST /api/agents/accept-invite
 * Accept an agent invitation and create user account
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-client'
import { hashPassword, generateSession } from '@/lib/auth-utils'
import { cookies } from 'next/headers'

export async function POST(request: NextRequest) {
  try {
    // 1. Parse request body
    const body = await request.json()
    const { invitationToken, password } = body

    if (!invitationToken || !password) {
      return NextResponse.json(
        { error: 'Invitation token and password are required' },
        { status: 400 }
      )
    }

    // Validate password strength
    if (password.length < 8) {
      return NextResponse.json(
        { error: 'Password must be at least 8 characters long' },
        { status: 400 }
      )
    }

    const supabase = createServerClient()

    // 2. Find the invitation
    const { data: invitation, error: inviteError } = await supabase
      .from('agent_invitations')
      .select('*')
      .eq('invitation_token', invitationToken)
      .eq('status', 'pending')
      .single()

    if (inviteError || !invitation) {
      return NextResponse.json(
        { error: 'Invalid or expired invitation' },
        { status: 404 }
      )
    }

    // 3. Check if invitation has expired
    if (new Date(invitation.expires_at) < new Date()) {
      // Update invitation status to expired
      await supabase
        .from('agent_invitations')
        .update({ status: 'expired' })
        .eq('id', invitation.id)

      return NextResponse.json(
        { error: 'This invitation has expired. Please request a new invitation.' },
        { status: 410 }
      )
    }

    // 4. Check if user already exists with this email in this business
    const { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .eq('email', invitation.email)
      .eq('business_id', invitation.business_id)
      .single()

    if (existingUser) {
      return NextResponse.json(
        { error: 'An account with this email already exists' },
        { status: 409 }
      )
    }

    // 5. Get business details
    const { data: business, error: businessError } = await supabase
      .from('businesses')
      .select('id, business_name')
      .eq('id', invitation.business_id)
      .single()

    if (businessError || !business) {
      return NextResponse.json(
        { error: 'Business not found' },
        { status: 404 }
      )
    }

    // 6. Hash password
    const passwordHash = await hashPassword(password)

    // 7. Create user account
    const { data: newUser, error: userError } = await supabase
      .from('users')
      .insert({
        business_id: invitation.business_id,
        name: invitation.name,
        email: invitation.email,
        role: invitation.role,
        password_hash: passwordHash,
      })
      .select()
      .single()

    if (userError) {
      console.error('[AcceptInvite] Error creating user:', userError)
      return NextResponse.json(
        { error: 'Failed to create user account' },
        { status: 500 }
      )
    }

    // 7.5 Assign departments or full access
    if (invitation.has_full_access) {
      // User has full access - no department restrictions
      console.log('[AcceptInvite] User granted full access to all emails');
    } else if (invitation.department_ids && Array.isArray(invitation.department_ids) && invitation.department_ids.length > 0) {
      // Assign specific departments
      const departmentInserts = invitation.department_ids.map((deptId: string) => ({
        user_id: newUser.id,
        department_id: deptId
      }));

      const { error: deptError } = await supabase
        .from('user_departments')
        .insert(departmentInserts);

      if (deptError) {
        console.error('[AcceptInvite] Error assigning departments:', deptError);
        // Don't fail the request, just log it. Admin can assign manually later.
      } else {
        console.log(`[AcceptInvite] Assigned ${invitation.department_ids.length} departments to user`);
      }
    }

    // 8. Generate session
    const { token: sessionToken, expiresAt } = generateSession()

    // 9. Create session record
    const { error: sessionError } = await supabase
      .from('user_sessions')
      .insert({
        user_id: newUser.id,
        session_token: sessionToken,
        expires_at: expiresAt,
      })

    if (sessionError) {
      console.error('[AcceptInvite] Error creating session:', sessionError)
      // Continue anyway - user can log in manually
    }

    // 10. Update invitation status
    await supabase
      .from('agent_invitations')
      .update({
        status: 'accepted',
        accepted_at: new Date().toISOString()
      })
      .eq('id', invitation.id)

    // 11. Set session cookies
    const cookieStore = await cookies()
    const { getCookieOptions, getClientCookieOptions } = await import('@/lib/cookie-config')
    const cookieMaxAge = 30 * 24 * 60 * 60 // 30 days

    cookieStore.set('session_token', sessionToken, getCookieOptions({
      httpOnly: true,
      maxAge: cookieMaxAge,
    }))

    cookieStore.set('user_id', newUser.id, getClientCookieOptions({
      maxAge: cookieMaxAge,
    }))

    cookieStore.set('current_user_id', newUser.id, getClientCookieOptions({
      maxAge: cookieMaxAge,
    }))

    console.log('[AcceptInvite] User created and session established')

    // 12. Return success
    return NextResponse.json({
      success: true,
      message: 'Account created successfully! Welcome aboard.',
      user: {
        id: newUser.id,
        name: newUser.name,
        email: newUser.email,
        role: newUser.role,
      },
      business: {
        id: business.id,
        name: business.business_name,
      },
      sessionToken,
    })
  } catch (error) {
    console.error('[AcceptInvite] Unexpected error:', error)
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    )
  }
}
