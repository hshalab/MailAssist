/**
 * GET /api/agents/[userId]/departments
 * Get departments assigned to a user
 * 
 * PATCH /api/agents/[userId]/departments
 * Update user's department assignments
 * Only admins and managers can modify department assignments
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-client';
import { validateBusinessSession } from '@/lib/session';
import { getUserDepartments, updateUserDepartments } from '@/lib/departments';

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ userId: string }> }
) {
    try {
        const { userId } = await params;

        // Get user's departments
        const departments = await getUserDepartments(userId);

        return NextResponse.json({ departments });
    } catch (error) {
        console.error('[GetUserDepartments] Error:', error);
        return NextResponse.json(
            { error: 'Failed to fetch user departments' },
            { status: 500 }
        );
    }
}

export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ userId: string }> }
) {
    try {
        const { userId } = await params;
        const body = await request.json();
        const { departmentIds = [], hasFullAccess } = body;

        // Validations...

        const supabase = createServerClient();

        // 1. Update Full Access Flag if provided
        if (typeof hasFullAccess === 'boolean') {
            const { error } = await supabase
                .from('users')
                .update({ has_full_access: hasFullAccess })
                .eq('id', userId);

            if (error) {
                console.error('[UpdateUserFullAccess] Error:', error);
                // Continue though, as departments might still need updating
            }
        }

        // 2. Update user's departments
        const success = await updateUserDepartments(userId, departmentIds);

        // ... rest of function ...

        // Fetch updated departments
        const departments = await getUserDepartments(userId);

        return NextResponse.json({
            success: true,
            departments,
        });
    } catch (error) {
        console.error('[UpdateUserDepartments] Error:', error);
        return NextResponse.json(
            { error: 'Failed to update user departments' },
            { status: 500 }
        );
    }
}
