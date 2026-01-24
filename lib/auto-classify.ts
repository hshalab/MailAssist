/**
 * Helper function to trigger auto-classification for unclassified emails
 * Can be called from API routes or client-side
 */

import { getCurrentUser } from './session';
import { supabase } from './supabase';
import { classifyTicketToDepartmentAsync } from './tickets';

export interface AutoClassifyOptions {
    days?: number;
    limit?: number;
    businessId?: string | null; // Optional: explicitly provide businessId for server-side calls
    userEmail?: string | null; // Optional: explicitly provide userEmail for server-side calls
}

export async function runAutoClassify(options: AutoClassifyOptions = {}): Promise<{
    processed: number;
    success: number;
    failed: number;
}> {
    try {
        // Try to get current user, but allow server-side calls without user context
        let user = null;
        try {
            user = await getCurrentUser();
        } catch (err) {
            console.warn('[Auto-Classify] Could not get current user (server-side context?), continuing...', err);
        }

        // If no user and no explicit businessId/email provided, we can't proceed
        if (!user && !options.businessId && !options.userEmail) {
            console.error('[Auto-Classify] No user context and no explicit businessId/userEmail provided');
            throw new Error('Unauthorized: No user context available');
        }

        // Use provided businessId/userEmail or fall back to user's context
        const businessId = options.businessId || (user?.businessId || null);
        const userEmail = options.userEmail || (user?.email || null);
        const accountType = businessId ? 'business' : 'personal';

        // Fetch user settings for auto_classify_days
        let defaultDays = 30;
        if (supabase) {
            let settingsQuery = supabase
                .from('user_settings')
                .select('auto_classify_days');

            if (businessId) {
                settingsQuery = settingsQuery.eq('business_id', businessId);
            } else if (userEmail) {
                settingsQuery = settingsQuery.eq('user_email', userEmail);
            }

            const { data: settings } = await settingsQuery.maybeSingle();
            defaultDays = settings?.auto_classify_days || 30;
        }

        const days = options.days || defaultDays;
        const limit = Math.min(options.limit || 30, 50); // Default batch size: 30, max 50

        // Calculate cutoff date
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - days);

        // Build query based on account type
        let ticketsQuery = supabase
            .from('tickets')
            .select('id, subject, user_email, customer_email, thread_id, created_at')
            .is('department_id', null)
            .neq('status', 'closed')
            .gte('created_at', cutoffDate.toISOString());

        // Filter by account scope - works for both personal and business accounts
        if (businessId) {
            // Business account: Get all tickets for connected Gmail accounts in this business
            // Get all connected account emails from tokens table
            const { data: tokens } = await supabase
                ?.from('tokens')
                .select('user_email')
                .eq('business_id', businessId)
                .not('user_email', 'is', null);

            if (tokens && tokens.length > 0) {
                // Get unique user emails from connected accounts
                const accountEmails = [...new Set(tokens.map(t => t.user_email).filter(Boolean))];

                console.log(`[Auto-Classify] Business account: Found ${accountEmails.length} connected accounts: ${accountEmails.join(', ')}`);

                if (accountEmails.length > 0) {
                    // Filter tickets by user_email matching any connected account
                    ticketsQuery = ticketsQuery.in('user_email', accountEmails);
                } else {
                    // Fallback: filter by userEmail if provided
                    if (userEmail) {
                        console.log(`[Auto-Classify] Business account: No connected accounts found, using user email: ${userEmail}`);
                        ticketsQuery = ticketsQuery.eq('user_email', userEmail);
                    }
                }
            } else {
                // Fallback: filter by userEmail if provided
                if (userEmail) {
                    console.log(`[Auto-Classify] Business account: No tokens found, using user email: ${userEmail}`);
                    ticketsQuery = ticketsQuery.eq('user_email', userEmail);
                }
            }
        } else if (userEmail) {
            // Personal account: filter by user_email
            console.log(`[Auto-Classify] Personal account: Filtering by user email: ${userEmail}`);
            ticketsQuery = ticketsQuery.eq('user_email', userEmail);
        }

        const { data: tickets, error: fetchError } = await ticketsQuery.limit(limit);

        if (fetchError) {
            console.error('[Auto-Classify] Fetch error:', fetchError);
            throw new Error(fetchError.message);
        }

        if (!tickets || tickets.length === 0) {
            console.log('[Auto-Classify] No unclassified tickets found to process');
            return {
                processed: 0,
                success: 0,
                failed: 0,
            };
        }

        console.log(`[Auto-Classify] Found ${tickets.length} unclassified tickets to process`);

        // Check if departments exist before processing
        const { getAllDepartments } = await import('./departments');
        const scopeEmail = businessId ? null : userEmail;
        const departments = await getAllDepartments(scopeEmail, businessId);

        if (!departments || departments.length === 0) {
            console.log('[Auto-Classify] No departments configured, skipping classification. User needs to create departments first.');
            return {
                processed: 0,
                success: 0,
                failed: 0,
            };
        }

        console.log(`[Auto-Classify] Found ${departments.length} departments, proceeding with classification`);

        // Process concurrently
        const results = await Promise.allSettled(
            tickets.map(async (t) => {
                // Fetch the email body from emails table using thread_id
                const { data: emailData, error: emailError } = await supabase
                    .from('emails')
                    .select('body')
                    .eq('thread_id', t.thread_id)
                    .order('date', { ascending: true })
                    .limit(1)
                    .maybeSingle();

                if (emailError) {
                    console.warn(`[Auto-Classify] No email found for ticket ${t.id} (thread: ${t.thread_id}): ${emailError.message}`);
                }

                const bodyContent = emailData?.body || '';
                const bodyLength = bodyContent.length;
                console.log(`[Auto-Classify] Ticket ${t.id} - Subject: "${t.subject?.substring(0, 40)}", Body length: ${bodyLength} chars`);

                return classifyTicketToDepartmentAsync(
                    t.id,
                    t.subject,
                    bodyContent,
                    t.user_email || userEmail || null,
                    t.customer_email || null, // Customer email for history lookup
                    t.thread_id || null // Thread ID for context
                );
            })
        );

        const successCount = results.filter(r => r.status === 'fulfilled').length;
        const failCount = results.filter(r => r.status === 'rejected').length;

        return {
            processed: tickets.length,
            success: successCount,
            failed: failCount,
        };
    } catch (error) {
        console.error('[Auto-Classify] Error:', error);
        throw error;
    }
}

