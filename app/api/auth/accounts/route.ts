import { NextResponse, NextRequest } from 'next/server';
import { validateBusinessSession } from '@/lib/session';
import { loadBusinessTokens, saveTokens, saveStoredEmails } from '@/lib/storage';
import { GenericEmailProvider } from '@/lib/generic-provider';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        // Check for business session first
        const businessSession = await validateBusinessSession();

        // Also check for personal session (session email without business)
        const { getSessionUserEmail } = await import('@/lib/session');
        const sessionEmail = (await getSessionUserEmail()) || businessSession?.email;

        console.log('[Accounts API] businessSession:', businessSession?.businessId, 'businessEmail:', businessSession?.email, 'sessionEmail:', sessionEmail);

        if (!businessSession && !sessionEmail) {
            return NextResponse.json(
                { error: 'Not authenticated' },
                { status: 401 }
            );
        }

        let accounts: Array<{ email: string, tokens: any }> = [];

        if (businessSession?.businessId) {
            // Business account - load all tokens for this business
            accounts = await loadBusinessTokens(businessSession.businessId, sessionEmail || undefined);
        } else if (businessSession || sessionEmail) {
            // Personal account - load tokens for all associated emails
            const { supabase } = await import('@/lib/supabase');
            if (supabase) {
                // For personal accounts, we check for tokens linked to:
                // 1. The email in the session/cookie
                // 2. The primary login email of the user
                const searchEmails = new Set<string>();
                if (sessionEmail) searchEmails.add(sessionEmail);
                if (businessSession?.email) searchEmails.add(businessSession.email);

                // Fetch user profile to get shared_gmail_email (robustness fix)
                if (businessSession?.id) {
                    const { data: userProfile } = await supabase
                        .from('users')
                        .select('shared_gmail_email')
                        .eq('id', businessSession.id)
                        .single();

                    if (userProfile?.shared_gmail_email) {
                        searchEmails.add(userProfile.shared_gmail_email);
                        console.log('[Accounts API] Added shared_gmail_email from profile:', userProfile.shared_gmail_email);
                    }
                }

                const emailsToQuery = Array.from(searchEmails);

                if (emailsToQuery.length > 0) {
                    const { data, error } = await supabase
                        .from('tokens')
                        .select('*')
                        .in('user_email', emailsToQuery)
                        .is('business_id', null);

                    console.log('[Accounts API] Token query for', emailsToQuery, '- found:', data?.length || 0);

                    if (!error && data) {
                        accounts = data.map((row: any) => ({
                            email: row.user_email,
                            tokens: {
                                access_token: row.access_token,
                                refresh_token: row.refresh_token,
                                expiry_date: row.expiry_date,
                                token_type: row.token_type,
                                scope: row.scope,
                                provider: row.provider || 'gmail',
                                imap_config: row.imap_config,
                                smtp_config: row.smtp_config,
                                updated_at: row.updated_at,
                            }
                        }));
                    }
                }
            }
        }

        // Return list of connected emails
        return NextResponse.json(
            {
                accounts: accounts.map(acc => ({
                    email: acc.email,
                    connectedAt: acc.tokens.updated_at || new Date().toISOString(),
                    status: 'connected',
                    provider: acc.tokens.provider || 'gmail'
                })),
                sessionEmail: sessionEmail || null
            },
            { headers: { 'Cache-Control': 'private, max-age=120, stale-while-revalidate=30' } }
        );

    } catch (error) {
        console.error('Error listing accounts:', error);
        return NextResponse.json(
            { error: 'Failed to list accounts' },
            { status: 500 }
        );
    }
}

export async function POST(request: NextRequest) {
    try {
        const businessSession = await validateBusinessSession();
        if (!businessSession) {
            return NextResponse.json(
                { error: 'Not authenticated as a business' },
                { status: 401 }
            );
        }

        const body = await request.json();
        const { provider, imapConfig, smtpConfig } = body;

        if (provider !== 'imap' || !imapConfig || !smtpConfig) {
            return NextResponse.json(
                { error: 'Invalid provider configuration' },
                { status: 400 }
            );
        }

        // Verify connection
        const emailProvider = new GenericEmailProvider(imapConfig, smtpConfig);
        const isConnected = await emailProvider.verifyConnection();

        if (!isConnected) {
            return NextResponse.json(
                { error: 'Failed to connect to email server. Please check your credentials.' },
                { status: 400 }
            );
        }

        // Save account
        const profile = await emailProvider.getProfile();

        // We reuse the 'tokens' structure to store the config
        await saveTokens({
            access_token: 'imap-placeholder', // Placeholder
            provider: 'imap',
            imap_config: imapConfig,
            smtp_config: smtpConfig,
            user_email: profile.email,
        }, businessSession.businessId, profile.email);

        // Trigger initial fetch
        try {
            const emails = await emailProvider.fetchInbox({ limit: 20 });
            await saveStoredEmails(emails);
        } catch (fetchError) {
            console.error('Error fetching initial emails:', fetchError);
            // Don't fail the request if fetch fails, just log it
        }

        return NextResponse.json({ success: true, email: profile.email });
    } catch (error) {
        console.error('Error adding account:', error);
        return NextResponse.json(
            { error: 'Failed to add account' },
            { status: 500 }
        );
    }
}
