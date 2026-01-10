/**
 * AI draft generation using Groq API
 * Generates email drafts based on user's past email style and tone
 */

import { findSimilarEmails } from './similarity';
import { generateEmbedding } from './embeddings';
import { createEmailContext } from './similarity';
import { loadStoredEmails } from './storage';
import type { KnowledgeItem } from './knowledge';
import type { Guardrails } from './guardrails';
import { logAIUsage, logGuardrailUsage } from './analytics';

interface Email {
  id: string;
  subject: string;
  from: string;
  to: string;
  body: string;
  date?: string;
}

interface StoredEmail extends Email {
  embedding: number[];
}

/**
 * Generate a draft reply for an incoming email
 */
export async function generateDraftReply(
  incomingEmail: Email,
  pastEmails: StoredEmail[],
  groqApiKey: string,
  conversationMessages?: Email[],
  knowledgeItems: KnowledgeItem[] = [],
  guardrails?: Guardrails | null,
  options?: {
    userEmail?: string | null;
    userId?: string | null;
    ticketId?: string | null;
    draftId?: string | null;
    isRegeneration?: boolean;
    shopifyContext?: string;
  }
): Promise<string> {
  // OPTIMIZATION: Generate embedding with conversation context for better similarity matching
  // Include recent conversation context to find more relevant past emails
  let queryEmbedding: number[];
  try {
    // Include conversation context in embedding for better similarity matching
    const conversationContext = conversationMessages && conversationMessages.length > 0
      ? conversationMessages.slice(-3).map(m => m.body).join(' ')
      : '';
    const queryContext = createEmailContext(
      incomingEmail.subject, 
      `${incomingEmail.body} ${conversationContext}`.trim()
    );
    queryEmbedding = await generateEmbedding(queryContext);
  } catch (error) {
    console.error('Error generating embedding for incoming email:', error);
    // If embedding fails, still generate draft but without similarity matching
    queryEmbedding = [];
  }

  // Find similar past emails to match tone and style
  // If no embedding was generated, use first 5 past emails as fallback
  let similarEmails: Array<{ emailId: string; similarity: number; email: any }>;
  if (queryEmbedding.length > 0 && pastEmails.length > 0) {
    similarEmails = findSimilarEmails(
      queryEmbedding,
      pastEmails.map((email) => ({
        emailId: email.id,
        embedding: email.embedding,
        email,
      })),
      5 // Top 5 most similar emails
    );
    // If no similar emails found, use first few as fallback
    if (similarEmails.length === 0) {
      similarEmails = pastEmails.slice(0, 5).map((email) => ({
        emailId: email.id,
        email,
        similarity: 0.5, // Default similarity for fallback
      }));
    }
  } else {
    // Fallback: use first 5 past emails if embedding generation failed
    similarEmails = pastEmails.slice(0, 5).map((email) => ({
      emailId: email.id,
      email,
      similarity: 0.5, // Default similarity for fallback
    }));
  }

  // Build context from similar emails
  const styleExamples = similarEmails
    .map(
      (item) => `Subject: ${item.email.subject}\nBody: ${item.email.body}`
    )
    .join('\n\n---\n\n');


  // Fetch internal chat (notes) for this ticket if ticketId is provided
  let internalChatContext = '';
  if (options?.ticketId) {
    try {
      const { getTicketNotes } = await import('./ticket-notes');
      const notes = await getTicketNotes(options.ticketId);
      if (notes && notes.length > 0) {
        // Take up to the last 5 notes for context
        internalChatContext = '\n\nINTERNAL CHAT (for staff context only, never show to customer):\n' +
          notes.slice(-5).map(n => `${n.userName} (${n.createdAt}): ${n.content}`).join('\n---\n');
      }
    } catch (err) {
      console.warn('Could not load internal chat notes for AI context', err);
    }
  }

  // Create prompt for Groq, including optional conversation history, internal chat context, and Shopify data
  const relevantKnowledge = selectKnowledge(incomingEmail, knowledgeItems);
  const prompt = createDraftPrompt(
    incomingEmail,
    styleExamples,
    conversationMessages,
    relevantKnowledge,
    guardrails,
    options?.isRegeneration,
    internalChatContext,
    options?.shopifyContext
  );

  // Call Groq API and measure response time
  const startTime = Date.now();
  let draft = await callGroqAPI(prompt, groqApiKey);
  const responseTimeMs = Date.now() - startTime;
  
  // Track knowledge items used
  const knowledgeItemIds = relevantKnowledge.map(k => k.id).filter(Boolean) as string[];
  
  // Enforce guardrails and track usage
  const originalDraft = draft;
  draft = enforceGuardrailsOutput(draft, guardrails, {
    userEmail: options?.userEmail,
    userId: options?.userId,
    ticketId: options?.ticketId,
    draftId: options?.draftId,
  });

  // Log AI usage
  if (options?.userEmail) {
    logAIUsage({
      userEmail: options.userEmail,
      userId: options.userId || null,
      ticketId: options.ticketId || null,
      action: options.isRegeneration ? 'draft_regenerated' : 'draft_generated',
      draftId: options.draftId || null,
      knowledgeItemIds: knowledgeItemIds.length > 0 ? knowledgeItemIds : undefined,
      guardrailApplied: !!guardrails,
      guardrailBlocked: draft !== originalDraft,
      responseTimeMs,
      draftLength: draft.length,
      wasEdited: false,
      wasSent: false,
    });
  }

  return draft;
}

