
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { getValidTokens } from '../lib/token-refresh';
import { getThreadById } from '../lib/gmail';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const LOG_FILE = path.resolve(process.cwd(), 'thread_body.txt');
function logToFile(msg: string) {
    fs.appendFileSync(LOG_FILE, msg + '\n');
    console.log(msg);
}

async function checkBody() {
    fs.writeFileSync(LOG_FILE, ''); // Clear log file
    try {
        logToFile('Starting checkBody...');

        // Check TOKENS table specifically (correct table name)
        const { data: tokenUsers, error: tokenError } = await supabase.from('tokens').select('user_email');

        let users: string[] = [];
        if (tokenError) {
            logToFile(`Error fetching tokens: ${JSON.stringify(tokenError)}`);
        } else {
            // Flatten structure for easier usage
            users = tokenUsers?.map(u => u.user_email) || [];
            logToFile(`Users with Tokens: ${users.join(', ')}`);
        }

        // Ticket ID from previous context: 19c677b0bc45dde7
        const threadId = '19c677b0bc45dde7';

        // Find the ticket first to get owner
        const { data: ticket } = await supabase.from('tickets').select('*').eq('thread_id', threadId).single();

        const userEmail = ticket?.owner_email || 'support@carifex.com';
        logToFile(`Ticket Owner: ${ticket?.owner_email}`);

        // Try to find a valid email that has tokens
        let validEmail = null;
        if (users.includes(userEmail)) {
            validEmail = userEmail;
        } else if (users.length > 0) {
            validEmail = users[0];
        }

        logToFile(`Trying initial email: ${validEmail}`);

        let thread = null;

        // Try explicit list of candidates
        const candidates = [validEmail, ...users.filter(u => u !== validEmail)].filter(Boolean) as string[];

        for (const email of candidates) {
            logToFile(`Attempting fetch with: ${email}`);
            try {
                const tokens = await getValidTokens(email);
                if (tokens && tokens.access_token) {
                    try {
                        thread = await getThreadById(tokens, threadId);
                        if (thread) {
                            logToFile(`SUCCESS: Found thread using ${email}`);
                            break;
                        }
                    } catch (e) {
                        logToFile(`Failed using ${email}: ${e}`);
                    }
                } else {
                    logToFile(`No valid tokens for ${email}`);
                }
            } catch (e) {
                logToFile(`Error fetching tokens for ${email}: ${e}`);
            }
        }

        if (!thread) {
            logToFile('CRITICAL: Could not fetch thread from ANY account.');
            return;
        }

        logToFile(`Found ${thread.messages?.length || 0} messages.`);

        if (thread.messages && thread.messages.length > 0) {
            // Log the LAST message (usually the reply)
            const lastMsg = thread.messages[thread.messages.length - 1];
            logToFile('--- Last Message ---');
            logToFile(`ID: ${lastMsg.id}`);
            logToFile(`Snippet: ${lastMsg.snippet}`);
            logToFile(`Payload MimeType: ${lastMsg.payload?.mimeType}`);
            logToFile(`Body Size: ${lastMsg.body ? lastMsg.body.length : 'N/A'}`);

            if (lastMsg.body) {
                logToFile('--- BODY START ---');
                logToFile(lastMsg.body);
                logToFile('--- BODY END ---');
            }

            const parts = lastMsg.payload?.parts || [];
            logToFile(`Parts Count: ${parts.length}`);
            parts.forEach((p: any, i: number) => {
                logToFile(`Part ${i}: Mime=${p.mimeType}, BodySize=${p.body?.size}, DataLength=${p.body?.data?.length}`);
                if (p.body?.data) {
                    logToFile(`Part ${i} Data: ${p.body.data.substring(0, 100)}...`);
                }
            });
        }

    } catch (err) {
        logToFile(`Top level error: ${err}`);
    }
}

checkBody();
