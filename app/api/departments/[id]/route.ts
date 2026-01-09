/**
 * Department By ID API Routes
 * GET /api/departments/[id] - Get a single department
 * PATCH /api/departments/[id] - Update a department (admin only)
 * DELETE /api/departments/[id] - Delete a department (admin only)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDepartmentById, updateDepartment, deleteDepartment } from '@/lib/departments';
import { getCurrentUser } from '@/lib/session';
import { runAutoClassify } from '@/lib/auto-classify';

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const currentUser = await getCurrentUser();

        if (!currentUser) {
            return NextResponse.json(
                { error: 'Unauthorized' },
                { status: 401 }
            );
        }

        const department = await getDepartmentById(id);

        if (!department) {
            return NextResponse.json(
                { error: 'Department not found' },
                { status: 404 }
            );
        }

        // Verify user has access to this department
        const hasAccess =
            (currentUser.accountType === 'business' && department.businessId === currentUser.businessId) ||
            (currentUser.accountType === 'personal' && department.userEmail === currentUser.email);

        if (!hasAccess) {
            return NextResponse.json(
                { error: 'Access denied' },
                { status: 403 }
            );
        }

        return NextResponse.json({
            success: true,
            department,
        });
    } catch (error) {
        console.error('Error fetching department:', error);
        return NextResponse.json(
            { error: 'Failed to fetch department' },
            { status: 500 }
        );
    }
}

export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const currentUser = await getCurrentUser();

        if (!currentUser) {
            return NextResponse.json(
                { error: 'Unauthorized' },
                { status: 401 }
            );
        }

        // Only admins can update departments
        if (currentUser.role !== 'admin') {
            return NextResponse.json(
                { error: 'Permission denied. Only admins can update departments.' },
                { status: 403 }
            );
        }

        // Verify department exists and user has access
        const existing = await getDepartmentById(id);
        if (!existing) {
            return NextResponse.json(
                { error: 'Department not found' },
                { status: 404 }
            );
        }

        const hasAccess =
            (currentUser.accountType === 'business' && existing.businessId === currentUser.businessId) ||
            (currentUser.accountType === 'personal' && existing.userEmail === currentUser.email);

        if (!hasAccess) {
            return NextResponse.json(
                { error: 'Access denied' },
                { status: 403 }
            );
        }

        const body = await request.json();
        const { name, description } = body;

        // Validate inputs if provided
        if (name !== undefined && (typeof name !== 'string' || name.length === 0 || name.length > 100)) {
            return NextResponse.json(
                { error: 'Department name must be 1-100 characters' },
                { status: 400 }
            );
        }

        if (description !== undefined && (typeof description !== 'string' || description.length < 10)) {
            return NextResponse.json(
                { error: 'Description must be at least 10 characters for effective AI classification' },
                { status: 400 }
            );
        }

        const department = await updateDepartment(id, { name, description });

        if (!department) {
            return NextResponse.json(
                { error: 'Failed to update department' },
                { status: 500 }
            );
        }

        // Trigger auto-classification for unclassified emails (non-blocking)
        // This helps re-classify tickets with updated department descriptions
        runAutoClassify({ 
            limit: 50,
            businessId: currentUser.businessId,
            userEmail: currentUser.accountType === 'personal' ? currentUser.email : null
        }).catch(err => {
            console.warn('[Department] Failed to trigger auto-classification after department update:', err);
            console.warn('[Department] Error details:', err instanceof Error ? err.stack : err);
        });

        return NextResponse.json({
            success: true,
            department,
        });
    } catch (error) {
        console.error('Error updating department:', error);
        return NextResponse.json(
            { error: 'Failed to update department' },
            { status: 500 }
        );
    }
}

export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const currentUser = await getCurrentUser();

        if (!currentUser) {
            return NextResponse.json(
                { error: 'Unauthorized' },
                { status: 401 }
            );
        }

        // Only admins can delete departments
        if (currentUser.role !== 'admin') {
            return NextResponse.json(
                { error: 'Permission denied. Only admins can delete departments.' },
                { status: 403 }
            );
        }

        // Verify department exists and user has access
        const existing = await getDepartmentById(id);
        if (!existing) {
            return NextResponse.json(
                { error: 'Department not found' },
                { status: 404 }
            );
        }

        const hasAccess =
            (currentUser.accountType === 'business' && existing.businessId === currentUser.businessId) ||
            (currentUser.accountType === 'personal' && existing.userEmail === currentUser.email);

        if (!hasAccess) {
            return NextResponse.json(
                { error: 'Access denied' },
                { status: 403 }
            );
        }

        const success = await deleteDepartment(id);

        if (!success) {
            return NextResponse.json(
                { error: 'Failed to delete department' },
                { status: 500 }
            );
        }

        return NextResponse.json({
            success: true,
            message: 'Department deleted successfully',
        });
    } catch (error) {
        console.error('Error deleting department:', error);
        return NextResponse.json(
            { error: 'Failed to delete department' },
            { status: 500 }
        );
    }
}
