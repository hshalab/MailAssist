
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
        for (const email of emails) {
            try {
                if (!email.threadId) {
                    console.warn(`[TicketSync] Email ${email.id} missing threadId, skipping.`);
                    continue;
                }

                // Use getOrCreateTicketForThread which handles duplicates safely
                // It checks DB first, so it won't duplicate or overwrite existing tickets
                const ticket = await getOrCreateTicketForThread(
                    email.threadId,
                    {
                        subject: email.subject || '(No Subject)',
                        customerEmail: email.from, // Parse 'from' header usually contains email
                        customerName: email.from, // Could parse name cleaner if needed
                        initialStatus: 'open',
                        priority: undefined,
                        tags: [],
                        lastCustomerReplyAt: email.date, // Use email date as last reply
                    },
                    email.snippet || '' // Use snippet as body preview
                );

                if (ticket) {
                    // Check if it was just created (approximate check based on created_at?)
                    // actually getOrCreateTicketForThread doesn't return 'isNew' flag easily
                    // unless we modify it. For now, just count success.
                    createdCount++;
                }
            } catch (err) {
                console.error(`[TicketSync] Error processing email ${email.id} (Subject: ${email.subject}):`, err);
                errors++;
            }
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
