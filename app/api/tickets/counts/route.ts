
import { NextRequest, NextResponse } from 'next/server';
import { getTicketCounts } from '@/lib/tickets';
import { getCurrentUserIdFromRequest } from '@/lib/permissions';
import { canViewAllTickets } from '@/lib/permissions';
import { getCurrentUserEmail } from '@/lib/storage';
import { validateBusinessSession } from '@/lib/session';

export async function GET(request: NextRequest) {
    try {
        const headerUserId = request.headers.get('x-user-id');
        let userId = headerUserId || getCurrentUserIdFromRequest(request);
        const businessSession = await validateBusinessSession();

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

        if (businessSession && userId !== businessSession.id) {
            const { getUserById } = await import('@/lib/users');
            const user = await getUserById(userId);
            if (!user || user.businessId !== businessSession.businessId) {
                return NextResponse.json(
                    { error: 'Unauthorized' },
                    { status: 403 }
                );
            }
        }

        if (!userEmail && businessId) {
            const { loadBusinessTokens } = await import('@/lib/storage');
            const connectedAccounts = await loadBusinessTokens(businessId, businessSession?.email || undefined);
            if (connectedAccounts.length > 0) {
                userEmail = connectedAccounts[0].email;
            }
        }

        if (!userEmail) {
            // Return zeros if no email (technically shouldn't happen for valid users)
            return NextResponse.json({ counts: { open: 0, assigned: 0, unassigned: 0, closed: 0 } });
        }

        const canViewAll = await canViewAllTickets(userId);
        const accountFilter = request.nextUrl.searchParams.get('account') || undefined;

        const counts = await getTicketCounts(
            userId,
            canViewAll,
            userEmail,
            accountFilter,
            businessId
        );

        return NextResponse.json({ counts }, {
            headers: {
                'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0'
            }
        });
    } catch (error) {
        console.error('Error fetching ticket counts:', error);
        return NextResponse.json(
            { error: 'Failed to fetch ticket counts', details: (error as Error).message },
            { status: 500 }
        );
    }
}