/**
 * Generate a draft for a new email (not a reply)
 */
export async function generateNewEmailDraft(
  recipientEmail: string,
  recipientName: string | null,
  subject: string,
  context: string,
  pastEmails: StoredEmail[],
  groqApiKey: string,
  knowledgeItems: KnowledgeItem[] = [],
  guardrails?: Guardrails | null,
  options?: {
    userEmail?: string | null;
    userId?: string | null;
    ticketId?: string | null;
    draftId?: string | null;
  }
): Promise<string> {
  // Generate embedding for the context
  let queryEmbedding: number[];
  try {
    const queryContext = `Subject: ${subject}\nContext: ${context}`;
    queryEmbedding = await generateEmbedding(queryContext);
  } catch (error) {
    console.error('Error generating embedding for new email context:', error);
    queryEmbedding = [];
  }

  // Find similar past emails to match tone and style
  let similarEmails: Array<{ emailId: string; similarity: number; email: any }>;
  if (queryEmbedding.length > 0 && pastEmails.length > 0) {
    similarEmails = findSimilarEmails(
      queryEmbedding,
      pastEmails.map((email) => ({
        emailId: email.id,
        embedding: email.embedding,
        email,
      })),
      5 // Top 5 most similar emails
    );
    // If no similar emails found, use first few as fallback
    if (similarEmails.length === 0) {
      similarEmails = pastEmails.slice(0, 5).map((email) => ({
        emailId: email.id,
        email,
        similarity: 0.5, // Default similarity for fallback
      }));
    }
  } else {
    // Fallback: use first 5 past emails if embedding generation failed
    similarEmails = pastEmails.slice(0, 5).map((email) => ({
      emailId: email.id,
      email,
      similarity: 0.5, // Default similarity for fallback
    }));
  }

  // Build context from similar emails
  const styleExamples = similarEmails
    .map(
      (item) => `Subject: ${item.email.subject}\nBody: ${item.email.body}`
    )
    .join('\n\n---\n\n');

  // Create prompt for Groq, including relevant knowledge
  const relevantKnowledge = selectKnowledgeForNewEmail(subject, context, knowledgeItems);
  const prompt = createNewEmailPrompt(recipientEmail, recipientName, subject, context, styleExamples, relevantKnowledge, guardrails);

  // Call Groq API and measure response time
  const startTime = Date.now();
  let draft = await callGroqAPI(prompt, groqApiKey);
  const responseTimeMs = Date.now() - startTime;
  
  // Track knowledge items used
  const knowledgeItemIds = relevantKnowledge.map(k => k.id).filter(Boolean) as string[];
  
  // Enforce guardrails and track usage
  const originalDraft = draft;
  draft = enforceGuardrailsOutput(draft, guardrails, {
    userEmail: options?.userEmail,
    userId: options?.userId,
    ticketId: options?.ticketId,
    draftId: options?.draftId,
  });

  // Log AI usage
  if (options?.userEmail) {
    logAIUsage({
      userEmail: options.userEmail,
      userId: options.userId || null,
      ticketId: options.ticketId || null,
      action: 'draft_generated',
      draftId: options.draftId || null,
      knowledgeItemIds: knowledgeItemIds.length > 0 ? knowledgeItemIds : undefined,
      guardrailApplied: !!guardrails,
      guardrailBlocked: draft !== originalDraft,
      responseTimeMs,
      draftLength: draft.length,
      wasEdited: false,
      wasSent: false,
    });
  }

  return draft;
}

