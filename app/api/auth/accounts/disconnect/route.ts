import { NextRequest, NextResponse } from 'next/server';
import { validateBusinessSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

export async function POST(request: NextRequest) {
    try {
        // Check for business session
        const businessSession = await validateBusinessSession();

        if (!businessSession) {
            return NextResponse.json(
                { error: 'Not authenticated as a business' },
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
        // This deletion affects ALL users in the business (agents, managers, admins)
        // because emails/tickets are shared across the business
        
        // 1. Delete emails where owner_email or user_email matches
        // This will remove emails for ALL users in the business, not just the current user
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
            // Continue even if emails deletion fails (might not have emails column)
        } else {
            console.log(`[Disconnect] Deleted ALL emails for account: ${email} (affects all users in business ${businessSession.businessId})`);
        }

        // 2. Delete tickets where owner_email or user_email matches
        // This will remove tickets for ALL users in the business (agents, managers, admins)
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
            // Continue even if tickets deletion fails (might not have tickets column)
        } else {
            console.log(`[Disconnect] Deleted ALL tickets for account: ${email} (affects all users in business ${businessSession.businessId})`);
        }

        // 3. Delete drafts where user_email matches
        const { error: draftsError } = await supabase
            .from('drafts')
            .delete()
            .eq('user_email', email);

        if (draftsError) {
            console.error('Error deleting drafts:', draftsError);
            // Continue even if drafts deletion fails
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
            // Continue even if sync_state deletion fails
        } else {
            console.log(`[Disconnect] Deleted sync_state for account: ${email}`);
        }

        // 5. Finally, delete tokens for this specific email AND business
        const { error: tokensError } = await supabase
            .from('tokens')
            .delete()
            .eq('business_id', businessSession.businessId)
            .eq('user_email', email);

        if (tokensError) {
            console.error('Error deleting tokens:', tokensError);
            return NextResponse.json(
                { error: 'Failed to disconnect account' },
                { status: 500 }
            );
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
