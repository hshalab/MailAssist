import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase credentials');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
    // Find the business
    const { data: business } = await supabase
        .from('businesses')
        .select('id, business_email, business_name')
        .eq('business_email', 'i221885@nu.edu.pk')
        .single();

    console.log('Business Owner Email:', business?.business_email);
    console.log('Business Name:', business?.business_name);
    console.log('Business ID:', business?.id);
    console.log('');

    // Check both users
    const { data: users } = await supabase
        .from('users')
        .select('id, email, role, business_id')
        .eq('business_id', business?.id);

    console.log('Users in this business:');
    users?.forEach(u => {
        const isOwner = u.email.toLowerCase() === business?.business_email?.toLowerCase();
        console.log(`  - ${u.email}: role=${u.role} ${isOwner ? '(OWNER - should be admin)' : '(should keep current role)'}`);
    });
}

main().catch(console.error);
