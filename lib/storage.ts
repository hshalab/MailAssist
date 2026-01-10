/**
 * Local storage handling for emails and embeddings
 * Uses file system to store data (JSON files)
 */

import crypto from 'crypto';
import { generateEmbedding } from './embeddings';
import { createEmailContext } from './similarity';
import { createClient } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { getValidTokens } from './token-refresh';
import { getUserProfile } from './gmail';
import { getSessionUserEmail, validateBusinessSession } from './session';

/**
 * Get current user's email address for data scoping
 * 1. Checks session cookie (Personal / Direct Connect)
 * 2. If cookie missing, checks Business Session -> Fetches Business's Connected Email
 */
export async function getCurrentUserEmail(): Promise<string | null> {
  try {
    // 1. Check for Business Session (Agents/Managers/Admins in Team Mode)
    const businessUser = await validateBusinessSession();

    if (businessUser && businessUser.businessId) {
      // Use Admin Client to bypass RLS for token lookup
      let adminClient = supabase;

      // Ensure we have a client before proceeding
      if (!adminClient && process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
        adminClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
          auth: { persistSession: false }
        });
      }

      if (adminClient) {
        // Find the primary email connected to this business
        const { data: tokenData } = await adminClient
          .from('tokens')
          .select('user_email')
          .eq('business_id', businessUser.businessId)
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (tokenData?.user_email) {
          // Priority: Return the Business Connected Email (e.g. support@company.com)
          // INSTEAD of the user's login email (e.g. agent@company.com)
          // This ensures everyone sees the shared mailbox data
          return tokenData.user_email;
        }
      }
    }

    // 2. Fallback: Session cookie (Personal / Direct Connect / No Business Token)
    const sessionEmail = await getSessionUserEmail();
    if (sessionEmail) {
      return sessionEmail;
    }

    return null;
  } catch (error) {
    return null;
  }
}

export interface StoredEmail {
  id: string;
  threadId?: string;
  subject: string;
  from: string;
  to: string;
  body: string;
  date: string;
  embedding: number[];
  labels?: string[];
  isSent: boolean; // true for sent emails, false for received
  isReply?: boolean;
  snippet?: string;
  ownerEmail?: string; // The account that received/sent this email
}

export interface StoredDraft {
  id: string;
  emailId: string;
  subject: string;
  from: string;
  to: string;
  originalBody: string;
  draftText: string;
  createdAt: string;
}

export interface StoredTokens {
  access_token?: string | null;
  refresh_token?: string | null;
  expiry_date?: number | null;
  token_type?: string | null;
  scope?: string | null;
  // New fields for multi-provider support
  provider?: 'gmail' | 'imap';
  imap_config?: any;
  smtp_config?: any;
  [key: string]: any;
}

export interface SyncState {
  status: 'idle' | 'running';
  queued: number;
  processed: number;
  errors: number;
  startedAt: number | null;
  finishedAt: number | null;
}

export const defaultSyncState: SyncState = {
  status: 'idle',
  queued: 0,
  processed: 0,
  errors: 0,
  startedAt: null,
  finishedAt: null,
};

/**
 * Load stored emails
 * OPTIMIZED: Supports filtering by email ID or limit for better performance
 */
