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
    // Try getting userId from cookie first
    let userId = getCurrentUserIdFromRequest(request);
    const businessSession = await validateBusinessSession();

    // If no cookie, fallback to business session
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
    const tickets = await getTickets(userId, canViewAll, userEmail, accountFilter, businessId);

    return NextResponse.json({ tickets });
  } catch (error) {
    console.error('Error fetching tickets:', error);
    return NextResponse.json(
      { error: 'Failed to fetch tickets', details: (error as Error).message },
      { status: 500 }
    );
  }
}





