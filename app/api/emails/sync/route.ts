/**
 * Background sync endpoint for processing sent emails and generating embeddings
 * This endpoint processes emails in the background for faster initial setup
 */

import { NextRequest, NextResponse } from 'next/server';
import { getValidTokens } from '@/lib/token-refresh';
import { fetchSentEmails } from '@/lib/gmail';
import { loadStoredEmails, storeSentEmail, loadSyncState, saveSyncState, saveStoredEmails, SyncState, getCurrentUserEmail } from '@/lib/storage';
import { supabase } from '@/lib/supabase';
import { createEmailContext } from '@/lib/similarity';

// Don't use in-memory cache on Vercel (serverless instances don't share memory)
// Always read from Supabase to get the real state
async function getSyncState(): Promise<SyncState> {
  return await loadSyncState();
}

async function setSyncState(state: SyncState) {
  await saveSyncState(state);
}

export async function POST(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    // Cap maxResults at 600 to prevent processing too many emails
    // For business accounts, we distribute this across all connected accounts
    const requestedMax = parseInt(searchParams.get('maxResults') || '100');
    const maxResults = Math.min(requestedMax, 2000);

    // Check for business session first
    const { validateBusinessSession } = await import('@/lib/session');
    const businessSession = await validateBusinessSession();

    let sentEmails: any[] = [];
    let inboxEmails: any[] = [];
    let userEmail: string | null = null;

    if (businessSession) {
      console.log('[SYNC] Business session detected:', businessSession.businessId);
      const { fetchAllSentEmails, fetchAllInboxEmails } = await import('@/lib/email-service');
      const { loadBusinessTokens } = await import('@/lib/storage');

      // CRITICAL FIX: Distribute email limit fairly across all accounts
      // Get account count first to calculate per-account limit
      const accounts = await loadBusinessTokens(businessSession.businessId, businessSession.email);
      const accountCount = Math.max(accounts.length, 1); // At least 1 to avoid division by zero

      // Distribute limit evenly: each account gets maxResults / accountCount
      // Ensure minimum of 50 emails per account so smaller accounts aren't excluded
      const perAccountLimit = Math.max(Math.floor(maxResults / accountCount), 50);

      console.log(`[SYNC] Distributing ${maxResults} emails across ${accountCount} accounts (${perAccountLimit} per account)`);

      // Fetch from all accounts with fair distribution
      sentEmails = await fetchAllSentEmails(businessSession.businessId, perAccountLimit, businessSession.email);

      // Also fetch inbox emails to create tickets from them
      console.log('[SYNC] Fetching inbox emails to create tickets...');
      inboxEmails = await fetchAllInboxEmails(businessSession.businessId, perAccountLimit, undefined, businessSession.email);

      // Filter out spam/trash from inbox emails
      inboxEmails = inboxEmails.filter((email: any) => {
        const labels = email.labels || [];
        const blockedLabels = ['SPAM', 'TRASH'];
        return !labels.some((label: string) => blockedLabels.includes(label));
      });
      console.log(`[SYNC] Found ${inboxEmails.length} inbox emails (after filtering spam/trash)`);

      // Get the first account's email to use as the "primary" user for sync state
      // Reuse accounts variable from above (already loaded on line 46)
      if (accounts.length > 0) {
        userEmail = accounts[0].email;
      }
    } else {
      // Legacy flow: Single account (or personal account using session auth)
      let tokens = await getValidTokens();

      // FALLBACK: For personal accounts using session auth
      if (!tokens?.access_token) {
        const { validateBusinessSession, getSessionUserEmail } = await import('@/lib/session');
        const businessSession = await validateBusinessSession();

        if (businessSession?.email && !businessSession.businessId) {
          console.log('[SYNC] Personal account via session, trying loadBusinessTokens...');
          const { loadBusinessTokens } = await import('@/lib/storage');
          const connectedAccounts = await loadBusinessTokens(null, businessSession.email);
          if (connectedAccounts.length > 0) {
            tokens = connectedAccounts[0].tokens;
            console.log(`[SYNC] Found tokens via loadBusinessTokens for: ${connectedAccounts[0].email}`);
          }
        }
      }

      if (!tokens || !tokens.access_token) {
        return NextResponse.json(
          { error: 'Not authenticated. Please connect Gmail first.' },
          { status: 401 }
        );
      }

      sentEmails = await fetchSentEmails(tokens, maxResults);

      // Also fetch inbox emails to create tickets
      console.log('[SYNC] Fetching inbox emails to create tickets...');
      const { fetchInboxEmails } = await import('@/lib/gmail');
      inboxEmails = await fetchInboxEmails(tokens, maxResults);

      // CRITICAL FIX: Add ownerEmail context for personal accounts so tickets are scoped correctly
      // For business accounts, fetchAllInboxEmails already does this
      const currentUserEmail = await getCurrentUserEmail();
      if (currentUserEmail) {
        inboxEmails = inboxEmails.map((e: any) => ({ ...e, ownerEmail: currentUserEmail }));
      }

      // Filter out spam/trash
      inboxEmails = inboxEmails.filter((email: any) => {
        const labels = email.labels || [];
        const blockedLabels = ['SPAM', 'TRASH'];
        return !labels.some((label: string) => blockedLabels.includes(label));
      });
      console.log(`[SYNC] Found ${inboxEmails.length} inbox emails (after filtering spam/trash)`);

      userEmail = await getCurrentUserEmail();
    }

    // Use explicit userEmail for sync state operations
    const currentSyncState = await loadSyncState(userEmail || undefined);
    const isContinuing = currentSyncState.status === 'running';

    // Always process inbox emails for tickets, even when continuing (to catch any missed emails)
    // But only do full processing on first sync
    const shouldProcessInboxEmails = !isContinuing || inboxEmails.length > 0;

    console.log(`[SYNC] ${isContinuing ? 'Continuing' : 'Starting new'} sync job. Current state:`, {
      status: currentSyncState.status,
      processed: currentSyncState.processed,
      queued: currentSyncState.queued
    });

    // OPTIMIZED: Only check for emails with embeddings AND ownerEmail using a lightweight query
    // Emails without ownerEmail need to be regenerated for account-specific learning
    let emailsWithEmbeddings = new Set<string>();

    if (supabase && userEmail) {
      try {
        // Only fetch IDs that have embeddings AND ownerEmail (properly scoped)
        const { data: existingEmails } = await supabase
          .from('emails')
          .select('id, owner_email')
          .eq('is_sent', true)
          .eq('user_email', userEmail)
          .not('embedding', 'is', null) // Has embedding
          .not('owner_email', 'is', null); // Has ownerEmail (account scoped)

        if (existingEmails) {
          emailsWithEmbeddings = new Set(existingEmails.map((e: any) => e.id));
        }
      } catch (error) {
        console.warn('[Sync] Error checking existing emails, will check duplicates later:', error);
        // Fallback: load stored emails if lightweight query fails
        const storedEmails = await loadStoredEmails();
        emailsWithEmbeddings = new Set(
          storedEmails
            .filter(e => e.embedding && e.embedding.length > 0 && e.ownerEmail)
            .map(e => e.id)
        );
      }
    }

    // Filter out emails that already have embeddings AND ownerEmail
    // Emails without ownerEmail will be regenerated with proper account scoping
    const newEmails = sentEmails.filter(e => !emailsWithEmbeddings.has(e.id));

    if (newEmails.length === 0) {
      // Mark as complete if no new emails
      if (isContinuing) {
        await saveSyncState({
          ...currentSyncState,
          status: 'idle',
          finishedAt: Date.now(),
        }, userEmail || undefined);
      }
      return NextResponse.json({
        message: 'All emails already processed',
        processed: currentSyncState.processed || 0,
        total: sentEmails.length
      });
    }

    // Use existing job start time if continuing, otherwise create new
    const jobStartedAt = isContinuing ? (currentSyncState.startedAt || Date.now()) : Date.now();

    // Only reset processed to 0 when starting a NEW job (not continuing)
    // When continuing, keep the existing processed count
    await saveSyncState({
      status: 'running',
      queued: isContinuing ? (currentSyncState.queued || newEmails.length) : newEmails.length,
      processed: isContinuing ? (currentSyncState.processed || 0) : 0,
      errors: isContinuing ? (currentSyncState.errors || 0) : 0,
      startedAt: jobStartedAt,
      finishedAt: null,
    }, userEmail || undefined);

    // On Vercel, serverless functions have time limits (~10s free tier)
    // Process a batch synchronously (await it) so it completes within timeout
    // Frontend will call sync again to continue processing remaining emails
    const BATCH_SIZE = 50; // Process 50 emails per request (maximized for speed)
    const batchToProcess = newEmails.slice(0, BATCH_SIZE);
    const remainingEmails = newEmails.slice(BATCH_SIZE);

    console.log(`[SYNC] Processing batch: ${batchToProcess.length} emails, ${remainingEmails.length} remaining`);

    let batchProcessed = 0;
    let batchErrors = 0;

    if (batchToProcess.length > 0) {
      // Process this batch synchronously (await it so it completes before function returns)
      try {
        const result = await processEmailsBatch(batchToProcess, jobStartedAt);
        batchProcessed = result.processed;
        batchErrors = result.errors;
      } catch (err) {
        console.error('Email batch processing error:', err);
        batchErrors = batchToProcess.length;
      }
    }

    // Process inbox emails to create tickets (synchronous to ensure completion)
    // Process on first sync, or if we have inbox emails and not continuing a sent email sync
    if (shouldProcessInboxEmails && inboxEmails.length > 0) {
      console.log(`[SYNC] Creating tickets from ${inboxEmails.length} inbox emails (isContinuing: ${isContinuing})...`);
      const businessId = businessSession?.businessId || null;
      // For business accounts, use business session email; for personal accounts, use userEmail
      const emailForClassify = businessSession?.email || userEmail || null;
      try {
        await processInboxEmailsForTickets(inboxEmails, businessId, emailForClassify);
        console.log(`[SYNC] Finished processing inbox emails for tickets`);
      } catch (err) {
        console.error('[SYNC] Error creating tickets from inbox emails:', err);
        console.error('[SYNC] Error details:', err instanceof Error ? err.stack : err);
      }
    } else {
      console.log(`[SYNC] Skipping inbox email processing: shouldProcess=${shouldProcessInboxEmails}, inboxCount=${inboxEmails.length}, isContinuing=${isContinuing}`);
    }

    // Update state with progress
    const currentState = await getSyncState();
    const totalProcessed = (currentState.processed || 0) + batchProcessed;
    const totalErrors = (currentState.errors || 0) + batchErrors;
    const isComplete = remainingEmails.length === 0;

    await setSyncState({
      status: isComplete ? 'idle' : 'running',
      queued: newEmails.length,
      processed: totalProcessed,
      errors: totalErrors,
      startedAt: jobStartedAt,
      finishedAt: isComplete ? Date.now() : null,
    });

    return NextResponse.json({
      message: isComplete
        ? 'Email processing complete'
        : `Processed ${batchProcessed} emails. ${remainingEmails.length} remaining.`,
      queued: newEmails.length,
      processed: totalProcessed,
      remaining: remainingEmails.length,
      processing: !isComplete,
      continue: !isComplete, // Signal to frontend to call sync again
    });
  } catch (error) {
    console.error('Error syncing emails:', error);
    return NextResponse.json(
      { error: 'Failed to sync emails', details: (error as Error).message },
      { status: 500 }
    );
  }
}

