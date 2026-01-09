/**
 * GET /api/agents/list
 * Get all team members for the current business
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

    // Get all users in the same business
    // If no business ID, just return the current user (personal account mode)
    if (!sessionUser.businessId) {
      return NextResponse.json({
        success: true,
        members: [{
          id: sessionUser.id,
          name: sessionUser.name,
          email: sessionUser.email,
          role: sessionUser.role,
        }],
      })
    }

    const { data: members, error } = await supabase
      .from('users')
      .select('id, name, email, role, created_at')
      .eq('business_id', sessionUser.businessId)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('[ListAgents] Error fetching members:', error)
      return NextResponse.json(
        { error: 'Failed to load team members' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      members: members || [],
    })
  } catch (error) {
    console.error('[ListAgents] Unexpected error:', error)
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    )
  }
}
