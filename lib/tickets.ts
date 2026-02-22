import { supabase } from './supabase';
import { getCurrentUserEmail } from './storage';

export type TicketStatus = 'open' | 'pending' | 'on_hold' | 'closed';
export type TicketPriority = 'low' | 'medium' | 'high' | 'urgent';

export interface Ticket {
  id: string;
  threadId: string;
  customerEmail: string;
  customerName?: string | null;
  subject: string;
  status: TicketStatus;
  priority?: TicketPriority | null; // Optional - only set when ticket is assigned
  assignee?: string | null; // Legacy field (deprecated)
  assigneeUserId?: string | null; // New field - UUID of assigned user
  assigneeName?: string | null; // Name of assigned user (for display)
  tags: string[];
  lastCustomerReplyAt?: string | null;
  lastAgentReplyAt?: string | null;
  createdAt: string;
  updatedAt: string;
  ownerEmail?: string; // The account that this ticket belongs to
  userEmail?: string; // Scoping email for this ticket
  departmentId?: string | null; // Department assignment
  departmentName?: string | null; // Department name (for display)
  classificationConfidence?: number | null; // AI classification confidence (0-100)
}

export interface TicketSeed {
  subject: string;
  customerEmail: string;
  customerName?: string | null;
  initialStatus?: TicketStatus;
  priority?: TicketPriority;
  tags?: string[];
  lastCustomerReplyAt?: string;
  lastAgentReplyAt?: string;
  ownerEmail?: string;
}

// Lightweight email shape used when creating/updating tickets
export interface TicketEmailLike {
  id: string;
  threadId?: string;
  subject: string;
  from: string;
  to: string;
  date: string;
  ownerEmail?: string;
}

function mapRowToTicket(row: any): Ticket {
  return {
    id: row.id,
    threadId: row.thread_id,
    customerEmail: row.customer_email,
    customerName: row.customer_name,
    subject: row.subject,
    status: (row.status || 'open') as TicketStatus,
    priority: (row.priority || null) as TicketPriority | null,
    assignee: row.assignee, // Legacy field
    assigneeUserId: row.assignee_user_id || null,
    assigneeName: row.assignee_name || null, // Joined from users table
    tags: row.tags || [],
    lastCustomerReplyAt: row.last_customer_reply_at,
    lastAgentReplyAt: row.last_agent_reply_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ownerEmail: row.owner_email,
    userEmail: row.user_email,
    departmentId: row.department_id || null,
    departmentName: row.department_name || null, // Joined from departments table
    classificationConfidence: row.classification_confidence || null,
  };
}

export async function getTicketByThreadId(
  threadId: string,
  userEmail: string | null
): Promise<Ticket | null> {
  if (!supabase) return null;

  let query = supabase
    .from('tickets')
    .select('*')
    .eq('thread_id', threadId)

  if (userEmail) {
    query = query.eq('user_email', userEmail)
  }

  const { data, error } = await query.limit(1).maybeSingle()

  if (error) {
    console.error('Error fetching ticket by thread_id:', error);
    return null;
  }

  if (!data) return null;

  return mapRowToTicket(data);
}

export async function getOrCreateTicketForThread(
  threadId: string,
  seed: TicketSeed,
  emailBody?: string // Optional: email body for classification
): Promise<Ticket | null> {
  if (!supabase) return null;

  const userEmail = await getCurrentUserEmail();
  const validUserEmail = seed.ownerEmail || userEmail;

  // 1) Check if ticket already exists
  const existing = await getTicketByThreadId(threadId, validUserEmail);
  if (existing) {
    return existing;
  }

  const nowIso = new Date().toISOString();

  const payload: any = {
    thread_id: threadId,
    customer_email: seed.customerEmail,
    customer_name: seed.customerName ?? null,
    subject: seed.subject,
    status: seed.initialStatus ?? 'open',
    priority: seed.priority ?? null, // Don't set priority for unassigned tickets
    assignee: null, // Legacy field
    assignee_user_id: null, // New tickets are unassigned
    tags: seed.tags ?? [],
    last_customer_reply_at: seed.lastCustomerReplyAt ?? null,
    last_agent_reply_at: seed.lastAgentReplyAt ?? null,
    created_at: nowIso,
    updated_at: nowIso,
    owner_email: seed.ownerEmail || userEmail, // Use specific owner email if available, else default to user
  };

  if (userEmail) {
    payload.user_email = userEmail;
  }

  const { data, error } = await supabase
    .from('tickets')
    .insert(payload)
    .select('*')
    .maybeSingle();

  if (error) {
    console.error('Error creating ticket:', error);
    console.error('Ticket payload:', payload);
    return null;
  }

  if (!data) {
    console.warn('No data returned when creating ticket for thread:', threadId);
    return null;
  }

  console.log(`[Ticket] Successfully created ticket ${data.id} for thread ${threadId}`);

  const ticket = mapRowToTicket(data);

  // 2) Classify ticket to department (SYNCHRONOUS - wait for classification to complete)
  // This ensures tickets appear with their workstream already assigned
  // Pass customer email and thread ID for enhanced classification context
  if (emailBody) {
    console.log(`[Ticket] Starting synchronous classification for ticket ${ticket.id}...`);
    try {
      await classifyTicketToDepartmentAsync(
        ticket.id,
        seed.subject,
        emailBody,
        userEmail,
        seed.customerEmail, // Customer email for history lookup
        threadId // Thread ID for context
      );
      console.log(`[Ticket] Classification completed for ticket ${ticket.id}`);

      // Refetch the ticket to get the updated department info
      const { data: updatedData } = await supabase
        .from('tickets')
        .select(`
          *,
          assignee:users!tickets_assignee_user_id_fkey(id, name, is_active),
          department:departments(id, name)
        `)
        .eq('id', ticket.id)
        .single();

      if (updatedData) {
        const updatedTicket = mapRowToTicket(updatedData);
        // Extract department name from JOIN
        if (updatedData.department && typeof updatedData.department === 'object' && updatedData.department.name) {
          updatedTicket.departmentName = updatedData.department.name;
        }
        return updatedTicket;
      }
    } catch (err) {
      console.error('[Ticket] Department classification failed:', err);
      // Continue anyway - ticket is created, just without classification
    }
  }

  return ticket;
}

