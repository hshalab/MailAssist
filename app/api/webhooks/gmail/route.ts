/**
 * Gmail Push Notification Webhook
 * 
 * Receives real-time notifications from Gmail via Google Pub/Sub
 * when new emails arrive. This enables instant email → ticket conversion.
 * 
 * Setup Required:
 * 1. Create a Pub/Sub topic in Google Cloud Console
 * 2. Grant Gmail publish permission to the topic
 * 3. Create a push subscription pointing to this endpoint
 * 4. Set GMAIL_HISTORY_TOPIC env var
 * 
 * Last updated: 2026-02-05
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

interface PubSubMessage {
    message: {
        data: string; // Base64 encoded
        messageId: string;
        publishTime: string;
    };
    subscription: string;
}

interface GmailNotification {
    emailAddress: string;
    historyId: string;
}

export async function POST(request: NextRequest) {
    const startTime = Date.now();
    console.log('[Gmail Webhook] Received push notification');

    try {
        // Parse the Pub/Sub message
        const body: PubSubMessage = await request.json();

        if (!body.message?.data) {
            console.log('[Gmail Webhook] No message data');
            return NextResponse.json({ success: true }); // ACK to Pub/Sub
        }

        // Decode the base64 message
        const decodedData = Buffer.from(body.message.data, 'base64').toString('utf-8');
        const notification: GmailNotification = JSON.parse(decodedData);

        console.log(`[Gmail Webhook] Notification for ${notification.emailAddress}, historyId: ${notification.historyId}`);

        // Get admin client
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

        if (!supabaseUrl || !supabaseServiceKey) {
            console.error('[Gmail Webhook] Missing Supabase credentials');
            return NextResponse.json({ success: true }); // ACK anyway
        }

        const adminClient = createClient(supabaseUrl, supabaseServiceKey, {
            auth: { persistSession: false }
        });

        // Get token for this email address
        const { data: tokenData, error: tokenError } = await adminClient
            .from('tokens')
            .select('user_email, access_token, refresh_token, business_id')
            .eq('user_email', notification.emailAddress)
            .single();

        if (tokenError || !tokenData) {
            console.log(`[Gmail Webhook] No token found for ${notification.emailAddress}`);
            return NextResponse.json({ success: true }); // ACK
        }

        // Import functions
        const { getNewMessagesFromHistory, getMessagesByIds } = await import('@/lib/gmail');
        const { getSyncState, updateSyncState } = await import('@/lib/sync-state');
        const { ensureTicketForEmail } = await import('@/lib/tickets');
        const { runAutoClassify } = await import('@/lib/auto-classify');

        // Get last sync state
        const syncState = await getSyncState(notification.emailAddress);
        const lastHistoryId = syncState?.last_history_id || null;

        const tokens = {
            access_token: tokenData.access_token,
            refresh_token: tokenData.refresh_token,
        };

        // Get new messages since last sync
        const { messageIds, latestHistoryId } = await getNewMessagesFromHistory(tokens, lastHistoryId);

        console.log(`[Gmail Webhook] ${messageIds.length} new messages for ${notification.emailAddress}`);

        if (messageIds.length > 0) {
            // Fetch message details
            const newEmails = await getMessagesByIds(tokens, messageIds);

            // Get agent emails
            const { data: businessTokens } = await adminClient
                .from('tokens')
                .select('user_email')
                .eq('business_id', tokenData.business_id || '')
                .not('user_email', 'is', null);

            const agentEmails = (businessTokens || [])
                .map(t => t.user_email?.toLowerCase())
                .filter(Boolean) as string[];

            if (!agentEmails.includes(notification.emailAddress.toLowerCase())) {
                agentEmails.push(notification.emailAddress.toLowerCase());
            }

            // Process new emails
            let ticketsCreated = 0;
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
                            ownerEmail: notification.emailAddress, // Pass owner email for correct scoping
                        },
                        isFromAgent,
                        email.body // Pass email body for AI classification
                    );
                    ticketsCreated++;
                } catch (emailError) {
                    console.warn(`[Gmail Webhook] Error processing email ${email.id}:`, emailError);
                }
            }

            console.log(`[Gmail Webhook] Created ${ticketsCreated} tickets`);

            // Auto-classify new tickets
            if (ticketsCreated > 0) {
                try {
                    const classifyResult = await runAutoClassify({
                        limit: ticketsCreated,
                        businessId: tokenData.business_id,
                        userEmail: notification.emailAddress,
                        days: 1
                    });
                    console.log(`[Gmail Webhook] Classified ${classifyResult.success} tickets`);
                } catch (classifyError) {
                    console.warn('[Gmail Webhook] Classification error:', classifyError);
                }
            }
        }

        // Update sync state
        if (latestHistoryId) {
            await updateSyncState(notification.emailAddress, latestHistoryId);
        }

        const duration = Date.now() - startTime;
        console.log(`[Gmail Webhook] Completed in ${duration}ms`);

        return NextResponse.json({
            success: true,
            emailAddress: notification.emailAddress,
            newMessages: messageIds.length,
            duration,
        });

    } catch (error) {
        console.error('[Gmail Webhook] Error:', error);
        // Always return 200 to ACK the message (prevents Pub/Sub retries)
        return NextResponse.json({
            success: false,
            error: error instanceof Error ? error.message : String(error),
        });
    }
}

// Handle GET for health checks
export async function GET() {
    return NextResponse.json({
        status: 'ok',
        endpoint: 'Gmail Push Notification Webhook'
    });
}
