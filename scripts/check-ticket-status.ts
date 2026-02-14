
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    fs.writeFileSync('debug-output.txt', 'Missing Supabase credentials');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function checkTicket() {
    const output: string[] = [];
    const log = (msg: string) => output.push(msg);

    log('Fetching recent tickets (last 7 days)...');

    const { data: tickets, error } = await supabase
        .from('tickets')
        .select('*')
        .gte('created_at', '2026-02-09T00:00:00Z')
        .order('created_at', { ascending: false })
        .limit(50);

    if (error) {
        log(`Error fetching tickets: ${JSON.stringify(error)}`);
    } else if (!tickets || tickets.length === 0) {
        log('No tickets found in the last 7 days.');
    } else {
        log(`Found ${tickets.length} tickets:`);
        tickets.forEach(t => {
            // Filter for potential matches manually
            const rawMatches = JSON.stringify(t).toLowerCase();
            if (rawMatches.includes('luis') || rawMatches.includes('mendoza')) {
                log('*** POTENTIAL MATCH ***');
            }

            log('------------------------------------------------');
            log(`ID: ${t.id}`);
            log(`Customer: ${t.customer_name} <${t.customer_email}>`);
            log(`Subject: ${t.subject}`);
            log(`Status: ${t.status}`);
            log(`Created At: ${t.created_at}`);
            log(`Updated At: ${t.updated_at}`);
            log(`Last Customer Reply: ${t.last_customer_reply_at}`);
            log(`Last Agent Reply: ${t.last_agent_reply_at}`);
            log('------------------------------------------------');
        });
    }

    fs.writeFileSync('debug-output.txt', output.join('\n'));
}

checkTicket().catch(err => fs.writeFileSync('debug-output.txt', `Error: ${err}`));
