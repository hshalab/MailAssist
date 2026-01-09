/**
 * Gmail API utilities for fetching emails and managing OAuth tokens
 */

import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { getValidTokens } from './token-refresh';
import { storeSentEmail, getCurrentUserEmail } from './storage';

// Initialize OAuth2 client
export function getOAuth2Client(): OAuth2Client {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const redirectUri = process.env.GMAIL_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('Missing Gmail OAuth2 credentials in environment variables');
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri) as any;
}

/**
 * Get OAuth2 authorization URL for Gmail authentication
 */
export function getAuthUrl(state?: string): string {
  const oauth2Client = getOAuth2Client();

  const scopes = [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/userinfo.email', // Added to get user email for login
    'https://www.googleapis.com/auth/userinfo.profile', // Added for name
  ];

  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent', // Force consent to get refresh token
    state: state,
  });
}

/**
 * Exchange authorization code for tokens
 */
export async function getTokensFromCode(code: string) {
  const oauth2Client = getOAuth2Client();
  const { tokens } = await oauth2Client.getToken(code);
  return tokens;
}

/**
 * Set credentials and get authenticated Gmail client
 */
export function getGmailClient(tokens: { access_token?: string | null; refresh_token?: string | null }) {
  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials(tokens);
  return google.gmail({ version: 'v1', auth: oauth2Client });
}

interface AttachmentPayload {
  filename: string
  mimeType: string
  data: string // base64 (no data: prefix)
}

interface SendReplyOptions {
  to: string
  subject: string
  body: string
  bodyHtml?: string
  threadId?: string
  inReplyTo?: string
  references?: string
  from?: string
  attachments?: AttachmentPayload[]
}

/**
 * Send a reply email through Gmail
 */