/**
 * Create prompt for new email generation
 */
function createNewEmailPrompt(
  recipientEmail: string,
  recipientName: string | null,
  subject: string,
  context: string,
  styleExamples: string,
  knowledgeItems: KnowledgeItem[] = [],
  guardrails?: Guardrails | null
): string {
  const guardrailTone = guardrails?.toneStyle?.trim() || "Friendly, concise, professional."
  const guardrailRules = guardrails?.rules?.trim()
  const banned = guardrails?.bannedWords?.filter(Boolean) || []
  const topicRules = guardrails?.topicRules || []

  const knowledgeSection = knowledgeItems.length
    ? `\n\nRELEVANT KNOWLEDGE SNIPPETS:\n${knowledgeItems
        .map((k, idx) => `[${idx + 1}] ${k.title}: ${k.body}`)
        .join("\n")}\n`
    : ""

  const topicRulesSection = topicRules.length
    ? `\nTopic-specific rules:\n${topicRules
        .map((r) => `- If tags/intent match "${r.tag}", then: ${r.instruction}`)
        .join("\n")}`
    : ""

  const bannedSection = banned.length
    ? `\nBanned words/phrases: ${banned.join(", ")}`
    : ""

  const recipientNameText = recipientName ? ` (${recipientName})` : '';

  return `You are an AI assistant helping to draft new emails. Follow the guardrails and knowledge below.

TONE & STYLE:
${guardrailTone}

GENERAL RULES:
${guardrailRules || "Keep responses accurate, polite, and helpful."}
${topicRulesSection}${bannedSection}

NEW EMAIL DETAILS:
Recipient: ${recipientEmail}${recipientNameText}
Subject: ${subject}
Context/Instructions: ${context}

USER'S PAST EMAIL STYLE EXAMPLES (use these to match tone and style):
${styleExamples || 'No past examples available. Use a professional, friendly tone.'}

${knowledgeSection}

INSTRUCTIONS:
1. Generate a new email based on the provided context and subject.
2. Match the tone and style of the user's past emails shown above.
3. Address the recipient appropriately (use their name if provided).
4. Make the email professional, clear, and appropriate for the context provided.
5. Keep it concise but complete.
6. Output ONLY the email body text (no subject line, no metadata, just the email content).
7. Do not include placeholders like [Your Name] - write as if the user is writing directly.
8. Respect all guardrails and avoid banned words/phrases.
9. Apply topic-specific rules when relevant to the email content or context.

Generate the new email now:`;
}

/**
 * Select relevant knowledge for new email generation
 */