/**
 * Process inbox emails to create tickets (non-blocking)
 * Only creates tickets for emails that don't already have tickets
 * Auto-classifies tickets in batches as they are created
 */
async function processInboxEmailsForTickets(inboxEmails: any[], businessId?: string | null, userEmailForClassify?: string | null): Promise<void> {
  console.log(`[SYNC] processInboxEmailsForTickets called with ${inboxEmails.length} emails, businessId: ${businessId}, userEmail: ${userEmailForClassify}`);

  // Filter emails by date - only process emails from the last 30-60 days
  // This prevents creating tickets for very old emails that are likely already resolved
  const DAYS_TO_SYNC = 60; // Configurable: 30 for more conservative, 60 for broader coverage
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - DAYS_TO_SYNC);

  const recentEmails = inboxEmails.filter(email => {
    try {
      const emailDate = new Date(email.date);
      return emailDate >= cutoffDate;
    } catch (error) {
      console.warn(`[SYNC] Invalid date for email ${email.id}: ${email.date}`);
      return false; // Skip emails with invalid dates
    }
  });

  console.log(`[SYNC] Filtered to ${recentEmails.length} recent emails (last ${DAYS_TO_SYNC} days) out of ${inboxEmails.length} total`);

  // Count unique threads
  // DEDUPLICATION FIX: Only process the latest email for each thread in this batch
  // This prevents race conditions where multiple emails for the same thread try to create a ticket simultaneously
  const latestEmailByThread = new Map();
  recentEmails.forEach(email => {
    const threadId = email.threadId || email.id;
    const existing = latestEmailByThread.get(threadId);
    if (!existing || new Date(email.date) > new Date(existing.date)) {
      latestEmailByThread.set(threadId, email);
    }
  });

  // Use the deduplicated list for processing
  const uniqueEmails = Array.from(latestEmailByThread.values());
  console.log(`[SYNC] Found ${latestEmailByThread.size} unique threads to process (deduplicated from ${recentEmails.length} emails)`);

  const uniqueThreads = new Set(uniqueEmails.map(e => e.threadId || e.id));

  const { ensureTicketForEmail } = await import('@/lib/tickets');

  // Get list of connected account emails to determine if email is from agent
  let agentEmails: string[] = [];
  try {
    const userEmail = await getCurrentUserEmail();
    console.log(`[SYNC] Current user email: ${userEmail}`);
    if (userEmail) {
      agentEmails.push(userEmail);
    }

    // For business accounts, also check all connected accounts
    if (businessId) {
      const { loadBusinessTokens } = await import('@/lib/storage');
      const accounts = await loadBusinessTokens(businessId);
      const accountEmails = accounts.map(acc => acc.email);
      console.log(`[SYNC] Found ${accounts.length} connected accounts: ${accountEmails.join(', ')}`);
      agentEmails.push(...accountEmails);
    }
  } catch (error) {
    console.warn('[SYNC] Error loading agent emails, using current user only:', error);
  }

  console.log(`[SYNC] Agent emails list: ${agentEmails.join(', ')}`);

  // Process in batches to avoid overwhelming the database
  const BATCH_SIZE = 20;
  let ticketsCreated = 0;
  let ticketsUpdated = 0;
  let ticketsSkipped = 0;

  // Get businessId and userEmail for auto-classify (needed for each batch)
  const businessIdForClassify = businessId || null;
  let emailForAutoClassify: string | null = userEmailForClassify || null;

  // If no email provided, try to get it from current user context
  if (!emailForAutoClassify) {
    try {
      emailForAutoClassify = await getCurrentUserEmail();
    } catch (err) {
      console.warn('[SYNC] Could not get user email for auto-classify:', err);
    }
  }

  // For business accounts, try to get email from business session if still not available
  if (!emailForAutoClassify && businessId) {
    const { validateBusinessSession } = await import('@/lib/session');
    const session = await validateBusinessSession();
    if (session) {
      emailForAutoClassify = session.email;
    }
  }

  if (!emailForAutoClassify) {
    console.warn('[SYNC] No user email available for auto-classify, skipping classification');
  } else {
    console.log(`[SYNC] Auto-classify will use email: ${emailForAutoClassify} (businessId: ${businessIdForClassify || 'personal'})`);
  }

  for (let i = 0; i < uniqueEmails.length; i += BATCH_SIZE) {
    const batch = uniqueEmails.slice(i, i + BATCH_SIZE);
    const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(uniqueEmails.length / BATCH_SIZE);
    console.log(`[SYNC] Processing batch ${batchNumber}/${totalBatches} (${batch.length} emails)`);

    // Process batch in parallel
    const results = await Promise.allSettled(
      batch.map(async (email) => {
        try {
          // Determine if email is from agent (check if from matches any connected account)
          // Extract email address from "Name <email@domain.com>" format
          const extractEmail = (emailStr: string) => {
            const match = emailStr?.match(/<([^>]+)>/) || emailStr?.match(/([^\s<>]+@[^\s<>]+)/);
            return match ? match[1].toLowerCase() : emailStr?.toLowerCase();
          };

          const emailFrom = extractEmail(email.from || '');
          const isFromAgent = agentEmails.some(agentEmail => {
            const agentEmailLower = agentEmail.toLowerCase();
            return emailFrom === agentEmailLower || emailFrom.includes(agentEmailLower) || email.from?.toLowerCase().includes(agentEmailLower);
          });

          console.log(`[SYNC] Email ${email.id}: from="${email.from}", isFromAgent=${isFromAgent}`);

          const ticket = await ensureTicketForEmail(
            {
              id: email.id,
              threadId: email.threadId,
              subject: email.subject,
              from: email.from,
              to: email.to,
              date: email.date,
              ownerEmail: email.ownerEmail, // CRITICAL FIX: Pass owner email for correct scoping
            },
            isFromAgent,
            email.body // Pass email body for AI classification
          );

          if (ticket) {
            // Check if this was a new ticket or existing one by checking if it was just created
            // (We can't easily tell, so we'll count all as created/updated)
            return { created: true, ticketId: ticket.id };
          }
          return { created: false, ticketId: null };
        } catch (error) {
          console.error(`[SYNC] Error creating ticket for email ${email.id} (thread: ${email.threadId}):`, error);
          return { created: false, ticketId: null, error: error instanceof Error ? error.message : String(error) };
        }
      })
    );

    // Count successful ticket creations/updates
    const successful = results.filter(r => r.status === 'fulfilled' && r.value?.created).length;
    const failed = results.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value?.created)).length;
    ticketsCreated += successful;
    ticketsSkipped += failed;

    console.log(`[SYNC] Batch ${batchNumber}/${totalBatches}: ${successful} tickets created/updated, ${failed} skipped/failed`);

    // Trigger auto-classification after each batch (runs during sync, works in production)
    if (successful > 0) {
      try {
        console.log(`[SYNC] Triggering auto-classification for batch ${batchNumber} (${successful} new tickets)...`);
        const { runAutoClassify } = await import('@/lib/auto-classify');

        // Run classification synchronously (await it) so it happens during sync
        // This ensures tickets are classified as they're created, not just at the end
        // Works for both business and personal accounts
        const classifyResult = await runAutoClassify({
          limit: Math.min(successful, 30), // Smaller batch size per sync batch
          businessId: businessIdForClassify,
          userEmail: emailForAutoClassify
        });

        console.log(`[SYNC] Batch ${batchNumber} auto-classification completed: ${classifyResult.processed} processed, ${classifyResult.success} successful, ${classifyResult.failed} failed`);
      } catch (error) {
        console.error(`[SYNC] Auto-classification error for batch ${batchNumber} (non-blocking):`, error);
        console.error(`[SYNC] Auto-classification error details:`, error instanceof Error ? error.stack : error);
        // Don't throw - continue processing batches even if classification fails
      }
    }

    // Small delay between batches to avoid rate limits
    if (i + BATCH_SIZE < uniqueEmails.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  const skippedOld = inboxEmails.length - recentEmails.length;
  console.log(`[SYNC] Ticket creation summary: ${ticketsCreated} tickets created/updated, ${ticketsSkipped} skipped/failed out of ${uniqueEmails.length} unique threads processed`);
}

