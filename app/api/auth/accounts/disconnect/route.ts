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
        const { error: emailsError1 } = await supabase
            .from('emails')
            .delete()
            .eq('owner_email', email);
        
        const { error: emailsError2 } = await supabase
            .from('emails')
            .delete()
            .eq('user_email', email);

        if (emailsError1 || emailsError2) {
            console.error('Error deleting emails:', emailsError1 || emailsError2);
        } else {
            console.log(`[Disconnect] Deleted emails for account: ${email}`);
        }

        // 2. Delete tickets where owner_email or user_email matches
        const { error: ticketsError1 } = await supabase
            .from('tickets')
            .delete()
            .eq('owner_email', email);
        
        const { error: ticketsError2 } = await supabase
            .from('tickets')
            .delete()
            .eq('user_email', email);

        if (ticketsError1 || ticketsError2) {
            console.error('Error deleting tickets:', ticketsError1 || ticketsError2);
        } else {
            console.log(`[Disconnect] Deleted tickets for account: ${email}`);
        }

        // 3. Delete drafts where user_email matches
        const { error: draftsError } = await supabase
            .from('drafts')
            .delete()
            .eq('user_email', email);

        if (draftsError) {
            console.error('Error deleting drafts:', draftsError);
        } else {
            console.log(`[Disconnect] Deleted drafts for account: ${email}`);
        }

        // 4. Delete sync_state where user_email matches
        const { error: syncStateError } = await supabase
            .from('sync_state')
            .delete()
            .eq('user_email', email);

        if (syncStateError) {
            console.error('Error deleting sync_state:', syncStateError);
        } else {
            console.log(`[Disconnect] Deleted sync_state for account: ${email}`);
        }

        // 5. CRITICAL: Delete tokens - handle both business and personal accounts
        // First, find ALL tokens for this email to ensure we delete everything
        const { data: allTokensForEmail } = await supabase
            .from('tokens')
            .select('id, business_id, user_email')
            .eq('user_email', email);

        console.log(`[Disconnect] Found ${allTokensForEmail?.length || 0} token(s) for email: ${email}`);

        if (allTokensForEmail && allTokensForEmail.length > 0) {
            // For business accounts, delete tokens matching this business_id
            // For personal accounts, delete tokens where business_id IS NULL
            let tokensToDelete = allTokensForEmail;
            
            if (businessSession?.businessId) {
                tokensToDelete = allTokensForEmail.filter(t => t.business_id === businessSession.businessId);
                console.log(`[Disconnect] Filtering to ${tokensToDelete.length} token(s) for business: ${businessSession.businessId}`);
            } else {
                tokensToDelete = allTokensForEmail.filter(t => t.business_id === null);
                console.log(`[Disconnect] Filtering to ${tokensToDelete.length} personal token(s)`);
            }

            // Delete each token individually to ensure deletion
            let deletedCount = 0;
            for (const token of tokensToDelete) {
                const { error: deleteError } = await supabase
                    .from('tokens')
                    .delete()
                    .eq('id', token.id);
                
                if (deleteError) {
                    console.error(`[Disconnect] Error deleting token ${token.id}:`, deleteError);
                } else {
                    deletedCount++;
                }
            }

            console.log(`[Disconnect] Successfully deleted ${deletedCount} of ${tokensToDelete.length} token(s)`);

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
                // Try to delete again with a more aggressive approach - delete ALL tokens for this email
                const { error: forceDeleteError } = await supabase
                    .from('tokens')
                    .delete()
                    .eq('user_email', email);
                
                if (forceDeleteError) {
                    console.error(`[Disconnect] Force delete failed:`, forceDeleteError);
                } else {
                    console.log(`[Disconnect] Force-deleted all remaining tokens for email: ${email}`);
                }
            } else {
                console.log(`[Disconnect] Verified: No tokens remain for email: ${email}`);
            }
        } else {
            console.log(`[Disconnect] No tokens found for email: ${email}`);
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