export async function sendReplyMessage(
  tokens: { access_token?: string | null; refresh_token?: string | null },
  options: SendReplyOptions
) {
  const gmail = getGmailClient(tokens)
  const {
    to,
    subject,
    body,
    bodyHtml,
    threadId,
    inReplyTo,
    references,
    from,
    attachments = [],
  } = options

  const headers = [
    `To: ${to}`,
    from ? `From: ${from}` : null,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    inReplyTo ? `In-Reply-To: ${inReplyTo}` : null,
    references ? `References: ${references}` : null,
  ]
    .filter(Boolean)
    .join('\r\n')

  const hasHtml = Boolean(bodyHtml)
  const hasAttachments = attachments.length > 0

  const altBoundary = `alt-${Date.now()}`
  const mixedBoundary = `mixed-${Date.now()}`

  const textPart = [
    `--${altBoundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    '',
    body.replace(/\r?\n/g, '\r\n'),
    '',
  ].join('\r\n')

  const htmlPart = hasHtml
    ? [
      `--${altBoundary}`,
      'Content-Type: text/html; charset="UTF-8"',
      '',
      bodyHtml!,
      '',
    ].join('\r\n')
    : ''

  const altClosing = `--${altBoundary}--`

  const buildAttachmentPart = (attachment: AttachmentPayload) =>
    [
      `--${mixedBoundary}`,
      `Content-Type: ${attachment.mimeType}; name="${attachment.filename}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${attachment.filename}"`,
      '',
      attachment.data,
      '',
    ].join('\r\n')

  let message = ''

  if (hasAttachments) {
    message += `${headers}\r\nContent-Type: multipart/mixed; boundary="${mixedBoundary}"\r\n\r\n`
    message += `--${mixedBoundary}\r\nContent-Type: multipart/alternative; boundary="${altBoundary}"\r\n\r\n`
    message += textPart
    if (hasHtml) message += htmlPart
    message += `${altClosing}\r\n`
    for (const attachment of attachments) {
      message += buildAttachmentPart(attachment)
    }
    message += `--${mixedBoundary}--`
  } else if (hasHtml) {
    message += `${headers}\r\nContent-Type: multipart/alternative; boundary="${altBoundary}"\r\n\r\n`
    message += textPart
    message += htmlPart
    message += altClosing
  } else {
    message += `${headers}\r\nContent-Type: text/plain; charset="UTF-8"\r\n\r\n${body.replace(/\r?\n/g, '\r\n')}`
  }

  const encodedMessage = encodeBase64Url(message)

  const response = await gmail.users.messages.send({
    userId: 'me',
    requestBody: {
      raw: encodedMessage,
      threadId,
    },
  })

  return response.data
}

/**
 * Fetch latest inbox emails
 * OPTIMIZED: Uses metadata format for list view (much faster)
 * Only fetches full body when needed (e.g., for ticket creation)
 */
export async function fetchInboxEmails(
  tokens: { access_token?: string | null; refresh_token?: string | null },
  maxResults: number = 50,
  query?: string,
  includeBody: boolean = false
) {
  const gmail = getGmailClient(tokens);

  const response = await gmail.users.messages.list({
    userId: 'me',
    maxResults,
    q: query || 'in:inbox',
  });

  const messages = response.data.messages || [];

  if (messages.length === 0) {
    return [];
  }

  // Use metadata format for list views (10x faster, less data)
  // Only fetch full body if explicitly needed
  const format = includeBody ? 'full' : 'metadata';

  // OPTIMIZED: Fetch messages with controlled concurrency
  // Gmail API allows ~50 requests/second per user, so we use larger batches
  // with concurrent processing to maximize throughput while respecting rate limits
  const BATCH_SIZE = 30; // Process 30 emails at a time (increased from 10 for faster loading)
  const emailDetails: any[] = [];

  // Process messages in larger batches with Promise.all for maximum concurrency
  for (let i = 0; i < messages.length; i += BATCH_SIZE) {
    const batch = messages.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(async (message) => {
        try {
          const fullMessage = await gmail.users.messages.get({
            userId: 'me',
            id: message.id!,
            format: format as 'full' | 'metadata' | 'minimal',
          });
          return parseEmailMessage(fullMessage.data, !includeBody);
        } catch (error) {
          console.error(`Error fetching message ${message.id}:`, error);
          return null; // Return null for failed messages
        }
      })
    );

    // Filter out null results from failed fetches and add to results
    emailDetails.push(...batchResults.filter((email) => email !== null));
  }

  return emailDetails;
}

/**
 * Fetch sent emails history
 * OPTIMIZED: Uses metadata format for list view (much faster)
 * Only fetches full body when needed (e.g., for embedding generation)
 */
export async function fetchSentEmails(
  tokens: { access_token?: string | null; refresh_token?: string | null },
  maxResults: number = 100,
  includeBody: boolean = false
) {
  const gmail = getGmailClient(tokens);

  const response = await gmail.users.messages.list({
    userId: 'me',
    maxResults,
    q: 'in:sent',
  });

  const messages = response.data.messages || [];

  if (messages.length === 0) {
    return [];
  }

  // Use metadata format for list views (10x faster, less data)
  // Only fetch full body if explicitly needed (e.g., for embeddings)
  const format = includeBody ? 'full' : 'metadata';

  // OPTIMIZED: Fetch messages with controlled concurrency
  // Gmail API allows ~50 requests/second per user, so we use larger batches
  // with concurrent processing to maximize throughput while respecting rate limits
  const BATCH_SIZE = 30; // Process 30 emails at a time (increased from 10 for faster loading)
  const emailDetails: any[] = [];

  // Process messages in larger batches with Promise.all for maximum concurrency
  for (let i = 0; i < messages.length; i += BATCH_SIZE) {
    const batch = messages.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(async (message) => {
        try {
          const fullMessage = await gmail.users.messages.get({
            userId: 'me',
            id: message.id!,
            format: format as 'full' | 'metadata' | 'minimal',
          });
          return parseEmailMessage(fullMessage.data, !includeBody);
        } catch (error) {
          console.error(`Error fetching message ${message.id}:`, error);
          return null; // Return null for failed messages
        }
      })
    );

    // Filter out null results from failed fetches and add to results
    emailDetails.push(...batchResults.filter((email) => email !== null));
  }

  return emailDetails;
}

/**
 * Get a specific email by ID
 */
export async function getEmailById(
  tokens: { access_token?: string | null; refresh_token?: string | null },
  emailId: string
) {
  const gmail = getGmailClient(tokens);

  const response = await gmail.users.messages.get({
    userId: 'me',
    id: emailId,
    format: 'full',
  });

  return parseEmailMessage(response.data);
}

/**
 * Fetch an entire Gmail thread (all messages in a conversation).
 * This is used for the helpdesk ticket detail view so we can show
 * both customer and agent messages in one timeline.
 */
export async function getThreadById(
  tokens: { access_token?: string | null; refresh_token?: string | null },
  threadId: string
) {
  const gmail = getGmailClient(tokens);

  const response = await gmail.users.threads.get({
    userId: 'me',
    id: threadId,
    format: 'full',
  });

  const messages = response.data.messages || [];

  const parsed = messages.map((message) => parseEmailMessage(message));

  // Sort by date ascending so UI can render top-to-bottom conversation
  parsed.sort((a, b) => {
    const da = new Date(a.date || '').getTime() || 0;
    const db = new Date(b.date || '').getTime() || 0;
    return da - db;
  });

  return {
    threadId: response.data.id,
    historyId: response.data.historyId,
    messages: parsed,
  };
}

/**
 * Get user profile information
 */
export async function getUserProfile(
  tokens: { access_token?: string | null; refresh_token?: string | null }
) {
  const gmail = getGmailClient(tokens);

  const response = await gmail.users.getProfile({
    userId: 'me',
  });

  return {
    emailAddress: response.data.emailAddress,
    messagesTotal: response.data.messagesTotal,
    threadsTotal: response.data.threadsTotal,
    historyId: response.data.historyId,
  };
}

/**
 * Start a Gmail History watch using Google Pub/Sub.
 * NOTE: This requires you to configure a Pub/Sub topic and grant Gmail
 * permission to publish to it. The topic name must be provided via
 * GMAIL_HISTORY_TOPIC environment variable.
 */
export async function startHistoryWatch(
  tokens: { access_token?: string | null; refresh_token?: string | null }
) {
  const gmail = getGmailClient(tokens);

  const topicName = process.env.GMAIL_HISTORY_TOPIC;
  if (!topicName) {
    throw new Error(
      'GMAIL_HISTORY_TOPIC is not set. Configure a Pub/Sub topic and set its full resource name in env.'
    );
  }

  const labelIds = ['INBOX', 'SENT'];

  const res = await gmail.users.watch({
    userId: 'me',
    requestBody: {
      topicName,
      labelIds,
    },
  });

  return res.data;
}

/**
 * Stop an existing Gmail History watch.
 */
export async function stopHistoryWatch(
  tokens: { access_token?: string | null; refresh_token?: string | null }
) {
  const gmail = getGmailClient(tokens);
  await gmail.users.stop({ userId: 'me' });
}

/**
 * Parse Gmail message format into a simpler structure
 * @param message - Gmail message object
 * @param metadataOnly - If true, skip body extraction (for list views)
 */
function parseEmailMessage(message: any, metadataOnly: boolean = false) {
  const headers = message.payload?.headers || [];
  const getHeader = (name: string) =>
    headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value || '';

  // For metadata-only format, use snippet if available, otherwise empty body
  let bodyText = '';
  let bodyHtml = '';
  const attachments: { id: string; filename: string; mimeType: string; size: number; contentId?: string }[] = [];

  if (!metadataOnly) {
    const decodeData = (data?: string) => {
      if (!data) return '';
      // Gmail uses URL-safe base64
      const normalized = data.replace(/-/g, '+').replace(/_/g, '/');
      return Buffer.from(normalized, 'base64').toString('utf-8');
    };

    // First pass: Extract ALL attachments from the entire message tree
    const extractAttachments = (part: any, depth: number = 0) => {
      if (!part) return;

      const mime = part.mimeType || '';
      const partHeaders = part.headers || [];
      const getPartHeader = (name: string) =>
        partHeaders.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value || '';
      
      // Check for Content-Disposition: attachment or inline with filename
      const contentDisposition = getPartHeader('content-disposition');
      const contentId = getPartHeader('content-id')?.replace(/^<|>$/g, '');
      const isAttachment = contentDisposition.includes('attachment') || 
                          (part.filename && part.filename.length > 0) ||
                          (part.body?.attachmentId);

      // Debug logging for each part
      if (depth === 0) {
        console.log('[Gmail] Extracting attachments - root part mimeType:', mime, 'hasAttachmentId:', !!part.body?.attachmentId, 'filename:', part.filename);
      }

      // Extract attachment info
      if (isAttachment && (part.body?.attachmentId || part.filename)) {
        const attachmentId = part.body?.attachmentId || contentId || `inline-${attachments.length}`;
        const filename = part.filename || `attachment-${attachments.length}`;
        
        console.log('[Gmail] Found attachment at depth', depth, '- id:', attachmentId, 'filename:', filename, 'contentDisposition:', contentDisposition);
        
        // Avoid duplicates
        if (!attachments.find(a => a.id === attachmentId)) {
          attachments.push({
            id: attachmentId,
            filename: filename,
            mimeType: mime,
            size: part.body?.size || 0,
            contentId: contentId,
          });
        }
      }

      // Recurse into multipart children
      if (part.parts && Array.isArray(part.parts)) {
        console.log('[Gmail] Part has', part.parts.length, 'child parts at depth', depth);
        for (const child of part.parts) {
          extractAttachments(child, depth + 1);
        }
      }
    };

    // Extract attachments first (full tree traversal)
    extractAttachments(message.payload);
    
    // Debug: Log found attachments
    console.log('[Gmail] parseEmailMessage - Message', message.id, 'Payload structure:', {
      hasPayload: !!message.payload,
      payloadMimeType: message.payload?.mimeType,
      hasParts: !!message.payload?.parts,
      partsCount: message.payload?.parts?.length || 0,
      payloadHasAttachmentId: !!message.payload?.body?.attachmentId,
      payloadFilename: message.payload?.filename
    });
    if (attachments.length > 0) {
      console.log('[Gmail] parseEmailMessage found', attachments.length, 'attachments:', attachments.map(a => ({ id: a.id, filename: a.filename, mimeType: a.mimeType, size: a.size })));
    } else {
      console.log('[Gmail] parseEmailMessage found NO attachments for message', message.id);
    }

    // Second pass: Extract body content
    const extractBody = (part: any): { text: string; html?: string } => {
      if (!part) return { text: '' };

      const mime = part.mimeType || '';
      const data = part.body?.data ? decodeData(part.body.data) : '';

      // Skip attachments when looking for body
      if (part.body?.attachmentId && part.filename) {
        return { text: '' };
      }

      // Direct text/plain
      if (mime === 'text/plain' && data) {
        return { text: data };
      }

      // HTML (fallback if no plain text exists)
      if (mime === 'text/html' && data) {
        return { text: '', html: data };
      }

      // Multipart: search children
      if (part.parts && Array.isArray(part.parts)) {
        let textContent = '';
        let htmlCandidate: string | undefined;
        for (const child of part.parts) {
          const result = extractBody(child);
          if (result.text && !textContent) textContent = result.text;
          if (result.html && !htmlCandidate) htmlCandidate = result.html;
        }
        return { text: textContent, html: htmlCandidate };
      }

      return { text: '' };
    };

    const bodyResult = extractBody(message.payload);
    bodyText = bodyResult.text;
    bodyHtml = bodyResult.html || '';

    // Use HTML if no plain text, keep the HTML for proper rendering
    if (!bodyText && bodyHtml) {
      bodyText = bodyHtml;
    }
  } else {
    // For metadata format, use snippet if available
    bodyText = message.snippet || '';
  }

  // Determine if this is a reply by checking for inReplyTo or References headers
  // Also check if subject starts with "Re:" or "RE:" or "Fwd:" or "FWD:"
  const inReplyTo = getHeader('in-reply-to');
  const references = getHeader('references');
  const subject = getHeader('subject');
  const messageIdHeader = getHeader('message-id');
  const isReply = Boolean(
    inReplyTo ||
    references ||
    /^(re|fwd?):\s*/i.test(subject)
  );

  return {
    id: message.id,
    threadId: message.threadId,
    messageId: messageIdHeader,
    snippet: message.snippet || '',
    subject,
    from: getHeader('from'),
    to: getHeader('to'),
    date: getHeader('date'),
    body: bodyText,
    labels: message.labelIds || [],
    isReply,
    attachments, // Include attachment metadata
  };
}

function encodeBase64Url(input: string) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Send a new email (not a reply) and create a ticket
 */
export async function sendNewEmail(
  to: string,
  recipientName: string | null,
  subject: string,
  body: string,
  userId: string
) {
  const tokens = await getValidTokens();
  if (!tokens || !tokens.access_token) {
    throw new Error('Not authenticated. Please connect Gmail first.');
  }

  const gmail = getGmailClient(tokens);

  const headers = [
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
  ].filter(Boolean).join('\r\n');

  const normalizedBody = body.replace(/\r?\n/g, '\r\n');
  const message = `${headers}\r\n\r\n${normalizedBody}`;
  const encodedMessage = encodeBase64Url(message);

  // Send the email with retry logic and better error handling
  let response;
  let retries = 3;
  let lastError: any = null;

  while (retries > 0) {
    try {
      response = await gmail.users.messages.send({
        userId: 'me',
        requestBody: {
          raw: encodedMessage,
        },
      });
      break; // Success, exit retry loop
    } catch (error: any) {
      console.error(`Gmail API send attempt failed (${4 - retries}/3):`, error.message);
      lastError = error;
      retries--;

      // For ECONNRESET, the email might have been sent successfully despite the error
      // Let's check if we can find the message in sent folder
      if (error.code === 'ECONNRESET' || error.message?.includes('ECONNRESET')) {
        console.log('ECONNRESET detected - checking if email was actually sent...');
        try {
          // Try to find the message in sent folder by checking recent messages
          const sentResponse = await gmail.users.messages.list({
            userId: 'me',
            q: `subject:(${subject.replace(/"/g, '\\"')}) in:sent`,
            maxResults: 5,
          });

          if (sentResponse.data.messages && sentResponse.data.messages.length > 0) {
            // Check if any of these messages match our content
            for (const msg of sentResponse.data.messages) {
              try {
                const fullMsg = await gmail.users.messages.get({
                  userId: 'me',
                  id: msg.id!,
                  format: 'metadata',
                });

                // Check if this is our message by comparing subject and approximate time
                const msgSubject = fullMsg.data.payload?.headers?.find((h: any) => h.name === 'Subject')?.value;
                const msgDate = fullMsg.data.payload?.headers?.find((h: any) => h.name === 'Date')?.value;

                if (msgSubject === subject && msgDate) {
                  const msgTime = new Date(msgDate).getTime();
                  const now = Date.now();
                  // If message was sent within last 30 seconds, it's likely ours
                  if (Math.abs(now - msgTime) < 30000) {
                    console.log('Found matching sent message despite ECONNRESET error');
                    response = { data: { id: msg.id, threadId: fullMsg.data.threadId } };
                    break;
                  }
                }
              } catch (checkError) {
                console.error('Error checking sent message:', checkError);
              }
            }
          }

          if (response) break; // Found the message
        } catch (checkError) {
          console.error('Error checking for sent message:', checkError);
        }
      }

      if (retries === 0) {
        throw lastError; // All retries failed
      }
      // Wait before retry
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  const messageId = response!.data.id;
  const threadId = response!.data.threadId;

  if (!threadId) {
    throw new Error('Failed to get thread ID from sent message');
  }

  // Store the sent email
  const sentEmail = {
    id: messageId!,
    threadId: threadId!,
    subject,
    from: await getCurrentUserEmail() || '',
    to,
    body,
    date: new Date().toISOString(),
  };

  // Store the sent email
  try {
    await storeSentEmail(sentEmail);
  } catch (storeError) {
    console.warn('Failed to store sent email for embedding, but email was sent successfully:', storeError);
  }

  // Create a ticket for this new email thread
  const { getOrCreateTicketForThread } = await import('./tickets');
  const ticket = await getOrCreateTicketForThread(threadId, {
    subject,
    customerEmail: to,
    customerName: recipientName,
    initialStatus: 'open',
    priority: null, // Let it be unassigned initially
    tags: ['outbound'],
    lastCustomerReplyAt: null,
    lastAgentReplyAt: new Date().toISOString(),
  });

  if (!ticket) {
    console.error('Failed to create ticket for sent email, but email was sent successfully');
    // Don't throw error here - email was sent, just log the ticket creation failure
  } else {
    // Try to assign the ticket to the current user since they sent it
    try {
      const { assignTicket } = await import('./tickets');
      const userEmail = await getCurrentUserEmail();
      const assignedTicket = await assignTicket(ticket.id, userId, userEmail, userId);
      if (!assignedTicket) {
        console.warn(`Failed to assign ticket ${ticket.id} to user ${userId}, but ticket was created`);
      }
    } catch (assignError) {
      console.warn('Failed to assign ticket to user, but ticket was created:', assignError);
    }
  }

  return {
    messageId,
    threadId,
    ticketId: ticket?.id || null,
  };
}

