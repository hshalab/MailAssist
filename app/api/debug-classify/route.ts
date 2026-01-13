
import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { classifyTicketToDepartmentAsync } from '@/lib/tickets';

// Increased timeout for processing
export const maxDuration = 60;

export async function GET(request: Request) {
    if (!supabase) return NextResponse.json({ error: 'No supabase client' });

    // Check mode: just list classified tickets
    if (request.url.includes('check=true')) {
        const { data: tickets } = await supabase
            .from('tickets')
            .select('id, subject, department_id, departments(name)')
            .not('department_id', 'is', null)
            .limit(20);
        return NextResponse.json({ classifiedCount: tickets?.length, tickets });
    }

    // ... (previous logic) ...
    // 1. Get 10 unclassified tickets
    const { data: tickets, error } = await supabase
        .from('tickets')
        .select('id, subject, user_email, customer_email, thread_id, department_id')
        .is('department_id', null)
        .limit(10);

    if (error) return NextResponse.json({ error: error.message });
    if (!tickets || tickets.length === 0) return NextResponse.json({ message: 'No unclassified tickets found' });

    const results = [];

    for (const ticket of tickets) {
        // Trying to fetch the first email content for this ticket to get a body
        const { data: emailData } = await supabase
            .from('tickets')
            .select('thread_id')
            .eq('id', ticket.id)
            .single();

        let bodyText = "No content available";
        if (emailData?.thread_id) {
            const { data: emails } = await supabase
                .from('emails')
                .select('body')
                .eq('thread_id', emailData.thread_id)
                .limit(1);
            if (emails && emails[0]?.body) {
                bodyText = emails[0].body.substring(0, 500); // First 500 chars
            }
        }

        // Run classification with enhanced context
        await classifyTicketToDepartmentAsync(
            ticket.id,
            ticket.subject,
            bodyText,
            ticket.user_email || null,
            ticket.customer_email || null, // Customer email for history lookup
            ticket.thread_id || null // Thread ID for context
        );

        results.push({ id: ticket.id, subject: ticket.subject, status: 'Triggered Classification' });
    }

    return NextResponse.json({
        processed: results.length,
        details: results
    });
}
