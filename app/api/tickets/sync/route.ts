
import { NextRequest, NextResponse } from 'next/server';
import { validateBusinessSession } from '@/lib/session';
import { fetchAllInboxEmails } from '@/lib/email-service';
import { getValidTokens } from '@/lib/token-refresh';
import { fetchInboxEmails } from '@/lib/gmail';
import { getOrCreateTicketForThread } from '@/lib/tickets';
import { getCurrentUserEmail } from '@/lib/storage';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes timeout for sync

export async function POST(request: NextRequest) {
    try {
        // 1. Auth check
        const businessSession = await validateBusinessSession();
        let emails: any[] = [];
        let processingUserEmail: string | null = null; // Email used for ticket ownership

        if (businessSession) {
            console.log(`[TicketSync] Starting sync for business ${businessSession.businessId}`);
            // Fetch from all accounts connected to business
            emails = await fetchAllInboxEmails(
                businessSession.businessId,
                500, // Sync up to 500 emails
                undefined, // query
                undefined // userEmail (optional)
            );

            // Use the email from the session as the primary owner for created tickets if needed
            processingUserEmail = businessSession.email;
        } else {
            // Personal account flow
            const tokens = await getValidTokens();
            if (!tokens || !tokens.access_token) {
                return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
            }

            emails = await fetchInboxEmails(tokens, 500, undefined, false);
            processingUserEmail = await getCurrentUserEmail();
        }

        console.log(`[TicketSync] Fetch complete. Found ${emails.length} emails.`);
        console.log(`[TicketSync] Processing tickets for user: ${processingUserEmail}`);

        let createdCount = 0;
        let existingCount = 0; // Track existing
        let errors = 0;

        // 2. Process emails to ensure tickets exist
        // 2. Process emails to ensure tickets exist (Optimized: Dedupe threads + Concurrency)

        // Group emails by threadId
        const emailsByThread = new Map<string, any[]>();
        for (const email of emails) {
            if (!email.threadId) continue;
            if (!emailsByThread.has(email.threadId)) {
                emailsByThread.set(email.threadId, []);
            }
            emailsByThread.get(email.threadId)!.push(email);
        }

        const uniqueThreadIds = Array.from(emailsByThread.keys());
        console.log(`[TicketSync] Consolidating ${emails.length} emails into ${uniqueThreadIds.length} unique threads.`);

        // Process in batches
        const BATCH_SIZE = 10;
        for (let i = 0; i < uniqueThreadIds.length; i += BATCH_SIZE) {
            const batchIds = uniqueThreadIds.slice(i, i + BATCH_SIZE);

            await Promise.all(batchIds.map(async (threadId) => {
                try {
                    const threadEmails = emailsByThread.get(threadId)!;
                    // Sort by date ascending (oldest first) to get original subject
                    threadEmails.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

                    const seedEmail = threadEmails[0]; // Oldest email
                    const latestEmail = threadEmails[threadEmails.length - 1]; // Newest for snippet/date

                    const ticket = await getOrCreateTicketForThread(
                        threadId,
                        {
                            subject: seedEmail.subject || '(No Subject)',
                            customerEmail: seedEmail.from,
                            customerName: seedEmail.from,
                            initialStatus: 'open',
                            tags: [],
                            lastCustomerReplyAt: latestEmail.date, // Use latest date
                        },
                        latestEmail.snippet || ''
                    );

                    if (ticket) createdCount++;
                } catch (err) {
                    console.error(`[TicketSync] Error processing thread ${threadId}:`, err);
                    errors++;
                }
            }));
        }

        console.log(`[TicketSync] Sync Summary: ${createdCount} processed (created/verified), ${errors} errors.`);

        return NextResponse.json({
            success: true,
            processed: emails.length,
            message: `Sync complete. Processed ${emails.length} emails.`,
        });

    } catch (error) {
        console.error('[TicketSync] Fatal error:', error);
        return NextResponse.json(
            { error: 'Failed to sync tickets', details: (error as Error).message },
            { status: 500 }
        );
    }
}
