/**
 * Diagnostic: Check for old open tickets that might have been zombies
 * previously hidden but now visible after cleanup + adoption
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
    // 1. Check how many old open tickets exist (created > 14 days ago, still open)
    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

    const { data: oldOpenTickets, error: err1 } = await supabase
        .from('tickets')
        .select('id, thread_id, subject, status, user_email, owner_email, created_at, updated_at, last_customer_reply_at, last_agent_reply_at')
        .eq('status', 'open')
        .lt('created_at', fourteenDaysAgo.toISOString())
        .order('created_at', { ascending: true })
        .limit(30);

    console.log(`\n=== OLD OPEN TICKETS (created > 14 days ago, still 'open') ===`);
    console.log(`Found: ${oldOpenTickets?.length || 0}`);

    if (oldOpenTickets && oldOpenTickets.length > 0) {
        for (const t of oldOpenTickets.slice(0, 15)) {
            const ageDays = Math.round((Date.now() - new Date(t.created_at).getTime()) / (1000 * 60 * 60 * 24));
            console.log(`  [${ageDays}d old] ${t.subject?.substring(0, 60)}`);
            console.log(`    id: ${t.id}`);
            console.log(`    user_email: ${t.user_email || 'NULL'}`);
            console.log(`    owner_email: ${t.owner_email || 'NULL'}`);
            console.log(`    last_customer_reply: ${t.last_customer_reply_at || 'never'}`);
            console.log(`    last_agent_reply: ${t.last_agent_reply_at || 'never'}`);
            console.log(`    updated_at: ${t.updated_at}`);
            console.log('');
        }
    }

    // 2. Check total ticket counts by status
    const { count: openCount } = await supabase.from('tickets').select('*', { count: 'exact', head: true }).eq('status', 'open');
    const { count: closedCount } = await supabase.from('tickets').select('*', { count: 'exact', head: true }).eq('status', 'closed');
    const { count: pendingCount } = await supabase.from('tickets').select('*', { count: 'exact', head: true }).eq('status', 'pending');

    console.log(`\n=== TICKET STATUS BREAKDOWN ===`);
    console.log(`  open: ${openCount}`);
    console.log(`  closed: ${closedCount}`);
    console.log(`  pending: ${pendingCount}`);

    // 3. Check tickets with NULL user_email (surviving zombies)
    const { data: zombies, count: zombieCount } = await supabase
        .from('tickets')
        .select('id, thread_id, subject, status, created_at', { count: 'exact' })
        .is('user_email', null)
        .limit(5);

    console.log(`\n=== ZOMBIE TICKETS (user_email = NULL) ===`);
    console.log(`Count: ${zombieCount}`);
    if (zombies && zombies.length > 0) {
        for (const z of zombies) {
            console.log(`  ${z.id}: "${z.subject?.substring(0, 50)}" [${z.status}] created: ${z.created_at}`);
        }
    }

    // 4. Check for tickets updated in the last 10 minutes (adoption via getTicketByThreadId)
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { data: recentlyUpdated, count: recentCount } = await supabase
        .from('tickets')
        .select('id, thread_id, subject, status, user_email, updated_at, created_at', { count: 'exact' })
        .gte('updated_at', tenMinAgo)
        .order('updated_at', { ascending: false })
        .limit(10);

    console.log(`\n=== TICKETS UPDATED IN LAST 10 MINUTES ===`);
    console.log(`Count: ${recentCount}`);
    if (recentlyUpdated) {
        for (const t of recentlyUpdated) {
            const ageDays = Math.round((Date.now() - new Date(t.created_at).getTime()) / (1000 * 60 * 60 * 24));
            console.log(`  [${ageDays}d old] ${t.subject?.substring(0, 50)} [${t.status}] user_email: ${t.user_email || 'NULL'}`);
        }
    }
}

main().catch(console.error);
