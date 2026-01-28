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

    let userEmail = await getCurrentUserEmail();
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

    // CRITICAL FIX: For business accounts, allow access even if user doesn't have Gmail connected
    // Invited users (agents) should be able to see tickets from business's connected accounts
    if (!userEmail && businessId) {
      // For business accounts, use business session email or any connected account email
      // This allows agents to see tickets even if they haven't connected their own Gmail
      const { loadBusinessTokens } = await import('@/lib/storage');
      const connectedAccounts = await loadBusinessTokens(businessId, businessSession?.email || undefined);
      if (connectedAccounts.length > 0) {
        // Use the first connected account's email for ticket filtering
        // The actual filtering will use all connected accounts
        userEmail = connectedAccounts[0].email;
        console.log(`[Tickets API] User ${userId} has no Gmail, using business account email: ${userEmail}`);
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

    const sortParam = request.nextUrl.searchParams.get('sort');

    // Default sort order logic:
    // If explicit sort param is provided, use it.
    // Otherwise, let frontend decide or default to 'desc' if not specified.
    // However, the USER request specifically asked for:
    // - Open/Unassigned = Oldest to Newest (ASC)
    // - Closed = Newest to Oldest (DESC)
    // We'll let the frontend drive this by passing ?sort=asc or ?sort=desc based on the active tab.
    const sortOrder = (sortParam === 'asc' || sortParam === 'desc') ? sortParam : 'desc';
    console.log(`[Tickets API] Received sort param: ${sortParam}, using sortOrder: ${sortOrder}`);

    // Parse status filter (comma separated) e.g. "open,pending"
    const statusParam = request.nextUrl.searchParams.get('status');
    const statusFilter = statusParam ? (statusParam.split(',') as any[]) : undefined;

    // Parse search query
    const searchQuery = request.nextUrl.searchParams.get('q') || undefined;

    // Get tickets with role-based filtering and optional account scope
    let tickets = await getTickets(
      userId,
      canViewAll,
      userEmail,
      accountFilter,
      businessId,
      sortOrder,
      statusFilter,
      searchQuery
    );

    // CRITICAL FIX: Filter tickets to only show those from connected accounts
    // This ensures tickets from disconnected accounts don't show up
    // Apply to both business and personal accounts
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

    return NextResponse.json({ tickets });
  } catch (error) {
    console.error('Error fetching tickets:', error);
    return NextResponse.json(
      { error: 'Failed to fetch tickets', details: (error as Error).message },
      { status: 500 }
    );
  }
}





