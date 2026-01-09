/**
 * GET /api/agents/invitations
 * Get all pending invitations for the current business
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase-client'
import { validateBusinessSession } from '@/lib/session'

export async function GET(request: NextRequest) {
  try {
    // Validate user session
    const sessionUser = await validateBusinessSession()

    if (!sessionUser) {
      return NextResponse.json(
        { error: 'Unauthorized - please log in' },
        { status: 401 }
      )
    }

    const supabase = createServerClient()

    // Get all pending invitations for this business
    // If no business ID, return empty list (personal accounts don't have team invitations)
    if (!sessionUser.businessId) {
      return NextResponse.json({
        success: true,
        invitations: [],
      })
    }

    const { data: invitations, error } = await supabase
      .from('agent_invitations')
      .select('id, email, name, role, status, expires_at, created_at')
      .eq('business_id', sessionUser.businessId)
      .in('status', ['pending', 'expired'])
      .order('created_at', { ascending: false })

    if (error) {
      console.error('[ListInvitations] Error fetching invitations:', error)
      return NextResponse.json(
        { error: 'Failed to load invitations' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      invitations: invitations || [],
    })
  } catch (error) {
    console.error('[ListInvitations] Unexpected error:', error)
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    )
  }
}
