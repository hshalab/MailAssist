/**
 * Cron endpoint to renew Gmail Watch subscriptions
 * 
 * Gmail Watch subscriptions expire after 7 days. This cron job
 * runs daily to renew watches for all connected accounts.
 * 
 * Vercel Cron: Schedule this to run daily
 * 
 * Last updated: 2026-02-05
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    const startTime = Date.now();

    // Verify cron secret
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('[Watch Renewal] Starting Gmail watch renewal...');

    try {
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

        if (!supabaseUrl || !supabaseServiceKey) {
            throw new Error('Missing Supabase credentials');
        }

        const adminClient = createClient(supabaseUrl, supabaseServiceKey, {
            auth: { persistSession: false }
        });

        // Get all tokens
        const { data: tokens, error: tokenError } = await adminClient
            .from('tokens')
            .select('user_email, access_token, refresh_token')
            .not('access_token', 'is', null);

        if (tokenError) throw tokenError;
        if (!tokens || tokens.length === 0) {
            return NextResponse.json({ message: 'No accounts to process' });
        }

        const { startHistoryWatch } = await import('@/lib/gmail');

        const results: { email: string; success: boolean; error?: string }[] = [];

        for (const token of tokens) {
            if (!token.user_email) continue;

            try {
                await startHistoryWatch({
                    access_token: token.access_token,
                    refresh_token: token.refresh_token,
                });

                results.push({ email: token.user_email, success: true });
                console.log(`[Watch Renewal] Renewed watch for ${token.user_email}`);
            } catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                results.push({ email: token.user_email, success: false, error: errorMsg });
                console.error(`[Watch Renewal] Failed for ${token.user_email}:`, errorMsg);
            }
        }

        const successCount = results.filter(r => r.success).length;
        const duration = Date.now() - startTime;

        console.log(`[Watch Renewal] Completed: ${successCount}/${results.length} accounts renewed in ${duration}ms`);

        return NextResponse.json({
            success: true,
            renewed: successCount,
            total: results.length,
            duration,
            results,
        });

    } catch (error) {
        console.error('[Watch Renewal] Fatal error:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : String(error) },
            { status: 500 }
        );
    }
}
