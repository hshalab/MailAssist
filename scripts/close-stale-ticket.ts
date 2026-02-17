
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

async function closeTicket(id: string) {
    console.log(`Closing stale ticket ${id}...`);
    const { error } = await supabase
        .from('tickets')
        .update({ status: 'closed', updated_at: new Date().toISOString() })
        .eq('id', id);

    if (error) {
        console.error('Error closing ticket:', error);
    } else {
        console.log('Ticket closed successfully.');
    }
}

// The ID found in previous step
closeTicket('4b303a77-72d8-4446-bc56-8449e726f34b');
