/**
 * Cron endpoint for automatic email sync and classification
 * Runs on a schedule to process new emails for all accounts
 * 
 * Vercel Cron Jobs will call this endpoint automatically
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const maxDuration = 60; // 60 seconds max for cron jobs

export async function GET(request: NextRequest) {
    const startTime = Date.now();

    // Verify cron secret for security (Vercel sends this automatically)
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    // In production, require the secret. In development, allow without secret for testing.
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
        console.log('[CRON] Unauthorized request - invalid or missing CRON_SECRET');
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('[CRON] Starting scheduled sync and classify job...');

    try {
        // Use admin client to bypass RLS and get all businesses
        let adminClient = supabase;
        if (process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.NEXT_PUBLIC_SUPABASE_URL) {
            adminClient = createClient(
                process.env.NEXT_PUBLIC_SUPABASE_URL,
                process.env.SUPABASE_SERVICE_ROLE_KEY,
                { auth: { persistSession: false } }
            );
        }

        if (!adminClient) {
            throw new Error('Supabase client not available');
        }

        // Get all unique business IDs from tokens table (including personal accounts where business_id is null)
        const { data: tokenData, error: tokenError } = await adminClient
            .from('tokens')
            .select('business_id, user_email')
            .not('access_token', 'is', null);

        if (tokenError) {
            console.error('[CRON] Error fetching tokens:', tokenError);
            throw tokenError;
        }

        if (!tokenData || tokenData.length === 0) {
            console.log('[CRON] No accounts found to process');
            return NextResponse.json({
                message: 'No accounts to process',
                duration: Date.now() - startTime
            });
        }

        // Group by business_id (null for personal accounts)
        const businessMap = new Map<string | null, string[]>();
        for (const token of tokenData) {
            const key = token.business_id || null;
            if (!businessMap.has(key)) {
                businessMap.set(key, []);
            }
            if (token.user_email) {
                businessMap.get(key)!.push(token.user_email);
            }
        }

        console.log(`[CRON] Found ${businessMap.size} account groups to process`);

        const results: {
            businessId: string | null;
            emails: string[];
            ticketsProcessed: number;
            classified: number;
            errors: string[];
        }[] = [];

        // Process each business/personal account group
        for (const [businessId, emails] of businessMap) {
            console.log(`[CRON] Processing ${businessId ? `business ${businessId}` : 'personal accounts'}: ${emails.join(', ')}`);

            const result = {
                businessId,
                emails,
                ticketsProcessed: 0,
                classified: 0,
                errors: [] as string[],
            };

            try {
                // Import the functions we need
                const { fetchAllInboxEmails } = await import('@/lib/email-service');
                const { ensureTicketForEmail } = await import('@/lib/tickets');
                const { runAutoClassify } = await import('@/lib/auto-classify');
                const { loadBusinessTokens } = await import('@/lib/storage');

                // Get connected accounts for this business/user
                const accounts = await loadBusinessTokens(businessId, emails[0]);

                if (accounts.length === 0) {
                    console.log(`[CRON] No valid tokens for ${businessId || emails[0]}, skipping`);
                    result.errors.push('No valid tokens');
                    results.push(result);
                    continue;
                }

                // Fetch recent inbox emails (last 50 per account, 60 days max)
                console.log(`[CRON] Fetching inbox emails for ${accounts.length} accounts...`);

                let inboxEmails: any[] = [];
                if (businessId) {
                    // Business account: fetch from all connected accounts
                    inboxEmails = await fetchAllInboxEmails(businessId, 50, undefined, emails[0]);
                } else {
                    // Personal account: fetch from the single account
                    const { fetchInboxEmails } = await import('@/lib/gmail');
                    if (accounts[0]?.tokens?.access_token) {
                        inboxEmails = await fetchInboxEmails(accounts[0].tokens, 50);
                    }
                }

                // Filter out spam/trash
                inboxEmails = inboxEmails.filter((email: any) => {
                    const labels = email.labels || [];
                    return !labels.some((label: string) => ['SPAM', 'TRASH'].includes(label));
                });

                console.log(`[CRON] Found ${inboxEmails.length} inbox emails`);

                // Get agent emails for this account to determine if email is from agent
                const agentEmails = accounts.map(acc => acc.email.toLowerCase());

                // Process emails to create tickets (batch of 20)
                const BATCH_SIZE = 20;
                for (let i = 0; i < Math.min(inboxEmails.length, 100); i += BATCH_SIZE) {
                    const batch = inboxEmails.slice(i, i + BATCH_SIZE);

                    for (const email of batch) {
                        try {
                            // Determine if email is from agent
                            const extractEmail = (emailStr: string) => {
                                const match = emailStr?.match(/<([^>]+)>/) || emailStr?.match(/([^\s<>]+@[^\s<>]+)/);
                                return match ? match[1].toLowerCase() : emailStr?.toLowerCase();
                            };

                            const emailFrom = extractEmail(email.from || '');
                            const isFromAgent = agentEmails.some(agentEmail =>
                                emailFrom === agentEmail || emailFrom?.includes(agentEmail)
                            );

                            await ensureTicketForEmail(
                                {
                                    id: email.id,
                                    threadId: email.threadId,
                                    subject: email.subject,
                                    from: email.from,
                                    to: email.to,
                                    date: email.date,
                                },
                                isFromAgent
                            );

                            result.ticketsProcessed++;
                        } catch (emailError) {
                            // Don't fail entire batch for one email
                            console.warn(`[CRON] Error processing email ${email.id}:`, emailError);
                        }
                    }
                }

                console.log(`[CRON] Processed ${result.ticketsProcessed} tickets, now classifying...`);

                // Run auto-classification
                const classifyResult = await runAutoClassify({
                    limit: 30,
                    businessId: businessId,
                    userEmail: emails[0],
                });

                result.classified = classifyResult.success;
                console.log(`[CRON] Classified ${classifyResult.success} tickets (${classifyResult.failed} failed)`);

            } catch (error) {
                console.error(`[CRON] Error processing ${businessId || emails[0]}:`, error);
                result.errors.push(error instanceof Error ? error.message : String(error));
            }

            results.push(result);
        }

        const duration = Date.now() - startTime;
        const totalTickets = results.reduce((sum, r) => sum + r.ticketsProcessed, 0);
        const totalClassified = results.reduce((sum, r) => sum + r.classified, 0);

        console.log(`[CRON] Completed in ${duration}ms: ${totalTickets} tickets processed, ${totalClassified} classified`);

        return NextResponse.json({
            success: true,
            message: `Processed ${totalTickets} tickets, classified ${totalClassified}`,
            accountGroups: results.length,
            totalTicketsProcessed: totalTickets,
            totalClassified,
            duration,
            results,
        });

    } catch (error) {
        console.error('[CRON] Fatal error:', error);
        return NextResponse.json(
            {
                error: 'Cron job failed',
                details: error instanceof Error ? error.message : String(error),
                duration: Date.now() - startTime,
            },
            { status: 500 }
        );
    }
}