export async function loadStoredEmails(options?: {
  emailId?: string;
  limit?: number;
  includeReceived?: boolean;
}): Promise<StoredEmail[]> {
  if (!supabase) {
    return [];
  }

  const userEmail = await getCurrentUserEmail();

  let query = supabase
    .from('emails')
    .select('*');

  // If specific email ID requested, use indexed query (much faster)
  if (options?.emailId) {
    query = query.eq('id', options.emailId);
  } else {
    // Only sent emails unless includeReceived is true
    if (!options?.includeReceived) {
      query = query.eq('is_sent', true);
    }
  }

  // Only filter by user_email if we have it and column exists
  if (userEmail) {
    query = query.eq('user_email', userEmail);
  }

  // Apply limit if specified (for pagination/caching)
  if (options?.limit) {
    query = query.limit(options.limit);
  }

  const { data, error } = await query.order('date', { ascending: false });

  if (error) {
    console.error('Error loading stored emails from Supabase:', error);
    return [];
  }

  // Map DB columns (snake_case) to StoredEmail (camelCase)
  return (data || []).map((row: any) => ({
    id: row.id,
    threadId: row.thread_id ?? undefined,
    subject: row.subject,
    from: row.from_address,
    to: row.to_address,
    body: row.body,
    date: row.date,
    embedding: row.embedding || [],
    labels: row.labels || [],
    isSent: row.is_sent,
    isReply: row.is_reply ?? undefined,
    snippet: row.snippet,
    ownerEmail: row.owner_email,
  }));
}

/**
 * Get a single email by ID (optimized)
 */
export async function getStoredEmailById(emailId: string): Promise<StoredEmail | null> {
  if (!supabase || !emailId) {
    return null;
  }

  const userEmail = await getCurrentUserEmail();

  let query = supabase
    .from('emails')
    .select('*')
    .eq('id', emailId)
    .limit(1);

  if (userEmail) {
    query = query.eq('user_email', userEmail);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    console.error('Error loading email by ID from Supabase:', error);
    return null;
  }

  if (!data) {
    return null;
  }

  // Map DB columns (snake_case) to StoredEmail (camelCase)
  return {
    id: data.id,
    threadId: data.thread_id ?? undefined,
    subject: data.subject,
    from: data.from_address,
    to: data.to_address,
    body: data.body,
    date: data.date,
    embedding: data.embedding || [],
    labels: data.labels || [],
    isSent: data.is_sent,
    isReply: data.is_reply ?? undefined,
  };
}

/**
 * Save emails
 */
export async function saveStoredEmails(emails: StoredEmail[], retries = 1) {
  if (!supabase || emails.length === 0) {
    return;
  }

  const userEmail = await getCurrentUserEmail();

  // OPTIMIZED: Batch upsert all emails at once instead of individual operations
  const payloads = emails.map((email) => {
    const payload: any = {
      id: email.id,
      thread_id: email.threadId ?? null,
      subject: email.subject,
      from_address: email.from,
      to_address: email.to,
      body: email.body,
      date: email.date,
      embedding: email.embedding,
      labels: email.labels ?? [],
      is_sent: email.isSent,
      is_reply: email.isReply ?? null,
      owner_email: email.ownerEmail,
      embedding_vector: email.embedding.length > 0 ? JSON.stringify(email.embedding) : null, // Save to new vector column
    };

    // Only add user_email if we have it (column might not exist yet)
    if (userEmail) {
      payload.user_email = userEmail;
    }

    return payload;
  });

  // Batch upsert (much faster than individual upserts)
  const { error } = await supabase
    .from('emails')
    .upsert(payloads, { onConflict: 'id' });

  if (error) {
    console.error('Error batch saving emails to Supabase:', error);
    // Fallback: try individual upserts if batch fails
    if (retries > 0) {
      console.warn('Batch upsert failed, retrying individually...');
      for (const email of emails) {
        const payload: any = {
          id: email.id,
          thread_id: email.threadId ?? null,
          subject: email.subject,
          from_address: email.from,
          to_address: email.to,
          body: email.body,
          date: email.date,
          embedding: email.embedding,
          labels: email.labels ?? [],
          is_sent: email.isSent,
          is_reply: email.isReply ?? null,
          snippet: email.snippet,
          owner_email: email.ownerEmail,
          embedding_vector: email.embedding.length > 0 ? JSON.stringify(email.embedding) : null, // Save to new vector column
        };
        if (userEmail) {
          payload.user_email = userEmail;
        }
        const { error: individualError } = await supabase
          .from('emails')
          .upsert(payload, { onConflict: 'id' });
        if (individualError) {
          console.error('Error saving email individually:', individualError, 'for email id', email.id);
        }
      }
    }
  }
}

