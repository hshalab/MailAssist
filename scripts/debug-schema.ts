
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const LOG_FILE = path.resolve(process.cwd(), 'schema_debug.txt');

async function debugSchema() {
    fs.writeFileSync(LOG_FILE, '');
    const log = (msg: string) => {
        console.log(msg);
        fs.appendFileSync(LOG_FILE, msg + '\n');
    }

    // Test common table names
    const candidates = [
        'connected_accounts', 'accounts', 'google_accounts', 'gmail_accounts',
        'gmail_tokens', 'tokens', 'auth_tokens', 'user_tokens', 'users'
    ];

    for (const table of candidates) {
        log(`Checking table: ${table}...`);
        const { error } = await supabase.from(table).select('*').limit(1);
        if (!error) {
            log(`MATCH: Table '${table}' exists!`);
        } else {
            log(`FAIL: '${table}' - ${error.message} (${error.code})`);
        }
    }
}

debugSchema();
