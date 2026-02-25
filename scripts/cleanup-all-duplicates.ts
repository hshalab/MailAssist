/**
 * COMPREHENSIVE Duplicate Ticket Cleanup Script
 * 
 * This script finds ALL duplicate tickets (same thread_id + user_email)
 * and deletes all but the OLDEST ticket per group.
 * 
 * Run: npx tsx scripts/cleanup-all-duplicates.ts
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

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

async function main() {
    console.log('=== COMPREHENSIVE Duplicate Ticket Cleanup ===\n');

    // Step 1: Fetch ALL tickets (paginated to handle large datasets)
    let allTickets: any[] = [];
    let offset = 0;
    const PAGE_SIZE = 1000;

    while (true) {
        const { data, error } = await supabase
            .from('tickets')
            .select('id, thread_id, user_email, owner_email, created_at, subject, status, department_id, assignee_user_id')
            .order('created_at', { ascending: true })
            .range(offset, offset + PAGE_SIZE - 1);

        if (error) {
            console.error('Error fetching tickets:', error);
            process.exit(1);
        }

        if (!data || data.length === 0) break;
        allTickets = allTickets.concat(data);
        offset += data.length;
        if (data.length < PAGE_SIZE) break;
    }

    console.log(`Total tickets in database: ${allTickets.length}`);

    // Step 2: Group tickets by (thread_id, user_email)
    // The "canonical" key is thread_id + user_email — there should only be ONE per group
    const groups = new Map<string, any[]>();

    for (const ticket of allTickets) {
        const key = `${ticket.thread_id}|${ticket.user_email || 'NULL'}`;
        if (!groups.has(key)) {
            groups.set(key, []);
        }
        groups.get(key)!.push(ticket);
    }

    // Step 3: Find groups with duplicates
    const duplicateGroups = Array.from(groups.entries()).filter(([, tickets]) => tickets.length > 1);

    console.log(`Found ${duplicateGroups.length} groups with duplicates\n`);

    if (duplicateGroups.length === 0) {
        console.log('No duplicates found! Database is clean.');
        return;
    }

    let totalDeleted = 0;
    const idsToDelete: string[] = [];

    for (const [key, tickets] of duplicateGroups) {
        // Sort by created_at ascending — KEEP the oldest, delete the rest
        tickets.sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

        // Prefer to keep the ticket that has the most data (department, assignee, etc.)
        // If the oldest one is less complete, keep a more complete one instead
        let keepIndex = 0;
        for (let i = 1; i < tickets.length; i++) {
            const current = tickets[keepIndex];
            const candidate = tickets[i];
            // Prefer tickets with department_id, assignee, or non-null user_email
            const currentScore = (current.department_id ? 1 : 0) + (current.assignee_user_id ? 1 : 0) + (current.user_email ? 1 : 0);
            const candidateScore = (candidate.department_id ? 1 : 0) + (candidate.assignee_user_id ? 1 : 0) + (candidate.user_email ? 1 : 0);
            if (candidateScore > currentScore) {
                keepIndex = i;
            }
        }

        const keep = tickets[keepIndex];
        const toDelete = tickets.filter((_: any, i: number) => i !== keepIndex);

        console.log(`[${key}] Subject: "${keep.subject?.substring(0, 60)}" — Keeping ${keep.id}, deleting ${toDelete.length} duplicate(s)`);

        for (const dup of toDelete) {
            idsToDelete.push(dup.id);
        }
    }

    console.log(`\nTotal tickets to delete: ${idsToDelete.length}`);

    // Step 4: Delete duplicates in batches
    const BATCH_SIZE = 50;
    for (let i = 0; i < idsToDelete.length; i += BATCH_SIZE) {
        const batch = idsToDelete.slice(i, i + BATCH_SIZE);
        const { error } = await supabase
            .from('tickets')
            .delete()
            .in('id', batch);

        if (error) {
            console.error(`Error deleting batch starting at ${i}:`, error);
        } else {
            totalDeleted += batch.length;
            console.log(`  Deleted batch ${Math.floor(i / BATCH_SIZE) + 1}: ${batch.length} tickets`);
        }
    }

    console.log(`\n=== Cleanup Complete ===`);
    console.log(`Deleted ${totalDeleted} duplicate tickets.`);
    console.log(`Remaining tickets: ${allTickets.length - totalDeleted}`);
}

main().catch(console.error);
