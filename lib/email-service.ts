import { loadBusinessTokens } from './storage';
import { createEmailProvider, AccountConfig } from './provider-factory';
import { StoredEmail } from './storage';
import { Resend } from 'resend';

// Initialize Resend with API key (safe to be undefined, will just fail gracefully)
const resend = new Resend(process.env.RESEND_API_KEY);

export const sendEmail = {
  /**
   * Send OTP verification email
   */
  otp: async ({ to, businessName, ownerName, otpCode }: { to: string; businessName: string; ownerName: string; otpCode: string }) => {
    // If no API key, just log the OTP (dev mode)
    if (!process.env.RESEND_API_KEY) {
      console.log('=================================================================');
      console.log(`[DEV MODE] Sending OTP to ${to}`);
      console.log(`Business: ${businessName}`);
      console.log(`OTP Code: ${otpCode}`);
      console.log('=================================================================');
      return { success: true, id: 'dev-mode' };
    }

    try {
      const companyName = process.env.COMPANY_NAME || 'Mail Assistant';
      const fromEmail = process.env.EMAIL_FROM || 'onboarding@resend.dev';

      console.log(`[EmailService] Attempting to send OTP from: ${companyName} <${fromEmail}> to: ${to}`);

      const { data, error } = await resend.emails.send({
        from: `${companyName} <${fromEmail}>`,
        to,
        subject: `Your verification code for ${businessName}`,
        html: `
          <!DOCTYPE html>
          <html>
            <head>
              <style>
                body { font-family: sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
                .container { background: #f9fafb; border-radius: 12px; padding: 40px; text-align: center; }
                .code { font-size: 32px; font-weight: bold; letter-spacing: 5px; color: #4f46e5; margin: 20px 0; background: white; padding: 20px; border-radius: 8px; display: inline-block; }
                .footer { margin-top: 30px; font-size: 12px; color: #666; }
              </style>
            </head>
            <body>
              <div class="container">
                <h1>Verify your email</h1>
                <p>Hi ${ownerName},</p>
                <p>Use the code below to verify your email address for <strong>${businessName}</strong>.</p>
                
                <div class="code">${otpCode}</div>
                
                <p>This code will expire in 10 minutes.</p>
                
                <div class="footer">
                  <p>If you didn't request this, you can safely ignore this email.</p>
                </div>
              </div>
            </body>
          </html>
        `
      });

      console.log('[EmailService] Resend Response:', { data, error });

      if (error) {
        console.error('[EmailService] Resend API error:', error);
        throw new Error(error.message);
      }

      return { success: true, id: data?.id };
    } catch (error) {
      console.error('[EmailService] Failed to send OTP email:', error);
      throw error;
    }
  },

  /**
   * Send password reset email
   */
  passwordReset: async ({ to, userName, resetLink }: { to: string; userName: string; resetLink: string }) => {
    // If no API key, just log the link (dev mode)
    if (!process.env.RESEND_API_KEY) {
      console.log('=================================================================');
      console.log(`[DEV MODE] Password Reset for ${to}`);
      console.log(`User: ${userName}`);
      console.log(`Reset Link: ${resetLink}`);
      console.log('=================================================================');
      return { success: true, id: 'dev-mode' };
    }

    try {
      const companyName = process.env.COMPANY_NAME || 'Mail Assistant';
      const fromEmail = process.env.EMAIL_FROM || 'onboarding@resend.dev';

      console.log(`[EmailService] Sending password reset to: ${to}`);

      const { data, error } = await resend.emails.send({
        from: `${companyName} <${fromEmail}>`,
        to,
        subject: `Reset your password - ${companyName}`,
        html: `
          <!DOCTYPE html>
          <html>
            <head>
              <style>
                body { font-family: sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
                .container { background: #f9fafb; border-radius: 12px; padding: 40px; text-align: center; }
                .button { display: inline-block; background: #4f46e5; color: white !important; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: bold; margin: 20px 0; }
                .button:hover { background: #4338ca; }
                .footer { margin-top: 30px; font-size: 12px; color: #666; }
                .link { word-break: break-all; font-size: 12px; color: #666; margin-top: 20px; }
              </style>
            </head>
            <body>
              <div class="container">
                <h1>Reset Your Password</h1>
                <p>Hi ${userName},</p>
                <p>We received a request to reset your password. Click the button below to create a new password.</p>
                
                <a href="${resetLink}" class="button">Reset Password</a>
                
                <p>This link will expire in 1 hour.</p>
                
                <div class="link">
                  <p>Or copy this link: ${resetLink}</p>
                </div>
                
                <div class="footer">
                  <p>If you didn't request this, you can safely ignore this email. Your password will remain unchanged.</p>
                </div>
              </div>
            </body>
          </html>
        `
      });

      if (error) {
        console.error('[EmailService] Resend API error:', error);
        throw new Error(error.message);
      }

      return { success: true, id: data?.id };
    } catch (error) {
      console.error('[EmailService] Failed to send password reset email:', error);
      throw error;
    }
  }
};