function selectKnowledgeForNewEmail(subject: string, context: string, items: KnowledgeItem[]): KnowledgeItem[] {
  if (!items?.length) return []
  const text = `${subject} ${context}`.toLowerCase()
  const scored = items.map((item) => {
    const tags = item.tags || []
    const tagScore = tags.reduce((acc, tag) => (text.includes(tag.toLowerCase()) ? acc + 2 : acc), 0)
    const keywordScore =
      (item.title?.toLowerCase().includes(text) ? 1 : 0) +
      (item.body?.toLowerCase().includes(subject.toLowerCase()) ? 1 : 0)
    const score = tagScore + keywordScore
    return { item, score }
  })
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((s) => s.item)
}

/**
 * Create prompt for draft generation
 */
function createDraftPrompt(
  incomingEmail: Email,
  styleExamples: string,
  conversationMessages: Email[] = [],
  knowledgeItems: KnowledgeItem[] = [],
  guardrails?: Guardrails | null,
  isRegeneration?: boolean,
  internalChatContext?: string,
  shopifyContext?: string
): string {
  // OPTIMIZATION: Use more conversation context (up to 15 messages) for better understanding
  // Sort messages by date to ensure chronological order
  const sortedMessages = [...(conversationMessages || [])].sort((a, b) => {
    const dateA = new Date(a.date || '').getTime() || 0;
    const dateB = new Date(b.date || '').getTime() || 0;
    return dateA - dateB; // Oldest first for context
  });
  
  const history = sortedMessages
    // Exclude the incoming email itself if it's in the list
    .filter((msg) => msg.id !== incomingEmail.id)
    // Take up to the last 15 messages for comprehensive context (increased from 5)
    .slice(-15)
    .map((msg) => {
      // Determine if message is from agent (sent) or customer (received)
      // Check if 'from' matches the connected account's email domain or if it's a reply
      const isFromAgent = msg.from?.toLowerCase().includes(incomingEmail.to?.toLowerCase() || '') || 
                         msg.to?.toLowerCase() === incomingEmail.to?.toLowerCase();
      const direction = isFromAgent ? 'Agent' : 'Customer';
      return `${direction} (${msg.from} → ${msg.to} at ${msg.date || 'unknown time'}):\n${msg.body}`;
    })
    .join('\n\n---\n\n');

  const historySection = history
    ? `\n\nCONVERSATION HISTORY (most recent messages first):\n${history}\n`
    : '';

  const guardrailTone = guardrails?.toneStyle?.trim() || "Friendly, concise, professional."
  const guardrailRules = guardrails?.rules?.trim()
  const banned = guardrails?.bannedWords?.filter(Boolean) || []
  const topicRules = guardrails?.topicRules || []

  const knowledgeSection = knowledgeItems.length
    ? `\n\nRELEVANT KNOWLEDGE SNIPPETS:\n${knowledgeItems
        .map((k, idx) => `[${idx + 1}] ${k.title}: ${k.body}`)
        .join("\n")}\n`
    : ""

  const topicRulesSection = topicRules.length
    ? `\nTopic-specific rules:\n${topicRules
        .map((r) => `- If tags/intent match "${r.tag}", then: ${r.instruction}`)
        .join("\n")}`
    : ""

  const bannedSection = banned.length
    ? `\nBanned words/phrases: ${banned.join(", ")}`
    : ""

  return `You are an AI assistant helping to draft email replies. Follow the guardrails and knowledge below.

${internalChatContext ? internalChatContext + '\n' : ''}
${shopifyContext ? shopifyContext + '\n' : ''}

TONE & STYLE:
${guardrailTone}

GENERAL RULES:
${guardrailRules || "Keep responses accurate, polite, and helpful."}
${topicRulesSection}${bannedSection}

INCOMING EMAIL TO REPLY TO:
Subject: ${incomingEmail.subject}
From: ${incomingEmail.from}
Body:
${incomingEmail.body}

${historySection}

USER'S PAST EMAIL STYLE EXAMPLES (use these to match tone and style):
${styleExamples || 'No past examples available. Use a professional, friendly tone.'}

${knowledgeSection}

INSTRUCTIONS:
1. CRITICAL: Read and understand the FULL CONVERSATION HISTORY above. This shows the complete context of all emails exchanged in this ticket/thread.
2. Analyze the incoming email and understand what it's asking or discussing, considering the full conversation context.
3. Match the tone and style of the user's past emails shown above - pay close attention to:
   - Writing style (formal vs casual, length, structure)
   - Tone (friendly, professional, empathetic, etc.)
   - Common phrases and expressions used
   - How questions are asked and answered
4. Generate a draft reply that:
   - Addresses ALL key points from the incoming email AND references relevant points from the conversation history
   - Matches the user's writing style and tone EXACTLY (use similar sentence structure, vocabulary, and phrasing)
   - Is professional and appropriate for the context
   - References previous messages in the conversation when relevant (e.g., "As mentioned earlier...", "Following up on...")
   - ${shopifyContext ? 'PERSONALIZES the response using Shopify customer information when available (order history, total spent, recent orders) - this builds rapport and shows understanding of their relationship with the business. ' : ''}Asks clarifying questions if the incoming email is unclear or needs more information
   - Is concise but complete - don't repeat information already covered in the conversation
   - Maintains continuity with the conversation flow
5. Output ONLY the draft email body text (no subject line, no metadata, just the reply text).
6. Do not include placeholders like [Your Name] - write as if the user is writing directly.
7. If the incoming email requires action or has questions, address them directly and reference any previous discussion about them.
8. Respect all guardrails and avoid banned words/phrases.
9. Apply topic-specific rules when relevant to the email content or tags.
10. IMPORTANT: Use the conversation history to understand the full context - don't just reply to the last email, consider the entire thread.${isRegeneration ? '\n11. IMPORTANT: This is a REGENERATION request. Create a DIFFERENT variation from any previous draft while maintaining the same core message and tone. Use different wording, sentence structure, or approach to convey the same information.' : ''}

Generate the draft reply now:`;
}

