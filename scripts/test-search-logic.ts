
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { getTickets } from '../lib/tickets';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const LOG_FILE = path.resolve(process.cwd(), 'search_results.log');
function log(msg: string) {
    fs.appendFileSync(LOG_FILE, msg + '\n');
    console.log(msg);
}

async function testSearch() {
    fs.writeFileSync(LOG_FILE, '');
    log('Testing getTickets search logic (Granular)...');

    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

    const userEmail_Salman = 'muhammad.salman3372@gmail.com';
    const { data: user } = await supabase.from('users').select('id, email').eq('email', 'support@carifex.com').single();
    const userId = user?.id;

    log(`User Context: support@carifex.com (${userId})`);

    // Target Ticket ID: 09e8030b-3bb1-4325-8f15-ba12ce982b95

    // 1. Search ONLY "groq" (NO user email, canViewAll=true)
    log('\n--- Test 1: Search "groq" ONLY (no userEmail) ---');
    try {
        const res = await getTickets(userId, true, null, undefined, undefined, 'desc', undefined, 'groq');
        log(`Found ${res.length} tickets`);
    } catch (e) { log(`Error 1: ${e}`); }

    // 2. Search ONLY user_email (NO search query)
    log(`\n--- Test 2: Search user_email: ${userEmail_Salman} ONLY ---`);
    try {
        const res = await getTickets(userId, true, userEmail_Salman, undefined, undefined, 'desc');
        log(`Found ${res.length} tickets`);
    } catch (e) { log(`Error 2: ${e}`); }

    // 3. Search BOTH
    log(`\n--- Test 3: Search BOTH "groq" AND user_email: ${userEmail_Salman} ---`);
    try {
        const res = await getTickets(userId, true, userEmail_Salman, undefined, undefined, 'desc', undefined, 'groq');
        log(`Found ${res.length} tickets`);
    } catch (e) { log(`Error 3: ${e}`); }

    // 4. Test .or syntax directly with exact subject
    log(`\n--- Test 4: Direct Supabase check with .or syntax ---`);
    try {
        const term = '%groq%';
        const { data, error } = await supabase.from('tickets').select('id').eq('user_email', userEmail_Salman).or(`subject.ilike.${term},customer_email.ilike.${term}`);
        log(`Found ${data?.length || 0} rows (Error: ${error?.message || 'none'})`);
    } catch (e) { log(`Error 4: ${e}`); }
}

testSearch();
