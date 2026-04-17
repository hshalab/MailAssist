/**
 * Cron endpoint for automatic email sync and classification
 * Uses INCREMENTAL sync via Gmail History API for fast execution
 * 
 * Vercel Cron Jobs will call this endpoint automatically
 * Last updated: 2026-02-05
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { createClient } from '@supabase/supabase-js';
import { isAIAutomationEnabled } from '@/lib/ai-config';

// Force dynamic to ensure this route is always built as a serverless function
export const dynamic = 'force-dynamic';

// Timeout guard - leave 5 seconds buffer before Vercel's 30s limit
const MAX_EXECUTION_TIME = 25000;

export async function GET(request: NextRequest) {
    const startTime = Date.now();

    // Helper to check if we're running out of time
    const isTimeRunningOut = () => Date.now() - startTime > MAX_EXECUTION_TIME;

    // Verify cron secret for security (Vercel sends this automatically)
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
        console.log('[CRON] Unauthorized request - invalid or missing CRON_SECRET');
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Global kill-switch: bail out before hitting Gmail or OpenAI when AI is off.
    if (!isAIAutomationEnabled()) {
        console.log('[CRON] AI_AUTOMATION_ENABLED=false — skipping job entirely');
        return NextResponse.json({
            success: true,
            skipped: true,
            reason: 'AI_AUTOMATION_ENABLED=false',
            duration: Date.now() - startTime,
        });
    }

    console.log('[CRON] Starting incremental sync and classify job...');

    try {
        // Use admin client to bypass RLS
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

        // Get all tokens with their sync state
        const { data: tokenData, error: tokenError } = await adminClient
            .from('tokens')
            .select('business_id, user_email, access_token, refresh_token')
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

        console.log(`[CRON] Found ${tokenData.length} accounts to process`);

        // Import sync functions
        const { getNewMessagesFromHistory, getMessagesByIds } = await import('@/lib/gmail');
        const { getSyncState, updateSyncState } = await import('@/lib/sync-state');
        const { ensureTicketForEmail } = await import('@/lib/tickets');
        const { runAutoClassify } = await import('@/lib/auto-classify');

        const results: {
            email: string;
            newMessages: number;
            ticketsCreated: number;
            classified: number;
            error?: string;
        }[] = [];

        let totalNewMessages = 0;
        let totalTickets = 0;
        let totalClassified = 0;

        // Process each account individually for better incremental sync
        for (const token of tokenData) {
            if (isTimeRunningOut()) {
                console.log('[CRON] Time running out, stopping early before next account');
                break;
            }

            const userEmail = token.user_email;
            if (!userEmail) continue;

            const result = {
                email: userEmail,
                newMessages: 0,
                ticketsCreated: 0,
                classified: 0,
                error: undefined as string | undefined,
            };

            try {
                // Get last sync state for this account
                const syncState = await getSyncState(userEmail);
                const lastHistoryId = syncState?.last_history_id || null;

                console.log(`[CRON] Processing ${userEmail}, lastHistoryId: ${lastHistoryId || 'none (first sync)'}`);

                // Get new messages since last sync using History API
                const tokens = {
                    access_token: token.access_token,
                    refresh_token: token.refresh_token,
                };

                // Limit history fetch to 5 pages to keep it fast
                const { messageIds, latestHistoryId } = await getNewMessagesFromHistory(tokens, lastHistoryId, 5);
                result.newMessages = messageIds.length;
                totalNewMessages += messageIds.length;

                console.log(`[CRON] ${userEmail}: ${messageIds.length} new messages to process`);

                if (messageIds.length > 0) {
                    // Get agent emails (connected accounts for this business)
                    const { data: businessTokens } = await adminClient
                        .from('tokens')
                        .select('user_email')
                        .eq('business_id', token.business_id || '')
                        .not('user_email', 'is', null);

                    const agentEmails = (businessTokens || [])
                        .map(t => t.user_email?.toLowerCase())
                        .filter(Boolean) as string[];

                    // Also add current user's email
                    if (userEmail && !agentEmails.includes(userEmail.toLowerCase())) {
                        agentEmails.push(userEmail.toLowerCase());
                    }

                    // BATCH PROCESSING: Process messages in chunks of 5 to avoid timeouts
                    const BATCH_SIZE = 5;
                    const batches = [];
                    for (let i = 0; i < messageIds.length; i += BATCH_SIZE) {
                        batches.push(messageIds.slice(i, i + BATCH_SIZE));
                    }

                    console.log(`[CRON] Processing ${messageIds.length} messages in ${batches.length} batches`);

                    for (const [batchIndex, batchIds] of batches.entries()) {
                        if (isTimeRunningOut()) {
                            console.log(`[CRON] Time running out during batch ${batchIndex + 1}/${batches.length}, stopping ticket creation`);
                            break;
                        }

                        try {
                            // Fetch details for this batch only
                            const newEmails = await getMessagesByIds(tokens, batchIds);

                            // Process new emails to create tickets
                            for (const email of newEmails) {
                                try {
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
                                            ownerEmail: userEmail, // CRITICAL: Pass owner email for proper scoping
                                        },
                                        isFromAgent,
                                        email.body // Pass email body for AI classification
                                    );

                                    result.ticketsCreated++;
                                    totalTickets++;
                                } catch (emailError) {
                                    console.warn(`[CRON] Error processing email ${email.id}:`, emailError);
                                }
                            }
                        } catch (batchError) {
                            console.error(`[CRON] Error processing batch ${batchIndex}:`, batchError);
                        }
                    }
                }

                // Update sync state with latest historyId
                if (latestHistoryId) {
                    await updateSyncState(userEmail, latestHistoryId);
                }

                // Run classification for this account's new tickets (limit to 5 per run for speed)
                if (!isTimeRunningOut() && result.ticketsCreated > 0) {
                    try {
                        const classifyResult = await runAutoClassify({
                            limit: 5, // Reduced limit for speed and safety
                            businessId: token.business_id,
                            userEmail: userEmail,
                            days: 1
                        });
                        result.classified = classifyResult.success;
                        totalClassified += classifyResult.success;
                    } catch (classifyError) {
                        console.warn(`[CRON] Classification error for ${userEmail}:`, classifyError);
                    }
                }

            } catch (error) {
                console.error(`[CRON] Error processing ${userEmail}:`, error);
                result.error = error instanceof Error ? error.message : String(error);
            }

            results.push(result);
        }

        const duration = Date.now() - startTime;

        console.log(`[CRON] Completed in ${duration}ms: ${totalNewMessages} new messages, ${totalTickets} tickets created, ${totalClassified} classified`);

        return NextResponse.json({
            success: true,
            message: `Processed ${totalNewMessages} new messages, created ${totalTickets} tickets, classified ${totalClassified}`,
            totalNewMessages,
            totalTicketsCreated: totalTickets,
            totalClassified,
            accountsProcessed: results.length,
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
