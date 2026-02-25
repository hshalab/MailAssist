import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false }
});

async function main() {
    const threadId = "19c65139fae5dafe"; // an example thread with known duplicates

    const { data, error } = await supabase
        .from('tickets')
        .select('*')
        .eq('thread_id', threadId)
        .limit(1)
        .maybeSingle();

    console.log("maybeSingle + limit(1):", { data: data?.id, error });

    const { data: data2, error: error2 } = await supabase
        .from('tickets')
        .select('*')
        .eq('thread_id', threadId);

    console.log("Without maybeSingle:", data2?.map(d => d.id), "count:", data2?.length);
}
main();
