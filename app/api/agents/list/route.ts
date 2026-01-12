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

    // For personal accounts (businessId is null), return only the current user
    // For business accounts, return all users in the same business
    if (!sessionUser.businessId || sessionUser.accountType === 'personal') {
      // Personal account - return only the current user
      const { data: currentUser, error } = await supabase
        .from('users')
        .select('id, name, email, role, created_at')
        .eq('id', sessionUser.id)
        .eq('is_active', true)
        .single()

      if (error) {
        console.error('[ListAgents] Error fetching current user:', error)
        return NextResponse.json(
          { error: 'Failed to load user information' },
          { status: 500 }
        )
      }

      return NextResponse.json({
        success: true,
        members: currentUser ? [currentUser] : [],
      })
    }

    // Business account - get all users in the same business
    const { data: members, error } = await supabase
      .from('users')
      .select('id, name, email, role, created_at')
      .eq('business_id', sessionUser.businessId)
      .eq('is_active', true)
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