/**
 * Process a batch of emails with parallel processing (for speed)
 * Returns the number processed so caller can track progress
 */
async function processEmailsBatch(emails: any[], startedAt: number): Promise<{ processed: number; errors: number }> {
  // Determine delay and concurrency based on embedding provider
  const provider = (process.env.EMBEDDING_PROVIDER || 'local').toLowerCase();
  const isLocal = provider === 'local';
  const embeddingApiKey = process.env.EMBEDDING_API_KEY;

  let processed = 0;
  let errors = 0;

  // For Hugging Face, use batch API calls (much faster - one API call for multiple embeddings)
  // For local, process individually
  if (!isLocal && embeddingApiKey && provider === 'huggingface') {
    // Process in batches of 20 for batch API calls (optimal batch size for HF)
    const BATCH_SIZE = 20;

    for (let i = 0; i < emails.length; i += BATCH_SIZE) {
      const batch = emails.slice(i, i + BATCH_SIZE);

      try {
        // Prepare email contexts for batch embedding
        const { generateEmbeddingsBatchHF } = await import('@/lib/embeddings');

        // Helper function to sanitize email body (same as in storage.ts)
        const sanitizeEmailBody = (text: string, maxLength: number): string => {
          if (!text) return '';
          const withoutScripts = text.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');
          const withoutTags = withoutScripts.replace(/<\/?[^>]+>/g, ' ');
          const normalized = withoutTags.replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
          return normalized.length <= maxLength ? normalized : normalized.slice(0, maxLength);
        };

        // Import intent extraction function
        const { extractEmailIntent, createEmailContextWithIntent } = await import('@/lib/ai-draft');
        
        const contexts = batch.map(email => {
          const trimmedBody = sanitizeEmailBody(email.body || '', 2000);
          // Use new intent-based context for better email type matching
          const intent = extractEmailIntent(email.subject, trimmedBody);
          return createEmailContextWithIntent(email.subject, trimmedBody, intent);
        });

        // Generate all embeddings in one API call (much faster!)
        const embeddings = await generateEmbeddingsBatchHF(contexts, embeddingApiKey);

        // Store emails with their embeddings
        for (let idx = 0; idx < batch.length; idx++) {
          const email = batch[idx];
          const embedding = embeddings[idx] || [];

          try {
            const isReply = email.isReply ?? /^(re|fwd?):\s*/i.test(email.subject || '');
            const trimmedBody = sanitizeEmailBody(email.body || '', 2000);

            // Extract owner email from the 'from' field (the account that sent this email)
            // This ensures embeddings are scoped per account for custom learning
            const extractEmailAddress = (emailStr: string): string => {
              const match = emailStr?.match(/<([^>]+)>/) || emailStr?.match(/([^\s<>]+@[^\s<>]+)/);
              return match ? match[1].toLowerCase() : emailStr?.toLowerCase() || '';
            };
            const ownerEmail = email.from ? extractEmailAddress(email.from) : undefined;

            const storedEmail = {
              ...email,
              body: trimmedBody,
              embedding,
              isSent: true,
              isReply: isReply,
              ownerEmail: ownerEmail, // Set owner email for account-specific scoping
            };

            // Save to database using upsert (more efficient than loading all emails)
            await saveStoredEmails([storedEmail]);
            processed++;
          } catch (saveError) {
            errors++;
            console.error(`Error saving email ${email.id}:`, saveError);
          }
        }
      } catch (batchError) {
        // If batch fails, fall back to individual processing
        console.warn('Batch embedding failed, falling back to individual:', batchError);
        for (const email of batch) {
          try {
            await storeSentEmail(email);
            processed++;
          } catch (err) {
            errors++;
            console.error(`Error processing email ${email.id}:`, err);
          }
        }
      }
    }
  } else {
    // For local or non-HF providers, process individually with high concurrency
    const CONCURRENCY = isLocal ? emails.length : 30;

    for (let i = 0; i < emails.length; i += CONCURRENCY) {
      const batch = emails.slice(i, i + CONCURRENCY);

      const results = await Promise.allSettled(
        batch.map(email => storeSentEmail(email))
      );

      for (let idx = 0; idx < results.length; idx++) {
        const result = results[idx];
        const email = batch[idx];

        if (result.status === 'fulfilled') {
          processed++;
        } else {
          errors++;
          console.error(`Error processing email ${email.id}:`, result.reason);
        }
      }
    }
  }

  return { processed, errors };
}

