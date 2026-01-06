
import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET() {
    if (!supabase) return NextResponse.json({ error: 'No supabase client' });

    // 1. Get user by email muhammad.salman1205@gmail.com to get their ID
    const { data: users } = await supabase.from('users').select('*');
    const targetUser = users?.find(u => u.email === 'muhammad.salman1205@gmail.com');

    if (!targetUser) return NextResponse.json({ error: 'User not found' });

    // 2. Get their assigned departments
    const { data: userDepts } = await supabase
        .from('user_departments')
        .select('department_id, departments(name)')
        .eq('user_id', targetUser.id);

    const deptIds = userDepts?.map((ud: any) => ud.department_id) || [];

    // 3. Get tickets to see their distribution
    const { data: allTickets } = await supabase
        .from('tickets')
        .select('id, subject, status, department_id, assignee_user_id')
        .limit(50);

    // 4. Count tickets by department
    const { count: unclassifiedCount } = await supabase
        .from('tickets')
        .select('*', { count: 'exact', head: true })
        .is('department_id', null);

    return NextResponse.json({
        user: { id: targetUser.id, email: targetUser.email },
        assignedDepartments: userDepts, // Confirming what the DB sees
        deptIdsFromLogic: deptIds,
        sampleTickets: allTickets,
        stats: {
            totalUnclassifiedTickets: unclassifiedCount,
            note: "If user has departments, they ONLY see tickets matching those department IDs. Unclassified tickets (null) are HIDDEN from specialized agents."
        }
    });
}
