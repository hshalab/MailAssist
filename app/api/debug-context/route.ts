
import { NextResponse } from 'next/server';
import { getCurrentUserEmail } from '@/lib/storage';
import { validateBusinessSession } from '@/lib/session';
import { getTickets } from '@/lib/tickets';
import { supabase } from '@/lib/supabase';

export async function GET() {
    const email = await getCurrentUserEmail();
    const session = await validateBusinessSession();

    let tickets = [];
    let debugQuery = 'N/A';

    if (session?.userId && email) {
        // Replicate the query manually to see what happens
        // Logic for agent with no departments
        const { data: userDepts } = await supabase
            .from('user_departments')
            .select('department_id')
            .eq('user_id', session.userId);

        const deptIds = userDepts?.map((ud: any) => ud.department_id) || [];

        let query = supabase.from('tickets').select('*').eq('user_email', email);

        if (deptIds.length === 0) {
            // This is the query that was failing/fixed
            query = query.or(`assignee_user_id.eq.${session.userId},and(assignee_user_id.is.null,department_id.is.null)`);
        }

        const { data } = await query.limit(10);
        tickets = data || [];
    }

    return NextResponse.json({
        email,
        session,
        ticketsFound: tickets.length,
        sampleTickets: tickets
    });
}
