/**
 * Regenerate embeddings for existing emails
 * Useful when:
 * - Adding account-specific scoping (ownerEmail)
 * - Updating embedding context (intent-based)
 * - Fixing missing embeddings
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserIdFromRequest } from '@/lib/permissions';
import { getCurrentUserEmail, loadStoredEmails, saveStoredEmails } from '@/lib/storage';
import { supabase } from '@/lib/supabase';
import { generateEmbedding } from '@/lib/embeddings';
import { extractEmailIntent, createEmailContextWithIntent } from '@/lib/ai-draft';

function sanitizeEmailBody(text: string, maxLength: number): string {
  if (!text) return '';
  const withoutScripts = text.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');
  const withoutTags = withoutScripts.replace(/<\/?[^>]+>/g, ' ');
  const normalized = withoutTags.replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
  return normalized.length <= maxLength ? normalized : normalized.slice(0, maxLength);
}

const extractEmailAddress = (emailStr: string): string => {
  const match = emailStr?.match(/<([^>]+)>/) || emailStr?.match(/([^\s<>]+@[^\s<>]+)/);
  return match ? match[1].toLowerCase() : emailStr?.toLowerCase() || '';
};

export async function POST(request: NextRequest) {
  try {
    const userId = getCurrentUserIdFromRequest(request);
    if (!userId) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    const userEmail = await getCurrentUserEmail();
    if (!userEmail) {
      return NextResponse.json(
        { error: 'No user email found' },
        { status: 400 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const { 
      force = false, // Force regeneration even if embedding exists
      limit = 500, // Increased default limit for batch processing
      onlyMissingOwnerEmail = true, // Only regenerate emails missing ownerEmail
      auto = false // Auto-regenerate all missing (for initial setup)
    } = body;

    if (!supabase) {
      return NextResponse.json(
        { error: 'Database not available' },
        { status: 500 }
      );
    }

    // Load emails that need regeneration
    let query = supabase
      .from('emails')
      .select('*')
      .eq('is_sent', true)
      .eq('user_email', userEmail);

    // Force mode overrides everything - regenerate ALL emails
    if (force) {
      // Force: get all emails (with limit)
      query = query.limit(limit);
    } else if (auto) {
      // Auto mode: Process all emails missing ownerEmail or embedding in batches
      // Don't set limit here - we'll process in chunks
      query = query.or('owner_email.is.null,embedding.is.null');
    } else if (onlyMissingOwnerEmail) {
      // Only get emails missing ownerEmail or embedding
      query = query.or('owner_email.is.null,embedding.is.null').limit(limit);
    } else {
      // Get emails missing embedding
      query = query.is('embedding', null).limit(limit);
    }

    const { data: emails, error: fetchError } = await query;

    if (fetchError) {
      console.error('[Regenerate] Error fetching emails:', fetchError);
      return NextResponse.json(
        { error: 'Failed to fetch emails', details: fetchError.message },
        { status: 500 }
      );
    }

    if (!emails || emails.length === 0) {
      console.log('[Regenerate] No emails found that need regeneration');
      return NextResponse.json({
        message: 'No emails need regeneration',
        processed: 0,
        total: 0
      });
    }

    console.log(`[Regenerate] Found ${emails.length} emails to regenerate (auto=${auto}, force=${force}, onlyMissingOwnerEmail=${onlyMissingOwnerEmail})`);

    let processed = 0;
    let errors = 0;
    const BATCH_SIZE = auto ? 20 : 10; // Larger batches for auto mode
    const totalBatches = Math.ceil(emails.length / BATCH_SIZE);

    console.log(`[Regenerate] Processing ${emails.length} emails in ${totalBatches} batches of ${BATCH_SIZE}`);
    console.error(`[Regenerate] START: Processing ${emails.length} emails in ${totalBatches} batches`); // Use console.error for immediate visibility

    // Process in batches
    for (let i = 0; i < emails.length; i += BATCH_SIZE) {
      const batch = emails.slice(i, i + BATCH_SIZE);
      const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
      console.log(`[Regenerate] Processing batch ${batchNumber}/${totalBatches} (${batch.length} emails)...`);
      console.error(`[Regenerate] BATCH ${batchNumber}/${totalBatches}: Starting...`); // Immediate visibility
      
      const results = await Promise.allSettled(
        batch.map(async (email: any) => {
          try {
            const trimmedBody = sanitizeEmailBody(email.body || '', 2000);
            
            // Extract ownerEmail from 'from' field if missing
            let ownerEmail = email.owner_email;
            if (!ownerEmail && email.from_address) {
              ownerEmail = extractEmailAddress(email.from_address);
            }

            // Generate new embedding with intent
            const intent = extractEmailIntent(email.subject || '', trimmedBody);
            const context = createEmailContextWithIntent(email.subject || '', trimmedBody, intent);
            // Use generateEmbedding with retry logic
            let embedding: number[];
            let lastError: Error | null = null;
            for (let attempt = 1; attempt <= 3; attempt++) {
              try {
                embedding = await generateEmbedding(context);
                break;
              } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                if (attempt < 3) {
                  await new Promise(resolve => setTimeout(resolve, 1500 * attempt));
                }
              }
            }
            if (!embedding!) {
              throw lastError || new Error('Failed to generate embedding');
            }

            // Update email with new embedding and ownerEmail
            const updatedEmail = {
              id: email.id,
              threadId: email.thread_id,
              subject: email.subject,
              from: email.from_address,
              to: email.to_address,
              body: trimmedBody,
              date: email.date,
              embedding,
              labels: email.labels || [],
              isSent: true,
              isReply: email.is_reply || false,
              ownerEmail: ownerEmail || undefined,
            };

            await saveStoredEmails([updatedEmail]);
            return { success: true, emailId: email.id };
          } catch (error) {
            console.error(`[Regenerate] Error processing email ${email.id}:`, error);
            throw error;
          }
        })
      );

      // Count results
      for (const result of results) {
        if (result.status === 'fulfilled') {
          processed++;
        } else {
          errors++;
        }
      }

      console.log(`[Regenerate] Batch ${batchNumber}/${totalBatches} complete: ${processed}/${emails.length} processed, ${errors} errors`);
      console.error(`[Regenerate] BATCH ${batchNumber}/${totalBatches} DONE: ${processed}/${emails.length} processed, ${errors} errors`); // Immediate visibility

      // Small delay between batches
      if (i + BATCH_SIZE < emails.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    console.log(`[Regenerate] Completed: ${processed} processed, ${errors} errors, ${emails.length} total emails`);
    console.error(`[Regenerate] ✅ COMPLETE: ${processed}/${emails.length} emails regenerated successfully, ${errors} errors`);
    
    // Verify a sample email was updated correctly
    if (processed > 0 && emails.length > 0) {
      try {
        const sampleEmail = emails[0];
        const { data: verifyEmail } = await supabase
          .from('emails')
          .select('embedding, owner_email')
          .eq('id', sampleEmail.id)
          .single();
        
        if (verifyEmail) {
          const hasEmbedding = verifyEmail.embedding && Array.isArray(verifyEmail.embedding) && verifyEmail.embedding.length > 0;
          const hasOwnerEmail = !!verifyEmail.owner_email;
          console.log(`[Regenerate] Verification: Sample email ${sampleEmail.id} - Embedding: ${hasEmbedding ? '✅' : '❌'}, OwnerEmail: ${hasOwnerEmail ? '✅' : '❌'}`);
        }
      } catch (verifyError) {
        console.warn('[Regenerate] Could not verify sample email:', verifyError);
      }
    }
    
    return NextResponse.json({
      message: 'Embeddings regenerated',
      processed,
      errors,
      total: emails.length,
      success: processed > 0
    });

  } catch (error) {
    console.error('[Regenerate] Error:', error);
    return NextResponse.json(
      { 
        error: 'Failed to regenerate embeddings',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}

