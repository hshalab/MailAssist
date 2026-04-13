/**
 * Departments API Routes
 * GET /api/departments - List all departments
 * POST /api/departments - Create a new department (admin only)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAllDepartments, createDepartment } from '@/lib/departments';
import { getCurrentUser } from '@/lib/session';
import { getSessionUserEmailFromRequest } from '@/lib/session';
import { runAutoClassify } from '@/lib/auto-classify';

export async function GET(request: NextRequest) {
    try {
        // Get current user for scoping
        const currentUser = await getCurrentUser();
        const userEmail = getSessionUserEmailFromRequest(request);

        if (!currentUser && !userEmail) {
            return NextResponse.json(
                { error: 'Unauthorized' },
                { status: 401 }
            );
        }

        // Get user's account scope
        const businessId = currentUser?.businessId || null;
        const scopeEmail = businessId ? null : (userEmail || null);

        const departments = await getAllDepartments(scopeEmail, businessId);

        return NextResponse.json(
            { success: true, departments },
            { headers: { 'Cache-Control': 'private, max-age=300, stale-while-revalidate=60' } }
        );
    } catch (error) {
        console.error('Error fetching departments:', error);
        return NextResponse.json(
            { error: 'Failed to fetch departments' },
            { status: 500 }
        );
    }
}

export async function POST(request: NextRequest) {
    try {
        const currentUser = await getCurrentUser();

        if (!currentUser) {
            return NextResponse.json(
                { error: 'Unauthorized' },
                { status: 401 }
            );
        }

        // Only admins can create departments
        if (currentUser.role !== 'admin') {
            return NextResponse.json(
                { error: 'Permission denied. Only admins can create departments.' },
                { status: 403 }
            );
        }

        const body = await request.json();
        const { name, description } = body;

        if (!name || !description) {
            return NextResponse.json(
                { error: 'Name and description are required' },
                { status: 400 }
            );
        }

        // Validate name length
        if (name.length > 100) {
            return NextResponse.json(
                { error: 'Department name must be 100 characters or less' },
                { status: 400 }
            );
        }

        // Validate description length
        if (description.length < 10) {
            return NextResponse.json(
                { error: 'Description must be at least 10 characters for effective AI classification' },
                { status: 400 }
            );
        }

        // Create department with proper scoping
        const department = await createDepartment({
            name,
            description,
            userEmail: currentUser.accountType === 'personal' ? currentUser.email : null,
            businessId: currentUser.businessId,
            createdBy: currentUser.id,
        });

        if (!department) {
            return NextResponse.json(
                { error: 'Failed to create department' },
                { status: 500 }
            );
        }

        // Trigger auto-classification for unclassified emails (non-blocking)
        // This helps classify existing unclassified tickets with the new department
        runAutoClassify({ 
            limit: 50,
            businessId: currentUser.businessId,
            userEmail: currentUser.accountType === 'personal' ? currentUser.email : null
        }).catch(err => {
            console.warn('[Department] Failed to trigger auto-classification after department creation:', err);
            console.warn('[Department] Error details:', err instanceof Error ? err.stack : err);
        });

        return NextResponse.json({
            success: true,
            department,
        });
    } catch (error) {
        console.error('Error creating department:', error);
        return NextResponse.json(
            { error: 'Failed to create department' },
            { status: 500 }
        );
    }
}
