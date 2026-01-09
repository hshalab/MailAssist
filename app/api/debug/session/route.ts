/**
 * GET /api/debug/session - Debug current session
 */

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = (supabaseUrl && supabaseKey)
    ? createClient(supabaseUrl, supabaseKey)
    : null;

export async function GET(request: NextRequest) {
    try {
        if (!supabase) {
            return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
        }

        const cookieStore = await cookies();
        const sessionToken = cookieStore.get('session_token')?.value;
        const currentUserId = cookieStore.get('current_user_id')?.value;
        const gmailUserEmail = cookieStore.get('gmail_user_email')?.value;

        // Get session info
        let sessionInfo = null;
        if (sessionToken) {
            const { data: session } = await supabase
                .from('user_sessions')
                .select('user_id, business_id, expires_at')
                .eq('session_token', sessionToken)
                .single();

            if (session) {
                // Get user info for this session
                const { data: user } = await supabase
                    .from('users')
                    .select('id, email, name, role, business_id')
                    .eq('id', session.user_id)
                    .single();

                sessionInfo = {
                    userId: session.user_id,
                    businessId: session.business_id,
                    expiresAt: session.expires_at,
                    user: user
                };
            }
        }

        // Get all sessions for debugging
        const { data: allSessions } = await supabase
            .from('user_sessions')
            .select('session_token, user_id, business_id, created_at, expires_at')
            .order('created_at', { ascending: false })
            .limit(10);

        // Get all users in the business
        let businessUsers = null;
        if (sessionInfo?.businessId) {
            const { data: users } = await supabase
                .from('users')
                .select('id, email, name, role')
                .eq('business_id', sessionInfo.businessId);
            businessUsers = users;
        }

        return NextResponse.json({
            cookies: {
                session_token: sessionToken ? sessionToken.substring(0, 8) + '...' : null,
                current_user_id: currentUserId,
                gmail_user_email: gmailUserEmail
            },
            currentSession: sessionInfo,
            recentSessions: allSessions?.map(s => ({
                token: s.session_token.substring(0, 8) + '...',
                userId: s.user_id,
                businessId: s.business_id,
                createdAt: s.created_at
            })),
            businessUsers
        });
    } catch (error) {
        console.error('Error:', error);
        return NextResponse.json({ error: 'Unexpected error', details: (error as Error).message }, { status: 500 });
    }
}
