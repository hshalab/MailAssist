
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

// Load env vars manually
const envPath = path.resolve(process.cwd(), '.env.local');
const envContent = fs.readFileSync(envPath, 'utf-8');
const envVars = Object.fromEntries(
    envContent.split('\n').map(line => {
        const [key, ...val] = line.split('=');
        return [key?.trim(), val?.join('=')?.trim()];
    })
);

const supabaseUrl = envVars['NEXT_PUBLIC_SUPABASE_URL'];
const supabaseKey = envVars['SUPABASE_SERVICE_ROLE_KEY'] || envVars['NEXT_PUBLIC_SUPABASE_ANON_KEY'];

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase credentials');
    console.log('Available keys:', Object.keys(envVars));
    process.exit(1);
}
// ex
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkTokens() {
    console.log('Checking tokens table...');
    const { data: tokens, error } = await supabase
        .from('tokens')
        .select('user_email, business_id, provider, updated_at');

    if (error) {
        console.error('Error fetching tokens:', error);
        return;
    }

    console.log('Tokens found:', tokens?.length);
    console.table(tokens);

    console.log('\nChecking users table for context...');
    const { data: users, error: userError } = await supabase
        .from('users')
        .select('id, email, role, business_id');

    if (userError) {
        console.error('Error fetching users:', userError);
    } else {
        console.table(users);
    }
}

checkTokens();
