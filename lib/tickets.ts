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
}

// Lightweight email shape used when creating/updating tickets
export interface TicketEmailLike {
  id: string;
  threadId?: string;
  subject: string;
  from: string;
  to: string;
  date: string;
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

  // 1) Check if ticket already exists
  const existing = await getTicketByThreadId(threadId, userEmail);
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
    owner_email: userEmail, // Default to current user email as owner
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

  // 2) Classify ticket to department (async, non-blocking)
  // Pass customer email and thread ID for enhanced classification context

  if (emailBody) {
    classifyTicketToDepartmentAsync(
      ticket.id,
      seed.subject,
      emailBody,
      userEmail,
      seed.customerEmail, // Customer email for history lookup
      threadId // Thread ID for context
    ).catch(err => {
      console.error('[Ticket] Department classification failed (non-blocking):', err);
    });
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
  isFromAgent: boolean
): Promise<Ticket | null> {
  if (!supabase) return null;

  const userEmail = await getCurrentUserEmail();
  const threadId = email.threadId || email.id;
  const dateIso = new Date(email.date).toISOString();

  // Guess customer email based on direction
  const customerEmail = isFromAgent ? email.to : email.from;

  // Try to find existing ticket
  let ticket = await getTicketByThreadId(threadId, userEmail);

  if (!ticket) {
    // Create new ticket using this email as seed
    ticket = await getOrCreateTicketForThread(threadId, {
      subject: email.subject,
      customerEmail,
      customerName: null,
      initialStatus: isFromAgent ? 'pending' : 'open',
      priority: undefined, // Don't set priority for unassigned tickets
      tags: [],
      lastCustomerReplyAt: isFromAgent ? undefined : dateIso,
      lastAgentReplyAt: isFromAgent ? dateIso : undefined,
    })!;
    if (ticket) {
      console.log(`[Ticket] Created ticket ${ticket.id} for email ${email.id}`, {
        threadId,
        lastCustomerReplyAt: ticket.lastCustomerReplyAt,
        createdAt: ticket.createdAt,
        dateIso
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
    // CRITICAL FIX: Check if email is newer than ticket's last update (including status changes)
    // This prevents old emails from reopening tickets that were closed AFTER the email arrived
    if (ticketUpdatedAt && incomingDate <= ticketUpdatedAt) {
      // Email is older than or equal to the ticket's last update - ignore it
      console.log(`[Ticket] Ignoring old customer email ${email.id} for ticket ${ticket.id} (email: ${dateIso}, ticket updated: ${ticket.updatedAt})`);
      return ticket;
    }

    // Only update if this is a NEWER customer reply than what we've seen before
    if (!lastCustomerReplyDate || incomingDate > lastCustomerReplyDate) {
      updates.last_customer_reply_at = dateIso;

      // ONLY re-open if ticket is CLOSED - do NOT touch status for open/pending tickets
      if (ticket.status === 'closed') {
        console.log(`[Ticket] Auto-reopening closed ticket ${ticket.id} due to NEW customer reply (email: ${dateIso}, last update: ${ticket.updatedAt})`);
        updates.status = 'open';
      }
      // If ticket is already open/pending, do NOT change the status
    } else {
      // Email is older than our last known customer reply - ignore it
      console.log(`[Ticket] Ignoring old customer email ${email.id} for ticket ${ticket.id} (already have newer reply)`);
      return ticket;
    }
  }

  if (userEmail) {
    updates.user_email = userEmail;
  }

  let query = supabase
    .from('tickets')
    .update(updates)
    .eq('thread_id', threadId);

  if (userEmail) {
    query = query.eq('user_email', userEmail);
  }

  const { data, error } = await query
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
        user_email: userEmail || null,
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
export async function getTickets(
  currentUserId: string | null,
  canViewAll: boolean,
  userEmail: string | null,
  accountFilter?: string,
  businessId?: string | null
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
  query = query.order('last_customer_reply_at', { ascending: false, nullsFirst: false });

  // OPTIMIZED: Removed limit to prevent hiding new tickets
  // query = query.limit(500);

  const { data, error } = await query;

  console.log(`[getTickets] Query params: userEmail=${userEmail}, canViewAll=${canViewAll}`);

  if (error) {
    console.error('Error fetching tickets:', error);
    // Fallback to simple query if JOIN fails (backward compatibility)
    return getTicketsFallback(currentUserId, canViewAll, userEmail);
  }

  console.log(`[getTickets] Found ${data?.length || 0} tickets`);

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
  userEmail: string | null
): Promise<Ticket | null> {
  if (!supabase) return null;

  const updates: any = {
    status,
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

