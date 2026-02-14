
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function checkTicket() {
    const output: string[] = [];
    const log = (msg: string) => output.push(msg);

    log('Searching for "Luis" in all tickets...');

    const { data: tickets, error } = await supabase
        .from('tickets')
        .select('*')
        .ilike('customer_name', '%Luis%');

    if (error) {
        log(`Error: ${JSON.stringify(error)}`);
    } else if (!tickets || tickets.length === 0) {
        log('No tickets found matching "Luis".');
    } else {
        log(`Found ${tickets.length} tickets matching "Luis":`);
        tickets.forEach(t => {
            log(`ID: ${t.id} | Name: ${t.customer_name} | Email: ${t.customer_email} | Status: ${t.status} | Updated: ${t.updated_at}`);
        });
    }

    fs.writeFileSync('debug-output-final.txt', output.join('\n'));
}

checkTicket();
