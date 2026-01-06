
import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET() {
    if (!supabase) return NextResponse.json({ error: 'No supabase client' });

    // Target Correct ID (Assigned to user)
    const targetDeptId = 'd4e3b72e-272f-463d-9c74-67dc450daa37'; // User's 'Promotions'

    // Find tickets currently in the "Wrong" Promotions (51f27... or others)
    const { data: ticketsToFix } = await supabase
        .from('tickets')
        .select('id, department_id')
        .neq('department_id', targetDeptId)
        .not('department_id', 'is', null);

    const ids = ticketsToFix?.map(t => t.id) || [];

    if (ids.length === 0) return NextResponse.json({ message: 'No tickets to fix' });

    // Update them to the correct department
    const { error } = await supabase
        .from('tickets')
        .update({ department_id: targetDeptId })
        .in('id', ids);

    return NextResponse.json({
        fixedCount: ids.length,
        targetDeptId,
        msg: "Moved tickets to the department the user is actually assigned to."
    });
}
