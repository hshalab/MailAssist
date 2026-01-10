import { NextRequest, NextResponse } from 'next/server';
import { validateBusinessSession, getSessionUserEmail } from '@/lib/session';
import { supabase } from '@/lib/supabase';

export async function POST(request: NextRequest) {
    try {
        // Check for business session OR personal session
        const businessSession = await validateBusinessSession();
        const sessionEmail = await getSessionUserEmail();

        if (!businessSession && !sessionEmail) {
            return NextResponse.json(
                { error: 'Not authenticated' },
                { status: 401 }
            );
        }

        const body = await request.json();
        const { email } = body;

        if (!email) {
            return NextResponse.json(
                { error: 'Email is required' },
                { status: 400 }
            );
        }

        if (!supabase) {
            return NextResponse.json(
                { error: 'Database connection failed' },
                { status: 500 }
            );
        }

        // CRITICAL: Delete all data associated with this email account
        console.log(`[Disconnect] Starting disconnect for email: ${email}, businessId: ${businessSession?.businessId || 'personal'}`);
        
        // 1. Delete emails where owner_email or user_email matches
        const { error: emailsError1, count: emailsCount1 } = await supabase
            .from('emails')
            .delete()
            .eq('owner_email', email)
            .select('*', { count: 'exact', head: true });
        
        const { error: emailsError2, count: emailsCount2 } = await supabase
            .from('emails')
            .delete()
            .eq('user_email', email)
            .select('*', { count: 'exact', head: true });

        if (emailsError1 || emailsError2) {
            console.error('Error deleting emails:', emailsError1 || emailsError2);
        } else {
            console.log(`[Disconnect] Deleted emails for account: ${email} (owner_email: ${emailsCount1 || 0}, user_email: ${emailsCount2 || 0})`);
        }

        // 2. Delete tickets where owner_email or user_email matches
        const { error: ticketsError1, count: ticketsCount1 } = await supabase
            .from('tickets')
            .delete()
            .eq('owner_email', email)
            .select('*', { count: 'exact', head: true });
        
        const { error: ticketsError2, count: ticketsCount2 } = await supabase
            .from('tickets')
            .delete()
            .eq('user_email', email)
            .select('*', { count: 'exact', head: true });

        if (ticketsError1 || ticketsError2) {
            console.error('Error deleting tickets:', ticketsError1 || ticketsError2);
        } else {
            console.log(`[Disconnect] Deleted tickets for account: ${email} (owner_email: ${ticketsCount1 || 0}, user_email: ${ticketsCount2 || 0})`);
        }

        // 3. Delete drafts where user_email matches
        const { error: draftsError, count: draftsCount } = await supabase
            .from('drafts')
            .delete()
            .eq('user_email', email)
            .select('*', { count: 'exact', head: true });

        if (draftsError) {
            console.error('Error deleting drafts:', draftsError);
        } else {
            console.log(`[Disconnect] Deleted drafts for account: ${email} (count: ${draftsCount || 0})`);
        }

        // 4. Delete sync_state where user_email matches
        const { error: syncStateError, count: syncStateCount } = await supabase
            .from('sync_state')
            .delete()
            .eq('user_email', email)
            .select('*', { count: 'exact', head: true });

        if (syncStateError) {
            console.error('Error deleting sync_state:', syncStateError);
        } else {
            console.log(`[Disconnect] Deleted sync_state for account: ${email} (count: ${syncStateCount || 0})`);
        }

        // 5. CRITICAL: Delete tokens - handle both business and personal accounts
        let tokensQuery = supabase
            .from('tokens')
            .delete()
            .eq('user_email', email);

        // For business accounts, only delete tokens for this business
        // For personal accounts, delete all tokens (business_id IS NULL)
        if (businessSession?.businessId) {
            tokensQuery = tokensQuery.eq('business_id', businessSession.businessId);
            console.log(`[Disconnect] Deleting tokens for business: ${businessSession.businessId}, email: ${email}`);
        } else {
            tokensQuery = tokensQuery.is('business_id', null);
            console.log(`[Disconnect] Deleting personal tokens for email: ${email}`);
        }

        const { error: tokensError, count: tokensCount } = await tokensQuery
            .select('*', { count: 'exact', head: true });

        if (tokensError) {
            console.error('Error deleting tokens:', tokensError);
            return NextResponse.json(
                { error: 'Failed to disconnect account' },
                { status: 500 }
            );
        }

        console.log(`[Disconnect] Successfully deleted ${tokensCount || 0} token(s) for account: ${email}`);

        // 6. Verify deletion - check if any tokens still exist
        let verifyQuery = supabase
            .from('tokens')
            .select('id, business_id, user_email')
            .eq('user_email', email);

        if (businessSession?.businessId) {
            verifyQuery = verifyQuery.eq('business_id', businessSession.businessId);
        } else {
            verifyQuery = verifyQuery.is('business_id', null);
        }

        const { data: remainingTokens } = await verifyQuery;

        if (remainingTokens && remainingTokens.length > 0) {
            console.error(`[Disconnect] WARNING: ${remainingTokens.length} token(s) still exist after deletion:`, remainingTokens);
            // Try to delete again with a more aggressive approach
            for (const token of remainingTokens) {
                await supabase.from('tokens').delete().eq('id', token.id);
            }
            console.log(`[Disconnect] Force-deleted remaining tokens`);
        } else {
            console.log(`[Disconnect] Verified: No tokens remain for email: ${email}`);
        }

        console.log(`[Disconnect] Successfully disconnected account: ${email} and deleted all associated data`);
        return NextResponse.json({ success: true });

    } catch (error) {
        console.error('Error in disconnect route:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}
