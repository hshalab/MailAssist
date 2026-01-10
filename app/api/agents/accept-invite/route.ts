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

    // 4.5 Get business details (needed for both migration and new account flows)
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

    // 4.6 CRITICAL FIX: Check if user has a personal account (business_id is null)
    // If they do, we'll migrate it to the business account instead of creating duplicate
    const { data: personalAccount } = await supabase
      .from('users')
      .select('id, name, business_id, user_email')
      .eq('email', invitation.email)
      .is('business_id', null)
      .single()

    let userId: string;
    let isMigration = false;

    if (personalAccount) {
      // User has a personal account - migrate it to business account
      console.log('[AcceptInvite] Personal account found, migrating to business account');
      isMigration = true;

      // Update personal account to link to business
      const { data: updatedUser, error: updateError } = await supabase
        .from('users')
        .update({
          business_id: invitation.business_id,
          role: invitation.role,
          password_hash: await hashPassword(password), // Update password
          name: invitation.name, // Update name from invitation
        })
        .eq('id', personalAccount.id)
        .select()
        .single()

      if (updateError || !updatedUser) {
        console.error('[AcceptInvite] Error migrating personal account:', updateError);
        return NextResponse.json(
          { error: 'Failed to migrate personal account to business account' },
          { status: 500 }
        )
      }

      userId = updatedUser.id;
      console.log('[AcceptInvite] Successfully migrated personal account to business account');

      // Migrate tokens: Update any tokens with this email to link to business
      const { error: tokenError } = await supabase
        .from('tokens')
        .update({ business_id: invitation.business_id })
        .eq('user_email', invitation.email)
        .is('business_id', null)

      if (tokenError) {
        console.warn('[AcceptInvite] Warning: Could not migrate tokens (may not exist):', tokenError);
        // Don't fail - tokens might not exist yet
      } else {
        console.log('[AcceptInvite] Migrated tokens to business account');
      }

      // Migrate emails: Update any emails with this user_email to link to business
      // Note: emails table uses user_email, not a direct user_id reference
      // This is handled automatically since we're using the same email

      // Migrate tickets: Update tickets to use business user_email
      // Tickets are already scoped by user_email, so they'll automatically be accessible
    } else {
      // No personal account - create new business account (original flow)
      console.log('[AcceptInvite] No personal account found, creating new business account');

      // 5. Hash password
      const passwordHash = await hashPassword(password)

      // 6. Create user account
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

      userId = newUser.id;
    }

    // 7.5 Assign departments or full access (for both new and migrated accounts)
    if (invitation.has_full_access) {
      // User has full access - no department restrictions
      console.log('[AcceptInvite] User granted full access to all emails');
    } else if (invitation.department_ids && Array.isArray(invitation.department_ids) && invitation.department_ids.length > 0) {
      // Assign specific departments
      const departmentInserts = invitation.department_ids.map((deptId: string) => ({
        user_id: userId,
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

    // 8. Get the user record (either newly created or migrated)
    const { data: userRecord, error: userFetchError } = await supabase
      .from('users')
      .select('id, name, email, role, business_id')
      .eq('id', userId)
      .single()

    if (userFetchError || !userRecord) {
      console.error('[AcceptInvite] Error fetching user record:', userFetchError);
      return NextResponse.json(
        { error: 'Failed to retrieve user account' },
        { status: 500 }
      )
    }

    // 9. Generate session
    const { token: sessionToken, expiresAt } = generateSession()

    // 10. Create session record
    const { error: sessionError } = await supabase
      .from('user_sessions')
      .insert({
        user_id: userRecord.id,
        session_token: sessionToken,
        expires_at: expiresAt,
      })

    if (sessionError) {
      console.error('[AcceptInvite] Error creating session:', sessionError)
      // Continue anyway - user can log in manually
    }

    // 11. Update invitation status
    await supabase
      .from('agent_invitations')
      .update({
        status: 'accepted',
        accepted_at: new Date().toISOString()
      })
      .eq('id', invitation.id)

    // 12. Set session cookies
    const cookieStore = await cookies()
    const { getCookieOptions, getClientCookieOptions } = await import('@/lib/cookie-config')
    const cookieMaxAge = 30 * 24 * 60 * 60 // 30 days

    cookieStore.set('session_token', sessionToken, getCookieOptions({
      httpOnly: true,
      maxAge: cookieMaxAge,
    }))

    cookieStore.set('user_id', userRecord.id, getClientCookieOptions({
      maxAge: cookieMaxAge,
    }))

    cookieStore.set('current_user_id', userRecord.id, getClientCookieOptions({
      maxAge: cookieMaxAge,
    }))

    console.log(`[AcceptInvite] User ${isMigration ? 'migrated' : 'created'} and session established`)

    // 13. Return success
    return NextResponse.json({
      success: true,
      message: isMigration 
        ? 'Personal account migrated to business account successfully! Welcome to the team.'
        : 'Account created successfully! Welcome aboard.',
      user: {
        id: userRecord.id,
        name: userRecord.name,
        email: userRecord.email,
        role: userRecord.role,
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