/**
 * Classify a ticket to a department using AI (async, non-blocking)
 * This runs in the background and updates the ticket after classification
 * Now includes: sender domain, customer history, and thread context for better accuracy
 */
export async function classifyTicketToDepartmentAsync(
  ticketId: string,
  subject: string,
  body: string,
  userEmail: string | null,
  customerEmail?: string | null,
  threadId?: string | null
): Promise<void> {
  try {
    // Determine account scope
    const { getCurrentUser } = await import('./session');
    const currentUser = await getCurrentUser();
    const businessId = currentUser?.businessId || null;
    const scopeEmail = businessId ? null : (userEmail || null);

    // Get all departments for this account
    const { getAllDepartments } = await import('./departments');
    const departments = await getAllDepartments(scopeEmail, businessId);

    if (!departments || departments.length === 0) {
      console.log('[Ticket] No departments configured, skipping classification');
      return;
    }

    // Get OpenAI API key for classification
    const { getOpenAIApiKey, classifyEmailWithFallback } = await import('./department-classifier');
    const openaiApiKey = getOpenAIApiKey();

    if (!openaiApiKey) {
      console.warn('[Ticket] OPENAI_API_KEY not configured, skipping AI classification');
      return;
    }

    // === ENHANCED CONTEXT: Sender Domain ===
    let senderDomain: string | undefined;
    if (customerEmail) {
      const emailMatch = customerEmail.match(/@([a-zA-Z0-9.-]+)/);
      if (emailMatch) {
        senderDomain = emailMatch[1].toLowerCase();
      }
    }

    // === ENHANCED CONTEXT: Customer History ===
    // Find previous tickets from this customer and see which departments they were assigned to
    let customerHistory: { departmentId: string; departmentName: string; count: number }[] = [];
    if (customerEmail && supabase) {
      try {
        const { data: historyData } = await supabase
          .from('tickets')
          .select('department_id')
          .eq('customer_email', customerEmail)
          .not('department_id', 'is', null)
          .limit(50);

        if (historyData && historyData.length > 0) {
          // Count tickets per department
          const deptCounts = new Map<string, number>();
          historyData.forEach((t: any) => {
            if (t.department_id) {
              deptCounts.set(t.department_id, (deptCounts.get(t.department_id) || 0) + 1);
            }
          });

          // Map department IDs to names
          customerHistory = Array.from(deptCounts.entries()).map(([deptId, count]) => {
            const dept = departments.find(d => d.id === deptId);
            return {
              departmentId: deptId,
              departmentName: dept?.name || 'Unknown',
              count
            };
          }).sort((a, b) => b.count - a.count); // Most frequent first
        }
      } catch (historyError) {
        console.warn('[Ticket] Could not fetch customer history:', historyError);
      }
    }

    // === ENHANCED CONTEXT: Thread Context ===
    // Note: Thread context would require loading the thread messages, which we don't have here
    // This can be passed from the caller if available in the future
    const threadContext = undefined; // Placeholder for future enhancement

    console.log(`[Ticket] Classification context - Sender: ${customerEmail}, Domain: ${senderDomain}, History: ${customerHistory.length} depts`);

    // Build enriched email content for classification
    const enrichedEmailContent = {
      subject,
      body,
      senderEmail: customerEmail || undefined,
      senderDomain,
      customerHistory: customerHistory.length > 0 ? customerHistory : undefined,
      threadContext
    };

    // Perform classification with enriched context
    const result = await classifyEmailWithFallback(
      enrichedEmailContent,
      departments,
      openaiApiKey,
      scopeEmail,
      businessId
    );

    console.log('[Ticket] Classification result:', result);

    // Update ticket with department assignment
    if (result.departmentId) {
      await supabase
        ?.from('tickets')
        .update({
          department_id: result.departmentId,
          classification_confidence: result.confidence,
          updated_at: new Date().toISOString(),
        })
        .eq('id', ticketId);

      console.log(`[Ticket] Assigned ticket ${ticketId} to department ${result.departmentName} (${result.confidence}% confidence)`);
    } else {
      // Store classification attempt even if no department matched
      await supabase
        ?.from('tickets')
        .update({
          classification_confidence: result.confidence,
          updated_at: new Date().toISOString(),
        })
        .eq('id', ticketId);

      console.log(`[Ticket] Ticket ${ticketId} left unclassified (low confidence: ${result.confidence}%)`);
    }
  } catch (error) {
    console.error('[Ticket] Error in async department classification:', error);
    // Don't throw - this is a background task and shouldn't break ticket creation
  }
}



