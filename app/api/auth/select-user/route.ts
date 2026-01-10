/**
 * User selection endpoint
 * Called after Gmail OAuth to select which team member is using the system
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUserById, getAllUsers } from '@/lib/users';
import { setCurrentUserIdInResponse, getSessionUserEmailFromRequest } from '@/lib/session';
import { createUser } from '@/lib/users';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, createNew } = body;

    // Check if Supabase client is initialized (env vars check)
    const { supabase } = await import('@/lib/supabase');
    if (!supabase) {
      return NextResponse.json(
        { error: 'Database configuration missing. Please check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.' },
        { status: 503 }
      );
    }

    // Support BOTH business and personal accounts
    const { validateBusinessSession, getSessionUserEmail } = await import('@/lib/session');
    const businessSession = await validateBusinessSession();
    const sharedGmailEmail = await getSessionUserEmail(); // More robust than request helper

    console.log('[SelectUser POST] businessSession:', !!businessSession, 'sharedGmailEmail:', sharedGmailEmail);

    // Require EITHER business session OR personal session (gmail email)
    if (!businessSession && !sharedGmailEmail) {
      console.log('[SelectUser POST] No authentication found');
      return NextResponse.json(
        { error: 'Not authenticated. Please connect Gmail first.' },
        { status: 401 }
      );
    }

    // If creating a new user
    if (createNew && body.name && body.role) {
      // Prepare user creation data based on account type
      const createData: any = {
        name: body.name,
        email: body.email || null,
        role: body.role,
      };

      // For business accounts: set businessId
      // For personal accounts: set sharedGmailEmail
      if (businessSession?.businessId) {
        createData.businessId = businessSession.businessId;
        console.log('[SelectUser POST] Creating user for business:', businessSession.businessId);
      } else if (sharedGmailEmail) {
        createData.sharedGmailEmail = sharedGmailEmail;
        console.log('[SelectUser POST] Creating user for personal account:', sharedGmailEmail);
      } else {
        // This should never happen due to auth check above, but just in case
        return NextResponse.json(
          { error: 'Unable to determine account context' },
          { status: 400 }
        );
      }

      const newUser = await createUser(createData);

      if (!newUser) {
        return NextResponse.json(
          { error: 'Failed to create user' },
          { status: 500 }
        );
      }

      console.log('[SelectUser POST] Created new user:', newUser.id, 'role:', newUser.role);

      // For first user (admin), auto-select them and set up session
      if (body.role === 'admin') {
        const response = NextResponse.json({
          success: true,
          user: newUser,
          message: 'User created and selected successfully',
          autoSelected: true
        });
        setCurrentUserIdInResponse(response, newUser.id);
        console.log('[SelectUser POST] Auto-selected first admin');
        return response;
      }

      // For other users, just return without auto-selecting
      return NextResponse.json({
        success: true,
        user: newUser,
        message: 'User created successfully'
      });
    }

    // If selecting existing user
    if (!userId) {
      return NextResponse.json(
        { error: 'User ID is required' },
        { status: 400 }
      );
    }

    // Verify user exists
    const user = await getUserById(userId);
    if (!user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    // Validate user belongs to the right context
    if (businessSession) {
      // Business account - verify user belongs to this business
      if (user.businessId !== businessSession.businessId) {
        console.log('[SelectUser POST] User businessId mismatch:', user.businessId, 'vs', businessSession.businessId);
        return NextResponse.json(
          { error: 'User does not belong to this business' },
          { status: 403 }
        );
      }
    } else if (sharedGmailEmail) {
      // Personal account - verify user belongs to this account
      // For personal accounts, we allow selecting if it matches any of the user's emails
      const emailMatches = !user.userEmail ||
        user.userEmail === sharedGmailEmail ||
        user.email === sharedGmailEmail ||
        (user as any).sharedGmailEmail === sharedGmailEmail;

      if (!emailMatches && !user.businessId) {
        console.log('[SelectUser POST] Email mismatch for personal account:', { userEmail: user.userEmail, sharedGmailEmail });
        return NextResponse.json(
          { error: 'User does not belong to this account' },
          { status: 403 }
        );
      }
    }

    if (!user.isActive) {
      return NextResponse.json(
        { error: 'User is inactive' },
        { status: 403 }
      );
    }

    // Set user ID in session
    const response = NextResponse.json({
      success: true,
      user,
      message: 'User selected successfully'
    });
    setCurrentUserIdInResponse(response, userId);
    console.log('[SelectUser POST] User selected:', userId);
    return response;
  } catch (error) {
    console.error('Error selecting user:', error);
    return NextResponse.json(
      { error: 'Failed to select user', details: (error as Error).message },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    // DEBUG: Log all received cookies
    const { cookies } = await import('next/headers');
    const cookieStore = await cookies();
    const allCookies = cookieStore.getAll();
    console.log('[SelectUser GET] ===== COOKIE DEBUG =====');
    console.log('[SelectUser GET] All cookies received:', allCookies.map(c => ({ name: c.name, value: c.value?.substring(0, 20) + '...' })));
    console.log('[SelectUser GET] session_token:', cookieStore.get('session_token')?.value?.substring(0, 20) + '...' || 'MISSING');
    console.log('[SelectUser GET] current_user_id:', cookieStore.get('current_user_id')?.value || 'MISSING');
    console.log('[SelectUser GET] gmail_user_email:', cookieStore.get('gmail_user_email')?.value || 'MISSING');
    console.log('[SelectUser GET] ========================');

    // Support BOTH business and personal accounts
    const { validateBusinessSession, getSessionUserEmail } = await import('@/lib/session');
    const businessSession = await validateBusinessSession();
    const sharedGmailEmail = await getSessionUserEmail();

    console.log('[SelectUser GET] businessSession:', !!businessSession, 'sharedGmailEmail:', sharedGmailEmail);

    // Require EITHER business session OR personal session
    if (!businessSession && !sharedGmailEmail) {
      console.log('[SelectUser GET] No authentication found');
      return NextResponse.json(
        { error: 'Not authenticated. Please connect Gmail first.' },
        { status: 401 }
      );
    }

    const users = await getAllUsers(businessSession?.businessId, sharedGmailEmail);
    console.log('[SelectUser GET] Found', users.length, 'users for context:', businessSession?.businessId || sharedGmailEmail);
    return NextResponse.json({ users });
  } catch (error) {
    console.error('Error fetching users for selection:', error);
    return NextResponse.json(
      { error: 'Failed to fetch users', details: (error as Error).message },
      { status: 500 }
    );
  }
}

