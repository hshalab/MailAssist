
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET(request: NextRequest) {
    if (!supabase) return NextResponse.json({ error: 'DB not connected' });

    const { count: total } = await supabase.from('tickets').select('*', { count: 'exact', head: true });

    const { count: unclassified } = await supabase.from('tickets')
        .select('*', { count: 'exact', head: true })
        .is('department_id', null);

    const { count: promotions } = await supabase.from('tickets')
        .select('*', { count: 'exact', head: true })
        .eq('department_id', 'ec68acab-28b9-43c3-b072-35804561848f'); // Assuming we can join to find ID? 
    // Actually we don't know the ID.

    // Group by department
    const { data: byDept, error } = await supabase
        .from('tickets')
        .select('department_id, departments(name)')
        .limit(1000); // Sample

    // Manual aggregation
    const deptCounts: Record<string, number> = {};
    byDept?.forEach((t: any) => {
        const name = t.departments?.name || 'Unclassified';
        deptCounts[name] = (deptCounts[name] || 0) + 1;
    });

    return NextResponse.json({
        total,
        unclassified,
        breakdown: deptCounts
    });
}
