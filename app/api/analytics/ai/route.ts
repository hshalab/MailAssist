/**
 * GET /api/analytics/ai - Get AI usage statistics
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAIUsageStats } from '@/lib/analytics';
import { getSessionUserEmailFromRequest, validateBusinessSession } from '@/lib/session';
import { isValidDate } from '@/lib/validation';

export async function GET(request: NextRequest) {
  try {
    const userEmail = getSessionUserEmailFromRequest(request as any);
    if (!userEmail) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    // Get business context for team-wide analytics
    const businessSession = await validateBusinessSession();
    const businessId = businessSession?.businessId || null;

    const url = new URL(request.url);
    const startDateStr = url.searchParams.get('startDate') || '';
    const endDateStr = url.searchParams.get('endDate') || '';

    // Default to last 30 days if not provided
    const endDate = endDateStr && isValidDate(endDateStr)
      ? new Date(endDateStr)
      : new Date();
    const startDate = startDateStr && isValidDate(startDateStr)
      ? new Date(startDateStr)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days ago

    const stats = await getAIUsageStats(userEmail, startDate, endDate, businessId);

    return NextResponse.json(
      { stats, dateRange: { startDate: startDate.toISOString(), endDate: endDate.toISOString() } },
      { headers: { 'Cache-Control': 'private, max-age=300, stale-while-revalidate=60' } }
    );
  } catch (error) {
    console.error('Error fetching AI usage stats:', error);
    return NextResponse.json(
      { error: 'Failed to fetch AI usage stats', details: (error as Error).message },
      { status: 500 }
    );
  }
}





