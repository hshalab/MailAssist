
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { getValidTokens } from '../lib/token-refresh';
import { getThreadById } from '../lib/gmail';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing Supabase credentials');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function debugThread() {
    console.log('Fetching ticket for "joselanderos97@yahoo.com"...');

    const { data: tickets, error } = await supabase
        .from('tickets')
        .select('*')
        .ilike('customer_email', '%joselanderos97@yahoo.com%')
        .limit(1);

    if (error || !tickets || tickets.length === 0) {
        console.error('Ticket not found', error);
        return;
    }

    const ticket = tickets[0];
    console.log('Ticket found:', ticket.id);
    console.log('Thread ID:', ticket.thread_id);
    console.log('Owner Email:', ticket.owner_email); // e.g. support@carifex.com

    if (!ticket.owner_email) {
        console.log('No owner email, defaulting to process.env.GMAIL_USER or checking accounts...');
        // If owner_email is null, we might need to find a valid user.
        // But typically it should be populated.
    }

    const userEmail = ticket.owner_email || 'support@carifex.com';

    console.log(`Getting tokens for ${userEmail}...`);
    try {
        const tokens = await getValidTokens(userEmail);
        if (!tokens || !tokens.access_token) {
            console.error('No valid tokens found for', userEmail);
            return;
        }

        console.log('Tokens retrieved. Fetching thread...');
        const thread = await getThreadById(tokens, ticket.thread_id);

        console.log(`Thread fetched with ${thread.messages.length} messages.`);

        thread.messages.forEach((msg, i) => {
            console.log(`\n--- Message ${i + 1} ---`);
            console.log('ID:', msg.id);
            console.log('From:', msg.from);
            console.log('Date:', msg.date);
            console.log('Snippet:', msg.snippet);
            console.log('Body Length:', msg.body ? msg.body.length : 0);
            console.log('Body Preview (Start):', msg.body ? msg.body.substring(0, 100) : 'NULL');
            // If body is empty, dump the whole object to see if anything else is there
            if (!msg.body || msg.body.trim().length === 0) {
                console.log('!!! BODY IS EMPTY !!!');
                console.log('Full Message Object:', JSON.stringify(msg, null, 2));
            }
        });

    } catch (err: any) {
        console.error('Error fetching thread:', err);
        if (err.response) {
            console.error('API Error:', err.response.data);
        }
    }
}

debugThread();
