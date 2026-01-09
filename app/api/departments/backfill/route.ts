import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { getCurrentUser, validateBusinessSession } from '@/lib/session';
import { classifyTicketToDepartmentAsync } from '@/lib/tickets';

export async function POST(request: NextRequest) {
    if (!supabase) {
        return NextResponse.json({ error: 'Database connection failed' }, { status: 500 });
    }

    try {
        console.log('[Backfill] Starting backfill request...');

        // Robust Auth Check
        let user = await getCurrentUser();

        if (!user) {
            console.log('[Backfill] getCurrentUser returned null. Trying validateBusinessSession...');
            const businessSession = await validateBusinessSession();
            if (businessSession) {
                user = businessSession;
            } else {
                console.log('[Backfill] validateBusinessSession returned null. Checking request cookies...');

                // Validation 2: Check request cookies directly (more reliable in some contexts)
                const userId = request.cookies.get('current_user_id')?.value;

                if (userId) {
                    console.log('[Backfill] Found current_user_id cookie in request:', userId);
                    try {
                        // Try to fetch user manually
                        const { getUserById } = await import('@/lib/users');
                        const dbUser = await getUserById(userId);
                        if (dbUser) {
                            user = {
                                id: dbUser.id,
                                name: dbUser.name,
                                email: dbUser.email || '',
                                role: dbUser.role,
                                businessId: dbUser.businessId || null,
                                businessName: 'Unknown',
                                accountType: dbUser.businessId ? 'business' : 'personal'
                            };
                        } else {
                            console.warn('[Backfill] User ID found in cookie but not in DB:', userId);
                        }
                    } catch (err) {
                        console.error('[Backfill] Error fetching user from DB:', err);
                    }
                } else {
                    console.warn('[Backfill] No current_user_id cookie found in request');
                    // Debug: list all cookies
                    request.cookies.getAll().forEach(c => console.log(`Cookie: ${c.name}=${c.value.substring(0, 10)}...`));
                }
            }
        }

        if (!user) {
            console.error('[Backfill] Authentication failed. No user found.');
            return NextResponse.json({ error: 'Unauthorized - Please refresh page' }, { status: 401 });
        }

        console.log(`[Backfill] Authenticated as user: ${user.email} (${user.id})`);

        // Fetch user settings for auto_classify_days
        let settingsQuery = supabase
            .from('user_settings')
            .select('auto_classify_days');

        if (user.accountType === 'business' && user.businessId) {
            settingsQuery = settingsQuery.eq('business_id', user.businessId);
        } else {
            settingsQuery = settingsQuery.eq('user_email', user.email);
        }

        const { data: settings } = await settingsQuery.maybeSingle();
        const defaultDays = settings?.auto_classify_days || 30;

        // Parse options (allow override via body, but default to user settings)
        const body = await request.json().catch(() => ({}));
        const days = body.days || defaultDays;
        const limit = Math.min(body.limit || 25, 50); // specific batch size, max 50

        // Calculate cutoff date
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - days);

        // Fetch unclassified, open, recent tickets
        // Note: We check department_id is null
        const { data: tickets, error: fetchError } = await supabase
            .from('tickets')
            .select('id, subject, user_email, created_at')
            .is('department_id', null)
            .neq('status', 'closed')
            .gte('created_at', cutoffDate.toISOString())
            .limit(limit);

        if (fetchError) {
            console.error('Backfill fetch error:', fetchError);
            return NextResponse.json({ error: fetchError.message }, { status: 500 });
        }

        if (!tickets || tickets.length === 0) {
            return NextResponse.json({
                message: 'No matching tickets found.',
                processed: 0,
                success: 0
            });
        }

        // Process concurrently (up to limit)
        const results = await Promise.allSettled(
            tickets.map(async (t) => {
                // Need email body for better classification, but subject is often enough for a quick pass 
                // OR we can fetch body. classifyTicketToDepartmentAsync fetches body if not provided?
                // Checking lib/tickets.ts: classifyTicketToDepartmentAsync(ticketId, subject, body, userEmail)
                // It does NOT fetch body internally if passed null/undefined, it needs body.
                // We should probably fetch the first message body for these tickets to be accurate.

                // Let's fetch the thread's first message to get body.
                const { data: messages } = await supabase
                    .from('messages')
                    .select('body')
                    .eq('ticket_id', t.id)
                    .order('date', { ascending: true })
                    .limit(1)
                    .single();

                const bodyContent = messages?.body || '';

                // Pass user_email from ticket or current user? 
                // The classifier needs context of departments, which are fetched based on userEmail/businessId.
                // classifyTicketToDepartmentAsync signature: (ticketId, subject, body, userEmail)
                // We should pass the updated userEmail logic.

                return classifyTicketToDepartmentAsync(t.id, t.subject, bodyContent, t.user_email || user.email);
            })
        );

        const successCount = results.filter(r => r.status === 'fulfilled').length;
        const failCount = results.filter(r => r.status === 'rejected').length;

        return NextResponse.json({
            message: `Processed ${tickets.length} tickets.`,
            processed: tickets.length,
            success: successCount,
            failed: failCount
        });

    } catch (error) {
        console.error('Backfill error:', error);
        return NextResponse.json(
            { error: 'Internal server error', details: (error as Error).message },
            { status: 500 }
        );
    }
}