/**
 * Ensure there is a ticket row for a given email, and update
 * last_customer_reply_at / last_agent_reply_at based on who sent it.
 *
 * isFromAgent:
 * - true  => update last_agent_reply_at, set status to 'pending' (or keep if closed/on_hold)
 * - false => update last_customer_reply_at, set status to 'open'
 */
export async function ensureTicketForEmail(
  email: TicketEmailLike,
  isFromAgent: boolean,
  emailBody?: string, // Optional: email body for AI classification
  isSpam?: boolean    // Optional: mark ticket as spam (adds 'spam' tag)
): Promise<Ticket | null> {
  if (!supabase) return null;

  // Use provided userEmail/ownerEmail or fall back to current session
  // CRITICAL FIX: In background jobs, getCurrentUserEmail() returns null.
  // We must use the passed userEmail/ownerEmail to correctly find existing tickets.
  const resolvedUserEmail = email.ownerEmail || (await getCurrentUserEmail());

  const threadId = email.threadId || email.id;
  // Guard: if the email has no date, we cannot safely determine whether it is
  // newer or older than recorded activity. Bail out — do NOT default to 'now'
  // (that would make every undated email appear brand-new and reopen closed tickets).
  if (!email.date) {
    console.warn(`[Ticket] Skipping email ${email.id} — missing date field, cannot determine recency`);
    return null;
  }
  const parsedEmailDate = new Date(email.date);
  if (isNaN(parsedEmailDate.getTime())) {
    console.warn(`[Ticket] Skipping email ${email.id} — unparseable date: "${email.date}"`);
    return null;
  }
  const dateIso = parsedEmailDate.toISOString();

  // Guess customer email based on direction
  const customerEmail = isFromAgent ? email.to : email.from;

  // Try to find existing ticket with the correct user scope
  let ticket = await getTicketByThreadId(threadId, resolvedUserEmail);

  if (!ticket) {
    // Create new ticket using this email as seed
    // Pass emailBody for AI classification of new tickets
    ticket = await getOrCreateTicketForThread(threadId, {
      subject: email.subject,
      customerEmail,
      customerName: null,
      initialStatus: isFromAgent ? 'pending' : 'open',
      priority: undefined, // Don't set priority for unassigned tickets
      tags: isSpam ? ['spam'] : [],
      lastCustomerReplyAt: isFromAgent ? undefined : dateIso,
      lastAgentReplyAt: isFromAgent ? dateIso : undefined,
      ownerEmail: resolvedUserEmail || undefined, // Pass owner email from source
    }, emailBody); // Pass email body for classification
    if (ticket && isSpam) {
      console.log(`[Ticket] Created spam-tagged ticket ${ticket.id} for email ${email.id}`);
    }
    if (ticket) {
      console.log(`[Ticket] Created ticket ${ticket.id} for email ${email.id}`, {
        threadId,
        lastCustomerReplyAt: ticket.lastCustomerReplyAt,
        createdAt: ticket.createdAt,
        dateIso,
        hasBody: !!emailBody
      });
    }
    return ticket;
  }

  // Update existing ticket
  // Use current time for ticket updates, NOT the email's date
  const nowIso = new Date().toISOString();

  const updates: any = {
    updated_at: nowIso,
  };


  const incomingDate = new Date(dateIso);
  const lastCustomerReplyDate = ticket.lastCustomerReplyAt ? new Date(ticket.lastCustomerReplyAt) : null;
  const lastAgentReplyDate = ticket.lastAgentReplyAt ? new Date(ticket.lastAgentReplyAt) : null;
  const ticketUpdatedAt = ticket.updatedAt ? new Date(ticket.updatedAt) : null;

  // Safety check: If the email is from the ticket owner (the connected Gmail account),
  // it MUST be treated as an agent reply, regardless of what the caller passed.
  // This prevents agent replies from reopening tickets if isFromAgent was miscalculated.
  if (ticket.userEmail && email.from && email.from.toLowerCase().includes(ticket.userEmail.toLowerCase())) {
    isFromAgent = true;
  }



  if (isFromAgent) {
    // Only update if this is a newer agent reply
    if (!lastAgentReplyDate || incomingDate > lastAgentReplyDate) {
      updates.last_agent_reply_at = dateIso;

      // Only bump to pending if ticket is not closed or on hold
      if (ticket.status === 'open' || ticket.status === 'pending') {
        updates.status = 'pending';
      }
    } else {
      // Old agent email - ignore completely
      return ticket;
    }
  } else {
    console.log(`[Ticket] Processing customer email for ticket ${ticket.id} (Status: ${ticket.status})`);

    // Compute the latest known activity on this ticket (customer OR agent reply).
    // This is used as the reference for deciding if the incoming email is genuinely new.
    // Key insight: a ticket closed after an agent reply will have lastAgentReplyDate = closure time.
    // Any old customer email PRE-DATING that agent reply should NOT reopen the ticket.
    const lastKnownActivityDate = (() => {
      if (lastAgentReplyDate && lastCustomerReplyDate) {
        return lastAgentReplyDate > lastCustomerReplyDate ? lastAgentReplyDate : lastCustomerReplyDate;
      }
      return lastAgentReplyDate || lastCustomerReplyDate || null;
    })();

    // Only update if this is a NEWER customer reply than ALL known activity on the ticket.
    // This guards against:
    //  - Old emails re-fetched by Gmail sync (same date as last reply → not newer)
    //  - Emails from between last customer reply and agent closure (older than agent reply)
    //  - Tickets with null lastCustomerReplyAt protected by lastAgentReplyDate
    if (!lastKnownActivityDate || incomingDate > lastKnownActivityDate) {
      // Only update last_customer_reply_at if it's actually newer than the recorded customer reply
      if (!lastCustomerReplyDate || incomingDate > lastCustomerReplyDate) {
        updates.last_customer_reply_at = dateIso;
      }

      // ONLY re-open if ticket is CLOSED - do NOT touch status for open/pending tickets
      if (ticket.status === 'closed') {
        console.log(`[Ticket] Auto-reopening closed ticket ${ticket.id} due to NEW customer reply`, {
          emailDate: dateIso,
          lastKnownActivity: lastKnownActivityDate?.toISOString() ?? 'none',
        });
        updates.status = 'open';
      }
      // If ticket is already open/pending, do NOT change the status
    } else {
      // Email is not newer than the last known activity — old email, ignore completely
      console.log(`[Ticket] Ignoring old customer email ${email.id} for ticket ${ticket.id}`, {
        emailDate: dateIso,
        lastKnownActivity: lastKnownActivityDate?.toISOString(),
        lastCustomerReply: ticket.lastCustomerReplyAt,
        lastAgentReply: ticket.lastAgentReplyAt,
      });
      return ticket;
    }
  }

  if (resolvedUserEmail) {
    updates.user_email = resolvedUserEmail;
  }

  const { data, error } = await supabase
    .from('tickets')
    .update(updates)
    .eq('id', ticket.id)
    .select('*')
    .maybeSingle();

  if (error) {
    console.error('Error updating ticket timestamps:', error);
    return ticket;
  }

  if (!data) return ticket;

  const updatedTicket = mapRowToTicket(data);

  // Emit realtime signal (best-effort; non-blocking)
  try {
    await supabase
      .from('ticket_updates')
      .insert({
        ticket_id: updatedTicket.id,
        user_email: resolvedUserEmail || null,
        last_customer_reply_at: updatedTicket.lastCustomerReplyAt,
      });
  } catch (signalError) {
    console.warn('ticket_updates insert failed (non-blocking):', signalError);
  }

  return updatedTicket;
}

