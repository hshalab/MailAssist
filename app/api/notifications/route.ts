import { NextRequest, NextResponse } from 'next/server'
import { listNotifications, markNotificationRead } from '@/lib/notifications'
import { getCurrentUserIdFromRequest } from '@/lib/session'

export async function GET(request: NextRequest) {
  // Try getting userId from cookie first
  let userId = getCurrentUserIdFromRequest(request)

  // If no cookie, try getting from business session
  if (!userId) {
    const { validateBusinessSession } = await import('@/lib/session')
    const businessSession = await validateBusinessSession()
    userId = businessSession?.id || null
  }

  if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  const notifications = await listNotifications(userId)
  return NextResponse.json({ notifications })
}

export async function PATCH(request: NextRequest) {
  const userId = getCurrentUserIdFromRequest(request)
  if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  const body = await request.json()
  const { notificationId } = body
  if (!notificationId) return NextResponse.json({ error: 'Missing notificationId' }, { status: 400 })
  const ok = await markNotificationRead(userId, notificationId)
  if (!ok) return NextResponse.json({ error: 'Failed to mark read' }, { status: 500 })
  return NextResponse.json({ ok: true })
}