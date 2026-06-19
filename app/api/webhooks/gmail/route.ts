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

// Bumped on every behavior change so we can confirm in logs which version
// is actually running. If you see a webhook log without this version line,
// the deploy hasn't picked up the latest code.
const WEBHOOK_VERSION = 'v2-multi-token-2026-05-02b';

export async function POST(request: NextRequest) {
    const startTime = Date.now();
    console.log(`[Gmail Webhook ${WEBHOOK_VERSION}] Received push notification`);

    try {
        // Parse the Pub/Sub message
        const body: PubSubMessage = await request.json();

        if (!body.message?.data) {
            console.warn('[Gmail Webhook] Malformed Pub/Sub envelope: no message.data. Acking to prevent retries.', { keys: Object.keys(body || {}) });
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

        // Get token for this email address.
        // CRITICAL: We do NOT use .single() here. The same user_email can have
        // multiple rows in `tokens` — one with NULL business_id (personal) and
        // one with a business_id (workspace). PostgREST's .single() errors out
        // (PGRST116 "more than one row") in that case, which used to make the
        // webhook silently drop every notification for that account.
        // Strategy: case-insensitive match (Gmail Pub/Sub email casing has been
        // observed to vary), prefer the business-scoped row so downstream
        // agent-email lookups by business_id work, fall back to personal.
        const lookupEmail = notification.emailAddress.trim().toLowerCase();
        // SECURITY: escape LIKE metacharacters (% and _) before passing to ilike.
        // The email comes from the Pub/Sub payload; an unescaped '%' would turn the
        // lookup into a wildcard match and could return a DIFFERENT account's tokens.
        // Escaping keeps the intended case-insensitive exact match.
        const lookupPattern = lookupEmail.replace(/([\\%_])/g, '\\$1');
        const { data: tokenRows, error: tokenError } = await adminClient
            .from('tokens')
            .select('user_email, access_token, refresh_token, business_id')
            .ilike('user_email', lookupPattern)
            .order('business_id', { ascending: false, nullsFirst: false });

        console.log(`[Gmail Webhook ${WEBHOOK_VERSION}] Token lookup for ${lookupEmail} returned ${tokenRows?.length ?? 0} row(s); error=${tokenError ? tokenError.message : 'none'}`);

        if (tokenError) {
            console.error(`[Gmail Webhook ${WEBHOOK_VERSION}] Token lookup failed for ${lookupEmail}:`, tokenError);
            return NextResponse.json({ success: true }); // ACK to avoid retry storm
        }

        if (!tokenRows || tokenRows.length === 0) {
            console.log(`[Gmail Webhook ${WEBHOOK_VERSION}] No token found for ${lookupEmail}`);
            return NextResponse.json({ success: true }); // ACK
        }

        if (tokenRows.length > 1) {
            console.log(`[Gmail Webhook ${WEBHOOK_VERSION}] Found ${tokenRows.length} token rows for ${lookupEmail}; using business-scoped row first (business_id=${tokenRows[0].business_id ?? 'NULL'})`);
        }

        const tokenData = tokenRows[0];

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
        const { messageIds, spamMessageIds, latestHistoryId } = await getNewMessagesFromHistory(tokens, lastHistoryId);

        console.log(`[Gmail Webhook] ${messageIds.length} new inbox message(s), ${spamMessageIds.length} new spam message(s) for ${notification.emailAddress}`);

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

            // Process new inbox emails
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
                            ownerEmail: notification.emailAddress,
                        },
                        isFromAgent,
                        email.body,
                        false // not spam
                    );
                    ticketsCreated++;
                } catch (emailError) {
                    console.warn(`[Gmail Webhook] Error processing email ${email.id}:`, emailError);
                }
            }

            console.log(`[Gmail Webhook] Created ${ticketsCreated} inbox tickets`);

            // Auto-classify new tickets
            if (ticketsCreated > 0) {
                try {
                    const { isAIAutomationEnabled, getAccountAISettings } = await import('@/lib/ai-config');
                    if (!isAIAutomationEnabled()) {
                        console.log('[Gmail Webhook] AI_AUTOMATION_ENABLED=false — skipping classify');
                    } else {
                    const aiSettings = await getAccountAISettings(notification.emailAddress, tokenData.business_id);
                    if (!aiSettings.enable_auto_classify) {
                        console.log('[Gmail Webhook] Auto-classify disabled for this account — skipping');
                    } else {
                    const classifyResult = await runAutoClassify({
                        limit: Math.min(ticketsCreated, 3), // Cap at 3 per webhook event to control costs
                        businessId: tokenData.business_id,
                        userEmail: notification.emailAddress,
                        days: 1
                    });
                    console.log(`[Gmail Webhook] Classified ${classifyResult.success} tickets`);
                    } // end enable_auto_classify check
                    } // end isAIAutomationEnabled check
                } catch (classifyError) {
                    console.warn('[Gmail Webhook] Classification error:', classifyError);
                }
            }
        }

        // --- Process spam messages ---
        // Intentionally do NOT create tickets for spam automatically.
        // Tickets should be created only when users move selected emails
        // out of spam via the bulk-unspam flow.
        if (spamMessageIds.length > 0) {
            console.log(`[Gmail Webhook] Detected ${spamMessageIds.length} spam message(s); skipping ticket creation by design`);
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
        // CRITICAL: Loud error logging — this used to swallow silently and the
        // outage went undetected for days. ACK is intentional (200) so Pub/Sub
        // doesn't retry-storm us, but every error MUST be visible in Vercel logs.
        const message = error instanceof Error ? error.message : String(error);
        const stack = error instanceof Error ? error.stack : undefined;
        console.error('[Gmail Webhook] FATAL — failed to process notification', { message, stack });
        return NextResponse.json({
            success: false,
            error: message,
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