function selectKnowledge(incomingEmail: Email, items: KnowledgeItem[]): KnowledgeItem[] {
  if (!items?.length) return []
  const text = `${incomingEmail.subject} ${incomingEmail.body}`.toLowerCase()
  const scored = items.map((item) => {
    const tags = item.tags || []
    const tagScore = tags.reduce((acc, tag) => (text.includes(tag.toLowerCase()) ? acc + 2 : acc), 0)
    const keywordScore =
      (item.title?.toLowerCase().includes(text) ? 1 : 0) +
      (item.body?.toLowerCase().includes(incomingEmail.subject.toLowerCase()) ? 1 : 0)
    const score = tagScore + keywordScore
    return { item, score }
  })
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((s) => s.item)
}

function enforceGuardrailsOutput(
  draft: string,
  guardrails?: Guardrails | null,
  options?: {
    userEmail?: string | null;
    userId?: string | null;
    ticketId?: string | null;
    draftId?: string | null;
  }
): string {
  if (!guardrails) return draft
  
  let result = draft
  const banned = guardrails.bannedWords?.filter(Boolean) || []
  const foundBannedWords: string[] = []
  
  banned.forEach((word) => {
    const re = new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi")
    if (re.test(result)) {
      foundBannedWords.push(word)
      result = result.replace(re, "[removed]")
    }
  })
  
  // Log guardrail usage
  if (options?.userEmail && guardrails) {
    // Always log guardrails as applied when they exist
    logGuardrailUsage({
      userEmail: options.userEmail,
      userId: options.userId || null,
      ticketId: options.ticketId || null,
      draftId: options.draftId || null,
      action: foundBannedWords.length > 0 ? 'blocked' : 'applied',
      guardrailType: foundBannedWords.length > 0 ? 'banned_words' : undefined, // Only specify type when blocked
      details: foundBannedWords.length > 0
        ? { bannedWordsFound: foundBannedWords }
        : { guardrailsApplied: true, toneStyle: !!guardrails.toneStyle, rules: !!guardrails.rules, topicRules: guardrails.topicRules?.length || 0 },
      draftContent: draft,
    })
    
    // Log topic rules if any match ticket tags
    if (guardrails.topicRules && guardrails.topicRules.length > 0) {
      // Note: We'd need ticket tags to check, but for now log that topic rules exist
      // This could be enhanced to check actual ticket tags
      // For now, topic rules are counted if they exist in the guardrails
    }
  }
  
  return result
}