export async function fetchAllInboxEmails(
  businessId: string | null,
  limit: number = 50,
  query?: string,
  userEmail?: string
): Promise<StoredEmail[]> {
  console.log(`[EmailService] Fetching inbox emails for business ${businessId} (User: ${userEmail || 'system'})`);
  const accounts = await loadBusinessTokens(businessId, userEmail);

  console.log(`[EmailService] Found ${accounts.length} accounts for business ${businessId}`);

  if (accounts.length === 0) {
    console.log('[EmailService] No accounts found for business');
    return [];
  }

  // CRITICAL FIX: Distribute limit evenly across accounts
  // The limit parameter is now per-account (calculated by caller)
  // This ensures fair distribution so all accounts get tickets created
  const perAccountLimit = limit; // Already calculated by caller

  console.log(`[EmailService] Fetching ${perAccountLimit} emails per account (${accounts.length} accounts)`);

  // Fetch from all accounts in parallel with fair distribution
  const results = await Promise.all(
    accounts.map(async ({ email, tokens }) => {
      try {
        let currentTokens = tokens;
        const providerType = (tokens.provider as any) || 'gmail';

        // Check for Gmail token expiry and refresh if needed
        if (providerType === 'gmail' && tokens.expiry_date && tokens.refresh_token) {
          const now = Date.now();
          if (now >= tokens.expiry_date - 5 * 60 * 1000) { // 5 min buffer
            console.log(`[EmailService] Refreshing expired Gmail token for ${email}`);
            try {
              const { getOAuth2Client } = await import('./gmail');
              const { saveTokens } = await import('./storage');

              const oauth2Client = getOAuth2Client();
              oauth2Client.setCredentials({
                refresh_token: tokens.refresh_token,
              });

              const { credentials } = await oauth2Client.refreshAccessToken();

              currentTokens = {
                ...tokens,
                access_token: credentials.access_token,
                expiry_date: credentials.expiry_date,
              };

              // Save refreshed tokens, preserving business association
              await saveTokens(currentTokens, businessId);
              console.log(`[EmailService] Token refreshed and saved for ${email}`);
            } catch (refreshError) {
              console.error(`[EmailService] Failed to refresh token for ${email}:`, refreshError);
              // Continue with old tokens, might fail but worth a try or just return empty
            }
          }
        }

        console.log(`[EmailService] Fetching inbox for ${email} (Provider: ${providerType}, Limit: ${perAccountLimit})`);

        const config: AccountConfig = {
          type: providerType,
          gmailTokens: currentTokens,
          imapConfig: tokens.imap_config,
          smtpConfig: tokens.smtp_config,
        };

        const provider = createEmailProvider(config);
        const emails = await provider.fetchInbox({ limit: perAccountLimit, query });

        console.log(`[EmailService] Successfully fetched ${emails.length} emails for ${email} (requested ${perAccountLimit})`);

        // Tag each email with the source account
        return emails.map(e => ({ ...e, ownerEmail: email }));
      } catch (error) {
        console.error(`[EmailService] Error fetching inbox for ${email}:`, error);
        return [];
      }
    })
  );

  // Flatten all emails
  const allEmailsFlat = results.flat();

  // CRITICAL FIX: Deduplicate emails by ID and threadId
  // When multiple accounts are connected, the same email might appear in multiple inboxes
  // (e.g., when CC'd, BCC'd, forwarded, or in shared mailboxes)
  const seenIds = new Set<string>();
  const deduplicatedEmails = allEmailsFlat.filter((email) => {
    // Create a unique key using both email ID and threadId for more robust deduplication
    const uniqueKey = `${email.id}|${email.threadId || email.id}`;

    if (seenIds.has(uniqueKey)) {
      console.log(`[EmailService] Skipping duplicate email: ${email.id} (Subject: ${email.subject})`);
      return false; // Skip this duplicate
    }

    seenIds.add(uniqueKey);
    return true; // Keep this email
  });

  // Sort by date (newest first)
  const allEmails = deduplicatedEmails.sort((a, b) => {
    const dateA = new Date(a.date || 0).getTime();
    const dateB = new Date(b.date || 0).getTime();
    return dateB - dateA;
  });

  console.log(`[EmailService] Total emails after deduplication: ${allEmails.length} (removed ${allEmailsFlat.length - allEmails.length} duplicates) from ${accounts.length} accounts`);
  return allEmails;
}

