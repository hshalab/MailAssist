
import { supabase } from '@/lib/supabase';

async function main() {
    if (!supabase) { console.log('No supabase'); return; }

    const { data: tickets } = await supabase
        .from('tickets')
        .select('id, subject, department_id, departments(name)')
        .not('department_id', 'is', null)
        .limit(10);

    console.log('Classified Tickets:', tickets);
}

main();