/**
 * Fetch inbox emails from ALL connected accounts for a business
 */
export async function fetchAllInboxEmails(
  businessId: string,
  maxResults: number = 50,
  query?: string,
  includeBody: boolean = false
) {
  const { loadBusinessTokens } = await import('./storage');
  const accounts = await loadBusinessTokens(businessId);

  if (accounts.length === 0) {
    return [];
  }

  // Fetch from all accounts in parallel
  const results = await Promise.all(
    accounts.map(async ({ email, tokens }) => {
      try {
        const emails = await fetchInboxEmails(tokens, maxResults, query, includeBody);
        // Tag each email with the source account
        return emails.map(e => ({ ...e, accountEmail: email }));
      } catch (error) {
        console.error(`Error fetching inbox for ${email}:`, error);
        return [];
      }
    })
  );

  // Flatten and sort by date (newest first)
  const allEmails = results.flat().sort((a, b) => {
    const dateA = new Date(a.date || 0).getTime();
    const dateB = new Date(b.date || 0).getTime();
    return dateB - dateA;
  });

  return allEmails;
}

/**
 * Fetch sent emails from ALL connected accounts for a business
 */
export async function fetchAllSentEmails(
  businessId: string,
  maxResults: number = 50,
  includeBody: boolean = false
) {
  const { loadBusinessTokens } = await import('./storage');
  const accounts = await loadBusinessTokens(businessId);

  if (accounts.length === 0) {
    return [];
  }

  // Fetch from all accounts in parallel
  const results = await Promise.all(
    accounts.map(async ({ email, tokens }) => {
      try {
        const emails = await fetchSentEmails(tokens, maxResults, includeBody);
        // Tag each email with the source account
        return emails.map(e => ({ ...e, accountEmail: email }));
      } catch (error) {
        console.error(`Error fetching sent emails for ${email}:`, error);
        return [];
      }
    })
  );

  // Flatten and sort by date (newest first)
  const allEmails = results.flat().sort((a, b) => {
    const dateA = new Date(a.date || 0).getTime();
    const dateB = new Date(b.date || 0).getTime();
    return dateB - dateA;
  });

  return allEmails;
}