export async function loadDrafts(userId?: string | null): Promise<StoredDraft[]> {
  if (!supabase) {
    return [];
  }

  const userEmail = await getCurrentUserEmail();

  let query = supabase.from('drafts').select('*');

  // Filter by created_by (user ID) if provided, otherwise fall back to user_email
  if (userId) {
    query = query.eq('created_by', userId);
  } else if (userEmail) {
    query = query.eq('user_email', userEmail);
  }

  const { data, error } = await query.order('created_at', { ascending: false });

  if (error) {
    console.error('Error loading drafts from Supabase:', error);
    return [];
  }

  return (data || []).map((row: any) => ({
    id: row.id,
    emailId: row.email_id,
    subject: row.subject,
    from: row.from,
    to: row.to,
    originalBody: row.original_body,
    draftText: row.draft_text,
    createdAt: row.created_at,
  }));
}

export async function saveDrafts(drafts: StoredDraft[], userId?: string | null) {
  if (!supabase) {
    return;
  }

  const userEmail = await getCurrentUserEmail();
  if (!userEmail) {
    console.error('Cannot save drafts: no user email');
    return;
  }

  const payload = drafts.map((draft) => ({
    id: draft.id,
    user_email: userEmail,
    created_by: userId || null, // Add created_by field for user-specific filtering
    email_id: draft.emailId,
    subject: draft.subject,
    from: draft.from,
    to: draft.to,
    original_body: draft.originalBody,
    draft_text: draft.draftText,
    created_at: draft.createdAt,
  }));

  const { error } = await supabase.from('drafts').upsert(payload, { onConflict: 'id' });
  if (error) {
    console.error('Error saving drafts to Supabase:', error);
  }
}

export async function deleteDraft(draftId: string, userId?: string | null) {
  if (!supabase) {
    return;
  }

  const userEmail = await getCurrentUserEmail();
  if (!userEmail) {
    console.error('Cannot delete draft: no user email');
    return;
  }

  let query = supabase.from('drafts').delete().eq('id', draftId);

  // Filter by created_by (user ID) if provided, otherwise fall back to user_email
  if (userId) {
    query = query.eq('created_by', userId);
  } else {
    query = query.eq('user_email', userEmail);
  }

  const { error } = await query;
  if (error) {
    console.error('Error deleting draft from Supabase:', error);
    throw error;
  }
}

/**
 * Store a sent email with its embedding
 * Optimized to handle errors gracefully
 */
