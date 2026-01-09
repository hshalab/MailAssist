/**
 * GET /api/debug/user-role - Check user role
 * GET /api/debug/user-role?email=xxx&fix=true - Fix to admin
 */

import { NextRequest, NextResponse } from 'next/server';
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

        const email = request.nextUrl.searchParams.get('email');
        const fix = request.nextUrl.searchParams.get('fix') === 'true';

        if (!email) {
            // List all users with their roles
            const { data: users, error } = await supabase
                .from('users')
                .select('id, email, name, role, business_id')
                .order('created_at', { ascending: false })
                .limit(20);

            if (error) {
                return NextResponse.json({ error: error.message }, { status: 500 });
            }

            return NextResponse.json({ users });
        }

        // Get specific user
        const { data: user, error: userError } = await supabase
            .from('users')
            .select('id, email, name, role, business_id')
            .eq('email', email.toLowerCase())
            .maybeSingle();

        // Get departments
        let departments = [];
        if (user) {
            const { data: depts } = await supabase
                .from('user_departments')
                .select('department_id')
                .eq('user_id', user.id);
            if (depts) departments = depts;
        }

        if (userError) {
            return NextResponse.json({ error: userError.message }, { status: 500 });
        }

        if (!user) {
            return NextResponse.json({ error: 'User not found', email }, { status: 404 });
        }

        // Fix role if requested
        if (fix && user.role !== 'admin') {
            const { error: updateError } = await supabase
                .from('users')
                .update({ role: 'admin' })
                .eq('id', user.id);

            if (updateError) {
                return NextResponse.json({ error: 'Failed to update role', details: updateError.message }, { status: 500 });
            }

            return NextResponse.json({
                message: 'Role updated to admin',
                before: user.role,
                after: 'admin',
                user: { ...user, role: 'admin' }
            });
        }

        return NextResponse.json({ user });
    } catch (error) {
        console.error('Error:', error);
        return NextResponse.json({ error: 'Unexpected error', details: (error as Error).message }, { status: 500 });
    }
}
