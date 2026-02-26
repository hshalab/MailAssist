/**
 * User management endpoints for specific user
 * GET: Get user details
 * PATCH: Update user (Admin only, or self for name/email)
 * DELETE: Deactivate user (Admin only)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUserById, updateUser, deleteUser, getAllUsers } from '@/lib/users';
import { requirePermission, getCurrentUserIdFromRequest } from '@/lib/permissions';
import { getCurrentUserIdFromRequest as getUserId } from '@/lib/session';

type RouteContext =
  | { params: { id: string } }
  | { params: Promise<{ id: string }> };

export async function GET(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const paramsData = await Promise.resolve((context as any).params);
    const userId = paramsData?.id;

    if (!userId) {
      return NextResponse.json(
        { error: 'Missing user id' },
        { status: 400 }
      );
    }

    const currentUserId = getUserId(request);
    if (!currentUserId) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    // Users can view their own profile, or Admin/Manager can view anyone
    if (userId !== currentUserId) {
      const { allowed } = await requirePermission(request, ['admin', 'manager']);
      if (!allowed) {
        return NextResponse.json(
          { error: 'Permission denied' },
          { status: 403 }
        );
      }
    }

    const user = await getUserById(userId);
    if (!user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ user });
  } catch (error) {
    console.error('Error fetching user:', error);
    return NextResponse.json(
      { error: 'Failed to fetch user', details: (error as Error).message },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const paramsData = await Promise.resolve((context as any).params);
    const userId = paramsData?.id;

    if (!userId) {
      return NextResponse.json(
        { error: 'Missing user id' },
        { status: 400 }
      );
    }

    const currentUserId = getUserId(request);
    if (!currentUserId) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { name, email, role, isActive } = body;

    // Check permissions
    const isSelf = userId === currentUserId;
    const isUpdatingRoleOrActive = role !== undefined || isActive !== undefined;

    // Get current user's details to check their role
    const currentUser = await getUserById(currentUserId);
    if (!currentUser) {
      return NextResponse.json(
        { error: 'Current user not found' },
        { status: 404 }
      );
    }

    // Get target user's current role
    const targetUser = await getUserById(userId);
    if (!targetUser) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    if (isUpdatingRoleOrActive || (!isSelf && name === undefined && email === undefined)) {
      // Role/status changes require admin OR manager (with restrictions)
      const { allowed } = await requirePermission(request, ['admin', 'manager']);
      if (!allowed) {
        return NextResponse.json(
          { error: 'Admin or Manager access required to update role or status' },
          { status: 403 }
        );
      }

      // Managers can only change roles between agent and manager (not admin)
      if (currentUser.role === 'manager' && role !== undefined) {
        // Manager cannot promote anyone to admin
        if (role === 'admin') {
          return NextResponse.json(
            { error: 'Only admins can promote users to admin role' },
            { status: 403 }
          );
        }
        // Manager cannot demote existing admins
        if (targetUser.role === 'admin') {
          return NextResponse.json(
            { error: 'Only admins can change admin roles' },
            { status: 403 }
          );
        }
      }
    }

    // Validate role if provided
    if (role && !['admin', 'manager', 'agent'].includes(role)) {
      return NextResponse.json(
        { error: 'Invalid role. Must be admin, manager, or agent' },
        { status: 400 }
      );
    }

    // If trying to change role FROM admin, ensure at least one other active admin exists
    if (targetUser.role === 'admin' && role && role !== 'admin') {
      const allUsers = await getAllUsers(currentUser.businessId ?? null, currentUser.userEmail ?? null);
      const activeAdmins = allUsers.filter(u => u.isActive && u.role === 'admin' && u.id !== userId);
      
      if (activeAdmins.length === 0) {
        return NextResponse.json(
          { error: 'Cannot change role: At least one admin must remain in the organization' },
          { status: 400 }
        );
      }
    }

    const updateData: any = {};
    if (name !== undefined) updateData.name = name;
    if (email !== undefined) updateData.email = email;
    if (role !== undefined) updateData.role = role;
    if (isActive !== undefined) updateData.isActive = isActive;

    const user = await updateUser(userId, updateData, {
      businessId: currentUser.businessId ?? null,
      userEmail: currentUser.userEmail ?? null,
    });
    if (!user) {
      return NextResponse.json(
        { error: 'Failed to update user' },
        { status: 500 }
      );
    }

    return NextResponse.json({ user });
  } catch (error) {
    console.error('Error updating user:', error);
    return NextResponse.json(
      { error: 'Failed to update user', details: (error as Error).message },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  context: RouteContext
) {
  try {
    // Check admin permission
    const { allowed } = await requirePermission(request, 'admin');
    
    if (!allowed) {
      return NextResponse.json(
        { error: 'Admin access required' },
        { status: 403 }
      );
    }

    const paramsData = await Promise.resolve((context as any).params);
    const userId = paramsData?.id;

    if (!userId) {
      return NextResponse.json(
        { error: 'Missing user id' },
        { status: 400 }
      );
    }

    await deleteUser(userId);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting user:', error);
    return NextResponse.json(
      { error: 'Failed to delete user', details: (error as Error).message },
      { status: 500 }
    );
  }
}


