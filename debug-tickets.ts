
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
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function debugTickets() {
    let logOutput = '--- Deep Dive Audit ---\n';

    // 1. Departments
    const { data: depts } = await supabase.from('departments').select('id, name');
    // logOutput += ... (skip brevity)

    // 2. Tickets Grouped by Dept
    const { data: tickets } = await supabase.from('tickets').select('id, subject, department_id, user_email, owner_email, assignee_user_id');
    const ticketCounts: Record<string, number> = {};
    const classifiedTickets: any[] = [];

    tickets?.forEach(t => {
        const dept = t.department_id || 'unclassified';
        ticketCounts[dept] = (ticketCounts[dept] || 0) + 1;
        if (t.department_id) {
            classifiedTickets.push({
                id: t.id,
                subject: t.subject,
                deptId: t.department_id,
                userEmail: t.user_email,
                ownerEmail: t.owner_email,
                assignee: t.assignee_user_id
            });
        }
    });

    logOutput += '\nTicket Distribution:\n' + JSON.stringify(ticketCounts, null, 2) + '\n';
    logOutput += 'Sample Classified Tickets:\n' + JSON.stringify(classifiedTickets.slice(0, 5), null, 2) + '\n';

    // 3. Agents and their Assignments
    const { data: users } = await supabase.from('users').select('id, name, email, role, user_email');
    for (const user of users || []) {
        if (user.role === 'agent') {
            const { data: userDepts } = await supabase
                .from('user_departments')
                .select('department_id')
                .eq('user_id', user.id);

            const assignedIds = userDepts?.map(d => d.department_id) || [];
            logOutput += `\nAgent: ${user.name} (${user.email})\n`;
            logOutput += 'Agent User Email (Scope): ' + user.user_email + '\n';
            logOutput += 'Assigned Dept IDs: ' + JSON.stringify(assignedIds) + '\n';

            const visibleCount = tickets?.filter(t =>
                t.department_id &&
                assignedIds.includes(t.department_id) &&
                (t.user_email === user.user_email)
            ).length;

            logOutput += `Should see ${visibleCount} automatic tickets (Dept match + Scope match)\n`;
            const deptMatchOnly = tickets?.filter(t => t.department_id && assignedIds.includes(t.department_id)).length;
            logOutput += `(Dept match only count: ${deptMatchOnly})\n`;
        }
    }

    // 4. Tokens
    const { data: tokens } = await supabase.from('tokens').select('user_email, business_id, updated_at');
    logOutput += '\nActive Tokens:\n' + JSON.stringify(tokens, null, 2) + '\n';

    fs.writeFileSync('debug_output.txt', logOutput);
    console.log('Output written to debug_output.txt');
}

debugTickets();
