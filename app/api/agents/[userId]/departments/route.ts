/**
 * GET /api/agents/[userId]/departments
 * Get departments assigned to a user
 * 
 * PATCH /api/agents/[userId]/departments
 * Update user's department assignments
 * Only admins and managers can modify department assignments
 */

import { NextRequest, NextResponse } from 'next/server';
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
        const { departmentIds = [] } = body;

        // Validate departmentIds is an array
        if (!Array.isArray(departmentIds)) {
            return NextResponse.json(
                { error: 'departmentIds must be an array' },
                { status: 400 }
            );
        }

        // Update user's departments
        const success = await updateUserDepartments(userId, departmentIds);

        if (!success) {
            return NextResponse.json(
                { error: 'Failed to update user departments' },
                { status: 500 }
            );
        }

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
