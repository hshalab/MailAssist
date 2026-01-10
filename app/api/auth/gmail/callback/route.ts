import { NextRequest, NextResponse } from 'next/server';
import { getTokensFromCode, getUserProfile } from '@/lib/gmail';
import { saveTokens } from '@/lib/storage';
import { setSessionUserEmailInResponse, setCurrentUserIdInResponse } from '@/lib/session';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { canLoginWithGoogle, getAccountInfo } from '@/lib/account-type-utils';

// Initialize Supabase client with service role for admin actions (creating users/sessions)
// Initialize Supabase client with service role for admin actions (creating users/sessions)
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = (supabaseUrl && supabaseKey)
  ? createClient(supabaseUrl, supabaseKey)
  : null;

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const code = searchParams.get('code');
    const error = searchParams.get('error');
    const stateParam = searchParams.get('state');

    if (!supabase) {
      console.error('Supabase client not initialized');
      return NextResponse.json({ error: 'Database connection unavailable' }, { status: 500 });
    }

    if (error) {
      return NextResponse.json(
        { error: 'Authentication failed', details: error },
        { status: 400 }
      );
    }

    if (!code) {
      return NextResponse.json(
        { error: 'No authorization code provided' },
        { status: 400 }
      );
    }

    // Parse state to determine mode
    let mode = 'connect'; // Default
    try {
      if (stateParam) {
        const state = JSON.parse(stateParam);
        if (state.mode) mode = state.mode;
      }
    } catch (e) {
      console.warn('Failed to parse state param, defaulting to connect mode');
    }

    console.log(`Processing OAuth callback in ${mode} mode...`);

    // Exchange code for tokens
    const tokens = await getTokensFromCode(code);

    if (!tokens || !tokens.access_token) {
      throw new Error('Failed to get access token from OAuth provider');
    }

    // Get user profile from Gmail to identify the user
    const profile = await getUserProfile(tokens);
    const gmailEmail = profile.emailAddress;

    if (!gmailEmail) {
      throw new Error('Failed to get email address from Gmail profile');
    }

    const frontendUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

    // ============================================================
    // NEW: Prevent connecting email already linked to another account
    // ============================================================
    const { data: existingToken } = await supabase
      .from('tokens')
      .select('business_id, user_email')
      .eq('user_email', gmailEmail)
      .maybeSingle();

    // Check if token exists to prevent duplicates (only in connect mode)
    if (existingToken && mode === 'connect') {
      const { validateBusinessSession } = await import('@/lib/session');
      const businessSession = await validateBusinessSession();

      // Validation:
      // 1. If existing token belongs to SAME business, it's a re-connection/refresh -> ALLOW
      // 2. If existing token belongs to NO business (personal) and current session is personal -> ALLOW (Update)

      const isSameBusiness = existingToken.business_id === (businessSession?.businessId || null);
      const isPersonalToPersonal = !existingToken.business_id && !businessSession?.businessId;

      // Block ONLY if:
      // - Existing token belongs to a DIFFERENT business
      // - Existing token belongs to a business, but current user is personal
      // - Existing token is personal, but current user is a DIFFERENT business

      if (!isSameBusiness && !isPersonalToPersonal) {
        console.warn(`[OAuth Connect] Blocked duplicate connection for ${gmailEmail}. Existing Business: ${existingToken.business_id}, Current Business: ${businessSession?.businessId}`);

        // Check if it's just a personal account switch (allow taking ownership of personal token if I have the credentials)
        // Security note: If I have the OAuth credentials for the account, I am the owner. 
        // The only risk is if I am 'stealing' a token from a business I don't belong to.
        if (existingToken.business_id) {
          return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/settings?error=email_already_connected`);
        }
      }

      // If we get here, it's a valid re-connection or update
      console.log(`[OAuth Connect] Updating existing token for ${gmailEmail}`);
    }

    // ============================================================
    // MODE: LOGIN (Sign in with Google / Create Personal Account)
    // ============================================================
    if (mode === 'login') {
      // Check if Google login is allowed for this email
      const googleLoginCheck = await canLoginWithGoogle(gmailEmail);

      if (!googleLoginCheck.canLogin) {
        // Business account with password exists - redirect with error
        const errorMsg = encodeURIComponent(googleLoginCheck.reason || 'Cannot login with Google');
        return NextResponse.redirect(`${frontendUrl}/auth/landing?view=login&error=${errorMsg}`);
      }

      // CRITICAL PRODUCTION FIX: Get old session info BEFORE account creation
      // This ensures we can delete old business sessions even when creating new personal account
      const { cookies: getCookies } = await import('next/headers');
      const cookieStore = await getCookies();
      const oldSessionToken = cookieStore.get('session_token')?.value;
      const oldUserId = cookieStore.get('current_user_id')?.value;
      const oldGmailEmail = cookieStore.get('gmail_user_email')?.value;

      console.log(`[OAuth Callback] Old session detected - token: ${oldSessionToken ? oldSessionToken.substring(0, 20) + '...' : 'none'}, userId: ${oldUserId || 'none'}, email: ${oldGmailEmail || 'none'}`);
      console.log(`[OAuth Callback] New login email: ${gmailEmail}`);

      // CRITICAL FIX: Prefer personal accounts for Google OAuth login
      // If user has both business and personal accounts, OAuth should access personal
      // Business accounts should use password login for better security
      const accountInfo = await getAccountInfo(gmailEmail, 'personal');
      let userId: string | undefined;
      let userName: string | undefined;
      let businessId: string | null = null;
      let accountCreatedInThisFlow = false; // Track if we create account in this OAuth flow

      // If account exists, use it
      if (accountInfo.exists && accountInfo.userId) {
        userId = accountInfo.userId;
        businessId = accountInfo.businessId || null;

        // SECURITY CHECK: Verify no duplicate users exist for this email
        const { data: allMatchingUsers, count: duplicateCount } = await supabase
          .from('users')
          .select('id, email, role, business_id, is_active')
          .eq('email', gmailEmail)
          .eq('is_active', true);

        if (duplicateCount && duplicateCount > 1) {
          console.warn(`[Gmail Callback] WARNING: Multiple active users found for ${gmailEmail}:`, allMatchingUsers);
          console.warn(`[Gmail Callback] Using user from getAccountInfo (prioritizes business owner): ${userId}`);
        }

        // Get user details
        const { data: existingUser } = await supabase
          .from('users')
          .select('*')
          .eq('id', userId)
          .single();

        if (existingUser) {
          // CRITICAL: Check if user is active
          if (!existingUser.is_active) {
            console.log('[Gmail Callback] Inactive user attempting OAuth login:', gmailEmail);
            const errorMsg = encodeURIComponent('Your account has been deactivated. Please contact your administrator.');
            return NextResponse.redirect(`${frontendUrl}/auth/landing?view=login&error=${errorMsg}`);
          }

          userName = existingUser.name;
          console.log('Found existing user:', gmailEmail, 'accountType:', accountInfo.accountType, 'businessId:', businessId, 'role:', existingUser.role);

          // SECURITY FIX: Only promote to admin if this is the business owner email
          // AND no other active admin exists for this business
          if (businessId && existingUser.role !== 'admin') {
            const { data: business } = await supabase
              .from('businesses')
              .select('business_email')
              .eq('id', businessId)
              .single();

            // Check if this email matches the business owner email
            const isBusinessOwner = business && business.business_email?.toLowerCase() === gmailEmail.toLowerCase();

            if (isBusinessOwner) {
              // Check if any other admin exists for this business
              const { data: existingAdmins, count: adminCount } = await supabase
                .from('users')
                .select('id', { count: 'exact' })
                .eq('business_id', businessId)
                .eq('role', 'admin')
                .eq('is_active', true)
                .neq('id', userId); // Exclude current user

              const shouldPromote = !adminCount || adminCount === 0;

              if (shouldPromote) {
                console.log('[Gmail Callback] Business owner email detected, promoting user to admin:', userId);
                const { error: updateError } = await supabase
                  .from('users')
                  .update({ role: 'admin' })
                  .eq('id', userId);

                if (updateError) {
                  console.error('[Gmail Callback] Error promoting user to admin:', updateError);
                } else {
                  console.log('[Gmail Callback] User promoted to admin successfully');
                  existingUser.role = 'admin';
                }
              } else {
                console.log('[Gmail Callback] Business owner detected but admin already exists, keeping current role:', existingUser.role);
              }
            } else {
              console.log('[Gmail Callback] Email does not match business owner, keeping role:', existingUser.role);
            }
          }
        }
      } else {
        // Create new personal account
        console.log('Creating new personal user for:', gmailEmail);
        accountCreatedInThisFlow = true; // Mark that we're creating account now

        // SECURITY FIX: Check if this is the first user (first user = admin, rest = agent)
        const { data: existingPersonalUsers, count: userCount } = await supabase
          .from('users')
          .select('id', { count: 'exact' })
          .is('business_id', null);

        const isFirstUser = !userCount || userCount === 0;
        const defaultRole = isFirstUser ? 'admin' : 'agent';

        console.log(`[OAuth Login] Creating new personal user with role: ${defaultRole} (first user: ${isFirstUser})`);

        const { data: newUser, error: createError } = await supabase
          .from('users')
          .insert({
            name: gmailEmail.split('@')[0], // Default name from email
            email: gmailEmail,
            role: defaultRole, // FIXED: First user is admin, rest are agents
            business_id: null, // Personal account - EXPLICITLY NULL
            is_email_verified: true,
            user_email: gmailEmail, // Critical for user selection!
            password_hash: 'GOOGLE_OAUTH', // Placeholder
          })
          .select()
          .single();

        if (createError) {
          throw new Error(`Failed to create user: ${createError.message}`);
        }
        userId = newUser.id;
        userName = newUser.name;
        businessId = null;

        // NEW: Initialize default settings for new personal account
        console.log('[OAuth Login] Initializing settings for new personal user:', gmailEmail);
        await supabase
          .from('user_settings')
          .insert({
            user_email: gmailEmail,
            auto_classify_days: 30
          });
      }

      // 3. Create Session
      // CRITICAL PRODUCTION FIX: Delete OLD session BEFORE creating new account
      // Must delete by old session token (not new userId) because new account might not exist yet
      // This prevents old business sessions from being used when creating new personal account

      // CRITICAL: ALWAYS delete old session token first, regardless of email match
      // This ensures old sessions are cleared before new ones are created
      if (oldSessionToken && supabase) {
        console.log(`[OAuth Callback] DELETING OLD SESSION TOKEN: ${oldSessionToken.substring(0, 20)}...`);
        const { error: deleteTokenError } = await supabase
          .from('user_sessions')
          .delete()
          .eq('session_token', oldSessionToken);

        if (deleteTokenError) {
          console.error('[OAuth Callback] Error deleting old session token:', deleteTokenError);
        } else {
          console.log(`[OAuth Callback] Old session token deleted successfully`);
        }
      }

      // CRITICAL: If logging in with a DIFFERENT email, we MUST delete all old sessions
      // This prevents cross-account contamination
      const isDifferentEmail = oldGmailEmail && oldGmailEmail.toLowerCase() !== gmailEmail.toLowerCase();

      if (isDifferentEmail) {
        console.log(`[OAuth Callback] ⚠️ DIFFERENT EMAIL DETECTED - Old: ${oldGmailEmail}, New: ${gmailEmail}`);
        console.log(`[OAuth Callback] DELETING ALL SESSIONS FOR OLD USER TO PREVENT CROSS-ACCOUNT ACCESS`);

        // Delete ALL sessions for the old email's user
        if (oldUserId && supabase) {
          console.log(`[OAuth Callback] Deleting ALL sessions for old user: ${oldUserId}`);
          const { error: deleteOldUserError } = await supabase
            .from('user_sessions')
            .delete()
            .eq('user_id', oldUserId);

          if (deleteOldUserError) {
            console.error('[OAuth Callback] Error deleting old user sessions:', deleteOldUserError);
          } else {
            console.log(`[OAuth Callback] All old user sessions deleted successfully`);
          }
        }
      }

      // Delete all sessions for new user (in case of re-login to same account)
      if (userId && supabase) {
        console.log(`[OAuth Callback] Deleting existing sessions for new user: ${userId}`);
        const { error: deleteNewUserError } = await supabase
          .from('user_sessions')
          .delete()
          .eq('user_id', userId);

        if (deleteNewUserError) {
          console.error('[OAuth Callback] Error deleting new user sessions:', deleteNewUserError);
        } else {
          console.log(`[OAuth Callback] New user sessions deleted successfully`);
        }
      }

      const sessionToken = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

      const { error: sessionError } = await supabase
        .from('user_sessions')
        .insert({
          user_id: userId,
          business_id: businessId,
          session_token: sessionToken,
          expires_at: expiresAt.toISOString(),
        });

      if (sessionError) {
        throw new Error(`Failed to create session: ${sessionError.message}`);
      }

      // 4. Set Cookies BEFORE creating redirect response
      // CRITICAL FIX: Setting cookies on redirect response doesn't work reliably in production
      // Must set cookies via cookies() API BEFORE redirect
      const { getCookieOptions } = await import('@/lib/cookie-config');
      const { cookies: setCookies } = await import('next/headers');
      const cookieStoreOAuth = await setCookies();

      const cookieMaxAge = 30 * 24 * 60 * 60; // 30 days in seconds
      const cookieOptionsWithMaxAge = getCookieOptions({
        httpOnly: true,
        expires: expiresAt,
        maxAge: cookieMaxAge
      });

      // Delete old cookies first
      console.log('[OAuth Callback] Deleting old cookies');
      cookieStoreOAuth.delete('session_token');
      cookieStoreOAuth.delete('current_user_id');
      cookieStoreOAuth.delete('gmail_user_email');
      cookieStoreOAuth.delete('user_id');

      // Set new cookies
      console.log(`[OAuth Callback] Setting new cookies - sessionToken: ${sessionToken.substring(0, 20)}..., userId: ${userId}, email: ${gmailEmail}`);

      cookieStoreOAuth.set('session_token', sessionToken, cookieOptionsWithMaxAge);
      cookieStoreOAuth.set('current_user_id', userId!, getCookieOptions({
        httpOnly: false,
        expires: expiresAt,
        maxAge: cookieMaxAge
      }));
      cookieStoreOAuth.set('gmail_user_email', gmailEmail, cookieOptionsWithMaxAge);
      cookieStoreOAuth.set('user_id', userId!, getCookieOptions({
        httpOnly: false,
        expires: expiresAt,
        maxAge: cookieMaxAge
      }));

      console.log(`[OAuth Callback] Cookies set via cookies() API`);

      // 5. Save Tokens (Linked to this user's business if they have one)
      await saveTokens(tokens, businessId || undefined, gmailEmail);

      // Get final user role after potential promotion
      const { data: finalUser } = await supabase
        .from('users')
        .select('role, name, email')
        .eq('id', userId)
        .single();

      // Create redirect URL (declared early so it's available for logging)
      let redirectUrl: string;
      if (accountCreatedInThisFlow) {
        redirectUrl = `${frontendUrl}/?auth=success&newAccount=true`;
      } else {
        redirectUrl = `${frontendUrl}/?auth=success`;
      }

      // Create redirect response with cookies
      const oauthRedirectResponse = NextResponse.redirect(redirectUrl);

      // Set cookies on redirect response
      oauthRedirectResponse.cookies.set('session_token', sessionToken, getCookieOptions({
        httpOnly: true,
        expires: expiresAt,
        maxAge: 30 * 24 * 60 * 60
      }));
      oauthRedirectResponse.cookies.set('current_user_id', userId!, getCookieOptions({
        httpOnly: false,
        expires: expiresAt,
        maxAge: 30 * 24 * 60 * 60
      }));
      oauthRedirectResponse.cookies.set('gmail_user_email', gmailEmail, getCookieOptions({
        httpOnly: true,
        expires: expiresAt,
        maxAge: 30 * 24 * 60 * 60
      }));
      oauthRedirectResponse.cookies.set('user_id', userId!, getCookieOptions({
        httpOnly: false,
        expires: expiresAt,
        maxAge: 30 * 24 * 60 * 60
      }));



      console.log('[OAuth Callback] ============ LOGIN COMPLETE ============');
      console.log('[OAuth Callback] Email:', gmailEmail);
      console.log('[OAuth Callback] User ID:', userId);
      console.log('[OAuth Callback] Business ID:', businessId);
      console.log('[OAuth Callback] Final Role:', finalUser?.role);
      console.log('[OAuth Callback] Account Created in This Flow:', accountCreatedInThisFlow);
      console.log('[OAuth Callback] Redirect:', redirectUrl);
      console.log('[OAuth Callback] Cookies Set:', {
        session_token: !!sessionToken,
        current_user_id: userId,
        gmail_user_email: gmailEmail,
      });
      console.log('[OAuth Callback] ==========================================');

      return oauthRedirectResponse;
    }

    // ============================================================
    // MODE: CONNECT (Link Gmail to existing account)
    // ============================================================
    else {
      // CRITICAL: Redirect back to inbox with success flag AND skeleton flag
      // This ensures the loading skeleton shows when user returns from OAuth
      // The skeleton flag will be checked by the frontend to show loading state
      const response = NextResponse.redirect(`${frontendUrl}/?auth=success&connected=true&showSkeleton=true`);

      // Check for active business session
      const { validateBusinessSession } = await import('@/lib/session');
      const businessSession = await validateBusinessSession();

      // CRITICAL FIX: If business session exists but no admin user in users table, create one
      if (businessSession?.businessId) {
        // Check if admin user exists for this business
        const { data: existingAdmin } = await supabase
          .from('users')
          .select('id')
          .eq('business_id', businessSession.businessId)
          .eq('role', 'admin')
          .eq('is_active', true)
          .maybeSingle();

        if (!existingAdmin) {
          // Get business details to create admin user
          const { data: business } = await supabase
            .from('businesses')
            .select('owner_name, business_email')
            .eq('id', businessSession.businessId)
            .single();

          if (business) {
            console.log('[Gmail Callback] Creating admin user for business:', businessSession.businessId);
            const { data: newAdmin, error: adminError } = await supabase
              .from('users')
              .insert({
                business_id: businessSession.businessId,
                name: business.owner_name,
                email: business.business_email,
                role: 'admin',
                is_active: true,
                is_email_verified: true,
                password_hash: null, // Business owner uses password from businesses table
              })
              .select()
              .single();

            if (adminError) {
              console.error('[Gmail Callback] Error creating admin user:', adminError);
            } else {
              console.log('[Gmail Callback] Admin user created successfully:', newAdmin.id);

              // NEW: Initialize settings for new business account
              console.log('[Gmail Callback] Initializing settings for new business:', businessSession.businessId);
              await supabase
                .from('user_settings')
                .insert({
                  business_id: businessSession.businessId,
                  auto_classify_days: 30
                });
            }
          }
        }
      }

      // Store tokens
      // If business session exists, link to business. Otherwise link to personal (via user_email scoping in saveTokens)
      // CRITICAL: Pass gmailEmail directly to saveTokens to avoid redundant getUserProfile call
      console.log(`[OAuth Connect] Saving tokens for ${gmailEmail}, businessId: ${businessSession?.businessId || 'personal'}`);
      const savedEmail = await saveTokens(tokens, businessSession?.businessId || undefined, gmailEmail);
      if (!savedEmail) {
        console.error(`[OAuth Connect] Failed to save tokens for ${gmailEmail}`);
        throw new Error('Failed to save tokens');
      }
      console.log(`[OAuth Connect] Successfully saved tokens for ${savedEmail}`);

      // ============================================================
      // SECURITY FIX: Removed automatic user creation
      // Users should be created via Team Management invitations only
      // Connecting Gmail should ONLY save tokens, not create user accounts
      // This prevents:
      // 1. Agent emails from appearing in inbox unexpectedly
      // 2. Automatic admin role assignment
      // 3. Duplicate user accounts
      // ============================================================
      console.log(`[OAuth Connect] Gmail connected successfully for ${gmailEmail}. Tokens saved.`);

      // CRITICAL: Trigger accounts refresh after reconnection
      // Dispatch event and set localStorage flag to refresh accounts list
      // Note: This will be picked up by the frontend after redirect
      console.log(`[OAuth Connect] Token saved, accounts should refresh on redirect`);

      // For personal accounts, update the shared_gmail_email field if user exists
      if (businessSession?.id && businessSession?.accountType === 'personal') {
        console.log(`[OAuth Connect] Updating personal user identity for ${gmailEmail} (User: ${businessSession.id})`);
        const { error: updateError } = await supabase
          .from('users')
          .update({
            shared_gmail_email: gmailEmail,
            // Keep the primary email as login handle, but link this Gmail for sync
          })
          .eq('id', businessSession.id);

        if (updateError) {
          console.error('[OAuth Connect] Error updating personal user identity:', updateError);
        } else {
          console.log(`[OAuth Connect] Successfully updated personal user identity for ${gmailEmail}`);
        }
      }

      // CRITICAL: Set session email cookie for PERSONAL accounts only
      // For personal accounts, we ALWAYS set it so loadTokens() and other APIs can find the tokens
      // Even if businessSession exists, if it's a personal account, we update the cookie
      if (!businessSession || businessSession.accountType === 'personal') {
        console.log('[OAuth Connect] Setting session email cookie for personal account:', gmailEmail);
        setSessionUserEmailInResponse(response, gmailEmail);
      } else {
        console.log('[OAuth Connect] Skipping session email cookie for business account (session unchanged)');
      }

      console.log('Gmail connected successfully:', gmailEmail);
      return response;
    }

  } catch (error) {
    console.error('Error in OAuth callback:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const frontendUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    return NextResponse.redirect(`${frontendUrl}?auth=error&message=${encodeURIComponent(errorMessage)}`);
  }
}
