
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function listTables() {
    const { data, error } = await supabase
        .from('information_schema.tables')
        .select('table_name')
        .eq('table_schema', 'public');

    if (error) {
        // If that fails (permissions), try standard query
        console.error('Error fetching tables from schema:', error);
        // Fallback: try to select from 'tokens' and 'accounts' to see if they exist
        const { error: tokensError } = await supabase.from('tokens').select('id').limit(1);
        console.log('Result for tokens:', tokensError ? tokensError.message : 'Exists');

        const { error: accountsError } = await supabase.from('accounts').select('id').limit(1);
        console.log('Result for accounts:', accountsError ? accountsError.message : 'Exists');
        return;
    }

    console.log('Tables:', data?.map(t => t.table_name).join(', '));
}

listTables();