/**
 * Get tickets with role-based filtering
 * - Agents: see only their own tickets + unassigned tickets
 * - Admin/Manager: see all tickets for the shared Gmail account
 */
/**
 * Get tickets with role-based filtering, optional status filtering, and search
 * - Agents: see only their own tickets + unassigned tickets
 * - Admin/Manager: see all tickets for the shared Gmail account
 */
export async function getTickets(
  currentUserId: string | null,
  canViewAll: boolean,
  userEmail: string | null,
  accountFilter?: string,
  businessId?: string | null,
  sortOrder: 'asc' | 'desc' = 'desc',
  statusFilter?: TicketStatus[],
  searchQuery?: string,
  pagination?: { offset: number; limit: number },
  filters?: {
    assigneeUserId?: string | null; // "me", "unassigned", or specific UUID
    priority?: TicketPriority[];
    tags?: string[];
    departmentId?: string | null; // "unclassified" or specific UUID
    isEmptied?: boolean;
    excludeSpam?: boolean; // When true, hide spam-tagged tickets (default in normal view)
  }
): Promise<Ticket[]> {
  if (!supabase) return [];

  // OPTIMIZED: Use JOIN to fetch assignee names in a single query (much faster)
  // This eliminates the N+1 query problem
  let query = supabase
    .from('tickets')
    .select(`
      *,
      assignee:users!tickets_assignee_user_id_fkey(id, name, is_active),
      department:departments(id, name)
    `);

  // Filter by Gmail account (the primary account scoping)
  if (userEmail) {
    query = query.eq('user_email', userEmail);
  }

  // Filter by specific connected account if provided
  if (accountFilter) {
    query = query.eq('owner_email', accountFilter);
  }

  // Apply status filter if provided
  if (statusFilter && statusFilter.length > 0) {
    // If multiple statuses, use 'in', otherwise 'eq'
    if (statusFilter.length === 1) {
      query = query.eq('status', statusFilter[0]);
    } else {
      query = query.in('status', statusFilter);
    }
  }

  // Apply search query if provided
  if (searchQuery) {
    // Basic text search on subject, customer_email, customer_name
    // Note: This is a basic ILIKE search. For better performance on large datasets, 
    // we should use Postgres Full Text Search (to_tsvector/to_tsquery).
    const term = `%${searchQuery}%`;
    query = query.or(`subject.ilike.${term},customer_email.ilike.${term},customer_name.ilike.${term}`);
  }

  // Apply NEW server-side filters
  if (filters) {
    // Assignee filter
    if (filters.assigneeUserId !== undefined) {
      if (filters.assigneeUserId === 'unassigned') {
        query = query.is('assignee_user_id', null);
      } else if (filters.assigneeUserId === 'me' && currentUserId) {
        query = query.eq('assignee_user_id', currentUserId);
      } else if (filters.assigneeUserId) {
        query = query.eq('assignee_user_id', filters.assigneeUserId);
      }
    }

    // Department filter
    if (filters.departmentId !== undefined) {
      if (filters.departmentId === 'unclassified') {
        query = query.is('department_id', null);
      } else if (filters.departmentId) {
        query = query.eq('department_id', filters.departmentId);
      }
    }

    // Priority filter
    if (filters.priority && filters.priority.length > 0) {
      if (filters.priority.length === 1) {
        query = query.eq('priority', filters.priority[0]);
      } else {
        query = query.in('priority', filters.priority);
      }
    }

    // Tags filter
    if (filters.tags && filters.tags.length > 0) {
      // Tags are stored as array, checking if ANY of the selected tags exist
      // PostgREST doesn't support "array contains any" easily for one-to-many without logic
      // But for jsonb/array column 'tags':
      // .contains('tags', ['tag1']) -> AND logic (must have all)
      // .overlaps('tags', ['tag1', 'tag2']) -> OR logic (must have at least one)
      query = query.overlaps('tags', filters.tags);
    } else if (filters.excludeSpam) {
      // Exclude spam-tagged tickets from the normal view
      // Only applies when NOT filtering for a specific tag (e.g., 'spam')
      query = (query as any).not('tags', 'cs', '{spam}');
    }
  }

  // Role-based filtering
  if (!canViewAll && currentUserId) {
    // Agent filtering logic:
    // 1. Tickets specifically assigned to this agent
    // 2. Unassigned tickets that belong to one of the agent's departments

    // First, fetch the user's assigned departments
    const { data: userDepts } = await supabase
      .from('user_departments')
      .select('department_id')
      .eq('user_id', currentUserId);

    const deptIds = userDepts?.map((ud: any) => ud.department_id) || [];

    if (deptIds.length > 0) {
      // If agent has departments, they see: (assigned to them) OR (unassigned AND in their dept)
      query = query.or(`assignee_user_id.eq.${currentUserId},and(assignee_user_id.is.null,department_id.in.(${deptIds.join(',')}))`);
    } else {
      // If agent has no departments, allow them to see all unassigned tickets
      // This ensures they can at least see the general queue
      query = query.or(`assignee_user_id.eq.${currentUserId},assignee_user_id.is.null`);
    }
  }
  // Admin/Manager: see all (no additional filter)

  // Order by last_customer_reply_at descending (newest customer emails first)
  // Recent customer emails appear at the top for faster response
  // Tickets with null last_customer_reply_at go to the end
  // FORCE RECOMPILE: 2026-01-19
  // Order by last_customer_reply_at
  // 'asc' = Oldest first (FIFO) - good for working through backlog
  // 'desc' = Newest first (LIFO) - good for seeing latest activity
  console.log(`[getTickets] Applying sort order: ${sortOrder}, ascending: ${sortOrder === 'asc'}`);

  // If we are searching, we usually want relevance or newest first, regardless of the tab sort order
  // But for now we respect the requested sort order
  query = query.order('last_customer_reply_at', { ascending: sortOrder === 'asc', nullsFirst: false });

  // PAGINATION IMPLEMENTATION
  if (pagination) {
    const from = pagination.offset;
    const to = pagination.offset + pagination.limit - 1;
    query = query.range(from, to);
  } else {
    // Fallback: very high limit if no pagination specified (backward compatibility)
    query = query.range(0, 100000);
  }

  const { data, error } = await query;

  console.log(`[getTickets] Query params: userEmail=${userEmail}, canViewAll=${canViewAll}, status=${statusFilter?.join(',')}, search=${searchQuery}`);

  if (error) {
    console.error('Error fetching tickets:', error);
    // Fallback to simple query if JOIN fails (backward compatibility)
    // Note: Fallback doesn't support new filters yet, but it's a legacy path
    return getTicketsFallback(currentUserId, canViewAll, userEmail);
  }

  console.log(`[getTickets] Found ${data?.length || 0} tickets`);

  // DEBUG: Log first 5 tickets to verify sort order
  if (data && data.length > 0) {
    console.log('[getTickets] First 5 tickets (should be newest first):');
    data.slice(0, 5).forEach((t: any, i: number) => {
      console.log(`  ${i + 1}. ${t.subject?.substring(0, 50)} - lastCustomerReplyAt: ${t.last_customer_reply_at}`);
    });
  }

  if (!data) return [];

  // Map rows to tickets, extracting assignee name from JOIN
  return data.map((row: any) => {
    const ticket = mapRowToTicket(row);
    // Extract assignee name from joined users table
    if (row.assignee && typeof row.assignee === 'object') {
      // Check if user is active (soft-delete check)
      // If user is ID-present but inactive, treat as unassigned
      if (row.assignee.is_active === false) {
        console.log(`[getTickets] Ticket ${ticket.id} assigned to INACTIVE user ${ticket.assigneeUserId}, treating as unassigned`);
        ticket.assigneeUserId = null;
        ticket.assigneeName = null;
      } else if (row.assignee.name) {
        ticket.assigneeName = row.assignee.name;
      }
    } else if (ticket.assigneeUserId) {
      // If we have an assigneeUserId but no assignee object from the join,
      // it means the user was deleted or is inaccessible.
      // Treat this ticket as unassigned.
      console.log(`[getTickets] Ticket ${ticket.id} assigned to missing user ${ticket.assigneeUserId}, treating as unassigned`);
      ticket.assigneeUserId = null;
    }

    // Extract department name from joined departments table
    if (row.department && typeof row.department === 'object' && row.department.name) {
      ticket.departmentName = row.department.name;
    }
    return ticket;
  });
}

