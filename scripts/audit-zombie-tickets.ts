
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing Supabase credentials');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function auditZombieTickets() {
    console.log('Starting audit for erroneously reopened tickets...');

    // Criteria for "Zombie" reopen:
    // 1. Status is 'open' or 'pending'
    // 2. Updated recently (e.g. last 7 days - when bug might have occurred)
    // 3. BUT last customer reply is OLD (e.g. > 30 days ago)
    // This implies the ticket was touched (reopened) by the system without a new message.

    const { data: tickets, error } = await supabase
        .from('tickets')
        .select('*')
        .in('status', ['open', 'pending'])
        .order('updated_at', { ascending: false });

    if (error) {
        console.error('Error fetching tickets:', error);
        return;
    }

    const now = new Date();
    const ONE_DAY_MS = 24 * 60 * 60 * 1000;

    // Checking tickets updated in last 14 days
    const RECENT_THRESHOLD_MS = 14 * ONE_DAY_MS;

    // Checking messages older than 30 days
    const OLD_MESSAGE_THRESHOLD_MS = 30 * ONE_DAY_MS;

    const zombies = tickets.filter(t => {
        const updatedAt = new Date(t.updated_at).getTime();

        // If ticket hasn't been updated recently, it's just an old open ticket (ignore)
        if (now.getTime() - updatedAt > RECENT_THRESHOLD_MS) return false;

        // Check last activity
        const lastReplyStr = t.last_customer_reply_at || t.created_at;
        const lastReply = new Date(lastReplyStr).getTime();

        // If last reply is recent, then it's a valid reopen/new ticket
        if (now.getTime() - lastReply < OLD_MESSAGE_THRESHOLD_MS) return false;

        // Suspect: Updated recently, but last message is old
        // Also check if updated_at is significantly later than last reply
        if (updatedAt - lastReply > ONE_DAY_MS) {
            return true;
        }

        return false;
    });

    console.log(`Found ${zombies.length} suspect 'Zombie' tickets (recently updated but old messages):`);

    if (zombies.length > 0) {
        console.log('--- Sample Zombies ---');
        zombies.slice(0, 10).forEach(z => {
            console.log(`[${z.id}] Subject: "${z.subject}"`);
            console.log(`    Status: ${z.status}`);
            console.log(`    Updated: ${z.updated_at}`);
            console.log(`    Last Reply: ${z.last_customer_reply_at || z.created_at}`);
            console.log('-----------------------------------');
        });
        console.log(`\nTo fix these, we can bulk-close them.`);
    } else {
        console.log('No zombie tickets found. The bug may not have reopened old tickets, or they were already closed.');
    }

    // Also check for user_email IS NULL (Orphaned tickets)
    const orphans = tickets.filter(t => !t.user_email);
    if (orphans.length > 0) {
        console.log(`\nFound ${orphans.length} ORPHANED tickets (NULL user_email):`);
        orphans.slice(0, 5).forEach(o => console.log(`  ${o.id}: ${o.subject}`));
    }
}

auditZombieTickets().catch(console.error);
