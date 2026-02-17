
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

async function findStaleOpenTickets() {
    console.log('Searching for "Open" tickets for support@carifex.com where Updated At is significantly newer than Last Customer Reply...');

    const { data: tickets, error } = await supabase
        .from('tickets')
        .select('id, subject, status, last_customer_reply_at, updated_at, user_email')
        .eq('status', 'open')
        .eq('user_email', 'support@carifex.com')
        .not('last_customer_reply_at', 'is', null)
        .limit(1000);

    if (error) {
        console.error('Error fetching tickets:', error);
        return;
    }

    const staleTickets = tickets.filter(t => {
        const updateDate = new Date(t.updated_at);
        // If last_customer_reply_at exists, use it. Otherwise, use updated_at to be safe (but query filters nulls)
        const customerDate = new Date(t.last_customer_reply_at);

        // Check if updated more than 24 hours after the last customer reply
        const diffMs = updateDate.getTime() - customerDate.getTime();
        const diffHours = diffMs / (1000 * 60 * 60);

        // ALSO check safety: if last_customer_reply_at is VERY recent (e.g. last 24h), DO NOT TOUCH.
        const hoursSinceReply = (new Date().getTime() - customerDate.getTime()) / (1000 * 60 * 60);
        const recentReplySafety = hoursSinceReply < 48; // If verified customer reply within 48h, keep open.

        if (recentReplySafety) {
            // This handles the user's concern: "if customer replies it should reopen"
            // If customer replied recently, we keep it OPEN.
            return false;
        }

        return diffHours > 24;
    });

    console.log(`\nFound ${staleTickets.length} likely stale tickets out of ${tickets.length} scanned.`);

    if (staleTickets.length > 0) {
        console.log('\nSample candidates to CLOSE:');
        staleTickets.slice(0, 10).forEach(t => {
            console.log(`- [${t.id}] "${t.subject}"`);
            console.log(`  Customer Reply: ${t.last_customer_reply_at}`);
            console.log(`  Last Update:    ${t.updated_at}`);
        });

        console.log('\nRecommendation: These tickets are OPEN but have NO recent customer reply, yet were updated recently (likely by glitch).');
    } else {
        console.log('No stale tickets found matching criteria.');
    }
}

findStaleOpenTickets();