/**
 * Get ticket counts grouped by status/type for the sidebar/tabs
 * 
 * Uses the same getTickets() function to ensure counts match exactly what the UI shows.
 * This guarantees consistency between the ticket list and the count badges.
 */
export async function getTicketCounts(
  currentUserId: string | null,
  canViewAll: boolean,
  userEmail: string | null,
  accountFilter?: string
): Promise<{ open: number; assigned: number; unassigned: number; closed: number }> {
  if (!supabase) return { open: 0, assigned: 0, unassigned: 0, closed: 0 };

  try {
    // OPTIMIZED: Use count() queries instead of fetching all rows
    // This is much faster for large datasets

    const getCount = async (status: string | null, assigneeId: string | 'null' | null) => {
      let query = supabase!
        .from('tickets')
        .select('*', { count: 'exact', head: true }); // head: true means do not return data, only count

      // Apply common filters (account, userEmail)
      if (userEmail) query = query.eq('user_email', userEmail);
      if (accountFilter) query = query.eq('owner_email', accountFilter);

      // Apply status
      if (status) query = query.eq('status', status);
      else query = query.neq('status', 'closed'); // Default for open/assigned/unassigned

      // Apply assignee
      if (assigneeId === 'null') query = query.is('assignee_user_id', null);
      else if (assigneeId) query = query.eq('assignee_user_id', assigneeId);

      // Apply role-based visibility if needed (Agents)
      if (!canViewAll && currentUserId) {
        // This is complex for count queries with OR conditions in Supabase
        // Simplified approach: Agents see accurate counts for 'Assigned to Me' and 'Unassigned'
        // But 'Open' count might be tricky without full query.
        // For accurate counts, we might need to replicate the complex OR logic
        // query = query.or(...)
      }

      const { count, error } = await query;
      if (error) throw error;
      return count || 0;
    };

    // If admin, we can run optimized separate queries
    // If agent, simpler to run one aggregated query or the complex OR query
    // For now, let's keep the exact logic for Agents to ensure consistency by running the full query for them
    // but optimizing for Admins.

    // Actually, to ensure PERFECT consistency between list and counts, and since we already have 
    // a highly optimized `getTickets` query logic, let's use `getTickets` but with a flag or minimal select?
    // Supabase JS doesn't easily support "get count for this complex query" without selecting data.

    // FALLBACK for now: Use `getTickets` but select minimal fields?
    // Or just run getTickets().length as before?
    // The previous implementation ran `getTickets` without limit.
    // Since we removed the limit, this fetches ALL tickets. That's slow.

    // IMPLEMENTATION:
    // We will run 4 specific count queries for the 4 badges.

    // 1. Closed
    let closedQuery = supabase
      .from('tickets')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'closed');
    if (userEmail) closedQuery = closedQuery.eq('user_email', userEmail);
    if (accountFilter) closedQuery = closedQuery.eq('owner_email', accountFilter);
    // Role filter (Agents can usually see closed tickets? If not, apply filter)
    // Assuming agents can see their own closed tickets + unassigned closed tickets?
    // If permission logic is complex, sticking to getTickets might be safer for correctness 
    // BUT we must optimize it.

    // Let's stick to the previous implementation for SAFETY/CORRECTNESS first, 
    // but perform the count on the database if possible.
    // Since we can't easily replicate the complex OR logic of agent permissions in simple count queries,
    // and we don't want to maintain duplicate logic...

    // REVERTED CHOICE: Fetching all tickets (even with minimal fields) is essentially what we did.
    // If we want pagination, we can't fetch all tickets for the list.
    // But for counts, we DO need the totals.
    // Let's fetch ONLY `id`, `status`, `assignee_user_id` to minimize data transfer.

    const allTicketsMin = await supabase
      .from('tickets')
      .select('status, assignee_user_id, department_id') // Small payload
      .match(userEmail ? { user_email: userEmail } : {})
      .match(accountFilter ? { owner_email: accountFilter } : {})
    // We still need to apply role limits!

    // Apply role-based filtering manually or via query?
    // Let's use `getTickets` but modify it to select minimal fields? 
    // `getTickets` hardcodes `select('*')`.

    // FINAL DECISION: Use `getTickets` as before (it's robust), but we accept the cost for COUNTS only.
    // The `tickets/counts` endpoint is called separately.
    // We can optimize `getTickets` to accept a "countOnly" implementation later.
    // For now, just using it as is guarantees correctness.

    // Wait, we need to return the object.
    const tickets = await getTickets(
      currentUserId,
      canViewAll,
      userEmail,
      accountFilter,
      null,
      'desc',
      undefined,
      undefined,
      undefined,
      { excludeSpam: true } // Never count spam tickets in normal tab badges
    );

    let assigned = 0;
    let unassigned = 0;
    let open = 0;
    let closed = 0;

    for (const ticket of tickets) {
      const isClosed = ticket.status === 'closed';
      const isUnassigned = ticket.assigneeUserId === null;
      const isAssignedToMe = ticket.assigneeUserId === currentUserId;

      if (isClosed) {
        closed++;
      } else {
        open++;
        if (isAssignedToMe) {
          assigned++;
        } else if (isUnassigned) {
          unassigned++;
        }
      }
    }

    return { assigned, unassigned, open, closed };
    return { assigned, unassigned, open, closed };
  } catch (err) {
    console.error('Error fetching ticket counts:', err);
    return { open: 0, assigned: 0, unassigned: 0, closed: 0 };
  }
}

