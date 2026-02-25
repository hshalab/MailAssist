/**
 * Bulk-close old stale open tickets that were never actioned.
 * These are tickets older than 14 days with status "open",
 * no agent reply, and no assignee.
 * 
 * Run: npx tsx scripts/close-stale-tickets.ts
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
);

async function main() {
    const DAYS_STALE = 14; // Tickets older than 14 days with no agent activity
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - DAYS_STALE);

    console.log(`=== Closing stale open tickets (created before ${cutoff.toISOString()}, no agent reply) ===\n`);

    // Find all old open tickets with no agent reply
    const { data: staleTickets, error, count } = await supabase
        .from('tickets')
        .select('id, thread_id, subject, status, user_email, created_at, last_agent_reply_at, assignee_user_id', { count: 'exact' })
        .eq('status', 'open')
        .lt('created_at', cutoff.toISOString())
        .is('last_agent_reply_at', null)
        .is('assignee_user_id', null);

    if (error) {
        console.error('Error fetching stale tickets:', error);
        process.exit(1);
    }

    console.log(`Found ${count} stale tickets to close\n`);

    if (!staleTickets || staleTickets.length === 0) {
        console.log('No stale tickets found. Database is clean.');
        return;
    }

    // Show some examples
    const examples = staleTickets.slice(0, 5);
    for (const t of examples) {
        const ageDays = Math.round((Date.now() - new Date(t.created_at).getTime()) / (1000 * 60 * 60 * 24));
        console.log(`  [${ageDays}d old] ${t.subject?.substring(0, 60)} (${t.user_email})`);
    }
    if (staleTickets.length > 5) {
        console.log(`  ... and ${staleTickets.length - 5} more\n`);
    }

    // Bulk-close in batches
    const ids = staleTickets.map(t => t.id);
    const BATCH_SIZE = 100;
    let totalClosed = 0;

    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
        const batch = ids.slice(i, i + BATCH_SIZE);
        const { error: updateError } = await supabase
            .from('tickets')
            .update({
                status: 'closed',
                updated_at: new Date().toISOString(),
                tags: ['auto-closed-stale'] // Tag them so you can identify them later
            })
            .in('id', batch);

        if (updateError) {
            console.error(`Error closing batch ${i / BATCH_SIZE + 1}:`, updateError);
        } else {
            totalClosed += batch.length;
            console.log(`  Closed batch ${Math.floor(i / BATCH_SIZE) + 1}: ${batch.length} tickets`);
        }
    }

    console.log(`\n=== Done: Closed ${totalClosed} stale tickets ===`);
}

main().catch(console.error);
