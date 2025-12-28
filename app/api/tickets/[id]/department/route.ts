import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { getCurrentUser } from '@/lib/session';
import { clearFeedbackCache } from '@/lib/feedback-cache';

export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id: ticketId } = await params;
        const body = await request.json();
        const { departmentId, reasoning } = body;
        const user = await getCurrentUser();

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        if (!ticketId) {
            return NextResponse.json({ error: 'Ticket ID is required' }, { status: 400 });
        }

        // 1. Fetch current ticket state to get original department (for feedback log)
        const { data: currentTicket, error: fetchError } = await supabase
            .from('tickets')
            .select('department_id, classification_confidence')
            .eq('id', ticketId)
            .single();

        if (fetchError || !currentTicket) {
            return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
        }

        // 2. Update the ticket
        // If setting to null (Unclassified), departmentId will be null
        const updates: any = {
            department_id: departmentId,
            updated_at: new Date().toISOString(),
            // If manually changed, we can implies 100% confidence or leave as is? 
            // Usually manual override implies 100% human confidence.
            classification_confidence: 100
        };

        const { error: updateError } = await supabase
            .from('tickets')
            .update(updates)
            .eq('id', ticketId);

        if (updateError) {
            throw updateError;
        }

        // 3. Log to department_feedback if the department changed
        if (currentTicket.department_id !== departmentId) {
            await supabase.from('department_feedback').insert({
                ticket_id: ticketId,
                original_department_id: currentTicket.department_id,
                final_department_id: departmentId,
                user_id: user.id || null, // Ensure ID is used
                reasoning: reasoning || 'Manual reassignment'
            });

            // 4. Clear feedback cache to ensure real-time learning
            clearFeedbackCache(user.email, user.businessId);
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Error updating ticket department:', error);
        return NextResponse.json(
            { error: 'Failed to update department', details: (error as Error).message },
            { status: 500 }
        );
    }
}
