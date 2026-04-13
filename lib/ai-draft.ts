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
 * Detect if user's past emails use closing phrases like "Best regards", "Regards", etc.
 * Only counts if the phrase appears at the END of an email (last 200 characters)
 */
function detectClosingPhraseUsage(styleExamples: string): boolean {
  if (!styleExamples) return false;
  
  const closingPhrases = [
    'best regards',
    'regards',
    'sincerely',
    'yours sincerely',
    'yours truly',
    'kind regards',
    'warm regards',
    'best',
    'thanks',
    'thank you',
    'cheers',
    'take care',
    'all the best',
  ];

  // Split style examples by email boundaries (look for "Body:" markers)
  const emailBodies = styleExamples.split(/Body:\s*/i).filter(body => body.trim().length > 0);
  
  // Check each email body - look for closing phrases in the last 200 characters (end of email)
  for (const body of emailBodies) {
    const trimmedBody = body.trim();
    if (trimmedBody.length === 0) continue;
    
    // Get the last 200 characters of the email (where closing phrases typically appear)
    const lastPart = trimmedBody.slice(-200).toLowerCase();
    
    for (const phrase of closingPhrases) {
      // Check if phrase appears near the end (in last 200 chars)
      const regex = new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (regex.test(lastPart)) {
        // Additional check: ensure it's not in the middle of a sentence
        // Look for the phrase followed by newline, end of text, or name placeholder
        const phraseIndex = lastPart.lastIndexOf(phrase);
        if (phraseIndex !== -1) {
          const afterPhrase = lastPart.substring(phraseIndex + phrase.length).trim();
          // If followed by newline, end, or common name patterns, it's likely a closing
          if (afterPhrase.length === 0 || 
              afterPhrase.startsWith('\n') || 
              afterPhrase.match(/^[,\n\s]*(\[|{)?(your|name|signature)/i)) {
            return true;
          }
        }
      }
    }
  }
  
  return false;
}

/**
 * Replace placeholders like {your name}, [Your Name], etc. with actual user name
 * Only replaces after "Best regards", "Regards", "Sincerely", etc.
 */
function replaceNamePlaceholder(draft: string, userName: string | null): string {
  if (!userName || !draft) return draft;

  // Common closing phrases (case-insensitive)
  const closingPhrases = [
    'best regards',
    'regards',
    'sincerely',
    'yours sincerely',
    'yours truly',
    'kind regards',
    'warm regards',
    'best',
    'thanks',
    'thank you',
    'cheers',
    'take care',
    'all the best',
  ];

  // Find the LAST occurrence of any closing phrase (most likely to be the actual closing)
  let closingIndex = -1;
  let closingPhrase = '';
  let closingLength = 0;
  
  for (const phrase of closingPhrases) {
    const regex = new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
    let match;
    let lastMatch = -1;
    let lastMatchLength = 0;
    
    // Find the last occurrence of this phrase
    while ((match = regex.exec(draft)) !== null) {
      lastMatch = match.index;
      lastMatchLength = match[0].length;
    }
    
    if (lastMatch !== -1 && (closingIndex === -1 || lastMatch > closingIndex)) {
      closingIndex = lastMatch;
      closingPhrase = phrase;
      closingLength = lastMatchLength;
    }
  }

  // Only replace placeholders AFTER closing phrases, not anywhere in the draft
  // If no closing phrase found, don't replace placeholders (they might be intentional in body)
  if (closingIndex < 0) {
    return draft; // No closing phrase found, don't replace placeholders
  }

  const textToProcess = draft.substring(closingIndex + closingLength);

  // Replace various placeholder patterns (case-insensitive)
  const placeholderPatterns = [
    /\{your name\}/gi,
    /\{Your Name\}/g,
    /\[Your Name\]/g,
    /\[your name\]/gi,
    /\{name\}/gi,
    /\[name\]/gi,
    /\{your_name\}/gi,
    /\{YOUR_NAME\}/g,
  ];

  let processedText = textToProcess;
  for (const pattern of placeholderPatterns) {
    processedText = processedText.replace(pattern, userName);
  }

  // Reconstruct the draft
  if (closingIndex >= 0) {
    return draft.substring(0, closingIndex + closingLength) + processedText;
  } else {
    return processedText;
  }
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
    userName?: string | null;
    shopifyContext?: string | null;
  }
): Promise<string> {
  // Validate required fields
  if (!incomingEmail?.body || !incomingEmail?.from || !incomingEmail?.to) {
    throw new Error('Invalid email: missing required fields (body, from, to)');
  }
  
  // Handle missing subject - use default if not provided
  if (!incomingEmail.subject || incomingEmail.subject.trim() === '') {
    incomingEmail.subject = '(no subject)';
  }

  // Validate API key early
  if (!groqApiKey || groqApiKey.trim() === '') {
    throw new Error('API key is required for draft generation');
  }

  // Generate embedding for the incoming email with enhanced context (intent + content)
  // OPTIMIZED: Use timeout to avoid blocking if embedding generation is slow
  let queryEmbedding: number[] = [];
  try {
    // Enhanced context: include intent keywords to better match email types
    const emailIntent = extractEmailIntent(incomingEmail.subject, incomingEmail.body);
    const queryContext = createEmailContextWithIntent(
      incomingEmail.subject, 
      incomingEmail.body, 
      emailIntent
    );
    // Add timeout to prevent blocking if embedding API is slow
    queryEmbedding = await Promise.race([
      generateEmbedding(queryContext),
      new Promise<number[]>((resolve) => setTimeout(() => resolve([]), 1500)) // 1.5 second timeout
    ]);
  } catch (error) {
    console.error('Error generating embedding for incoming email:', error);
    // If embedding fails, still generate draft but without similarity matching
    queryEmbedding = [];
  }

  // Find similar past emails by INTENT + CONTENT (not just tone/style)
  // This helps learn "what to reply to what type of email"
  // OPTIMIZED: Reduced candidate pool and final selection for faster processing
  let similarEmails: Array<{ emailId: string; similarity: number; email: any }>;
  if (queryEmbedding.length > 0 && pastEmails.length > 0) {
    // Find emails with similar intent/content (reduced from 8 to 5 for speed)
    similarEmails = findSimilarEmails(
      queryEmbedding,
      pastEmails.map((email) => ({
        emailId: email.id,
        embedding: email.embedding,
        email,
      })),
      5 // Reduced from 8 to 5 for faster similarity search
    );
    
    // If no similar emails found, use first few as fallback
    if (similarEmails.length === 0) {
      similarEmails = pastEmails.slice(0, 3).map((email) => ({
        emailId: email.id,
        email,
        similarity: 0.5, // Default similarity for fallback
      }));
    } else {
      // Filter and prioritize by intent similarity (reduced from 5 to 3 for speed)
      const incomingIntent = extractEmailIntent(incomingEmail.subject, incomingEmail.body);
      similarEmails = prioritizeByIntent(similarEmails, incomingIntent).slice(0, 3);
    }
  } else {
    // Fallback: use first 3 past emails if embedding generation failed (reduced from 5)
    similarEmails = pastEmails.slice(0, 3).map((email) => ({
      emailId: email.id,
      email,
      similarity: 0.5, // Default similarity for fallback
    }));
  }

  // Build context from similar emails - include both INCOMING and RESPONSE
  // This teaches the AI "when customer asks X, respond with Y"
  let styleExamples = similarEmails
    .map(
      (item) => {
        // Try to find the response to this email if it's a customer email
        // For now, we'll show the email itself as an example of what was replied to
        const intent = extractEmailIntent(item.email.subject, item.email.body);
        return `Email Type/Intent: ${intent}\nSubject: ${item.email.subject}\nBody: ${item.email.body}`;
      }
    )
    .join('\n\n---\n\n');

  // If no style examples, provide a default fallback
  if (!styleExamples || styleExamples.trim().length === 0) {
    styleExamples = 'No past email examples available. Use a professional, friendly, and helpful tone.';
  }

  // Detect if user uses closing phrases in their past emails
  const usesClosingPhrases = detectClosingPhraseUsage(styleExamples);


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

  // Analyze conversation history to extract questions/answers and avoid repetition
  const conversationAnalysis = analyzeConversationHistory(
    conversationMessages || [],
    incomingEmail
  );

  // Create prompt for Groq, including optional conversation history and internal chat context
  const relevantKnowledge = selectKnowledge(incomingEmail, knowledgeItems);
  const prompt = createDraftPrompt(
    incomingEmail,
    styleExamples,
    conversationMessages,
    relevantKnowledge,
    guardrails,
    options?.isRegeneration,
    internalChatContext,
    conversationAnalysis,
    usesClosingPhrases,
    options?.shopifyContext || null
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

  // Replace name placeholder after "Best regards" or similar closings
  draft = replaceNamePlaceholder(draft, options?.userName || null);

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
    userName?: string | null;
  }
): Promise<string> {
  // Validate required fields
  if (!recipientEmail || !subject || !context) {
    throw new Error('Missing required fields: recipientEmail, subject, context');
  }

  // Validate API key early
  if (!groqApiKey || groqApiKey.trim() === '') {
    throw new Error('API key is required for draft generation');
  }

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
  let styleExamples = similarEmails
    .map(
      (item) => `Subject: ${item.email.subject}\nBody: ${item.email.body}`
    )
    .join('\n\n---\n\n');

  // If no style examples, provide a default fallback
  if (!styleExamples || styleExamples.trim().length === 0) {
    styleExamples = 'No past email examples available. Use a professional, friendly, and helpful tone.';
  }

  // Detect if user uses closing phrases in their past emails
  const usesClosingPhrases = detectClosingPhraseUsage(styleExamples);

  // Create prompt for Groq, including relevant knowledge
  const relevantKnowledge = selectKnowledgeForNewEmail(subject, context, knowledgeItems);
  const prompt = createNewEmailPrompt(recipientEmail, recipientName, subject, context, styleExamples, relevantKnowledge, guardrails, usesClosingPhrases);

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

  // Replace name placeholder after "Best regards" or similar closings
  draft = replaceNamePlaceholder(draft, options?.userName || null);

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
  guardrails?: Guardrails | null,
  usesClosingPhrases: boolean = false
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

USER'S PAST EMAIL STYLE EXAMPLES (match BOTH tone/style AND formatting - paragraph breaks, spacing, structure):
${styleExamples || 'No past examples available. Use a professional, friendly tone.'}

CRITICAL - FORMATTING MATCH: Pay close attention to how the user formats their emails above. Match:
- Paragraph breaks and spacing (single vs double line breaks)
- How they structure their emails (greeting, body, closing)
- Line length and wrapping
- Use of lists, bullets, or numbered items (if they use them)
- Overall email structure and flow

${knowledgeSection}

INSTRUCTIONS:
1. Generate a new email based on the provided context and subject.
2. Match the tone, style, AND FORMATTING of the user's past emails shown above. Pay attention to paragraph breaks, spacing, structure, and how they organize their emails. Use the same formatting patterns (single vs double line breaks, paragraph structure, etc.).
3. Address the recipient appropriately (use their name if provided).
4. Make the email professional, clear, and appropriate for the context provided.
5. Keep it SHORT and concise: Aim for 2-4 sentences for simple emails, 4-6 for complex ones. Avoid unnecessary elaboration.
6. Output ONLY the email body text (no subject line, no metadata, just the email content).
7. Do not include placeholders like [Your Name] - write as if the user is writing directly.
8. Respect all guardrails and avoid banned words/phrases.
9. Apply topic-specific rules when relevant to the email content or context.
${usesClosingPhrases ? '10. IMPORTANT - Closing phrases: The user\'s past emails show they DO use closing phrases like "Best regards", "Regards", etc. You may include a closing phrase if appropriate.' : '10. IMPORTANT - Closing phrases: The user\'s past emails show they DO NOT use closing phrases like "Best regards", "Regards", etc. Do NOT add any closing phrases to the draft. End the email naturally without formal closings.'}

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
 * Extract email intent/type from subject and body
 * Generic patterns that work for any business type
 * Uses semantic patterns rather than business-specific terms
 */
export function extractEmailIntent(subject: string, body: string): string {
  // Handle missing or empty subject
  const safeSubject = subject || '';
  const text = `${safeSubject} ${body}`.toLowerCase();
  
  // Generic email intents/types - semantic patterns that work across industries
  const intentPatterns: { [key: string]: RegExp[] } = {
    // Request for reversal/return of something (money, service, item, etc.)
    'reversal_request': [/refund/, /return.*money/, /money.*back/, /cancel/, /reverse/, /undo/],
    // Inquiry about location/status of something (shipment, appointment, service, etc.)
    'status_inquiry': [/where.*(?:is|are|my|the)/, /tracking/, /status/, /when.*(?:arrive|come|deliver|complete)/, /location/, /update/],
    // Negative feedback or dissatisfaction
    'complaint': [/complaint/, /unhappy/, /disappointed/, /terrible/, /awful/, /horrible/, /bad.*service/, /dissatisfied/, /upset/],
    // Question about how something works or what something is
    'information_request': [/question/, /how.*work/, /what.*is/, /explain/, /tell.*about/, /can.*you.*explain/, /what.*does/],
    // Something not functioning correctly
    'technical_issue': [/not.*working/, /broken/, /error/, /bug/, /issue/, /problem/, /fix/, /malfunction/, /doesn.*t.*work/],
    // Financial/payment related
    'financial_inquiry': [/charge/, /payment/, /invoice/, /bill/, /price/, /cost/, /fee/, /payment/, /billing/, /charge/],
    // Access/authentication related
    'access_issue': [/login/, /password/, /account/, /access/, /sign.*in/, /authentication/, /credentials/],
    // General help or assistance
    'general_inquiry': [/help/, /information/, /assistance/, /support/, /guidance/],
  };

  // Check patterns in order of specificity (most specific first)
  for (const [intent, patterns] of Object.entries(intentPatterns)) {
    if (patterns.some(pattern => pattern.test(text))) {
      return intent;
    }
  }

  return 'general_inquiry';
}

/**
 * Create email context with intent for better embedding matching
 */
export function createEmailContextWithIntent(subject: string, body: string, intent: string): string {
  // Handle missing or empty subject
  const safeSubject = subject || '(no subject)';
  return `Intent: ${intent}\nSubject: ${safeSubject}\n\nBody: ${body}`.trim();
}

/**
 * Prioritize similar emails by intent match
 */
function prioritizeByIntent(
  similarEmails: Array<{ emailId: string; similarity: number; email: any }>,
  targetIntent: string
): Array<{ emailId: string; similarity: number; email: any }> {
  return similarEmails.map(item => {
    const itemIntent = extractEmailIntent(item.email.subject, item.email.body);
    // Boost similarity if intents match
    const boostedSimilarity = itemIntent === targetIntent 
      ? Math.min(1.0, item.similarity + 0.2) 
      : item.similarity;
    return { ...item, similarity: boostedSimilarity };
  }).sort((a, b) => b.similarity - a.similarity);
}

/**
 * Analyze conversation history to extract questions and answers
 * Enhanced for long threads - extracts key information, questions, answers, and topics
 */
function analyzeConversationHistory(
  conversationMessages: Email[],
  incomingEmail: Email
): {
  questionsAsked: string[];
  questionsAnswered: string[];
  topicsCovered: string[];
  keyInformation: string[]; // Important facts/decisions made in the thread (ONLY from agent messages)
  threadSummary: string; // Brief summary for very long threads
  contextSummary?: string; // What "it" might refer to (orders, issues, etc.)
  hasAgentReplies: boolean; // Whether any agent has replied in this thread
} {
  const questionsAsked: string[] = [];
  const questionsAnswered: string[] = [];
  const topicsCovered: string[] = [];
  const keyInformation: string[] = [];
  let hasAgentReplies = false;
  const allMessages = [...conversationMessages, incomingEmail];

  // Extract email addresses for comparison
  const extractEmailAddress = (emailStr: string): string => {
    const match = emailStr?.match(/<([^>]+)>/) || emailStr?.match(/([^\s<>]+@[^\s<>]+)/);
    return match ? match[1].toLowerCase() : emailStr?.toLowerCase() || '';
  };
  
  const incomingToEmail = extractEmailAddress(incomingEmail.to);

  // Enhanced question patterns - more comprehensive
  const questionPatterns = [
    /(?:^|\s)(?:what|when|where|who|why|how|can|could|would|will|is|are|do|does|did|should|may|might)\s+[^?.!]*[?]/gi,
    /[^.!]*\?/g, // Any sentence ending with ?
  ];

  // Key information patterns (decisions, confirmations, important facts)
  // Generic patterns that work for any business - status words and reference numbers
  const keyInfoPatterns = [
    // Status/decision words (generic across industries)
    /\b(?:confirmed|agreed|decided|resolved|fixed|completed|approved|rejected|cancelled|refunded|shipped|delivered|scheduled|booked|processed|initiated|finalized)\b/gi,
    // Reference numbers (generic pattern - works for orders, tickets, cases, appointments, etc.)
    /\b(?:reference|ref|case|ticket|order|appointment|booking|transaction|id|number|#)\s*(?:number|id|#)?[:\s]*([A-Z0-9#-]+)/gi,
  ];

  // Extract what "it" might refer to - generic patterns for any business
  const contextItems: string[] = []; // What the conversation is about
  const referenceNumbers: string[] = []; // Any reference numbers (orders, tickets, cases, appointments, etc.)
  const trackingNumbers: string[] = []; // Tracking/shipping numbers (if applicable)
  const entityNames: string[] = []; // Products, services, items, appointments, etc. (generic)
  const issuesMentioned: string[] = []; // Problems/issues mentioned

  // Process all messages (prioritize recent ones for long threads)
  // OPTIMIZED: Reduced from 20 to 15 for faster analysis
  const recentMessages = allMessages.slice(-15); // Last 15 messages for analysis
  const olderMessages = allMessages.slice(0, -15); // Older messages for summary only

  for (const msg of recentMessages) {
    const text = `${msg.subject} ${msg.body}`;
    
    // Determine if message is from agent or customer
    const msgFromEmail = extractEmailAddress(msg.from);
    const isFromAgent = msgFromEmail === incomingToEmail;
    const isFromCustomer = !isFromAgent;
    
    // Track if there are any agent replies (excluding the current incoming email)
    if (isFromAgent && msg.id !== incomingEmail.id) {
      hasAgentReplies = true;
    }
    
    // Extract questions using multiple patterns
    for (const pattern of questionPatterns) {
      const questions = text.match(pattern) || [];
      
      if (isFromCustomer) {
        questionsAsked.push(...questions.map(q => q.trim().substring(0, 200))); // Limit length
      } else {
        questionsAnswered.push(...questions.map(q => q.trim().substring(0, 200)));
      }
    }

    // Extract key information (decisions, confirmations, reference numbers, etc.)
    // CRITICAL: Only extract from AGENT messages, not customer messages
    // Customers may ask about things that aren't true yet
    
    if (isFromAgent) {
      // Only trust information from agent replies
      for (const pattern of keyInfoPatterns) {
        const matches = text.match(pattern);
        if (matches) {
          keyInformation.push(...matches.map(m => m.trim().substring(0, 100)));
        }
      }
    }

    // Extract reference numbers (generic - works for orders, tickets, cases, appointments, etc.)
    const referenceMatches = text.match(/\b(?:reference|ref|case|ticket|order|appointment|booking|transaction|id|number|#)\s*(?:number|id|#)?[:\s]*([A-Z0-9#-]+)/gi);
    if (referenceMatches) {
      referenceNumbers.push(...referenceMatches.map(m => {
        // Extract just the number/ID part
        const match = m.match(/([A-Z0-9#-]+)$/i);
        return match ? match[1].trim() : '';
      }).filter(Boolean));
    }

    // Extract tracking numbers (if applicable - shipping, delivery, etc.)
    const trackingMatches = text.match(/\b(?:tracking|tracking\s+number|tracking\s+id|tracking\s+#|shipment|delivery\s+id)[:\s]*([A-Z0-9-]+)/gi);
    if (trackingMatches) {
      trackingNumbers.push(...trackingMatches.map(m => {
        const match = m.match(/([A-Z0-9-]+)$/i);
        return match ? match[1].trim() : '';
      }).filter(Boolean));
    }

    // Extract entity names (generic - products, services, items, appointments, etc.)
    const entityMatches = text.match(/\b(?:product|service|item|appointment|booking|package|subscription)[:\s]+([A-Z][A-Za-z0-9\s-]{2,40})/gi);
    if (entityMatches) {
      entityNames.push(...entityMatches.map(m => {
        const match = m.match(/:\s*([A-Z][A-Za-z0-9\s-]{2,40})/i);
        return match ? match[1].trim() : '';
      }).filter(Boolean).slice(0, 5));
    }

    // Extract issues/problems mentioned
    const issueMatches = text.match(/\b(?:issue|problem|concern|complaint|wrong|broken|not\s+working)[:\s]+([^.!?]{10,100})/gi);
    if (issueMatches) {
      issuesMentioned.push(...issueMatches.map(m => m.trim().substring(0, 100)));
    }

    // Extract what the conversation is about (main topic)
    if (text.match(/\b(?:about|regarding|concerning|re|re:)\s+([A-Z][^.!?]{5,50})/gi)) {
      const topicMatch = text.match(/\b(?:about|regarding|concerning|re|re:)\s+([A-Z][^.!?]{5,50})/gi);
      if (topicMatch) {
        contextItems.push(...topicMatch.map(m => m.replace(/\b(?:about|regarding|concerning|re|re:)\s+/gi, '').trim()).slice(0, 3));
      }
    }

    // Extract topics (generic keyword extraction - learns from actual email content)
    // Use common business-agnostic terms that appear across industries
    const topicKeywords = text.match(/\b(refund|return|shipping|delivery|order|product|service|payment|invoice|billing|account|login|password|technical|support|complaint|issue|problem|fix|broken|error|bug|appointment|booking|subscription|request|inquiry|question|update|status|tracking|confirmation|cancel|cancellation)\b/gi) || [];
    topicsCovered.push(...topicKeywords.map(t => t.toLowerCase()));
  }

  // Create thread summary for very long threads
  let threadSummary = '';
  if (allMessages.length > 15) {
    // For very long threads, create a brief summary
    const firstMessage = allMessages[0];
    const lastFewMessages = allMessages.slice(-5);
    threadSummary = `This is a long conversation thread (${allMessages.length} messages). `;
    threadSummary += `Started with: "${firstMessage.subject}". `;
    threadSummary += `Recent topics: ${[...new Set(topicsCovered.slice(-10))].join(', ')}. `;
    threadSummary += `Key decisions: ${keyInformation.slice(-5).join('; ')}.`;
  }

  // Build context summary for generic references (works for any business type)
  const contextSummary: string[] = [];
  if (referenceNumbers.length > 0) {
    contextSummary.push(`Reference numbers discussed: ${[...new Set(referenceNumbers)].slice(0, 5).join(', ')}`);
  }
  if (trackingNumbers.length > 0) {
    contextSummary.push(`Tracking numbers: ${[...new Set(trackingNumbers)].slice(0, 5).join(', ')}`);
  }
  if (entityNames.length > 0) {
    contextSummary.push(`Items/services mentioned: ${[...new Set(entityNames)].slice(0, 5).join(', ')}`);
  }
  if (issuesMentioned.length > 0) {
    contextSummary.push(`Issues discussed: ${[...new Set(issuesMentioned)].slice(0, 3).join('; ')}`);
  }
  if (contextItems.length > 0) {
    contextSummary.push(`Main topics: ${[...new Set(contextItems)].slice(0, 3).join(', ')}`);
  }

  return {
    questionsAsked: [...new Set(questionsAsked)].slice(-10), // Keep last 10 unique questions (reduced from 20)
    questionsAnswered: [...new Set(questionsAnswered)].slice(-10), // Keep last 10 unique answers (reduced from 20)
    topicsCovered: [...new Set(topicsCovered)].slice(0, 10), // Limit to 10 topics (reduced)
    keyInformation: [...new Set(keyInformation)].slice(-5), // Keep last 5 key info items (reduced from 10) - ONLY from agent messages
    threadSummary,
    contextSummary: contextSummary.length > 0 ? contextSummary.join('. ') : undefined, // What "it" might refer to
    hasAgentReplies,
  };
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
  conversationAnalysis?: {
    questionsAsked: string[];
    questionsAnswered: string[];
    topicsCovered: string[];
    keyInformation: string[];
    threadSummary: string;
    contextSummary?: string;
    hasAgentReplies?: boolean;
  },
  usesClosingPhrases: boolean = false,
  shopifyContext?: string | null
): string {
  // For long threads, use smart truncation: keep first message, last N messages, and summary
  const isLongThread = (conversationMessages || []).length > 15;
  let history: string;
  
  if (isLongThread && conversationAnalysis?.threadSummary) {
    // Long thread: Use summary + first message + recent messages (to capture full context)
    const firstMessage = (conversationMessages || [])[0];
    const recentMessages = (conversationMessages || [])
      .filter((msg) => msg.id !== incomingEmail.id)
      .slice(-10) // Increased from 8 to 10 for better context
      .map((msg) => {
        const direction = msg.from === incomingEmail.to ? 'Agent' : 'Customer';
        const bodyPreview = msg.body.length > 400 ? msg.body.substring(0, 400) + '...' : msg.body;
        return `${direction} (${msg.date || 'unknown time'}):\n${bodyPreview}`;
      })
      .join('\n\n---\n\n');
    
    const firstMessageText = firstMessage ? `FIRST MESSAGE (conversation started here):\n${firstMessage.from === incomingEmail.to ? 'Agent' : 'Customer'} (${firstMessage.date || 'unknown time'}):\n${firstMessage.body.substring(0, 500)}${firstMessage.body.length > 500 ? '...' : ''}\n\n---\n\n` : '';
    
    history = `THREAD SUMMARY (${conversationMessages.length} total messages):\n${conversationAnalysis.threadSummary}\n\n---\n\n${firstMessageText}RECENT MESSAGES (last 10):\n${recentMessages}`;
  } else {
    // Short/medium thread: Show ALL messages (not just last 15) for complete context
    const messagesToShow = (conversationMessages || [])
      .filter((msg) => msg.id !== incomingEmail.id)
      .map((msg) => {
        const direction = msg.from === incomingEmail.to ? 'Agent' : 'Customer';
        return `${direction} (${msg.from} → ${msg.to} at ${msg.date || 'unknown time'}):\n${msg.body}`;
      })
      .join('\n\n---\n\n');
    
    history = messagesToShow;
  }

  const historySection = history
    ? `\n\nCONVERSATION HISTORY:\n${history}\n`
    : '';

  // Build enhanced conversation analysis section
  let conversationAnalysisSection = '';
  if (conversationAnalysis) {
    conversationAnalysisSection = `\n\nCONVERSATION ANALYSIS (CRITICAL - READ CAREFULLY):\n`;
    
    // Only show key information if there were agent replies
    if (conversationAnalysis.hasAgentReplies && conversationAnalysis.keyInformation.length > 0) {
      conversationAnalysisSection += `Key Information/Decisions Already Made (from previous agent replies):\n${conversationAnalysis.keyInformation.map((info, i) => `  ${i + 1}. ${info}`).join('\n')}\n\n`;
    } else if (!conversationAnalysis.hasAgentReplies) {
      conversationAnalysisSection += `⚠️ IMPORTANT: No agent has replied to this customer yet. The customer may have asked questions or mentioned reference numbers, but DO NOT assume any status or make up information. Only reference what the customer said, not what you think the status might be.\n\n`;
    }
    
    if (conversationAnalysis.questionsAsked.length > 0) {
      conversationAnalysisSection += `Questions Already Asked by Customer:\n${conversationAnalysis.questionsAsked.slice(0, 10).map((q, i) => `  ${i + 1}. ${q}`).join('\n')}\n\n`;
    }
    
    if (conversationAnalysis.questionsAnswered.length > 0) {
      conversationAnalysisSection += `Questions Already Answered:\n${conversationAnalysis.questionsAnswered.slice(0, 10).map((q, i) => `  ${i + 1}. ${q}`).join('\n')}\n\n`;
    }
    
    if (conversationAnalysis.topicsCovered.length > 0) {
      conversationAnalysisSection += `Topics Already Discussed: ${conversationAnalysis.topicsCovered.slice(0, 15).join(', ')}\n\n`;
    }
    
    if (conversationAnalysis.contextSummary) {
      conversationAnalysisSection += `CONVERSATION CONTEXT (What "it" might refer to):\n${conversationAnalysis.contextSummary}\n\n`;
      conversationAnalysisSection += `IMPORTANT: If the customer uses vague references like "it", "that", "the [item]", "my issue", "the [service]", etc., use the context above to understand what they're referring to. Infer the meaning from previous messages in the conversation history.\n\n`;
    }
    
    conversationAnalysisSection += `CRITICAL RULES FOR LONG THREADS:\n`;
    conversationAnalysisSection += `1. Do NOT repeat questions that were already asked or answered above.\n`;
    conversationAnalysisSection += `2. If a question was already answered, briefly acknowledge it (e.g., "As mentioned earlier...") and provide new information or move forward.\n`;
    conversationAnalysisSection += `3. Reference key information already established (reference numbers, decisions, etc.) without re-asking for them.\n`;
    conversationAnalysisSection += `4. Focus on NEW information in the incoming email, not rehashing old topics.\n`;
    conversationAnalysisSection += `5. If this is a very long thread, be concise and focus on the current issue.\n`;
  }

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

  // Add Shopify context if available
  const shopifySection = shopifyContext ? `\n\n${shopifyContext}\n` : '';

  // Truncate prompt components if they're too long to avoid token limits
  // Estimate: ~4 characters per token, max ~8000 tokens = ~32000 characters
  // Reserve space for system message and instructions (~2000 chars)
  const MAX_PROMPT_LENGTH = 30000;
  let currentLength = 771; // Base prompt length estimate
  
  // Truncate history section if needed
  let truncatedHistory = historySection;
  if (truncatedHistory.length > 8000) {
    truncatedHistory = truncatedHistory.substring(0, 8000) + '\n\n[Conversation history truncated for length...]';
  }
  currentLength += truncatedHistory.length;

  // Truncate style examples if needed
  let truncatedStyleExamples = styleExamples || 'No past examples available. Use a professional, friendly tone.';
  if (truncatedStyleExamples.length > 5000) {
    truncatedStyleExamples = truncatedStyleExamples.substring(0, 5000) + '\n\n[Style examples truncated for length...]';
  }
  currentLength += truncatedStyleExamples.length;

  // Truncate knowledge section if needed
  let truncatedKnowledge = knowledgeSection;
  const remainingSpace = MAX_PROMPT_LENGTH - currentLength - 2000; // Reserve for other sections
  if (truncatedKnowledge.length > remainingSpace) {
    truncatedKnowledge = truncatedKnowledge.substring(0, remainingSpace) + '\n\n[Knowledge items truncated for length...]';
  }

  // Truncate conversation analysis if needed
  let truncatedAnalysis = conversationAnalysisSection;
  const analysisSpace = MAX_PROMPT_LENGTH - currentLength - truncatedKnowledge.length - 2000;
  if (truncatedAnalysis.length > analysisSpace) {
    truncatedAnalysis = truncatedAnalysis.substring(0, analysisSpace) + '\n\n[Conversation analysis truncated for length...]';
  }

  return `You are an AI assistant helping to draft email replies. Follow the guardrails and knowledge below.

${internalChatContext ? internalChatContext + '\n' : ''}${shopifySection}

TONE & STYLE:
${guardrailTone}

GENERAL RULES:
${guardrailRules || "Keep responses accurate, polite, and helpful."}
${topicRulesSection}${bannedSection}

INCOMING EMAIL TO REPLY TO:
Subject: ${incomingEmail.subject || '(no subject)'}
From: ${incomingEmail.from}
Body:
${incomingEmail.body}

${truncatedHistory}

USER'S PAST EMAIL STYLE EXAMPLES (match BOTH tone/style AND formatting - paragraph breaks, spacing, structure):
${truncatedStyleExamples}

CRITICAL - FORMATTING MATCH: Pay close attention to how the user formats their emails above. Match:
- Paragraph breaks and spacing (single vs double line breaks)
- How they structure their emails (greeting, body, closing)
- Line length and wrapping
- Use of lists, bullets, or numbered items (if they use them)
- Overall email structure and flow

${truncatedKnowledge}

${truncatedAnalysis}

INSTRUCTIONS:
1. CRITICAL - Read the FULL conversation history above. The customer may be referring to previous messages, decisions, or information from earlier in the thread. Make sure you understand the complete context before replying.
2. CRITICAL - DO NOT MAKE UP INFORMATION: Only reference facts, statuses, or decisions that were ACTUALLY stated by an agent in previous messages. If no agent has replied yet, do NOT assume any status, outcome, or information. Only acknowledge what the customer said, not what you think might be true.
3. Analyze the incoming email and understand what TYPE of email it is (request, inquiry, complaint, etc.) and what it's asking or discussing.
4. If the incoming email uses vague/generic references (e.g., "I need an update on it", "what about that", "the [item]", "my issue"), use the conversation history and context summary to understand what they're referring to. Infer the meaning from previous messages, but DO NOT infer statuses or outcomes that weren't explicitly stated.
5. If the incoming email references something from the conversation history (e.g., "as we discussed", "you mentioned", "the [item] I asked about"), check if an agent actually said that. If no agent replied, acknowledge their previous email but do NOT make up what was discussed.
6. Look at the "Email Type/Intent" in the style examples above to learn what types of responses work for different email types.
7. Match the tone, style, AND FORMATTING of the user's past emails shown above. Pay attention to paragraph breaks, spacing, structure, and how they organize their emails. Use the same formatting patterns (single vs double line breaks, paragraph structure, etc.).
8. Generate a draft reply that:
   - Addresses the key points in the incoming email
   - References relevant information from PREVIOUS AGENT REPLIES (if any) when appropriate
   - If no agent has replied yet, acknowledge the customer's previous email(s) and provide a helpful response without making up statuses
   - Matches the user's writing style, tone, AND formatting (paragraph breaks, spacing, structure)
   - Is professional and appropriate for the email type
   - Uses similar response patterns as shown in the style examples for this email type
   - Is CONCISE: Keep it short and to the point. Aim for 2-4 sentences for simple inquiries, 4-6 sentences for complex issues. Avoid unnecessary elaboration or repetition.
9. CRITICAL - Avoid repetition:
   - Do NOT ask questions that were already asked in the conversation history
   - Do NOT ask questions that were already answered in the conversation history
   - If a topic was already discussed, acknowledge it briefly and provide new information or move forward
   - Only ask NEW clarifying questions if the incoming email introduces something unclear that hasn't been addressed
10. Output ONLY the draft email body text (no subject line, no metadata, just the reply text).
11. Do not include placeholders like [Your Name] - write as if the user is writing directly.
12. If the incoming email requires action or has questions, address them directly.
13. CRITICAL - LENGTH CONTROL: Keep the draft SHORT. Most emails should be 2-4 sentences. Only use more if absolutely necessary for complex issues. Be direct and avoid filler words or unnecessary explanations.
13. Respect all guardrails and avoid banned words/phrases.
14. Apply topic-specific rules when relevant to the email content or tags.${isRegeneration ? '\n15. IMPORTANT: This is a REGENERATION request. Create a DIFFERENT variation from any previous draft while maintaining the same core message and tone. Use different wording, sentence structure, or approach to convey the same information.' : ''}
${usesClosingPhrases ? '16. IMPORTANT - Closing phrases: The user\'s past emails show they DO use closing phrases like "Best regards", "Regards", etc. You may include a closing phrase if appropriate.' : '16. IMPORTANT - Closing phrases: The user\'s past emails show they DO NOT use closing phrases like "Best regards", "Regards", etc. Do NOT add any closing phrases to the draft. End the email naturally without formal closings.'}

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
 * Get OpenAI API key from environment
 */
export function getOpenAIApiKey(): string | null {
  return process.env.OPENAI_API_KEY || null;
}

/**
 * Lightweight helper: rewrite an agent-provided snippet to be clearer/more customer-friendly
 * without inventing new facts. This is used for "polish only" flows in the UI.
 */
export async function rewriteAgentText(
  text: string,
  options?: { tone?: 'friendly' | 'formal' | 'neutral'; language?: string },
  apiKeyOverride?: string | null
): Promise<string> {
  const apiKey = apiKeyOverride || getOpenAIApiKey();
  if (!apiKey) {
    throw new Error('OpenAI API key not configured');
  }

  const safeText = text?.trim();
  if (!safeText) {
    throw new Error('Text is required for rewrite');
  }

  const toneLabel = options?.tone === 'formal'
    ? 'formal, professional'
    : options?.tone === 'friendly'
    ? 'warm, friendly, empathetic'
    : 'clear, neutral, professional';

  const languageHint = options?.language
    ? `Write in ${options.language}.`
    : 'Write in the same language as the original.';

  const prompt = `You are a customer support writing assistant.

Your job is to REWRITE the agent's draft message so it is clearer, more concise, and customer-friendly,
while keeping ALL factual content and constraints EXACTLY the same.

CRITICAL RULES:
- Do NOT invent or assume any facts, numbers, dates, tracking details, product statuses, or promises.
- If the original text says information is missing/unknown (for example: no tracking yet, item out of stock,
  waiting for supplier, cannot guarantee a date), you MUST preserve that meaning.
- You may change wording, order, and tone, but you may NOT change what is true.
- You may soften phrasing and make it more empathetic, but you cannot promise outcomes the agent did not promise.
- Do not add apologies or compensations that are not present in the original unless the tone clearly allows a simple apology.

TONE:
- Target tone: ${toneLabel}.
- Keep the length similar or slightly shorter than the original.

OUTPUT:
- ${languageHint}
- Output ONLY the rewritten message, no commentary, no quotes around it.

ORIGINAL MESSAGE:
"""${safeText}"""

Rewritten message:`;

  // Lower temperature for more predictable, fast rewrites
  return await callGroqAPI(prompt, apiKey, 0.4);
}

/**
 * Call AI API (Groq or OpenAI) to generate draft
 */
async function callGroqAPI(prompt: string, apiKey: string, temperature?: number): Promise<string> {
  const REQUEST_TIMEOUT = 30000; // 30 seconds timeout
  // Determine if this is an OpenAI key or Groq key
  const isOpenAI = apiKey.startsWith('sk-');

  const baseUrl = isOpenAI
    ? 'https://api.openai.com/v1/chat/completions'
    : 'https://api.groq.com/openai/v1/chat/completions';

  // Single model per provider — no escalation to expensive models on failure.
  // gpt-4o-mini is 10-20x cheaper than gpt-4o and sufficient for draft generation.
  // Groq: free tier, llama-3.3-70b is the best available.
  const models = isOpenAI
    ? ['gpt-4o-mini']
    : ['llama-3.3-70b-versatile', 'llama-3.1-70b-versatile'];

  let lastError: Error | null = null;

  for (const model of models) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

      try {
        const response = await fetch(baseUrl, {
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
            max_tokens: 800, // Limit to keep drafts concise
          }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          let errorMessage = `AI API error (${model}): ${response.status} ${response.statusText}`;
          try {
            const errorData = await response.json();
            errorMessage = errorData.error?.message || errorData.message || errorMessage;

            // If model not found (404), try next model
            if (response.status === 404 && models.indexOf(model) < models.length - 1) {
              console.warn(`[AI API] Model ${model} not found, trying next model...`);
              continue; // Try next model
            }

            // Provide helpful hints for common errors
            if (response.status === 401 || response.status === 403) {
              errorMessage += ' (Check your API_KEY)';
              throw new Error(errorMessage); // Don't retry on auth errors
            } else if (response.status === 429) {
              errorMessage += ' (Rate limit exceeded, please try again later)';
              throw new Error(errorMessage); // Don't retry on rate limits
            }
          } catch (parseError) {
            // If JSON parsing fails, use the status text
            if (parseError instanceof Error && parseError.message.includes('Check your API_KEY')) {
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
          throw new Error('Invalid response format from AI API: no choices returned');
        }

        const draft = data.choices[0]?.message?.content?.trim();

        if (!draft) {
          throw new Error('No draft content in AI API response');
        }

        console.log(`[AI API] Successfully generated draft using model: ${model}`);
        return draft;
      } catch (fetchError: any) {
        clearTimeout(timeoutId);
        if (fetchError.name === 'AbortError') {
          // Timeout - don't retry with other models
          throw new Error('Request timeout: AI API took too long to respond');
        }

        // If it's an auth/rate limit error, don't try other models
        if (fetchError.message?.includes('Check your API_KEY') ||
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
  throw lastError || new Error('All AI API models failed');
}



