import { NextResponse } from 'next/server';
import { cleanupOrphanedTicketAssignments } from '@/lib/tickets';
import { validateBusinessSession } from '@/lib/session';

/**
 * POST /api/debug/cleanup-orphaned-assignments
 * 
 * Cleans up tickets assigned to inactive or deleted users.
 * Sets assignee_user_id to NULL for orphaned assignments.
 * 
 * This fixes count inconsistencies when users are soft-deleted.
 */
export async function POST() {
  try {
    // Verify user is authenticated
    const session = await validateBusinessSession();
    if (!session) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    const cleanedCount = await cleanupOrphanedTicketAssignments();

    return NextResponse.json({
      success: true,
      message: `Cleaned up ${cleanedCount} orphaned ticket assignments`,
      cleanedCount
    });
  } catch (error) {
    console.error('Error cleaning up orphaned assignments:', error);
    return NextResponse.json(
      { 
        error: 'Failed to cleanup orphaned assignments', 
        details: (error as Error).message 
      },
      { status: 500 }
    );
  }
}