export async function storeSentEmail(email: {
  id: string;
  threadId?: string;
  subject: string;
  from: string;
  to: string;
  body: string;
  date: string;
  labels?: string[];
  isReply?: boolean;
}) {
  // Quick check: if email already exists with embedding, skip it
  if (supabase) {
    try {
      const userEmail = await getCurrentUserEmail();
      let query = supabase
        .from('emails')
        .select('id, embedding')
        .eq('id', email.id)
        .eq('is_sent', true);

      if (userEmail) {
        query = query.eq('user_email', userEmail);
      }

      const { data: existingEmail } = await query.limit(1).maybeSingle();

      // If email exists and has embedding, return early (skip re-embedding)
      if (existingEmail && existingEmail.embedding && Array.isArray(existingEmail.embedding) && existingEmail.embedding.length > 0) {
        // Return the existing email structure (we'll need to load it fully if needed)
        return {
          id: email.id,
          threadId: email.threadId,
          subject: email.subject,
          from: email.from,
          to: email.to,
          body: email.body,
          date: email.date,
          embedding: existingEmail.embedding,
          labels: email.labels,
          isSent: true,
          isReply: email.isReply,
        } as StoredEmail;
      }
    } catch (error) {
      // If check fails, continue with normal flow
      console.warn('Could not check existing email, continuing with normal flow:', error);
    }
  }

  // Check if email exists using optimized query
  const existing = await getStoredEmailById(email.id);

  // Determine if this is a reply (check email.isReply or infer from subject)
  const isReply = email.isReply ?? /^(re|fwd?):\s*/i.test(email.subject || '');

  // Double-check: if existing email has embedding, skip
  if (existing && existing.embedding.length > 0) {
    return existing; // Already processed with embedding
  }

  const trimmedBody = sanitizeEmailBody(email.body || '', 2000);

  // Generate embeddings for ALL sent emails (not just replies)
  // This allows the AI to learn from the user's complete writing style
  try {
    const context = createEmailContext(email.subject, trimmedBody);
    // Use direct embedding generation (batch processing is handled at sync level)
    const embedding = await generateEmbeddingWithRetry(context);

    const storedEmail: StoredEmail = {
      ...email,
      body: trimmedBody,
      embedding,
      isSent: true,
      isReply: isReply,
    };

    // Save the email (upsert will handle existing)
    await saveStoredEmails([storedEmail]);
    return storedEmail;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[STORAGE] Error generating embedding for email ${email.id}:`, errorMessage);
    console.error('[STORAGE] Full error details:', error);
    console.error('[STORAGE] Stack trace:', error instanceof Error ? error.stack : 'N/A');

    // Store without embedding if embedding generation fails
    // This allows the app to continue working even if some embeddings fail
    const storedEmail: StoredEmail = {
      ...email,
      body: trimmedBody,
      embedding: [],
      isSent: true,
      isReply: isReply,
    };

    // Save the email (upsert will handle existing)
    await saveStoredEmails([storedEmail]);
    return storedEmail;
  }
}

/**
 * Store received emails (for reference, but don't generate embeddings for them)
 */
export async function storeReceivedEmail(email: {
  id: string;
  threadId?: string;
  subject: string;
  from: string;
  to: string;
  body: string;
  date: string;
  labels?: string[];
  isReply?: boolean;
}) {
  // We no longer persist inbound email bodies; callers can fetch fresh copies
  // directly from Gmail when needed for the UI.
  return null;
}

/**
 * Store a generated draft for later viewing
 */
export async function storeDraft(entry: {
  emailId: string;
  subject: string;
  from: string;
  to: string;
  originalBody: string;
  draftText: string;
}, userId?: string | null) {
  const drafts = await loadDrafts(userId);
  const newDraft: StoredDraft = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    ...entry,
  };

  drafts.unshift(newDraft);
  await saveDrafts(drafts, userId);
  return newDraft;
}

/**
 * Get all sent emails (for style matching)
 */
export async function getSentEmails(): Promise<StoredEmail[]> {
  const storedEmails = await loadStoredEmails();
  return storedEmails.filter((email) => email.isSent && email.embedding.length > 0);
}

/**
 * Load stored OAuth tokens for a specific user
 * @param userEmail - Optional user email to filter tokens. If not provided, uses session cookie.
 * @param businessId - Optional business ID to filter tokens.
 */
export async function loadTokens(userEmail?: string | null, businessId?: string): Promise<StoredTokens | null> {
  if (!supabase) {
    return null;
  }

  try {
    // Get user email from parameter or session cookie
    let targetUserEmail = userEmail;
    if (!targetUserEmail && !businessId) {
      targetUserEmail = await getSessionUserEmail();
    }

    let query = supabase
      .from('tokens')
      .select('*')
      .order('updated_at', { ascending: false });

    // CRITICAL: If businessId is provided, use ONLY businessId to find tokens
    // This is because tokens are stored under the business owner's email,
    // but agents have their own email - we need to find tokens by business, not by agent email
    if (businessId) {
      query = query.eq('business_id', businessId);
      // Do NOT filter by user_email when we have a businessId
    } else if (targetUserEmail) {
      // Only filter by user_email if we don't have a businessId (personal account flow)
      query = query.eq('user_email', targetUserEmail);
    }

    const { data, error } = await query.limit(1).maybeSingle();

    if (error) {
      // If error is about missing column, that's okay - user_email might not exist yet
      if (!error.message?.includes('column') && !error.message?.includes('user_email')) {
        console.error('Error loading tokens from Supabase:', error);
      }
      return null;
    }

    if (!data) {
      return null;
    }

    const tokens: StoredTokens = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expiry_date: data.expiry_date,
      token_type: data.token_type,
      scope: data.scope,
      provider: data.provider || 'gmail',
      imap_config: data.imap_config,
      smtp_config: data.smtp_config,
    };

    return tokens;
  } catch (error) {
    console.error('Error loading tokens:', error);
    return null;
  }
}

/**
 * Load ALL stored OAuth tokens for a business
 */
/* Existing code for loadBusinessTokens */
export async function loadBusinessTokens(businessId: string | null, userEmail?: string | null): Promise<Array<{ email: string, tokens: StoredTokens }>> {
  if (!supabase || (!businessId && !userEmail)) {
    console.log('[Storage] loadBusinessTokens: missing supabase or ids', { businessId, userEmail });
    return [];
  }

  try {
    // Bypass RLS using Service Role Key if available (for agents to read admin tokens)
    let adminClient = supabase;
    if (process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.NEXT_PUBLIC_SUPABASE_URL) {
      adminClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false }
      });
      console.log('[Storage] loadBusinessTokens: Using dedicated Service Role Client');
    }

    let query = adminClient
      .from('tokens')
      .select('*');

    // CRITICAL FIX: For business accounts, always fetch ALL tokens for the business
    // Ignore userEmail when businessId is provided - invited users (agents) need to see all business tokens
    if (businessId) {
      // Business account - fetch ALL tokens for this business (ignoring userEmail)
      query = query.eq('business_id', businessId);
      console.log(`[Storage] loadBusinessTokens: Loading ALL tokens for business ${businessId} (ignoring userEmail: ${userEmail})`);
    } else if (userEmail) {
      // Personal account - only user email provided
      query = query.eq('user_email', userEmail).is('business_id', null);
    } else {
      return [];
    }

    const { data, error } = await query;

    console.log(`[Storage] loadBusinessTokens query result:`, {
      businessId,
      userEmail,
      count: data?.length,
      error: error?.message,
      usingAdmin: adminClient !== supabase
    });

    if (error) {
      console.error('Error loading business tokens:', error);
      return [];
    }

    return (data || []).map((row: any) => ({
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
      }
    }));
  } catch (error) {
    console.error('Error loading business tokens:', error);
    return [];
  }
}

/**
 * Save OAuth tokens for a specific user
 * CRITICAL: Only deletes tokens for this user, not all users (prevents cross-user data access)
 * @param tokens - The OAuth tokens to save
 * @param businessId - Optional business ID to associate tokens with
 * @param userEmail - Optional user email (if provided, skips getUserProfile call)
 * @returns The user email if successful, null if failed
 */
export async function saveTokens(tokens: StoredTokens, businessId?: string | null, userEmail?: string | null): Promise<string | null> {
  if (!supabase) {
    console.error('Cannot save tokens: Supabase client not initialized');
    return null;
  }

  if (!tokens.access_token) {
    console.error('Cannot save tokens: no access_token provided');
    return null;
  }

  // Use provided email or try to get user email from Gmail profile
  let finalUserEmail: string | null = userEmail || null;
  
  if (!finalUserEmail) {
    try {
      const profile = await getUserProfile(tokens);
      finalUserEmail = profile?.emailAddress || null;
    } catch (error) {
      console.error('Error getting user profile in saveTokens:', error);
      // Continue to throw error below if we can't get email
    }
  }

  if (!finalUserEmail) {
    console.error('Cannot save tokens: unable to determine user email');
    throw new Error('User email is required to save tokens securely');
  }

  // CRITICAL SECURITY FIX: Only delete tokens for THIS user AND THIS CONTEXT
  // This prevents one user's login from affecting another user's session
  // and separates Personal (business_id=null) from Business (business_id=xyz) contexts
  try {
    let deleteQuery = supabase.from('tokens').delete().eq('user_email', finalUserEmail);

    if (businessId) {
      deleteQuery = deleteQuery.eq('business_id', businessId);
    } else {
      // For personal accounts, business_id is null
      deleteQuery = deleteQuery.is('business_id', null);
    }

    await deleteQuery;
  } catch (deleteError) {
    console.warn('Error deleting old tokens:', deleteError);
  }

  // Build insert payload (only include fields that definitely exist)
  const insertPayload: any = {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token ?? null,
    expiry_date: tokens.expiry_date ?? null,
    token_type: tokens.token_type ?? null,
    scope: tokens.scope ?? null,
    user_email: finalUserEmail, // Always include user_email for proper scoping
    provider: tokens.provider || 'gmail',
    imap_config: tokens.imap_config,
    smtp_config: tokens.smtp_config,
    business_id: businessId || null // Explicitly set business_id
  };

  // Try to insert tokens (after deleting old ones for this specific context)
  const { error } = await supabase.from('tokens').insert(insertPayload);

  if (error) {
    console.warn('Error saving tokens, checking for schema mismatch:', error.message);

    // Fallback: If error suggests missing columns (provider, imap_config, etc.), try saving without them
    // This handles the case where the user hasn't run the migration yet
    if (error.message?.includes('column') || error.message?.includes('provider') || error.message?.includes('imap_config')) {
      console.warn('Schema mismatch detected. Retrying with legacy schema (Gmail only)...');

      const legacyPayload = {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token ?? null,
        expiry_date: tokens.expiry_date ?? null,
        token_type: tokens.token_type ?? null,
        scope: tokens.scope ?? null,
        user_email: finalUserEmail,
        business_id: businessId
      };

      const { error: retryError } = await supabase.from('tokens').insert(legacyPayload);
      if (retryError) {
        console.error('CRITICAL: Failed to save tokens even with legacy schema:', retryError);
        throw retryError;
      }
      return finalUserEmail;
    }

    // If error is about user_email column not existing (very old schema), try without it
    if (error.message?.includes('user_email')) {
      console.warn('user_email column might not exist, retrying without it...');
      delete insertPayload.user_email;
      const { error: retryError } = await supabase.from('tokens').insert(insertPayload);
      if (retryError) {
        console.error('Error saving tokens to Supabase (after retry):', retryError);
        throw retryError;
      }
    } else {
      console.error('Error saving tokens to Supabase:', error);
      throw error;
    }
  }

  return finalUserEmail; // Return user email so caller can set session cookie
}

/**
 * Clear stored tokens (for logout)
 * Only clears tokens for the current user from session
 */
export async function clearTokens(userEmail?: string | null) {
  if (!supabase) {
    return;
  }

  const targetUserEmail = userEmail || await getCurrentUserEmail();
  if (!targetUserEmail) {
    return;
  }

  const { error } = await supabase.from('tokens').delete().eq('user_email', targetUserEmail);
  if (error) {
    console.error('Error clearing tokens from Supabase:', error);
  }
}

/**
 * Clear all stored data (emails, drafts, sync state, tokens)
 * Used when logging out to remove all user data
 */
export async function clearAllData() {
  if (!supabase) {
    return;
  }

  const userEmail = await getCurrentUserEmail();
  if (!userEmail) {
    return;
  }

  const tables = ['emails', 'drafts', 'sync_state', 'tokens'];

  for (const table of tables) {
    const { error } = await supabase.from(table).delete().eq('user_email', userEmail);
    if (error) {
      console.error(`Error clearing table ${table} in Supabase:`, error);
    }
  }
}

/**
 * Find similar emails using Supabase pgvector (RPC)
 * Replaces the in-memory cosine similarity
 */
export async function findSimilarEmailsVector(
  queryEmbedding: number[],
  matchThreshold: number = 0.5,
  matchCount: number = 5,
  userEmail: string
): Promise<Array<{ id: string; subject: string; body: string; similarity: number }>> {
  if (!supabase) return [];

  const { data, error } = await supabase.rpc('match_emails', {
    query_embedding: JSON.stringify(queryEmbedding), // Vector must be passed as string for some clients, or array
    match_threshold: matchThreshold,
    match_count: matchCount,
    filter_user_email: userEmail
  });

  if (error) {
    console.error('Error finding similar emails via pgvector:', error);
    return [];
  }

  return data || [];
}

async function generateEmbeddingWithRetry(text: string, attempts = 3): Promise<number[]> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await generateEmbedding(text);
    } catch (error) {
      lastError = error;
      const delay = 1500 * attempt;
      console.warn(`Embedding attempt ${attempt} failed; retrying in ${delay}ms`);
      await wait(delay);
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Failed to generate embedding');
}

function sanitizeEmailBody(text: string, maxLength: number): string {
  if (!text) return '';
  const withoutScripts = text.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');
  const withoutTags = withoutScripts.replace(/<\/?[^>]+>/g, ' ');
  const normalized = withoutTags.replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
  return truncateText(normalized, maxLength);
}

function truncateText(text: string, maxLength: number): string {
  if (!text) return '';
  return text.length <= maxLength ? text : text.slice(0, maxLength);
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function loadSyncState(explicitUserEmail?: string | null): Promise<SyncState> {
  if (!supabase) {
    return { ...defaultSyncState };
  }

  const userEmail = explicitUserEmail || await getCurrentUserEmail();

  let query = supabase.from('sync_state').select('*');
  if (userEmail) {
    query = query.eq('user_email', userEmail);
  }

  const { data, error } = await query.limit(1).maybeSingle();

  if (error) {
    console.error('Error loading sync state from Supabase:', error);
    return { ...defaultSyncState };
  }

  if (!data) {
    return { ...defaultSyncState };
  }

  return {
    status: (data.status as SyncState['status']) ?? defaultSyncState.status,
    queued: data.queued ?? defaultSyncState.queued,
    processed: data.processed ?? defaultSyncState.processed,
    errors: data.errors ?? defaultSyncState.errors,
    startedAt: data.started_at ? new Date(data.started_at).getTime() : null,
    finishedAt: data.finished_at ? new Date(data.finished_at).getTime() : null,
  };
}

export async function saveSyncState(state: SyncState, explicitUserEmail?: string | null) {
  if (!supabase) {
    return;
  }

  const userEmail = explicitUserEmail || await getCurrentUserEmail();
  if (!userEmail) {
    // If we can't identify the user, we can't save state
    return;
  }

  const payload = {
    user_email: userEmail,
    status: state.status,
    queued: state.queued,
    processed: state.processed,
    errors: state.errors,
    started_at: state.startedAt ? new Date(state.startedAt).toISOString() : null,
    finished_at: state.finishedAt ? new Date(state.finishedAt).toISOString() : null,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase.from('sync_state').upsert(payload, { onConflict: 'user_email' });

  if (error) {
    // Fallback: If updated_at column is missing, try saving without it
    if (error.message?.includes('column') && error.message?.includes('updated_at')) {
      console.warn('Schema mismatch: updated_at column missing in sync_state. Retrying without it...');
      const { updated_at, ...legacyPayload } = payload;
      const { error: retryError } = await supabase.from('sync_state').upsert(legacyPayload, { onConflict: 'user_email' });

      if (retryError) {
        console.error('Error saving sync state to Supabase (after retry):', retryError);
      }
    } else {
      console.error('Error saving sync state to Supabase:', error);
    }
  }
}


