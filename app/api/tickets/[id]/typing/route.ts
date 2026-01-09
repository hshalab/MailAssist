/**
 * GET/POST /api/tickets/[id]/typing - Manage typing indicators
 * GET: Fetch current typing users
 * POST: Update typing status for current user
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserIdFromRequest } from '@/lib/permissions';
import { validateBusinessSession } from '@/lib/session';

// In-memory store for typing indicators (in production, use Redis or database)
const typingStatus = new Map<string, Map<string, number>>(); // ticketId -> userId -> timestamp

// Clean up old typing indicators (older than 5 seconds)
setInterval(() => {
  const now = Date.now()
  typingStatus.forEach((users, ticketId) => {
    users.forEach((timestamp, userId) => {
      if (now - timestamp > 5000) {
        users.delete(userId)
      }
    })
    if (users.size === 0) {
      typingStatus.delete(ticketId)
    }
  })
}, 2000)

type RouteContext =
  | { params: { id: string } }
  | { params: Promise<{ id: string }> };

export async function GET(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const paramsData = await Promise.resolve((context as any).params);
    const ticketId = paramsData?.id;

    if (!ticketId) {
      return NextResponse.json(
        { error: 'Missing ticket ID' },
        { status: 400 }
      );
    }

    // Try getting userId from cookie first, then fallback to business session
    let userId = getCurrentUserIdFromRequest(request);
    if (!userId) {
      const businessSession = await validateBusinessSession();
      userId = businessSession?.id || null;
    }

    if (!userId) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    // Get all users currently typing (excluding current user)
    const typingUsers = typingStatus.get(ticketId);
    const activeTypingUsers = typingUsers
      ? Array.from(typingUsers.keys()).filter(id => id !== userId)
      : [];

    return NextResponse.json({ typingUsers: activeTypingUsers });
  } catch (error) {
    console.error('Error fetching typing status:', error);
    return NextResponse.json(
      { error: 'Failed to fetch typing status', details: (error as Error).message },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const paramsData = await Promise.resolve((context as any).params);
    const ticketId = paramsData?.id;

    if (!ticketId) {
      return NextResponse.json(
        { error: 'Missing ticket ID' },
        { status: 400 }
      );
    }

    // Try getting userId from cookie first, then fallback to business session
    let userId = getCurrentUserIdFromRequest(request);
    if (!userId) {
      const businessSession = await validateBusinessSession();
      userId = businessSession?.id || null;
    }

    if (!userId) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { typing } = body;

    if (typeof typing !== 'boolean') {
      return NextResponse.json(
        { error: 'Invalid typing status' },
        { status: 400 }
      );
    }

    // Update typing status
    if (!typingStatus.has(ticketId)) {
      typingStatus.set(ticketId, new Map());
    }

    const users = typingStatus.get(ticketId)!;

    if (typing) {
      users.set(userId, Date.now());
    } else {
      users.delete(userId);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error updating typing status:', error);
    return NextResponse.json(
      { error: 'Failed to update typing status', details: (error as Error).message },
      { status: 500 }
    );
  }
}

