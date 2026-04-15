/**
 * Generate draft reply for a specific email
 */

import { NextRequest, NextResponse } from 'next/server';
import { getValidTokens } from '@/lib/token-refresh';
import { getEmailById, getThreadById } from '@/lib/gmail';
import { getSentEmails, storeDraft, loadDrafts, saveDrafts, loadStoredEmails } from '@/lib/storage';
import { supabase } from '@/lib/supabase';
import { generateDraftReply } from '@/lib/ai-draft';
import { listKnowledge } from '@/lib/knowledge';
import { getGuardrails } from '@/lib/guardrails';
import { getCurrentUserIdFromRequest, getSessionUserEmailFromRequest } from '@/lib/session';
import { checkDailyLimit, checkRateLimit, getRequestIdentity } from '@/lib/rate-limit';

type RouteContext =
  | { params: { id: string } }
  | { params: Promise<{ id: string }> };

export async function POST(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const paramsData = await Promise.resolve((context as any).params);
    let emailId = paramsData?.id;
    if (!emailId) {
      const segments = request.nextUrl.pathname.split('/');
      emailId = decodeURIComponent(segments[segments.length - 2] || '');
    }

    if (!emailId) {
      return NextResponse.json(
        { error: 'Missing email id' },
        { status: 400 }
      );
    }

    const openaiApiKey = process.env.OPENAI_API_KEY;

    // CRITICAL FIX: For invited users (agents) who don't have their own Gmail connected,
    // allow them to use business-connected email accounts for draft generation
    let userEmail = getSessionUserEmailFromRequest(request as any);

    if (!userEmail) {
      // Check if this is a business account user (invited agent/manager)
      const { validateBusinessSession } = await import('@/lib/session');
      const businessSession = await validateBusinessSession();

      if (businessSession?.businessId) {
        // For business accounts, use any connected account email from the business
        const { loadBusinessTokens } = await import('@/lib/storage');
        const connectedAccounts = await loadBusinessTokens(businessSession.businessId, businessSession?.email || undefined);
        if (connectedAccounts.length > 0) {
          userEmail = connectedAccounts[0].email;
          console.log(`[Draft API] Invited user has no Gmail, using business account email: ${userEmail}`);
        }
      } else if (businessSession?.email) {
        // FALLBACK: Personal account using session auth (businessId is null)
        // Try loading tokens using just the email
        const { loadBusinessTokens } = await import('@/lib/storage');
        const connectedAccounts = await loadBusinessTokens(null, businessSession.email);
        if (connectedAccounts.length > 0) {
          userEmail = connectedAccounts[0].email;
          console.log(`[Draft API] Personal account via session, using email: ${userEmail}`);
        }
      }
    }

    if (!userEmail) {
      return NextResponse.json(
        { error: 'Not authenticated. Please connect Gmail or ensure your business has connected email accounts.' },
        { status: 401 }
      );
    }

    if (!openaiApiKey) {
      return NextResponse.json(
        { error: 'OPENAI_API_KEY not configured' },
        { status: 500 }
      );
    }

    // Load and refresh tokens if needed
    // CRITICAL FIX: For invited users, try to get tokens from business-connected accounts
    let tokens = await getValidTokens();

    if (!tokens || !tokens.access_token) {
      // Check if this is a business account user (invited agent/manager)
      const { validateBusinessSession } = await import('@/lib/session');
      const businessSession = await validateBusinessSession();

      if (businessSession?.businessId) {
        // For business accounts, try to get tokens from business-connected accounts
        const { loadBusinessTokens } = await import('@/lib/storage');
        const connectedAccounts = await loadBusinessTokens(businessSession.businessId, businessSession?.email || undefined);
        if (connectedAccounts.length > 0) {
          // Use tokens from the first connected account
          tokens = connectedAccounts[0].tokens;
          console.log(`[Draft API] Using business account tokens for invited user`);
        }
      } else if (businessSession?.email) {
        // FALLBACK: Personal account using session auth (businessId is null)
        const { loadBusinessTokens } = await import('@/lib/storage');
        const connectedAccounts = await loadBusinessTokens(null, businessSession.email);
        if (connectedAccounts.length > 0) {
          tokens = connectedAccounts[0].tokens;
          console.log(`[Draft API] Using personal account tokens via session`);
        }
      }
    }

    if (!tokens || !tokens.access_token) {
      return NextResponse.json(
        { error: 'Not authenticated. Please connect Gmail or ensure your business has connected email accounts.' },
        { status: 401 }
      );
    }

    // Fetch the specific email
    const incomingEmail = await getEmailById(tokens, emailId);

    if (!incomingEmail) {
      return NextResponse.json(
        { error: 'Email not found' },
        { status: 404 }
      );
    }

    // Ensure userEmail is the connected Gmail account (for business accounts, this is already set above)
    // For consistency, also check getCurrentUserEmail() which handles business accounts correctly
    if (!userEmail) {
      const { getCurrentUserEmail } = await import('@/lib/storage');
      userEmail = await getCurrentUserEmail();
    }

    // Check per-account AI feature toggle
    const { getAccountAISettings } = await import('@/lib/ai-config');
    const aiSettings = await getAccountAISettings(userEmail, businessAccount?.businessId ?? null);
    if (!aiSettings.enable_ai_drafts) {
      return NextResponse.json(
        { error: 'AI draft generation is disabled for this account.' },
        { status: 403 }
      );
    }

    // Get current user ID for logging
    const userId = getCurrentUserIdFromRequest(request);
    const identity = userId || userEmail || getRequestIdentity(request.headers);
    const shortWindow = checkRateLimit(`draft:${identity}`, 20, 60 * 1000);
    if (!shortWindow.allowed) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Please wait before generating another draft.' },
        { status: 429 }
      );
    }
    const daily = await checkDailyLimit(`draft-daily:${identity}`, 30);
    if (!daily.allowed) {
      return NextResponse.json(
        { error: 'Daily draft limit reached for this account. Please try again tomorrow.' },
        { status: 429 }
      );
    }

    // Get current user's name for replacing placeholders in draft
    let userName: string | null = null;
    try {
      const { validateBusinessSession } = await import('@/lib/session');
      const businessSession = await validateBusinessSession();
      if (businessSession?.name) {
        userName = businessSession.name;
      } else if (userId) {
        const { getUserById } = await import('@/lib/users');
        const user = await getUserById(userId);
        if (user?.name) {
          userName = user.name;
        }
      }
    } catch (nameError) {
      console.warn('[Draft] Could not get user name for placeholder replacement:', nameError);
    }

    // OPTIMIZATION: Parallelize all data loading operations for faster draft generation
    // Load conversation thread, past emails, knowledge, guardrails, and ticket lookup in parallel
    const threadIdForContext = incomingEmail.threadId || incomingEmail.id;

    // Determine which account this incoming email belongs to
    // CRITICAL: For business accounts with multiple connected emails, we need to match
    // the incoming email's 'to' field against all connected accounts
    const extractEmailAddress = (emailStr: string): string => {
      const match = emailStr?.match(/<([^>]+)>/) || emailStr?.match(/([^\s<>]+@[^\s<>]+)/);
      return match ? match[1].toLowerCase() : emailStr?.toLowerCase() || '';
    };

    let accountEmail: string | null = null;
    
    // First, check if incoming email already has ownerEmail set (from sync)
    if ((incomingEmail as any).ownerEmail) {
      accountEmail = (incomingEmail as any).ownerEmail;
    } else {
      // Extract from 'to' field and match against connected accounts
      const incomingToEmail = incomingEmail.to ? extractEmailAddress(incomingEmail.to) : null;
      
      // For business accounts, check all connected accounts
      const { validateBusinessSession } = await import('@/lib/session');
      const businessSession = await validateBusinessSession();
      
      if (businessSession?.businessId) {
        const { loadBusinessTokens } = await import('@/lib/storage');
        const connectedAccounts = await loadBusinessTokens(businessSession.businessId, businessSession.email);
        
        // Find which connected account matches the incoming email's 'to' field
        if (incomingToEmail) {
          const matchingAccount = connectedAccounts.find(acc => {
            const accEmail = extractEmailAddress(acc.email);
            return accEmail === incomingToEmail || incomingToEmail.includes(accEmail) || accEmail.includes(incomingToEmail);
          });
          accountEmail = matchingAccount ? extractEmailAddress(matchingAccount.email) : incomingToEmail;
        } else {
          // Fallback: use first connected account or userEmail
          accountEmail = connectedAccounts.length > 0 ? extractEmailAddress(connectedAccounts[0].email) : userEmail;
        }
      } else {
        // Personal account: use incomingToEmail or userEmail
        accountEmail = incomingToEmail || userEmail;
      }
    }

    const [
      pastEmailsResult,
      threadResult,
      knowledgeResult,
      guardrailsResult,
      ticketResult
    ] = await Promise.allSettled([
      // Get past sent emails for style matching (limit to recent 50 for faster performance)
      // CRITICAL: Only load emails from the same account (ownerEmail) for custom per-account learning
      (async () => {
        const storedEmails = await loadStoredEmails({ 
          limit: 15, // Reduced to 15 to shrink prompt size and cut costs
          includeReceived: false,
          ownerEmail: accountEmail || undefined // Filter by account email for custom embeddings
        });
        return storedEmails.filter((email) => email.isSent && email.embedding.length > 0);
      })(),
      // Load conversation history (full thread) for better context
      // IMPORTANT: Always try to load thread to allow AI to reference past conversations
      (async () => {
        try {
          // Try to load thread - use threadId if available, otherwise try emailId as threadId
          const threadIdToLoad = incomingEmail.threadId || incomingEmail.id;
          if (threadIdToLoad) {
            const thread = await getThreadById(tokens, threadIdToLoad);
            const messages = thread.messages || [];
            // Filter out the current incoming email from the history (we'll show it separately)
            return messages.filter(msg => msg.id !== incomingEmail.id);
          }
          return [];
        } catch (threadError) {
          console.warn('[Draft] Could not load conversation thread for context:', threadError);
          return [];
        }
      })(),
      // Load knowledge base (scoped to current email account)
      listKnowledge(userEmail),
      // Load guardrails (scoped to current email account)
      getGuardrails(userEmail),
      // Try to find associated ticket for context
      (async () => {
        try {
          const { getTicketByThreadId } = await import('@/lib/tickets');
          if (incomingEmail.threadId && userEmail) {
            const ticket = await getTicketByThreadId(incomingEmail.threadId, userEmail);
            return ticket?.id || null;
          }
          return null;
        } catch (ticketError) {
          console.warn('[Draft] Could not find ticket for logging:', ticketError);
          return null;
        }
      })()
    ]);

    // Extract results from Promise.allSettled
    const pastEmails = pastEmailsResult.status === 'fulfilled' ? pastEmailsResult.value : [];
    const conversationMessages: {
      id: string;
      subject: string;
      from: string;
      to: string;
      body: string;
      date?: string;
    }[] = threadResult.status === 'fulfilled' ? threadResult.value : [];
    const knowledgeItems = knowledgeResult.status === 'fulfilled' ? knowledgeResult.value : [];
    const guardrails = guardrailsResult.status === 'fulfilled' ? guardrailsResult.value : null;
    const ticketId: string | null = ticketResult.status === 'fulfilled' ? ticketResult.value : null;

    // If no past emails, return a simple fallback draft
    if (pastEmails.length === 0) {
      console.warn(`[Draft] No past emails with embeddings found`);
      return NextResponse.json(
        {
          error: 'No past emails found for style matching. Please send some emails first.',
          draft: 'I received your email and will get back to you soon.' // Fallback draft
        },
        { status: 200 }
      );
    }

    // Ensure pastEmails have valid structure (safety check)
    const validPastEmails = pastEmails.filter(e => e && e.id && (e.embedding?.length > 0 || true)); // Allow emails without embeddings as fallback
    if (validPastEmails.length === 0) {
      console.warn(`[Draft] No valid past emails found after filtering`);
      return NextResponse.json(
        {
          error: 'No valid past emails found for style matching.',
          draft: 'I received your email and will get back to you soon.'
        },
        { status: 200 }
      );
    }

    // Check if this is a regeneration (query param or check if draft exists)
    const url = new URL(request.url);
    const isRegeneration = url.searchParams.get('regenerate') === 'true';

    // Check for existing draft for this email
    let existingDraftId: string | null = null;
    if (userEmail) {
      try {
        const drafts = await loadDrafts(userId || null);
        const existingDraft = drafts.find(d => d.emailId === (incomingEmail.id || emailId));
        if (existingDraft) {
          existingDraftId = existingDraft.id;
        }
      } catch (error) {
        console.warn('[Draft] Could not check for existing draft:', error);
      }
    }

    // CRITICAL: Fetch Shopify customer data if available (for personalized replies)
    let shopifyContext = '';
    try {
      const customerEmail = incomingEmail.from || incomingEmail.to;
      if (customerEmail && userEmail) {
        // Extract email from "Name <email@example.com>" format
        const emailMatch = customerEmail.match(/<(.+?)>/) || [null, customerEmail];
        const extractedEmail = emailMatch[1] || customerEmail;

        // Check if Shopify is configured and fetch customer data
        const { supabase } = await import('@/lib/supabase');
        if (supabase) {
          const { data: shopifyConfig } = await supabase
            .from('shopify_config')
            .select('shop_domain, access_token')
            .eq('user_email', userEmail)
            .limit(1)
            .maybeSingle();

          if (shopifyConfig && shopifyConfig.access_token) {
            const { getCustomerData } = await import('@/lib/shopify');
            const customerData = await getCustomerData(
              {
                shopDomain: shopifyConfig.shop_domain,
                accessToken: shopifyConfig.access_token,
              },
              extractedEmail
            );

            if (customerData.customer || customerData.recentOrders.length > 0) {
              const ordersInfo = customerData.recentOrders.slice(0, 3).map(order => {
                const orderDate = new Date(order.createdAt).toLocaleDateString();
                const orderTotal = order.totalPriceSet?.shopMoney?.amount || order.totalPrice || '0';
                const orderCurrency = order.totalPriceSet?.shopMoney?.currencyCode || 'USD';
                const orderStatus = order.fulfillmentStatus || order.financialStatus || 'unknown';
                // ShopifyLineItem has 'title' property, not 'name'
                const items = order.lineItems?.slice(0, 3).map(item => item.title || 'N/A').join(', ') || 'N/A';
                // ShopifyOrder has 'name' property (order number like "#1001")
                const orderName = order.name || 'N/A';
                // Order note is on the order, not customer
                const orderNote = order.note ? ` - Note: ${order.note}` : '';
                return `- Order #${orderName} (${orderDate}): ${orderCurrency} ${orderTotal} - Status: ${orderStatus} - Items: ${items}${orderNote}`;
              }).join('\n');

              shopifyContext = `\n\nSHOPIFY CUSTOMER INFORMATION (use this to personalize the reply):
Customer Name: ${customerData.customer?.firstName || ''} ${customerData.customer?.lastName || ''}
Total Spent: ${customerData.totalSpent || 0}
Total Orders: ${customerData.orders?.length || 0}
Recent Orders:
${ordersInfo || 'No recent orders'}
IMPORTANT: Use this information to personalize your response. Reference their order history, total spent, or specific orders when relevant. This helps build rapport and shows you understand their relationship with the business.`;
            }
          }
        }
      }
    } catch (shopifyError) {
      // Non-critical - continue without Shopify context
      console.warn('[Draft] Could not load Shopify customer data:', shopifyError);
    }

    // Generate draft reply
    let draft: string;
    try {
      draft = await generateDraftReply(
        incomingEmail,
        pastEmails,
        openaiApiKey,
        conversationMessages,
        knowledgeItems || [],
        guardrails,
        {
          userEmail,
          userId: userId || null,
          ticketId,
          draftId: existingDraftId || null, // Use existing draft ID if available
          isRegeneration: isRegeneration || !!existingDraftId, // Mark as regeneration if param set or existing draft found
          shopifyContext, // Pass Shopify context to AI
          userName, // Pass user name for placeholder replacement
        }
      );
    } catch (draftError) {
      console.error('[Draft] Error in generateDraftReply:', draftError);
      const errorMessage = draftError instanceof Error ? draftError.message : String(draftError);

      // If it's an OpenAI API error, provide more details
      if (errorMessage.includes('OpenAI API') || errorMessage.includes('401') || errorMessage.includes('403')) {
        return NextResponse.json(
          {
            error: 'Failed to generate draft',
            details: errorMessage,
            hint: 'Please check your OPENAI_API_KEY environment variable'
          },
          { status: 500 }
        );
      }

      throw draftError; // Re-throw to be caught by outer catch
    }

    // Save draft (upsert if regenerating)
    let savedDraft;
    try {
      if (existingDraftId && isRegeneration) {
        // Update existing draft
        const drafts = await loadDrafts(userId || null);
        const draftIndex = drafts.findIndex(d => d.id === existingDraftId);
        if (draftIndex >= 0) {
          drafts[draftIndex] = {
            ...drafts[draftIndex],
            draftText: draft,
            createdAt: new Date().toISOString(),
          };
          await saveDrafts(drafts, userId || null);
          savedDraft = drafts[draftIndex];
        } else {
          // Draft not found, create new one
          savedDraft = await storeDraft({
            emailId: incomingEmail.id || emailId,
            subject: incomingEmail.subject || '',
            from: incomingEmail.from || '',
            to: incomingEmail.to || '',
            originalBody: incomingEmail.body || incomingEmail.snippet || '',
            draftText: draft,
          }, userId || null);
        }
      } else {
        // Create new draft
        savedDraft = await storeDraft({
          emailId: incomingEmail.id || emailId,
          subject: incomingEmail.subject || '',
          from: incomingEmail.from || '',
          to: incomingEmail.to || '',
          originalBody: incomingEmail.body || incomingEmail.snippet || '',
          draftText: draft,
        }, userId || null);
      }

      // Update AI usage log with draft ID if we have it
      // Note: The log was created in generateDraftReply, but we can't update it easily
      // In a production system, you might want to query and update the most recent log
    } catch (storeError) {
      console.error('[Draft] Error storing draft:', storeError);
      // Still return the draft even if storing fails
      return NextResponse.json({
        draft,
        emailId: incomingEmail.id,
        subject: incomingEmail.subject,
        draftId: null,
        warning: 'Draft generated but could not be saved'
      });
    }

    return NextResponse.json({
      draft,
      emailId: incomingEmail.id,
      subject: incomingEmail.subject,
      draftId: savedDraft.id,
    });
  } catch (error) {
    console.error('[Draft] Unexpected error generating draft:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;

    return NextResponse.json(
      {
        error: 'Failed to generate draft',
        details: errorMessage,
        ...(errorStack && { stack: errorStack })
      },
      { status: 500 }
    );
  }
}

