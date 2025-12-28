/**
 * PATCH /api/quick-replies/[id] - Update a quick reply
 * DELETE /api/quick-replies/[id] - Delete a quick reply
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserIdFromRequest } from '@/lib/permissions';
import { canViewAllTickets } from '@/lib/permissions';
import { getCurrentUserEmail } from '@/lib/storage';
import { getSessionUserEmailFromRequest } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { isValidUUID, validateTextInput, sanitizeStringArray } from '@/lib/validation';

type RouteContext =
  | { params: { id: string } }
  | { params: Promise<{ id: string }> };

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!id) {
      return NextResponse.json(
        { error: 'Missing quick reply ID' },
        { status: 400 }
      );
    }

    const userId = getCurrentUserIdFromRequest(request);
    if (!userId) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    // Get user_email from session for RLS scoping
    const userEmail = getSessionUserEmailFromRequest(request) || await getCurrentUserEmail();
    if (!userEmail) {
      return NextResponse.json(
        { error: 'Unable to determine user email' },
        { status: 401 }
      );
    }

    if (!supabase) {
      return NextResponse.json(
        { error: 'Database not available' },
        { status: 500 }
      );
    }

    // Check if quick reply exists and user has permission (filter by created_by)
    const { data: existing } = await supabase
      .from('quick_replies')
      .select('created_by, user_email')
      .eq('id', id)
      .single();

    if (!existing) {
      return NextResponse.json(
        { error: 'Quick reply not found' },
        { status: 404 }
      );
    }

    // Users can only edit their own quick replies, unless they're admin/manager
    const canManage = await canViewAllTickets(userId);
    if (!canManage && existing.created_by !== userId) {
      return NextResponse.json(
        { error: 'Unauthorized - you can only edit your own quick replies' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const updates: any = {
      updated_at: new Date().toISOString(),
    };

    // Validate and sanitize inputs if provided
    if (body.title !== undefined) {
      const titleValidation = validateTextInput(body.title, 200, false);
      if (!titleValidation.valid) {
        return NextResponse.json(
          { error: titleValidation.error || 'Invalid title' },
          { status: 400 }
        );
      }
      updates.title = titleValidation.sanitized;
    }

    if (body.content !== undefined) {
      const contentValidation = validateTextInput(body.content, 5000, false);
      if (!contentValidation.valid) {
        return NextResponse.json(
          { error: contentValidation.error || 'Invalid content' },
          { status: 400 }
        );
      }
      updates.content = contentValidation.sanitized;
    }

    if (body.category !== undefined) {
      const categoryValidation = validateTextInput(body.category, 50, false);
      updates.category = categoryValidation.sanitized || 'General';
    }

    if (body.tags !== undefined) {
      const sanitizedTags = sanitizeStringArray(Array.isArray(body.tags) ? body.tags : []);
      if (sanitizedTags.length > 20) {
        return NextResponse.json(
          { error: 'Maximum 20 tags allowed' },
          { status: 400 }
        );
      }
      updates.tags = sanitizedTags;
    }

    const { data, error } = await supabase
      .from('quick_replies')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Error updating quick reply:', error);
      return NextResponse.json(
        { error: 'Failed to update quick reply', details: error.message },
        { status: 500 }
      );
    }

    if (!data) {
      return NextResponse.json(
        { error: 'Quick reply not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ quickReply: data });
  } catch (error) {
    console.error('Error in PATCH quick-replies:', error);
    return NextResponse.json(
      { error: 'Failed to update quick reply', details: (error as Error).message },
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

    if (!id || !isValidUUID(id)) {
      return NextResponse.json(
        { error: 'Invalid or missing quick reply ID' },
        { status: 400 }
      );
    }

    const userId = getCurrentUserIdFromRequest(request);
    if (!userId) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    // Get user_email from session for RLS scoping
    const userEmail = getSessionUserEmailFromRequest(request) || await getCurrentUserEmail();
    if (!userEmail) {
      return NextResponse.json(
        { error: 'Unable to determine user email' },
        { status: 401 }
      );
    }

    if (!supabase) {
      return NextResponse.json(
        { error: 'Database not available' },
        { status: 500 }
      );
    }

    // Check if quick reply exists and user has permission (filter by created_by)
    const { data: existing } = await supabase
      .from('quick_replies')
      .select('created_by, user_email')
      .eq('id', id)
      .single();

    if (!existing) {
      return NextResponse.json(
        { error: 'Quick reply not found' },
        { status: 404 }
      );
    }

    // Users can only delete their own quick replies, unless they're admin/manager
    const canManage = await canViewAllTickets(userId);
    if (!canManage && existing.created_by !== userId) {
      return NextResponse.json(
        { error: 'Unauthorized - you can only delete your own quick replies' },
        { status: 403 }
      );
    }

    const { error } = await supabase
      .from('quick_replies')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error deleting quick reply:', error);
      return NextResponse.json(
        { error: 'Failed to delete quick reply', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in DELETE quick-replies:', error);
    return NextResponse.json(
      { error: 'Failed to delete quick reply', details: (error as Error).message },
      { status: 500 }
    );
  }
}

