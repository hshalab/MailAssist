/**
 * User management endpoints
 * GET: List all users (all authenticated users can see all users for switching purposes)
 * POST: Create new user (Admin only)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAllUsers, createUser, UserRole } from '@/lib/users';
import { requirePermission } from '@/lib/permissions';
import { getCurrentUserIdFromRequest } from '@/lib/session';
import { validateTextInput, isValidEmail, isValidUserRole } from '@/lib/validation';

export async function GET(request: NextRequest) {
  try {
    // Check if Supabase client is initialized (env vars check)
    const { supabase } = await import('@/lib/supabase');
    if (!supabase) {
      return NextResponse.json(
        { error: 'Database configuration missing. Please check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.' },
        { status: 503 }
      );
    }

    const userId = getCurrentUserIdFromRequest(request);

    if (!userId) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    // For user switching, all authenticated users should be able to see all users
    // This allows agents to switch to admin/manager accounts
    // The restriction on user management (create/edit/delete) is still enforced in POST/PATCH/DELETE endpoints
    const { validateBusinessSession, getSessionUserEmail } = await import('@/lib/session');
    const businessSession = await validateBusinessSession();
    const sharedGmailEmail = await getSessionUserEmail();

    const users = await getAllUsers(businessSession?.businessId, sharedGmailEmail);

    return NextResponse.json({ users });
  } catch (error) {
    console.error('Error fetching users:', error);
    return NextResponse.json(
      { error: 'Failed to fetch users', details: (error as Error).message },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    // Check admin permission
    const { allowed } = await requirePermission(request, 'admin');

    if (!allowed) {
      return NextResponse.json(
        { error: 'Admin access required' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { name, email, role } = body;

    // Validate name
    const nameValidation = validateTextInput(name, 100, true);
    if (!nameValidation.valid) {
      return NextResponse.json(
        { error: nameValidation.error || 'Invalid name' },
        { status: 400 }
      );
    }

    // Validate role
    if (!isValidUserRole(role)) {
      return NextResponse.json(
        { error: 'Invalid role. Must be admin, manager, or agent' },
        { status: 400 }
      );
    }

    // Validate email if provided
    if (email && !isValidEmail(email)) {
      return NextResponse.json(
        { error: 'Invalid email format' },
        { status: 400 }
      );
    }

    const user = await createUser({
      name: nameValidation.sanitized,
      email: email ? email.trim().toLowerCase() : null,
      role: role.toLowerCase() as UserRole,
    });

    if (!user) {
      return NextResponse.json(
        { error: 'Failed to create user' },
        { status: 500 }
      );
    }

    return NextResponse.json({ user }, { status: 201 });
  } catch (error) {
    console.error('Error creating user:', error);
    return NextResponse.json(
      { error: 'Failed to create user', details: (error as Error).message },
      { status: 500 }
    );
  }
}