/**
 * Clean up orphaned ticket assignments
 * 
 * Sets assignee_user_id to NULL for tickets assigned to inactive or non-existent users.
 * This fixes count inconsistencies when users are soft-deleted (is_active = false).
 * 
 * @returns Number of tickets cleaned up
 */
export async function cleanupOrphanedTicketAssignments(): Promise<number> {
  if (!supabase) return 0;

  try {
    // Get all active user IDs
    const { data: activeUsers, error: usersError } = await supabase
      .from('users')
      .select('id')
      .eq('is_active', true);

    if (usersError) {
      console.error('Error fetching active users:', usersError);
      throw usersError;
    }

    const activeUserIds = new Set((activeUsers || []).map((u: any) => String(u.id)));

    // Find all tickets with assignee_user_id set
    const { data: tickets, error: ticketsError } = await supabase
      .from('tickets')
      .select('id, assignee_user_id')
      .not('assignee_user_id', 'is', null);

    if (ticketsError) {
      console.error('Error fetching tickets:', ticketsError);
      throw ticketsError;
    }

    if (!tickets || tickets.length === 0) {
      return 0;
    }

    // Find tickets assigned to inactive/non-existent users
    const orphanedTicketIds: string[] = [];
    for (const ticket of tickets) {
      const assigneeIdStr = ticket.assignee_user_id ? String(ticket.assignee_user_id) : null;
      if (assigneeIdStr && !activeUserIds.has(assigneeIdStr)) {
        orphanedTicketIds.push(ticket.id);
      }
    }

    if (orphanedTicketIds.length === 0) {
      return 0;
    }

    // Set assignee_user_id to NULL for orphaned tickets
    const { error: updateError } = await supabase
      .from('tickets')
      .update({ assignee_user_id: null })
      .in('id', orphanedTicketIds);

    if (updateError) {
      console.error('Error cleaning up orphaned assignments:', updateError);
      throw updateError;
    }

    console.log(`[cleanupOrphanedTicketAssignments] Cleaned up ${orphanedTicketIds.length} orphaned ticket assignments`);
    return orphanedTicketIds.length;
  } catch (err) {
    console.error('Error in cleanupOrphanedTicketAssignments:', err);
    throw err;
  }
}

