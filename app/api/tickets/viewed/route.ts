import { NextRequest, NextResponse } from "next/server"
import { getCurrentUserEmail } from "@/lib/storage"
import { getCurrentUserIdFromRequest } from "@/lib/session"
import { getTicketViewsForUser } from "@/lib/ticket-views"

export async function GET(request: NextRequest) {
  try {
    const userId = getCurrentUserIdFromRequest(request)
    if (!userId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
    }

    // CRITICAL FIX: For business accounts, allow access even if user doesn't have Gmail connected
    // Invited users (agents) should be able to see ticket views from business's connected accounts
    let userEmail = await getCurrentUserEmail()
    
    if (!userEmail) {
      // Check if this is a business account user
      const { validateBusinessSession } = await import('@/lib/session');
      const businessSession = await validateBusinessSession();
      
      if (businessSession?.businessId) {
        // For business accounts, use any connected account email from the business
        const { loadBusinessTokens } = await import('@/lib/storage');
        const connectedAccounts = await loadBusinessTokens(businessSession.businessId, businessSession?.email || undefined);
        if (connectedAccounts.length > 0) {
          userEmail = connectedAccounts[0].email;
          console.log(`[Tickets Viewed API] User ${userId} has no Gmail, using business account email: ${userEmail}`);
        }
      }
    }

    if (!userEmail) {
      return NextResponse.json({ error: "No Gmail account connected" }, { status: 400 })
    }

    const views = await getTicketViewsForUser(userId, userEmail)
    const map: Record<string, string> = {}
    views.forEach((v) => {
      map[v.ticketId] = v.lastViewedAt
    })

    return NextResponse.json({ views: map })
  } catch (error) {
    console.error("Error fetching ticket views:", error)
    return NextResponse.json({ error: "Failed to fetch ticket views" }, { status: 500 })
  }
}

