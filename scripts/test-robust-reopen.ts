
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing Supabase credentials');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const originalLog = console.log;
console.log = function (...args: any[]) {
    originalLog.apply(console, args);
    try {
        fs.appendFileSync('robust_log.txt', args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ') + '\n');
    } catch (e) {
        // ignore
    }
}

function log(msg: string) {
    console.log(msg);
}

async function testRobustReopen() {
    fs.writeFileSync('robust_log.txt', 'Starting test...\n');
    const { ensureTicketForEmail } = await import('../lib/tickets');

    // 1. Get a ticket
    let { data: ticket } = await supabase
        .from('tickets')
        .select('*')
        .eq('status', 'closed')
        .limit(1)
        .single();

    if (!ticket) {
        log('No closed ticket found, trying to find any ticket to close...');
        const { data: anyTicket } = await supabase.from('tickets').select('*').limit(1).single();
        if (!anyTicket) {
            log('No tickets found at all.');
            return;
        }
        // force close it
        await supabase.from('tickets').update({ status: 'closed', updated_at: new Date().toISOString() }).eq('id', anyTicket.id);
        ticket = { ...anyTicket, status: 'closed' };
        log(`Forced closed ticket ${ticket.id}`);
    }

    log(`Using ticket ${ticket.id} bound to user ${ticket.user_email}`);

    // Set a specific updated_at for testing AND reset last_customer_reply_at
    const fixedTime = new Date('2025-01-01T12:00:00Z');
    const oldReplyTime = new Date('2025-01-01T11:00:00Z'); // 1 hour before

    await supabase.from('tickets').update({
        updated_at: fixedTime.toISOString(),
        last_customer_reply_at: oldReplyTime.toISOString()
    }).eq('id', ticket.id);

    // Refresh ticket to get exact DB state
    const { data: refreshedTicket } = await supabase.from('tickets').select('*').eq('id', ticket.id).single();
    log(`Ticket updated_at set to: ${refreshedTicket.updated_at}`);
    log(`Ticket last_customer_reply_at set to: ${refreshedTicket.last_customer_reply_at}`);

    // TEST 3 RE-VERIFICATION ONLY
    log('\n--- TEST 3: Customer Email NEW (Real New Reply) ---');
    const newDate = new Date('2025-01-01T13:00:00Z').toISOString(); // 1 hour after closure

    // NOTE: Still passing ownerEmail as a good practice, but the FIX is in using ticket.id
    const result = await ensureTicketForEmail({
        id: 'test-cust-msg-new',
        threadId: ticket.thread_id,
        subject: 'Real New Reply',
        from: 'Customer <cust@test.com>',
        to: ticket.user_email,
        date: newDate,
        ownerEmail: ticket.user_email
    }, false);

    log(`ensureTicketForEmail returned status: ${result?.status}, updated_at: ${result?.updatedAt}`);

    const { data: t3 } = await supabase.from('tickets').select('*').eq('id', ticket.id).single();
    log(`DB Ticket State: status=${t3.status}, updated_at=${t3.updated_at}`);

    // Expecting OPEN
    if (t3.status === 'open') {
        log('PASS: Ticket REOPENED after new customer email');
    } else {
        log(`FAIL: Ticket status is ${t3.status} (Expected: open)`);
    }
}

testRobustReopen();
