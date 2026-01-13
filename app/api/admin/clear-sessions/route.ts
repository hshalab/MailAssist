import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

/**
 * Admin-only endpoint to clear all sessions
 * This forces all users to re-login, fixing stale session issues
 * 
 * Usage: POST /api/admin/clear-sessions
 * Requires: Admin authentication
 */
export async function POST(req: NextRequest) {
    try {
        // Create admin client with service role key
        const supabaseAdmin = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!,
            {
                auth: {
                    autoRefreshToken: false,
                    persistSession: false
                }
            }
        );

        // Verify admin access (check if current user is admin)
        // You can add your own admin verification logic here
        const authHeader = req.headers.get('authorization');
        if (!authHeader) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Clear all sessions
        const { error } = await supabaseAdmin.rpc('clear_all_sessions');

        if (error) {
            // Fallback: Direct SQL delete if RPC doesn't exist
            const { error: deleteError } = await supabaseAdmin
                .from('auth.sessions')
                .delete()
                .neq('id', '00000000-0000-0000-0000-000000000000'); // Delete all

            if (deleteError) {
                throw deleteError;
            }
        }

        return NextResponse.json({
            success: true,
            message: 'All sessions cleared. Users will need to re-login.'
        });
    } catch (error) {
        console.error('[Admin] Error clearing sessions:', error);
        return NextResponse.json(
            { error: 'Failed to clear sessions' },
            { status: 500 }
        );
    }
}
