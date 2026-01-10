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

      const accountInfo = await getAccountInfo(gmailEmail);
      let userId: string | undefined;
      let userName: string | undefined;
      let businessId: string | null = null;

      // If account exists, use it
      if (accountInfo.exists && accountInfo.userId) {
        userId = accountInfo.userId;
        businessId = accountInfo.businessId || null;

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

          // CRITICAL FIX: If this is a business account and the email matches the business owner email,
          // ensure the user is admin (they might have been created as agent)
          if (businessId && existingUser.role !== 'admin') {
            const { data: business } = await supabase
              .from('businesses')
              .select('business_email')
              .eq('id', businessId)
              .single();

            // Case-insensitive email comparison
            if (business && business.business_email?.toLowerCase() === gmailEmail.toLowerCase()) {
              console.log('[Gmail Callback] Business owner email detected, promoting user to admin:', userId, 'email:', gmailEmail, 'business_email:', business.business_email);
              const { error: updateError } = await supabase
                .from('users')
                .update({ role: 'admin' })
                .eq('id', userId);

              if (updateError) {
                console.error('[Gmail Callback] Error promoting user to admin:', updateError);
              } else {
                console.log('[Gmail Callback] User promoted to admin successfully');
                // Refresh user data to ensure role is updated
                const { data: updatedUser } = await supabase
                  .from('users')
                  .select('*')
                  .eq('id', userId)
                  .single();
                if (updatedUser) {
                  existingUser.role = 'admin';
                  console.log('[Gmail Callback] User role confirmed as admin:', updatedUser.role);
                }
              }
            } else {
              console.log('[Gmail Callback] Email does not match business owner:', {
                gmailEmail,
                businessEmail: business?.business_email,
                matches: business?.business_email?.toLowerCase() === gmailEmail.toLowerCase()
              });
            }
          }
        }
      } else {
        // Create new personal account
        console.log('Creating new personal user for:', gmailEmail);
        const { data: newUser, error: createError } = await supabase
          .from('users')
          .insert({
            name: gmailEmail.split('@')[0], // Default name from email
            email: gmailEmail,
            role: 'admin', // Default role is now admin
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

      // Create redirect response
      const redirectUrl = accountInfo.exists ? `${frontendUrl}/?auth=success` : `${frontendUrl}/?auth=success&newAccount=true`;
      const response = NextResponse.redirect(redirectUrl);

      // 4. Set Cookies
      const { getCookieOptions } = await import('@/lib/cookie-config')
      response.cookies.set('session_token', sessionToken, getCookieOptions({
        httpOnly: true,
        expires: expiresAt,
      }));

      // Use helper to set current_user_id with proper flags
      setCurrentUserIdInResponse(response, userId!);

      // Set gmail_user_email cookie for session management
      setSessionUserEmailInResponse(response, gmailEmail);

      // 5. Save Tokens (Linked to this user's business if they have one)
      await saveTokens(tokens, businessId || undefined);

      // Get final user role after potential promotion
      const { data: finalUser } = await supabase
        .from('users')
        .select('role, name, email')
        .eq('id', userId)
        .single();

      console.log('[OAuth Callback] Login successful for:', gmailEmail, 'businessId:', businessId);
      console.log('[OAuth Callback] User ID being set:', userId, 'Role:', finalUser?.role, 'Name:', finalUser?.name);
      console.log('[OAuth Callback] Cookies set:', {
        session_token: !!sessionToken,
        current_user_id: userId,
        gmail_user_email: gmailEmail,
        user_role: finalUser?.role,
        env: process.env.NODE_ENV,
        isVercel: process.env.VERCEL === '1'
      });
      return response;
    }

    // ============================================================
    // MODE: CONNECT (Link Gmail to existing account)
    // ============================================================
    else {
      // Redirect back to inbox with success flag to trigger sync
      const response = NextResponse.redirect(`${frontendUrl}/?auth=success&connected=true`);

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
      await saveTokens(tokens, businessSession?.businessId || undefined);

      // ============================================================
      // NEW: Automatic User Creation for connected Gmail account
      // ============================================================
      if (businessSession?.businessId) {
        console.log(`[OAuth Connect] Checking for user associated with ${gmailEmail} in business ${businessSession.businessId}`);

        // Check if user already exists for this email in this business
        const { data: existingUser } = await supabase
          .from('users')
          .select('id')
          .eq('business_id', businessSession.businessId)
          .eq('email', gmailEmail)
          .maybeSingle();

        if (!existingUser) {
          console.log(`[OAuth Connect] Creating new admin user identity for ${gmailEmail}`);
          const { error: createError } = await supabase
            .from('users')
            .insert({
              name: gmailEmail.split('@')[0],
              email: gmailEmail,
              role: 'admin', // Owner-connected accounts are always admin
              business_id: businessSession.businessId,
              shared_gmail_email: gmailEmail,
              user_email: gmailEmail,
              is_active: true,
              is_email_verified: true,
              password_hash: 'CONNECTED_ACCOUNT', // Placeholder
            });

          if (createError) {
            console.error('[OAuth Connect] Error creating user identity:', createError);
          } else {
            console.log(`[OAuth Connect] Successfully created admin user identity for ${gmailEmail}`);
          }
        } else {
          console.log(`[OAuth Connect] User already exists for ${gmailEmail}, skipping creation.`);
        }
      } else if (businessSession?.id && businessSession?.accountType === 'personal') {
        // For personal accounts, update the user identity with the connected Gmail
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
