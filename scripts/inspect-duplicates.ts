import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing Supabase credentials in .env.local');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false }
});

async function main() {
    const { data: tickets, error } = await supabase
        .from('tickets')
        .select('id, thread_id, subject, created_at, user_email, owner_email, department_id')
        .ilike('subject', '%Payout%')
        .order('created_at', { ascending: false })
        .limit(20);

    if (error) {
        console.error("Error fetching tickets:", error);
    } else {
        console.log(JSON.stringify(tickets, null, 2));
    }
}
main();
