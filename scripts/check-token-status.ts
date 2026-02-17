
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function checkTokens() {
    const { data: tokens, error } = await supabase.from('tokens').select('user_email, expiry_date, refresh_token');
    if (error) {
        console.error('Error:', error);
        return;
    }

    console.log('Tokens found:', tokens.length);
    tokens.forEach(t => {
        const remaining = t.expiry_date ? (t.expiry_date - Date.now()) / 1000 : 'N/A';
        console.log(`Email: ${t.user_email}, Refresh Token: ${!!t.refresh_token}, Expires In (s): ${remaining}`);
    });
}

checkTokens();
