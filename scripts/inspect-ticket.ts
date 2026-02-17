
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

async function inspectTicket() {
    console.log('Searching for ticket from "joselanderos97@yahoo.com"...');

    // use ilike customerEmail if that column exists, or we might need to search 'customer_email'
    // The schema might be camelCase or snake_case. Let's try select * first.

    const { data: tickets, error } = await supabase
        .from('tickets')
        .select('*')
        .ilike('customer_email', '%joselanderos97@yahoo.com%')
        .limit(5);

    if (error) {
        console.error('Error searching tickets:', error);
        return;
    }

    if (!tickets || tickets.length === 0) {
        console.log('No matching tickets found.');
        return;
    }

    console.log(`Found ${tickets.length} tickets.`);
    const ticket = tickets[0];
    console.log('Inspecting Ticket:', ticket.id, ticket.subject);
    console.log('Status:', ticket.status);
    console.log('Thread ID:', ticket.thread_id);

    // Check emails table for this thread
    const { data: emails, error: emailError } = await supabase
        .from('emails')
        .select('*')
        .eq('thread_id', ticket.thread_id)
        .order('date', { ascending: true });

    if (emailError) {
        console.error('Error fetching emails:', emailError);
    } else if (emails) {
        console.log(`\nFound ${emails.length} emails in thread:`);
        emails.forEach(e => {
            console.log(`--------------------------------------------------`);
            console.log(`ID: ${e.id}`);
            console.log(`Date: ${e.date}`);
            console.log(`From: ${e.from}`);
            console.log(`Subject: ${e.subject}`);
            console.log(`Body Length: ${e.body ? e.body.length : 'NULL'}`);
            if (e.body && e.body.length < 50) {
                console.log(`FULL BODY (Short): "${e.body}"`);
            } else if (!e.body) {
                console.log(`FULL BODY: [EMPTY/NULL]`);
            }
        });
    }
}

inspectTicket();
