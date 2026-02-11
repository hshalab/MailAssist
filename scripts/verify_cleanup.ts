
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// Load environment variables directly
const envPath = path.resolve(process.cwd(), '.env.local');
console.log('Loading .env from:', envPath);

if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
} else {
    console.error('.env.local not found');
    process.exit(1);
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing Supabase credentials in .env.local');
    console.log('NEXT_PUBLIC_SUPABASE_URL:', supabaseUrl ? 'Set' : 'Missing');
    console.log('SUPABASE_SERVICE_ROLE_KEY:', supabaseServiceKey ? 'Set' : 'Missing');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false }
});

async function cleanup() {
    console.log('Finding duplicate tickets...');

    // Get all NULL user_email tickets
    const { data: nullUserTickets, error } = await supabase
        .from('tickets')
        .select('id, thread_id')
        .is('user_email', null);

    if (error) {
        console.error('Error:', error);
        return;
    }

    console.log(`Found ${nullUserTickets?.length || 0} tickets with NULL user_email`);

    for (const ticket of nullUserTickets || []) {
        // Check if a valid ticket exists for this thread
        const { data: validTickets } = await supabase
            .from('tickets')
            .select('id')
            .eq('thread_id', ticket.thread_id)
            .not('user_email', 'is', null)
            .limit(1);

        if (validTickets && validTickets.length > 0) {
            console.log(`Deleting duplicate ticket ${ticket.id} (valid one is ${validTickets[0].id})`);
            await supabase.from('tickets').delete().eq('id', ticket.id);
        }
    }
}

cleanup()
    .then(() => console.log('Done'))
    .catch(e => console.error(e));
