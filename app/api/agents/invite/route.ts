/**
 * POST /api/agents/invite
 * Invite a new agent to join the business
 * Only admins can invite agents
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-client'
import { validateBusinessSession } from '@/lib/session'
import { randomBytes } from 'crypto'
import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY!)

export async function POST(request: NextRequest) {
  try {
    // 1. Validate user session and check if admin
    const sessionUser = await validateBusinessSession()

    if (!sessionUser) {
      return NextResponse.json(
        { error: 'Unauthorized - please log in' },
        { status: 401 }
      )
    }

    if (sessionUser.role !== 'admin' && sessionUser.role !== 'manager') {
      return NextResponse.json(
        { error: 'Only admins and managers can invite agents' },
        { status: 403 }
      )
    }

    // 2. Parse request body
    const body = await request.json()
    const { name, email, role = 'agent', departmentIds = [] } = body

    if (!name || !email) {
      return NextResponse.json(
        { error: 'Name and email are required' },
        { status: 400 }
      )
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { error: 'Invalid email format' },
        { status: 400 }
      )
    }

    // Validate role
    if (!['agent', 'manager'].includes(role)) {
      return NextResponse.json(
        { error: 'Role must be either "agent" or "manager"' },
        { status: 400 }
      )
    }

    const supabase = createServerClient()

    // 3. Check if user already exists in this business
    const { data: existingUser } = await supabase
      .from('users')
      .select('id, email, business_id')
      .eq('email', email)
      .eq('business_id', sessionUser.businessId)
      .single()

    if (existingUser) {
      return NextResponse.json(
        { error: 'A user with this email already exists in your business' },
        { status: 409 }
      )
    }

    // 4. Check if there's already a pending invitation
    const { data: existingInvite } = await supabase
      .from('agent_invitations')
      .select('id, status')
      .eq('email', email)
      .eq('business_id', sessionUser.businessId)
      .eq('status', 'pending')
      .single()

    if (existingInvite) {
      return NextResponse.json(
        { error: 'There is already a pending invitation for this email' },
        { status: 409 }
      )
    }

    // 5. Generate invitation token
    const invitationToken = randomBytes(32).toString('hex')
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + 7) // 7 days expiry

    // 6. Create invitation record
    const { data: invitation, error: inviteError } = await supabase
      .from('agent_invitations')
      .insert({
        business_id: sessionUser.businessId,
        invited_by: sessionUser.id,
        email: email,
        name: name,
        role: role,
        invitation_token: invitationToken,
        token: invitationToken, // for backward compatibility
        status: 'pending',
        expires_at: expiresAt.toISOString(),
        department_ids: departmentIds, // Store department IDs for assignment after acceptance
      })
      .select()
      .single()

    if (inviteError) {
      console.error('[InviteAgent] Error creating invitation:', inviteError)
      return NextResponse.json(
        { error: 'Failed to create invitation' },
        { status: 500 }
      )
    }

    // 7. Send invitation email
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    const inviteUrl = `${appUrl}/invite/${invitationToken}`

    const companyName = process.env.COMPANY_NAME || 'Mail Assistant';
    const fromEmail = process.env.EMAIL_FROM || 'onboarding@resend.dev';

    try {
      const resendResult = await resend.emails.send({
        from: `${companyName} <${fromEmail}>`,
        to: email,
        subject: `You've been invited to join ${sessionUser.businessName}`,
        html: `
          <!DOCTYPE html>
          <html>
            <head>
              <style>
                body {
                  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
                  line-height: 1.6;
                  color: #333;
                  max-width: 600px;
                  margin: 0 auto;
                  padding: 20px;
                }
                .container {
                  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                  border-radius: 12px;
                  padding: 40px;
                  color: white;
                }
                .content {
                  background: white;
                  border-radius: 8px;
                  padding: 30px;
                  color: #333;
                  margin-top: 20px;
                }
                .button {
                  display: inline-block;
                  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                  color: white;
                  padding: 14px 32px;
                  text-decoration: none;
                  border-radius: 8px;
                  font-weight: 600;
                  margin: 20px 0;
                }
                .footer {
                  margin-top: 30px;
                  padding-top: 20px;
                  border-top: 1px solid #eee;
                  font-size: 12px;
                  color: #666;
                  text-align: center;
                }
              </style>
            </head>
            <body>
              <div class="container">
                <h1 style="margin: 0; font-size: 28px;">🎉 You've Been Invited!</h1>
                <p style="margin: 10px 0 0 0; opacity: 0.9;">Join ${sessionUser.businessName} on ${companyName}</p>
              </div>
              
              <div class="content">
                <p>Hi ${name},</p>
                
                <p><strong>${sessionUser.name}</strong> has invited you to join <strong>${sessionUser.businessName}</strong> as a ${role}.</p>
                
                <p>Click the button below to accept your invitation and set up your account:</p>
                
                <center>
                  <a href="${inviteUrl}" class="button">Accept Invitation</a>
                </center>
                
                <p style="font-size: 14px; color: #666;">
                  Or copy and paste this link into your browser:<br>
                  <a href="${inviteUrl}" style="color: #667eea; word-break: break-all;">${inviteUrl}</a>
                </p>
                
                <p style="font-size: 14px; color: #666;">
                  This invitation will expire in 7 days.
                </p>
              </div>
              
              <div class="footer">
                <p>This email was sent by ${companyName}. If you weren't expecting this invitation, you can safely ignore this email.</p>
              </div>
            </body>
          </html>
        `,
      });
      console.log('[InviteAgent] Resend API response:', JSON.stringify(resendResult));
      if (!resendResult || resendResult.error) {
        console.error('[InviteAgent] Resend API error:', resendResult?.error);
        // Delete the invitation if email fails
        await supabase
          .from('agent_invitations')
          .delete()
          .eq('id', invitation.id);
        return NextResponse.json(
          { error: 'Failed to send invitation email. Please try again.' },
          { status: 500 }
        );
      }
      console.log('[InviteAgent] Invitation email sent successfully');
    } catch (emailError) {
      console.error('[InviteAgent] Error sending invitation email:', emailError)

      // Delete the invitation if email fails
      await supabase
        .from('agent_invitations')
        .delete()
        .eq('id', invitation.id)

      return NextResponse.json(
        { error: 'Failed to send invitation email. Please try again.' },
        { status: 500 }
      )
    }

    // 8. Return success
    return NextResponse.json({
      success: true,
      message: `Invitation sent to ${email}`,
      invitation: {
        id: invitation.id,
        email: invitation.email,
        name: invitation.name,
        role: invitation.role,
        status: invitation.status,
        expiresAt: invitation.expires_at,
      },
    })
  } catch (error) {
    console.error('[InviteAgent] Unexpected error:', error)
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    )
  }
}
