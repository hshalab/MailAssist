
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

async function testThreadFetch() {
    console.log('Fetching a ticket...');

    // Get a closed ticket or one with activity
    const { data: ticket, error } = await supabase
        .from('tickets')
        .select('*')
        .eq('status', 'closed')
        .not('last_agent_reply_at', 'is', null) // Try to find one with agent reply
        .limit(1)
        .single();

    if (error || !ticket) {
        console.log('No closed tickets with agent replies found, trying any ticket...');
        const { data: anyTicket } = await supabase
            .from('tickets')
            .select('*')
            .limit(1)
            .single();

        if (!anyTicket) {
            console.error('No tickets found at all.');
            return;
        }
        console.log(`Using ticket ${anyTicket.id} (status: ${anyTicket.status})`);
        await fetchThreadForTicket(anyTicket);
    } else {
        console.log(`Using ticket ${ticket.id} (status: ${ticket.status})`);
        await fetchThreadForTicket(ticket);
    }
}

async function fetchThreadForTicket(ticket: any) {
    try {
        const { getValidTokens } = await import('../lib/token-refresh');
        const { getThreadById } = await import('../lib/gmail');

        console.log(`Fetching tokens for user ${ticket.user_email}...`);
        const tokens = await getValidTokens(ticket.user_email);

        if (!tokens || !tokens.access_token) {
            console.error('No tokens found for user.');
            return;
        }

        console.log(`Fetching thread ${ticket.thread_id}...`);
        const thread = await getThreadById(tokens, ticket.thread_id);

        console.log(`Thread fetched successfully. ${thread.messages.length} messages.`);
        thread.messages.forEach((msg: any, i: number) => {
            console.log(`[${i}] From: ${msg.from} | Date: ${msg.date} | Subject: ${msg.subject}`);
        });

    } catch (err) {
        console.error('Error fetching thread:', err);
    }
}

testThreadFetch();
