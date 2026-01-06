
import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET() {
    if (!supabase) return NextResponse.json({ error: 'No supabase client' });

    // 1. Get user and their departments
    const { data: users } = await supabase.from('users').select('*');
    const targetUser = users?.find(u => u.email === 'muhammad.salman1205@gmail.com');

    if (!targetUser) return NextResponse.json({ error: 'User not found' });

    const { data: userDepts } = await supabase
        .from('user_departments')
        .select('department_id, departments(name)')
        .eq('user_id', targetUser.id);

    const userDeptIds = userDepts?.map((ud: any) => ud.department_id) || [];

    // 2. Get the "Promotions" department from the DB (to see if there are duplicates)
    const { data: allPromotionsDepts } = await supabase
        .from('departments')
        .select('id, name')
        .ilike('name', '%Promotion%');

    // 3. Get the classified tickets
    const { data: classifiedTickets } = await supabase
        .from('tickets')
        .select('id, subject, department_id, departments(name)')
        .not('department_id', 'is', null)
        .limit(10);

    // 4. Check for matches
    const matches = classifiedTickets?.filter(t => userDeptIds.includes(t.department_id));

    return NextResponse.json({
        user: { id: targetUser.id, email: targetUser.email },
        userAssignedDepts: userDepts,
        allPromotionsDeptsInDB: allPromotionsDepts,
        classifiedTickets,
        matchesFound: matches?.length,
        conclusion: matches?.length > 0 ? "IDs Match - Logic Issue?" : "IDs Do Not Match - Classification Issue"
    });
}
