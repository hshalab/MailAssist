/**
 * GET /api/analytics/guardrails - Get guardrail usage statistics
 */

import { NextRequest, NextResponse } from 'next/server';
import { getGuardrailStats } from '@/lib/analytics';
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

    const stats = await getGuardrailStats(userEmail, startDate, endDate, businessId);

    return NextResponse.json(
      { stats, dateRange: { startDate: startDate.toISOString(), endDate: endDate.toISOString() } },
      { headers: { 'Cache-Control': 'private, max-age=300, stale-while-revalidate=60' } }
    );
  } catch (error) {
    console.error('Error fetching guardrail stats:', error);
    return NextResponse.json(
      { error: 'Failed to fetch guardrail stats', details: (error as Error).message },
      { status: 500 }
    );
  }
}





