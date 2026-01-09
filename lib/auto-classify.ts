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

        // Fetch unclassified, open, recent tickets
        const { data: tickets, error: fetchError } = await supabase
            .from('tickets')
            .select('id, subject, user_email, created_at')
            .is('department_id', null)
            .neq('status', 'closed')
            .gte('created_at', cutoffDate.toISOString())
            .limit(limit);

        if (fetchError) {
            console.error('[Auto-Classify] Fetch error:', fetchError);
            throw new Error(fetchError.message);
        }

        if (!tickets || tickets.length === 0) {
            return {
                processed: 0,
                success: 0,
                failed: 0,
            };
        }

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