/**
 * Get Groq API key from environment
 */
export function getGroqApiKey(): string | null {
  return process.env.GROQ_API_KEY || null;
}

/**
 * Call Groq API to generate draft
 */
async function callGroqAPI(prompt: string, apiKey: string, temperature?: number): Promise<string> {
  const REQUEST_TIMEOUT = 30000; // 30 seconds timeout for Groq API
  const models = ['llama-3.3-70b-versatile', 'llama-3.1-70b-versatile', 'llama-3-70b-8192']; // Try models in order
  
  let lastError: Error | null = null;
  
  for (const model of models) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
      
      try {
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: model,
            messages: [
              {
                role: 'system',
                content: 'You are a helpful assistant that generates email drafts matching the user\'s writing style.',
              },
              {
                role: 'user',
                content: prompt,
              },
            ],
            temperature: temperature || 0.7,
            max_tokens: 1000,
          }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          let errorMessage = `Groq API error (${model}): ${response.status} ${response.statusText}`;
          try {
            const errorData = await response.json();
            errorMessage = errorData.error?.message || errorData.message || errorMessage;
            
            // If model not found (404), try next model
            if (response.status === 404 && models.indexOf(model) < models.length - 1) {
              console.warn(`[Groq API] Model ${model} not found, trying next model...`);
              continue; // Try next model
            }
            
            // Provide helpful hints for common errors
            if (response.status === 401 || response.status === 403) {
              errorMessage += ' (Check your GROQ_API_KEY)';
              throw new Error(errorMessage); // Don't retry on auth errors
            } else if (response.status === 429) {
              errorMessage += ' (Rate limit exceeded, please try again later)';
              throw new Error(errorMessage); // Don't retry on rate limits
            }
          } catch (parseError) {
            // If JSON parsing fails, use the status text
            if (parseError instanceof Error && parseError.message.includes('Check your GROQ_API_KEY')) {
              throw parseError; // Re-throw auth errors
            }
          }
          
          // If it's not the last model, try the next one
          if (models.indexOf(model) < models.length - 1) {
            lastError = new Error(errorMessage);
            continue;
          }
          
          throw new Error(errorMessage);
        }

        const data = await response.json();
        
        if (!data.choices || !Array.isArray(data.choices) || data.choices.length === 0) {
          throw new Error('Invalid response format from Groq API: no choices returned');
        }
        
        const draft = data.choices[0]?.message?.content?.trim();

        if (!draft) {
          throw new Error('No draft content in Groq API response');
        }

        console.log(`[Groq API] Successfully generated draft using model: ${model}`);
        return draft;
      } catch (fetchError: any) {
        clearTimeout(timeoutId);
        if (fetchError.name === 'AbortError') {
          // Timeout - don't retry with other models
          throw new Error('Request timeout: Groq API took too long to respond');
        }
        
        // If it's an auth/rate limit error, don't try other models
        if (fetchError.message?.includes('Check your GROQ_API_KEY') || 
            fetchError.message?.includes('Rate limit')) {
          throw fetchError;
        }
        
        // Otherwise, try next model
        lastError = fetchError;
        if (models.indexOf(model) < models.length - 1) {
          continue;
        }
        throw fetchError;
      }
    } catch (modelError) {
      lastError = modelError instanceof Error ? modelError : new Error(String(modelError));
      // If it's the last model, throw the error
      if (models.indexOf(model) === models.length - 1) {
        throw lastError;
      }
      // Otherwise continue to next model
      continue;
    }
  }
  
  // If we get here, all models failed
  throw lastError || new Error('All Groq API models failed');
}



