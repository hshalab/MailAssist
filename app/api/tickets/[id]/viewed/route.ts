import { NextRequest, NextResponse } from "next/server"
import { getUserEmailForTickets } from "@/lib/ticket-helpers"
import { getCurrentUserIdFromRequest } from "@/lib/session"
import { upsertTicketView } from "@/lib/ticket-views"

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const params = await context.params
    const ticketId = params?.id
    if (!ticketId) {
      return NextResponse.json({ error: "Missing ticket ID" }, { status: 400 })
    }

    const userId = getCurrentUserIdFromRequest(request)
    if (!userId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
    }

    const userEmail = await getUserEmailForTickets()
    if (!userEmail) {
      return NextResponse.json({ error: "No Gmail account connected" }, { status: 400 })
    }

    const body = await request.json().catch(() => ({}))
    const lastViewedAt = body?.lastViewedAt as string | undefined

    const result = await upsertTicketView(userId, ticketId, lastViewedAt)

    if (!result) {
      return NextResponse.json({ error: "Failed to update view state" }, { status: 500 })
    }

    return NextResponse.json({ ticketId, lastViewedAt: result.last_viewed_at || lastViewedAt })
  } catch (error) {
    console.error("Error updating ticket view:", error)
    return NextResponse.json({ error: "Failed to update ticket view" }, { status: 500 })
  }
}