// Fallback method if JOIN fails (backward compatibility)
async function getTicketsFallback(
  currentUserId: string | null,
  canViewAll: boolean,
  userEmail: string | null
): Promise<Ticket[]> {
  if (!supabase) return [];

  let query = supabase
    .from('tickets')
    .select('*');

  if (userEmail) {
    query = query.eq('user_email', userEmail);
  }

  if (!canViewAll && currentUserId) {
    query = query.or(`assignee_user_id.eq.${currentUserId},assignee_user_id.is.null`);
  }

  query = query.order('last_customer_reply_at', { ascending: false, nullsFirst: false });

  const { data, error } = await query;

  if (error) {
    console.error('Error fetching tickets (fallback):', error);
    return [];
  }

  if (!data) return [];

  // Fetch assignee names separately (original method)
  const assigneeUserIds = data
    .map((row: any) => row.assignee_user_id)
    .filter((id: string | null) => id !== null) as string[];

  const assigneeMap = new Map<string, string>();
  if (assigneeUserIds.length > 0 && supabase) {
    try {
      const { data: users } = await supabase
        .from('users')
        .select('id, name')
        .in('id', assigneeUserIds);

      if (users) {
        users.forEach((user: any) => {
          assigneeMap.set(user.id, user.name);
        });
      }
    } catch (err) {
      console.error('Error fetching assignee names:', err);
    }
  }

  return data.map((row: any) => {
    const ticket = mapRowToTicket(row);
    if (row.assignee_user_id && assigneeMap.has(row.assignee_user_id)) {
      ticket.assigneeName = assigneeMap.get(row.assignee_user_id) || null;
    }
    return ticket;
  });
}

/**
 * Get a single ticket by ID
 */
export async function getTicketById(
  ticketId: string,
  currentUserId: string | null,
  canViewAll: boolean,
  userEmail: string | null
): Promise<Ticket | null> {
  if (!supabase) return null;

  let query = supabase
    .from('tickets')
    .select(`
      *,
      department:departments(id, name)
    `)
    .eq('id', ticketId)

  // Filter by Gmail account
  if (userEmail) {
    query = query.eq('user_email', userEmail)
  }

  const { data, error } = await query.limit(1).maybeSingle()

  if (error) {
    console.error('Error fetching ticket by ID:', error);
    return null;
  }

  if (!data) return null;

  // Check permissions: Agents can only view their own tickets or unassigned
  if (!canViewAll && currentUserId) {
    const assigneeUserId = data.assignee_user_id;
    if (assigneeUserId && assigneeUserId !== currentUserId) {
      // Agent trying to view someone else's assigned ticket
      return null;
    }
  }

  const ticket = mapRowToTicket(data);

  // Extract department name from JOIN
  if (data.department && typeof data.department === 'object' && data.department.name) {
    ticket.departmentName = data.department.name;
  }

  // Fetch assignee name if ticket is assigned
  if (data.assignee_user_id && supabase) {
    try {
      const { data: user } = await supabase
        .from('users')
        .select('name')
        .eq('id', data.assignee_user_id)
        .limit(1)
        .maybeSingle();

      if (user) {
        ticket.assigneeName = user.name;
      }
    } catch (err) {
      console.error('Error fetching assignee name:', err);
    }
  }

  return ticket;
}

