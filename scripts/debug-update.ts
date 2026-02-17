
import dotenv from 'dotenv';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing Supabase credentials');
    process.exit(1);
}

const localClient = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    console.log('--- DEBUG UPDATE ---');

    // 1. Get closed ticket
    const { data: ticket } = await localClient.from('tickets').select('*').eq('status', 'closed').limit(1).single();
    if (!ticket) {
        console.log('No closed ticket found.');
        return;
    }
    console.log(`Using ticket ${ticket.id}`);

    // 2. Construct updates
    const nowIso = new Date().toISOString();
    const updates = {
        updated_at: nowIso,
        last_customer_reply_at: nowIso,
        status: 'open',
        was_reopened: true,
        user_email: ticket.user_email
    };
    console.log('Updates:', updates);

    // 3. Try import client
    console.log('Importing lib/tickets client...');
    const { supabase: importedClient } = await import('../lib/supabase');

    console.log('Attempting update with IMPORTED client...');
    const { data: res1, error: err1 } = await importedClient
        .from('tickets')
        .update(updates)
        .eq('id', ticket.id)
        .select('*')
        .maybeSingle();

    if (err1) console.error('Imported client error:', err1);
    else if (!res1) console.error('Imported client returned NO DATA');
    else console.log('Imported client SUCCESS. Status:', res1.status);

    // Reset
    await localClient.from('tickets').update({ status: 'closed' }).eq('id', ticket.id);

    // 4. Try local client
    console.log('Attempting update with LOCAL client...');
    const { data: res2, error: err2 } = await localClient
        .from('tickets')
        .update(updates)
        .eq('id', ticket.id)
        .select('*')
        .maybeSingle();

    if (err2) console.error('Local client error:', err2);
    else if (!res2) console.error('Local client returned NO DATA');
    else console.log('Local client SUCCESS. Status:', res2.status);
}

run();