/**
 * Process emails in the background with embeddings (legacy - kept for compatibility)
 * This runs asynchronously so the API can return immediately
 * Optimized for parallel processing with local embeddings
 */
async function processEmailsInBackground(emails: any[], startedAt: number) {
  console.log(`Processing ${emails.length} emails in background...`);

  let processed = 0;
  let errors = 0;

  // Determine delay based on embedding provider
  const provider = (process.env.EMBEDDING_PROVIDER || 'local').toLowerCase();
  const isLocal = provider === 'local';
  const delayMs = isLocal ? 100 : 500; // Small delay between emails to prevent file conflicts

  // Process emails sequentially to avoid file write conflicts
  // This prevents corruption and ENOENT errors from concurrent writes
  for (let i = 0; i < emails.length; i++) {
    const email = emails[i];

    try {
      await storeSentEmail(email);
      processed++;
    } catch (error) {
      const errorMessage = (error as Error)?.message || String(error);

      // Only count as error if it's not a recoverable file system error
      const isRecoverableError =
        errorMessage.includes('ENOENT') ||
        errorMessage.includes('EEXIST') ||
        errorMessage.includes('EPERM') ||
        errorMessage.includes('no such file or directory');

      if (!isRecoverableError) {
        errors++;
        console.error(`Error processing email ${email.id}:`, error);
      } else {
        console.warn(`Recoverable error processing email ${email.id}:`, errorMessage);
        // Retry once for recoverable errors
        try {
          await new Promise(resolve => setTimeout(resolve, 200));
          await storeSentEmail(email);
          processed++;
        } catch (retryError) {
          errors++;
          console.error(`Error processing email ${email.id} after retry:`, retryError);
        }
      }
    }

    // Update sync state every 10 emails or at the end
    if (processed % 10 === 0 || i === emails.length - 1) {
      await setSyncState({
        status: 'running',
        queued: emails.length,
        processed,
        errors,
        startedAt,
        finishedAt: null,
      });
      console.log(`Processed ${processed}/${emails.length} emails...`);
    }

    // Small delay between emails to prevent file system conflicts
    if (i < emails.length - 1) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  // Keep the final processed count when finishing (don't reset to 0)
  // This way the UI shows the actual progress even after job completes
  await setSyncState({
    status: 'idle',
    queued: emails.length, // Keep original queued count
    processed, // Keep final processed count (not 0!)
    errors,
    startedAt,
    finishedAt: Date.now(),
  });

  console.log(`Background processing complete: ${processed} processed, ${errors} errors`);
}

/**
 * Get sync status
 */
export async function GET() {
  try {
    const userEmail = await getCurrentUserEmail();

    // OPTIMIZED: Use lightweight count query instead of loading all emails
    let allSentWithEmbeddings = 0;
    let repliesWithEmbeddings = 0;

    if (supabase && userEmail) {
      try {
        // Count all sent emails with embeddings
        const { count: allCount } = await supabase
          .from('emails')
          .select('*', { count: 'exact', head: true })
          .eq('is_sent', true)
          .eq('user_email', userEmail)
          .not('embedding', 'is', null);
        allSentWithEmbeddings = allCount || 0;

        // Count replies with embeddings
        const { count: repliesCount } = await supabase
          .from('emails')
          .select('*', { count: 'exact', head: true })
          .eq('is_sent', true)
          .eq('is_reply', true)
          .eq('user_email', userEmail)
          .not('embedding', 'is', null);
        repliesWithEmbeddings = repliesCount || 0;
      } catch (error) {
        console.warn('[Sync] Error counting emails with embeddings, using fallback:', error);
        // Fallback to loading all emails if count fails
        const storedEmails = await loadStoredEmails();
        allSentWithEmbeddings = storedEmails.filter(e => e.isSent && e.embedding.length > 0).length;
        repliesWithEmbeddings = storedEmails.filter(e => e.isSent && e.isReply && e.embedding.length > 0).length;
      }
    } else {
      // Fallback if no supabase or userEmail
      const storedEmails = await loadStoredEmails();
      allSentWithEmbeddings = storedEmails.filter(e => e.isSent && e.embedding.length > 0).length;
      repliesWithEmbeddings = storedEmails.filter(e => e.isSent && e.isReply && e.embedding.length > 0).length;
    }

    const syncState = await getSyncState();

    // Use syncState to determine "pending" so the UI isn't stuck if some
    // embeddings fail and are stored without vectors.
    const pendingFromJob =
      syncState.status === 'running'
        ? Math.max(0, syncState.queued - syncState.processed)
        : 0;

    // When sync is running, use the job's processed count
    // When not running, use the actual stored count
    const actualProcessed = syncState.status === 'running'
      ? (syncState.processed ?? 0)
      : allSentWithEmbeddings;

    // Get total stored count if needed for lastSync calculation
    let totalStored = 0;
    let lastSync: number | null = null;

    if (supabase && userEmail) {
      try {
        const { count: totalCount } = await supabase
          .from('emails')
          .select('*', { count: 'exact', head: true })
          .eq('is_sent', true)
          .eq('user_email', userEmail);
        totalStored = totalCount || 0;

        // Get most recent email date for lastSync
        const { data: recentEmail } = await supabase
          .from('emails')
          .select('date')
          .eq('is_sent', true)
          .eq('user_email', userEmail)
          .order('date', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (recentEmail?.date) {
          lastSync = new Date(recentEmail.date).getTime();
        }
      } catch (error) {
        console.warn('[Sync] Error getting total count:', error);
      }
    }

    return NextResponse.json({
      totalStored,
      sentWithEmbeddings: allSentWithEmbeddings, // All sent emails with embeddings
      completedReplies: repliesWithEmbeddings, // Replies with embeddings (for compatibility)
      pendingReplies: pendingFromJob,
      processing: syncState.status === 'running',
      queued: syncState.queued,
      processed: actualProcessed, // Use actual processed count
      errors: syncState.errors,
      startedAt: syncState.startedAt,
      finishedAt: syncState.finishedAt,
      lastSync
    });
  } catch (error) {
    console.error('Error getting sync status:', error);
    return NextResponse.json(
      { error: 'Failed to get sync status', details: (error as Error).message },
      { status: 500 }
    );
  }
}


