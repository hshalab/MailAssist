import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase credentials');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
    const email = 'i221885@nu.edu.pk';

    console.log('Checking OAuth readiness for:', email);
    console.log('='.repeat(60));

    // Check user record
    const { data: user, error: userError } = await supabase
        .from('users')
        .select('id, email, password_hash, business_id, role, is_active, user_email')
        .eq('email', email)
        .maybeSingle();

    if (userError) {
        console.error('Error fetching user:', userError);
        return;
    }

    if (!user) {
        console.log('❌ No user found with email:', email);
        return;
    }

    console.log('\n✅ USER FOUND:');
    console.log('  - ID:', user.id);
    console.log('  - Email:', user.email);
    console.log('  - User Email (scope):', user.user_email);
    console.log('  - Business ID:', user.business_id || 'NULL (Personal)');
    console.log('  - Role:', user.role);
    console.log('  - Is Active:', user.is_active);
    console.log('  - Has Password:', user.password_hash ? 'YES' : 'NO');

    // Check if there are any active sessions
    const { data: sessions, error: sessionsError } = await supabase
        .from('user_sessions')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(3);

    if (sessionsError) {
        console.error('\nError fetching sessions:', sessionsError);
    } else {
        console.log('\n📊 RECENT SESSIONS:');
        if (sessions && sessions.length > 0) {
            sessions.forEach((s, i) => {
                const isExpired = new Date(s.expires_at) < new Date();
                console.log(`  ${i + 1}. Created: ${new Date(s.created_at).toLocaleString()}`);
                console.log(`     Expires: ${new Date(s.expires_at).toLocaleString()} ${isExpired ? '(EXPIRED)' : '(ACTIVE)'}`);
                console.log(`     Business ID: ${s.business_id || 'NULL'}`);
            });
        } else {
            console.log('  No sessions found');
        }
    }

    // OAuth readiness check
    console.log('\n🔍 OAUTH LOGIN READINESS:');
    console.log(`  - User is ${user.is_active ? 'ACTIVE ✅' : 'INACTIVE ❌'}`);
    console.log(`  - Password login: ${user.password_hash ? 'Available ✅' : 'Not set ⚠️'}`);
    console.log(`  - OAuth login: ${user.is_active ? 'Should work ✅' : 'Will be blocked ❌'}`);

    if (!user.is_active) {
        console.log('\n⚠️  WARNING: User is INACTIVE. OAuth login will fail!');
        console.log('   The user was likely removed from the business.');
    }
}

main().catch(console.error);
