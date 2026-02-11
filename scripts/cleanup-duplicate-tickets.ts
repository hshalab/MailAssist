
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing Supabase credentials in .env.local');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false }
});

async function cleanupDuplicateTickets() {
    console.log('Starting duplicate ticket cleanup...');

    // 1. Find tickets with matching thread_ids but different IDs
    // We want to keep the one WITH user_email and delete the one WITHOUT user_email (if both exist)
    // Or if duplicates exist with same user_email status (unlikely due to index), keep the oldest.

    // Get all tickets with user_email IS NULL
    const { data: nullUserTickets, error: nullError } = await supabase
        .from('tickets')
        .select('id, thread_id, subject, created_at')
        .is('user_email', null);

    if (nullError) {
        console.error('Error fetching tickets with null user_email:', nullError);
        return;
    }

    console.log(`Found ${nullUserTickets?.length || 0} tickets with NULL user_email.`);

    if (!nullUserTickets || nullUserTickets.length === 0) {
        console.log('No cleanup needed.');
        return;
    }

    let deletedCount = 0;
    let fixedCount = 0;

    // For each null-user ticket, check if a valid ticket exists for the same thread_id
    for (const nullTicket of nullUserTickets) {
        const { data: validTickets, error: validError } = await supabase
            .from('tickets')
            .select('id, user_email, created_at')
            .eq('thread_id', nullTicket.thread_id)
            .not('user_email', 'is', null);

        if (validError) {
            console.error(`Error checking for valid duplicate of ${nullTicket.id}:`, validError);
            continue;
        }

        if (validTickets && validTickets.length > 0) {
            // A valid ticket exists! The null-user ticket is a "zombie" duplicate.
            console.log(`[DUPLICATE] Deleting zombie ticket ${nullTicket.id} (thread ${nullTicket.thread_id}). Valid ticket exists: ${validTickets[0].id}`);

            const { error: deleteError } = await supabase
                .from('tickets')
                .delete()
                .eq('id', nullTicket.id);

            if (!deleteError) {
                deletedCount++;
            } else {
                console.error(`Failed to delete ticket ${nullTicket.id}:`, deleteError);
            }
        } else {
            // No valid ticket exists. This null-ticket might be the ONLY record.
            // We should probably attempt to fix it by assigning it to a user if possible, 
            // or leave it alone if we can't determine the owner.
            // For now, we'll log it.
            console.log(`[ORPHAN] Ticket ${nullTicket.id} (thread ${nullTicket.thread_id}) has no user_email and no duplicate. Subject: "${nullTicket.subject}"`);

            // OPTIONAL: Try to fix it if it has an owner_email
            // const { data: fullTicket } = await supabase.from('tickets').select('owner_email').eq('id', nullTicket.id).single();
            // if (fullTicket?.owner_email) {
            //    await supabase.from('tickets').update({ user_email: fullTicket.owner_email }).eq('id', nullTicket.id);
            //    fixedCount++;
            // }
        }
    }

    console.log('Cleanup complete.');
    console.log(`Deleted ${deletedCount} duplicate tickets.`);
    console.log(`Fixed ${fixedCount} orphan tickets.`);
}

cleanupDuplicateTickets()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error('Fatal error:', err);
        process.exit(1);
    });