export async function fetchAllSentEmails(
  businessId: string | null,
  limit: number = 50,
  userEmail?: string
): Promise<StoredEmail[]> {
  console.log(`[EmailService] Fetching sent emails for business ${businessId}`);
  const accounts = await loadBusinessTokens(businessId, userEmail);

  if (accounts.length === 0) {
    return [];
  }

  // CRITICAL FIX: Distribute limit evenly across accounts
  // The limit parameter is now per-account (calculated by caller)
  const perAccountLimit = limit; // Already calculated by caller

  console.log(`[EmailService] Fetching ${perAccountLimit} sent emails per account (${accounts.length} accounts)`);

  // Fetch from all accounts in parallel with fair distribution
  const results = await Promise.all(
    accounts.map(async ({ email, tokens }) => {
      try {
        const config: AccountConfig = {
          type: (tokens.provider as any) || 'gmail',
          gmailTokens: tokens,
          imapConfig: tokens.imap_config,
          smtpConfig: tokens.smtp_config,
        };

        const provider = createEmailProvider(config);
        const emails = await provider.fetchSent({ limit: perAccountLimit });

        console.log(`[EmailService] Successfully fetched ${emails.length} sent emails for ${email} (requested ${perAccountLimit})`);

        // Tag each email with the source account
        return emails.map(e => ({ ...e, ownerEmail: email }));
      } catch (error) {
        console.error(`[EmailService] Error fetching sent emails for ${email}:`, error);
        return [];
      }
    })
  );

  // Flatten all emails
  const allEmailsFlat = results.flat();

  // CRITICAL FIX: Deduplicate emails by ID and threadId
  // When multiple accounts are connected, the same sent email might appear multiple times
  const seenIds = new Set<string>();
  const deduplicatedEmails = allEmailsFlat.filter((email) => {
    // Create a unique key using both email ID and threadId for more robust deduplication
    const uniqueKey = `${email.id}|${email.threadId || email.id}`;

    if (seenIds.has(uniqueKey)) {
      console.log(`[EmailService] Skipping duplicate sent email: ${email.id} (Subject: ${email.subject})`);
      return false; // Skip this duplicate
    }

    seenIds.add(uniqueKey);
    return true; // Keep this email
  });

  // Sort by date (newest first)
  const allEmails = deduplicatedEmails.sort((a, b) => {
    const dateA = new Date(a.date || 0).getTime();
    const dateB = new Date(b.date || 0).getTime();
    return dateB - dateA;
  });

  console.log(`[EmailService] Total sent emails after deduplication: ${allEmails.length} (removed ${allEmailsFlat.length - allEmails.length} duplicates) from ${accounts.length} accounts`);
  return allEmails;
}
