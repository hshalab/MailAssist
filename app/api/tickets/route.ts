/**
 * GET /api/tickets - List tickets with role-based filtering
 * - Agents: see only their own tickets + unassigned tickets
 * - Admin/Manager: see all tickets
 */

import { NextRequest, NextResponse } from 'next/server';
import { getTickets } from '@/lib/tickets';
import { getCurrentUserIdFromRequest } from '@/lib/permissions';
import { canViewAllTickets } from '@/lib/permissions';
import { getCurrentUserEmail } from '@/lib/storage';
import { validateBusinessSession } from '@/lib/session';

export async function GET(request: NextRequest) {
  try {
    // CRITICAL FIX: Check for userId in header first (from sessionStorage, per-tab)
    // This prevents cookie sharing issues when multiple users are logged in on different tabs
    const headerUserId = request.headers.get('x-user-id');
    
    // Try getting userId from header (per-tab), then cookie, then business session
    let userId = headerUserId || getCurrentUserIdFromRequest(request);
    const businessSession = await validateBusinessSession();

    // If no header/cookie, fallback to business session
    if (!userId && businessSession?.id) {
      userId = businessSession.id;
    }

    const userEmail = await getCurrentUserEmail();
    const businessId = businessSession?.businessId || null;

    if (!userId) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    // CRITICAL: Validate that the userId from header/cookie actually belongs to the current session
    // This prevents one user from accessing another user's tickets
    if (businessSession && userId !== businessSession.id) {
      // If we have a business session, verify the userId matches
      // This ensures users can't spoof user IDs
      const { getUserById } = await import('@/lib/users');
      const user = await getUserById(userId);
      if (!user || user.businessId !== businessSession.businessId) {
        console.warn(`[Tickets API] User ID ${userId} does not belong to business ${businessSession.businessId}`);
        return NextResponse.json(
          { error: 'Unauthorized: User does not belong to this business' },
          { status: 403 }
        );
      }
    }

    if (!userEmail) {
      return NextResponse.json(
        { error: 'No Gmail account connected' },
        { status: 400 }
      );
    }

    // Check if user can view all tickets (Admin/Manager)
    const canViewAll = await canViewAllTickets(userId);

    // Get account filter if specified
    const accountFilter = request.nextUrl.searchParams.get('account') || undefined;

    // Get tickets with role-based filtering and optional account scope
    let tickets = await getTickets(userId, canViewAll, userEmail, accountFilter, businessId);

    // CRITICAL FIX: Filter tickets to only show those from connected accounts
    // This ensures tickets from disconnected accounts don't show up
    if (businessId) {
      const { loadBusinessTokens } = await import('@/lib/storage');
      const connectedAccounts = await loadBusinessTokens(businessId, userEmail);
      const connectedEmails = new Set(connectedAccounts.map(acc => acc.email));
      
      if (connectedEmails.size > 0) {
        // Only show tickets from connected accounts
        tickets = tickets.filter((ticket: any) => {
          // If ticket has owner_email, it must be in connected accounts
          // If no owner_email, allow it (legacy tickets)
          return !ticket.owner_email || connectedEmails.has(ticket.owner_email);
        });
        console.log(`[Tickets API] Filtered tickets to ${tickets.length} from ${connectedEmails.size} connected accounts`);
      } else {
        // No connected accounts, return empty
        console.log('[Tickets API] No connected accounts found, returning empty ticket list');
        tickets = [];
      }
    }

    return NextResponse.json({ tickets });
  } catch (error) {
    console.error('Error fetching tickets:', error);
    return NextResponse.json(
      { error: 'Failed to fetch tickets', details: (error as Error).message },
      { status: 500 }
    );
  }
}





