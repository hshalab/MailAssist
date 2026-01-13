
import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET() {
    try {
        console.log('Starting comprehensive duplicate ticket cleanup...');

        // Fetch all tickets using pagination
        let allTickets: any[] = [];
        let page = 0;
        const pageSize = 1000;
        let hasMore = true;

        while (hasMore) {
            const { data, error } = await supabase
                .from('tickets')
                .select('id, thread_id, user_email, created_at')
                .order('created_at', { ascending: true })
                .range(page * pageSize, (page + 1) * pageSize - 1);

            if (error) throw error;

            if (data && data.length > 0) {
                allTickets = [...allTickets, ...data];
                console.log(`Fetched page ${page}: ${data.length} tickets. Total so far: ${allTickets.length}`);
                if (data.length < pageSize) hasMore = false;
                page++;
            } else {
                hasMore = false;
            }
        }

        console.log(`Total tickets scanned: ${allTickets.length}`);

        const seenThreads = new Map<string, string>();
        const duplicatesToDelete: string[] = [];

        for (const ticket of allTickets) {
            // Create a unique key for the thread+user combo
            const key = `${ticket.thread_id}_${ticket.user_email || 'GLOBAL'}`;

            if (seenThreads.has(key)) {
                // Seen before -> duplicate
                duplicatesToDelete.push(ticket.id);
            } else {
                // First time -> keeper
                seenThreads.set(key, ticket.id);
            }
        }

        console.log(`Found ${duplicatesToDelete.length} duplicates to delete.`);

        if (duplicatesToDelete.length === 0) {
            return NextResponse.json({ message: 'No duplicates found', scanned: allTickets.length });
        }

        // Delete duplicates in batches
        const DELETE_BATCH_SIZE = 100;
        let deletedCount = 0;

        for (let i = 0; i < duplicatesToDelete.length; i += DELETE_BATCH_SIZE) {
            const batch = duplicatesToDelete.slice(i, i + DELETE_BATCH_SIZE);
            const { error: deleteError } = await supabase
                .from('tickets')
                .delete()
                .in('id', batch);

            if (deleteError) {
                console.error('Error deleting batch:', deleteError);
            } else {
                deletedCount += batch.length;
            }
        }

        return NextResponse.json({
            message: 'Cleanup complete',
            scanned: allTickets.length,
            duplicatesFound: duplicatesToDelete.length,
            deleted: deletedCount
        });

    } catch (error) {
        console.error('Cleanup failed:', error);
        return NextResponse.json({ error: String(error) }, { status: 500 });
    }
}
