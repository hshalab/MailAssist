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
}

export async function runAutoClassify(options: AutoClassifyOptions = {}): Promise<{
    processed: number;
    success: number;
    failed: number;
}> {
    try {
        const user = await getCurrentUser();
        if (!user) {
            throw new Error('Unauthorized');
        }

        // Fetch user settings for auto_classify_days
        let settingsQuery = supabase
            .from('user_settings')
            .select('auto_classify_days');

        if (user.accountType === 'business' && user.businessId) {
            settingsQuery = settingsQuery.eq('business_id', user.businessId);
        } else {
            settingsQuery = settingsQuery.eq('user_email', user.email);
        }

        const { data: settings } = await settingsQuery.maybeSingle();
        const defaultDays = settings?.auto_classify_days || 30;

        const days = options.days || defaultDays;
        const limit = Math.min(options.limit || 30, 50); // Default batch size: 30, max 50

        // Calculate cutoff date
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - days);

        // Build query based on account type
        let ticketsQuery = supabase
            .from('tickets')
            .select('id, subject, user_email, created_at')
            .is('department_id', null)
            .neq('status', 'closed')
            .gte('created_at', cutoffDate.toISOString());

        // Filter by account scope - works for both personal and business accounts
        if (user.accountType === 'business' && user.businessId) {
            // Business account: Get all tickets for connected Gmail accounts in this business
            // Get all connected account emails from tokens table
            const { data: tokens } = await supabase
                .from('tokens')
                .select('user_email')
                .eq('business_id', user.businessId)
                .not('user_email', 'is', null);

            if (tokens && tokens.length > 0) {
                // Get unique user emails from connected accounts
                const accountEmails = [...new Set(tokens.map(t => t.user_email).filter(Boolean))];
                
                console.log(`[Auto-Classify] Business account: Found ${accountEmails.length} connected accounts: ${accountEmails.join(', ')}`);
                
                if (accountEmails.length > 0) {
                    // Filter tickets by user_email matching any connected account
                    ticketsQuery = ticketsQuery.in('user_email', accountEmails);
                } else {
                    // Fallback: filter by current user's email
                    console.log(`[Auto-Classify] Business account: No connected accounts found, using user email: ${user.email}`);
                    ticketsQuery = ticketsQuery.eq('user_email', user.email);
                }
            } else {
                // Fallback: filter by current user's email
                console.log(`[Auto-Classify] Business account: No tokens found, using user email: ${user.email}`);
                ticketsQuery = ticketsQuery.eq('user_email', user.email);
            }
        } else {
            // Personal account: filter by user_email
            console.log(`[Auto-Classify] Personal account: Filtering by user email: ${user.email}`);
            ticketsQuery = ticketsQuery.eq('user_email', user.email);
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
        const businessId = user.accountType === 'business' && user.businessId ? user.businessId : null;
        const scopeEmail = businessId ? null : user.email;
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
                // Fetch the thread's first message to get body
                const { data: messages } = await supabase
                    .from('messages')
                    .select('body')
                    .eq('ticket_id', t.id)
                    .order('date', { ascending: true })
                    .limit(1)
                    .single();

                const bodyContent = messages?.body || '';

                return classifyTicketToDepartmentAsync(
                    t.id,
                    t.subject,
                    bodyContent,
                    t.user_email || user.email
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

