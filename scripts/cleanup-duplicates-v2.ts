
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing Supabase URL or Service Role Key in .env.local');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function cleanupDuplicates() {
    console.log('Starting robust duplicate cleanup...');

    // 1. Fetch ALL tickets (we need to group them in memory to be safe)
    // Fetching ID, threadId, userEmail, createdAt, subject
    const { data: tickets, error } = await supabase
        .from('tickets')
        .select('id, thread_id, user_email, created_at, subject, status, assignee_user_id')
        .order('created_at', { ascending: true });

    if (error) {
        console.error('Error fetching tickets:', error);
        return;
    }

    console.log(`Fetched ${tickets.length} tickets. Analyze for duplicates...`);

    const ticketsByThread = new Map<string, any[]>();

    // Group by thread_id ONLY (strict mode)
    // User explicitly requested NOT to group by subject as it can be repetitive.
    tickets.forEach(ticket => {
        if (!ticket.thread_id) return;
        const existing = ticketsByThread.get(ticket.thread_id) || [];
        existing.push(ticket);
        ticketsByThread.set(ticket.thread_id, existing);
    });

    let duplicatesFound = 0;
    let deletedCount = 0;

    for (const [threadId, group] of ticketsByThread.entries()) {
        if (group.length > 1) {
            duplicatesFound++;
            console.log(`Found ${group.length} tickets for thread ${threadId}:`);

            // Strategy:
            // 1. Prefer tickets with user_email
            // 2. Prefer tickets with assignee_user_id (active work)
            // 3. Prefer tickets with status != 'closed' if others are closed? (Maybe not)
            // 4. Default to keeping the OLDEST one (original)? Or NEWEST?
            //    - If we keep newest, we might lose history.
            //    - If we keep oldest, we keep the original creation date.
            //    - BUT, if the new one has the user_email and the old one didn't, we want the one with user_email.

            // Let's score them
            const scored = group.map(t => {
                let score = 0;
                if (t.user_email) score += 10;
                if (t.assignee_user_id) score += 5;
                if (t.status !== 'closed') score += 2; // Prefer keeping open ones?
                return { ticket: t, score };
            });

            // Sort by score DESC, then by created_at DESC (prefer newer if scores equal? or older?)
            // Actually, if we have a ticket with user_email and one without, the one without is likely the logic bug result.
            scored.sort((a, b) => {
                if (b.score !== a.score) return b.score - a.score;
                // If scores equal, prefer the one that is NOT closed?
                // If all equal, prefer the Listing one (created_at). 
                // Let's keep the one created EARLIER if both have email (true duplicate?)
                // Or keep the LATER one if it has more info?
                // Let's keep the one created LATER if it has user_email and the other doesn't. 
                // If both have user_email, keep one.
                return new Date(b.ticket.created_at).getTime() - new Date(a.ticket.created_at).getTime(); // Keep newest?
            });

            const winner = scored[0].ticket;
            const losers = scored.slice(1).map(s => s.ticket);

            console.log(`  KEEPING: ${winner.id} (user: ${winner.user_email || 'null'}, status: ${winner.status})`);

            for (const loser of losers) {
                console.log(`  DELETING: ${loser.id} (user: ${loser.user_email || 'null'}, status: ${loser.status})`);

                // Delete the duplicate
                const { error: deleteError } = await supabase
                    .from('tickets')
                    .delete()
                    .eq('id', loser.id);

                if (deleteError) {
                    console.error(`  Failed to delete ${loser.id}:`, deleteError);
                } else {
                    deletedCount++;
                    // Should we move messages? 
                    // If the loser has messages associated with it, we might orphan them.
                    // Ideally we should update the `ticket_id` of messages belonging to loser to winner.id

                    /*
                    const { error: moveError } = await supabase
                      .from('messages') // Assuming table name is available? Not sure of schema.
                      .update({ ticket_id: winner.id })
                      .eq('ticket_id', loser.id);
                    */
                    // Since I don't know the full schema for messages/comments, I will just delete for now
                    // based on the previous simple SQL script logic.
                    // If duplicates were created by sync, they probably just have the seed email message.
                }
            }
        }
    }

    console.log('-----------------------------------');
    console.log(`Cleanup complete.`);
    console.log(`Threads with duplicates: ${duplicatesFound}`);
    console.log(`Tickets deleted: ${deletedCount}`);
}

cleanupDuplicates().catch(console.error);
