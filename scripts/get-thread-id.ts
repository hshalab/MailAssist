
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing Supabase credentials');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function getThreadId() {
    const { data, error } = await supabase
        .from('tickets')
        .select('thread_id, id, subject')
        .limit(1);

    if (error) {
        console.error('Error fetching ticket:', error);
        return;
    }

    if (data && data.length > 0) {
        console.log('Found ticket:', data[0]);
    } else {
        console.log('No tickets found.');
    }
}

getThreadId();