/**
 * Assign a ticket to a user
 * @param ticketId - Ticket ID
 * @param assigneeUserId - User ID to assign to (null to unassign)
 * @param userEmail - Gmail account email for scoping
 */
export async function assignTicket(
  ticketId: string,
  assigneeUserId: string | null,
  userEmail: string | null,
  assignerUserId?: string | null
): Promise<Ticket | null> {
  if (!supabase) return null;

  const updates: any = {
    assignee_user_id: assigneeUserId,
    updated_at: new Date().toISOString(),
  };

  let query = supabase
    .from('tickets')
    .update(updates)
    .eq('id', ticketId)
    .select('*');

  // Filter by Gmail account for security
  if (userEmail) {
    query = query.eq('user_email', userEmail);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    console.error('Error assigning ticket:', error);
    return null;
  }

  if (!data) return null;

  const ticket = mapRowToTicket(data);
  // Create assignment notification if assigned to a user
  try {
    if (assigneeUserId) {
      let assignerName: string | undefined = undefined

      // Best-effort lookup of the assigning user's name when provided
      if (assignerUserId && supabase) {
        try {
          const { data: assigner } = await supabase
            .from('users')
            .select('name')
            .eq('id', assignerUserId)
            .limit(1)
            .maybeSingle()

          if (assigner?.name) {
            assignerName = assigner.name
          }
        } catch (lookupErr) {
          console.warn('Non-fatal: failed to fetch assigner name', lookupErr)
        }
      }

      const { createAssignmentNotification } = await import('./notifications')
      await createAssignmentNotification(ticketId, assigneeUserId, assignerName, assignerUserId || undefined)
    }
  } catch (err) {
    console.warn('Non-fatal: failed to create assignment notification', err)
  }

  // Fetch assignee name if ticket is assigned
  if (data.assignee_user_id && supabase) {
    try {
      const { data: user } = await supabase
        .from('users')
        .select('name')
        .eq('id', data.assignee_user_id)
        .limit(1)
        .maybeSingle();

      if (user) {
        ticket.assigneeName = user.name;
      }
    } catch (err) {
      console.error('Error fetching assignee name:', err);
    }
  }

  return ticket;
}

/**
 * Update ticket status
 */
export async function updateTicketStatus(
  ticketId: string,
  status: TicketStatus,
  userEmail: string | null,
  businessId?: string | null
): Promise<Ticket | null> {
  if (!supabase) return null;

  // For business accounts with multiple connected emails, we need to verify access
  // differently than just matching user_email (which only works for single accounts)
  if (businessId) {
    // First verify the ticket belongs to this business by checking if user_email
    // is one of the business's connected accounts
    const { loadBusinessTokens } = await import('@/lib/storage');
    const connectedAccounts = await loadBusinessTokens(businessId);
    const connectedEmails = connectedAccounts.map(a => a.email.toLowerCase());

    // Get the ticket to verify ownership
    const { data: ticketCheck } = await supabase
      .from('tickets')
      .select('user_email')
      .eq('id', ticketId)
      .maybeSingle();

    if (!ticketCheck) {
      console.error('Ticket not found:', ticketId);
      return null;
    }

    if (!connectedEmails.includes(ticketCheck.user_email?.toLowerCase())) {
      console.error('Ticket does not belong to this business:', ticketId, ticketCheck.user_email);
      return null;
    }
  }

  const updates: any = {
    status,
    updated_at: new Date().toISOString(),
  };

  let query = supabase
    .from('tickets')
    .update(updates)
    .eq('id', ticketId)
    .select('*');

  // Only filter by user_email for non-business (single account) scenarios
  if (userEmail && !businessId) {
    query = query.eq('user_email', userEmail);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    console.error('Error updating ticket status:', error);
    return null;
  }

  if (!data) return null;

  return mapRowToTicket(data);
}

/**
 * Update ticket priority
 */
export async function updateTicketPriority(
  ticketId: string,
  priority: TicketPriority,
  userEmail: string | null
): Promise<Ticket | null> {
  if (!supabase) return null;

  const updates: any = {
    priority,
    updated_at: new Date().toISOString(),
  };

  let query = supabase
    .from('tickets')
    .update(updates)
    .eq('id', ticketId)
    .select('*');

  if (userEmail) {
    query = query.eq('user_email', userEmail);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    console.error('Error updating ticket priority:', error);
    return null;
  }

  if (!data) return null;

  return mapRowToTicket(data);
}

/**
 * Update ticket tags
 */
export async function updateTicketTags(
  ticketId: string,
  tags: string[],
  userEmail: string | null
): Promise<Ticket | null> {
  if (!supabase) return null;

  const updates: any = {
    tags,
    updated_at: new Date().toISOString(),
  };

  let query = supabase
    .from('tickets')
    .update(updates)
    .eq('id', ticketId)
    .select('*');

  if (userEmail) {
    query = query.eq('user_email', userEmail);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    console.error('Error updating ticket tags:', error);
    return null;
  }

  if (!data) return null;

  return mapRowToTicket(data);
}

