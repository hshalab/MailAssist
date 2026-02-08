/**
 * Analytics and Logging utilities
 * Tracks guardrail usage, AI usage, and ticket analytics
 */

import { supabase } from './supabase';
import { loadBusinessTokens } from './storage';

export interface GuardrailLog {
  userEmail: string;
  userId?: string | null;
  ticketId?: string | null;
  draftId?: string | null;
  action: 'applied' | 'blocked' | 'topic_rule_triggered';
  guardrailType?: 'tone_style' | 'rules' | 'banned_words' | 'topic_rule';
  details?: Record<string, any>;
  draftContent?: string;
}

export interface AIUsageLog {
  userEmail: string;
  userId?: string | null;
  ticketId?: string | null;
  action: 'draft_generated' | 'draft_regenerated' | 'draft_edited' | 'draft_sent' | 'knowledge_used';
  draftId?: string | null;
  knowledgeItemIds?: string[];
  guardrailApplied?: boolean;
  guardrailBlocked?: boolean;
  responseTimeMs?: number;
  draftLength?: number;
  wasEdited?: boolean;
  wasSent?: boolean;
}

/**
 * Log guardrail usage
 */
export async function logGuardrailUsage(log: GuardrailLog): Promise<void> {
  if (!supabase || !log.userEmail) return;

  try {
    await supabase.from('guardrail_logs').insert({
      user_email: log.userEmail,
      user_id: log.userId || null,
      ticket_id: log.ticketId || null,
      draft_id: log.draftId || null,
      action: log.action,
      guardrail_type: log.guardrailType || null,
      details: log.details || {},
      draft_content: log.draftContent || null,
    });
  } catch (error) {
    console.error('[Analytics] Error logging guardrail usage:', error);
    // Don't throw - logging failures shouldn't break the app
  }
}

/**
 * Log AI usage
 */
export async function logAIUsage(log: AIUsageLog): Promise<void> {
  if (!supabase || !log.userEmail) return;

  try {
    await supabase.from('ai_usage_logs').insert({
      user_email: log.userEmail,
      user_id: log.userId || null,
      ticket_id: log.ticketId || null,
      action: log.action,
      draft_id: log.draftId || null,
      knowledge_item_ids: log.knowledgeItemIds || [],
      guardrail_applied: log.guardrailApplied || false,
      guardrail_blocked: log.guardrailBlocked || false,
      response_time_ms: log.responseTimeMs || null,
      draft_length: log.draftLength || null,
      was_edited: log.wasEdited || false,
      was_sent: log.wasSent || false,
    });
  } catch (error) {
    console.error('[Analytics] Error logging AI usage:', error);
    // Don't throw - logging failures shouldn't break the app
  }
}

/**
 * Get ticket analytics for a date range
 * Calculates from actual tickets table instead of aggregated table
 * For business accounts, includes all tickets for the business
 * For personal accounts, includes only tickets for the user email
 */
export async function getTicketAnalytics(
  userEmail: string,
  startDate: Date,
  endDate: Date,
  businessId?: string | null
): Promise<{
  byStatus: Record<string, number>;
  byDepartment: Record<string, number>;
  totalTickets: number;
  avgResponseTime: number;
  avgResolutionTime: number;
  reopenedTickets: number;
}> {
  if (!supabase || !userEmail) {
    return {
      byStatus: {},
      byDepartment: {},
      totalTickets: 0,
      avgResponseTime: 0,
      avgResolutionTime: 0,
      reopenedTickets: 0,
    };
  }

  try {
    // Set end date to end of day to include the full day
    const endDateWithTime = new Date(endDate);
    endDateWithTime.setHours(23, 59, 59, 999);

    let query = supabase
      .from('tickets')
      .select('status, created_at, updated_at, last_customer_reply_at, last_agent_reply_at, department_id')
      .gte('created_at', startDate.toISOString())
      .lte('created_at', endDateWithTime.toISOString());

    // For business accounts, get all tickets for connected Gmail accounts in this business
    // For personal accounts, filter by user_email
    if (businessId) {
      // Get all connected account emails using robust loader (uses Admin client)
      const connectedAccounts = await loadBusinessTokens(businessId);

      if (connectedAccounts && connectedAccounts.length > 0) {
        const accountEmails = [...new Set(connectedAccounts.map(t => t.email).filter(Boolean))];
        if (accountEmails.length > 0) {
          query = query.in('user_email', accountEmails);
        } else {
          // No connected accounts found, return empty
          return {
            byStatus: {},
            byDepartment: {},
            totalTickets: 0,
            avgResponseTime: 0,
            avgResolutionTime: 0,
            reopenedTickets: 0,
          };
        }
      } else {
        // No connected accounts found, return empty
        return {
          byStatus: {},
          byDepartment: {},
          totalTickets: 0,
          avgResponseTime: 0,
          avgResolutionTime: 0,
          reopenedTickets: 0,
        };
      }
    } else {
      // Personal account - filter by user email
      query = query.eq('user_email', userEmail);
    }

    const { data: tickets, error } = await query;

    if (error) throw error;

    // Count by status and department
    const byStatus: Record<string, number> = {};
    const byDepartment: Record<string, number> = {};
    let totalTickets = 0;
    let reopenedTickets = 0;
    let totalResponseTime = 0;
    let totalResolutionTime = 0;
    let responseTimeCount = 0;
    let resolutionTimeCount = 0;

    tickets?.forEach((ticket: any) => {
      // Count by actual status for detailed breakdown
      const status = ticket.status || 'open';
      byStatus[status] = (byStatus[status] || 0) + 1;
      totalTickets++;

      // Count by department
      const deptId = ticket.department_id || 'unassigned';
      byDepartment[deptId] = (byDepartment[deptId] || 0) + 1;

      // Note: was_reopened tracking requires schema migration

      // Calculate response time (time from customer reply to agent reply)
      if (ticket.last_customer_reply_at && ticket.last_agent_reply_at) {
        const customerTime = new Date(ticket.last_customer_reply_at).getTime();
        const agentTime = new Date(ticket.last_agent_reply_at).getTime();
        if (agentTime > customerTime) {
          const responseTimeMinutes = (agentTime - customerTime) / (1000 * 60);
          totalResponseTime += responseTimeMinutes;
          responseTimeCount++;
        }
      }

      // Calculate resolution time (time from creation to close)
      if (status === 'closed' && ticket.created_at) {
        const createdTime = new Date(ticket.created_at).getTime();
        // Use updated_at as approximation for when ticket was closed
        const closeTime = ticket.updated_at
          ? new Date(ticket.updated_at).getTime()
          : ticket.last_agent_reply_at
            ? new Date(ticket.last_agent_reply_at).getTime()
            : new Date().getTime();
        const resolutionTimeMinutes = (closeTime - createdTime) / (1000 * 60);
        if (resolutionTimeMinutes > 0) {
          totalResolutionTime += resolutionTimeMinutes;
          resolutionTimeCount++;
        }
      }
    });

    return {
      byStatus,
      byDepartment,
      totalTickets,
      avgResponseTime: responseTimeCount > 0 ? totalResponseTime / responseTimeCount : 0,
      avgResolutionTime: resolutionTimeCount > 0 ? totalResolutionTime / resolutionTimeCount : 0,
      reopenedTickets,
    };
  } catch (error) {
    console.error('[Analytics] Error fetching ticket analytics:', error);
    return {
      byStatus: {},
      byDepartment: {},
      totalTickets: 0,
      avgResponseTime: 0,
      avgResolutionTime: 0,
      reopenedTickets: 0,
    };
  }
}

/**
 * Get guardrail usage statistics
 * For business accounts, includes all guardrail logs for the business
 * For personal accounts, includes only logs for the user email
 */
export async function getGuardrailStats(
  userEmail: string,
  startDate: Date,
  endDate: Date,
  businessId?: string | null
): Promise<{
  totalApplied: number;
  totalBlocked: number;
  topicRulesTriggered: number;
  bannedWordsFound: number;
}> {
  if (!supabase || !userEmail) {
    return {
      totalApplied: 0,
      totalBlocked: 0,
      topicRulesTriggered: 0,
      bannedWordsFound: 0,
    };
  }

  try {
    // Set end date to end of day to include the full day
    const endDateWithTime = new Date(endDate);
    endDateWithTime.setHours(23, 59, 59, 999);

    let query = supabase
      .from('guardrail_logs')
      .select('action, guardrail_type, details')
      .gte('created_at', startDate.toISOString())
      .lte('created_at', endDateWithTime.toISOString());

    // For business accounts, get all logs for connected Gmail accounts in this business
    // For personal accounts, filter by user_email
    if (businessId) {
      // Get all connected account emails using robust loader
      const connectedAccounts = await loadBusinessTokens(businessId);

      if (connectedAccounts && connectedAccounts.length > 0) {
        const accountEmails = [...new Set(connectedAccounts.map(t => t.email).filter(Boolean))];
        if (accountEmails.length > 0) {
          query = query.in('user_email', accountEmails);
        } else {
          return {
            totalApplied: 0,
            totalBlocked: 0,
            topicRulesTriggered: 0,
            bannedWordsFound: 0,
          };
        }
      } else {
        return {
          totalApplied: 0,
          totalBlocked: 0,
          topicRulesTriggered: 0,
          bannedWordsFound: 0,
        };
      }
    } else {
      // Personal account - filter by user email
      query = query.eq('user_email', userEmail);
    }

    const { data, error } = await query;

    if (error) throw error;

    let totalApplied = 0;
    let totalBlocked = 0;
    let topicRulesTriggered = 0;
    let bannedWordsFound = 0;

    data?.forEach((row) => {
      if (row.action === 'applied') totalApplied++;
      if (row.action === 'blocked') {
        totalBlocked++;
        // Count banned words found from details or by type
        if (row.guardrail_type === 'banned_words') {
          const details = row.details as any;
          if (details?.bannedWordsFound && Array.isArray(details.bannedWordsFound)) {
            bannedWordsFound += details.bannedWordsFound.length;
          } else {
            bannedWordsFound++; // At least one banned word if blocked by banned_words type
          }
        }
      }
      if (row.action === 'topic_rule_triggered') topicRulesTriggered++;
      // Also count topic rules from applied actions that have topic rules in details
      if (row.action === 'applied' && row.details) {
        const details = row.details as any;
        if (details?.topicRules && details.topicRules > 0) {
          // Topic rules exist but we don't know if they triggered without ticket tag matching
          // For now, we'll only count explicit topic_rule_triggered actions
        }
      }
    });

    return {
      totalApplied,
      totalBlocked,
      topicRulesTriggered,
      bannedWordsFound,
    };
  } catch (error) {
    console.error('[Analytics] Error fetching guardrail stats:', error);
    return {
      totalApplied: 0,
      totalBlocked: 0,
      topicRulesTriggered: 0,
      bannedWordsFound: 0,
    };
  }
}

/**
 * Get AI usage statistics
 * For business accounts, includes all AI usage logs for the business
 * For personal accounts, includes only logs for the user email
 */
export async function getAIUsageStats(
  userEmail: string,
  startDate: Date,
  endDate: Date,
  businessId?: string | null
): Promise<{
  draftsGenerated: number;
  draftsRegenerated: number;
  draftsEdited: number;
  draftsSent: number;
  avgResponseTime: number;
  knowledgeItemsUsed: Record<string, number>;
}> {
  if (!supabase || !userEmail) {
    return {
      draftsGenerated: 0,
      draftsRegenerated: 0,
      draftsEdited: 0,
      draftsSent: 0,
      avgResponseTime: 0,
      knowledgeItemsUsed: {},
    };
  }

  try {
    // Set end date to end of day to include the full day
    const endDateWithTime = new Date(endDate);
    endDateWithTime.setHours(23, 59, 59, 999);

    let query = supabase
      .from('ai_usage_logs')
      .select('action, response_time_ms, knowledge_item_ids, was_edited, was_sent, user_id')
      .gte('created_at', startDate.toISOString())
      .lte('created_at', endDateWithTime.toISOString());

    // For business accounts, get all logs for connected Gmail accounts in this business
    // For personal accounts, filter by user_email
    if (businessId) {
      // Get all connected account emails using robust loader
      const connectedAccounts = await loadBusinessTokens(businessId);

      if (connectedAccounts && connectedAccounts.length > 0) {
        const accountEmails = [...new Set(connectedAccounts.map(t => t.email).filter(Boolean))];
        if (accountEmails.length > 0) {
          query = query.in('user_email', accountEmails);
        } else {
          return {
            draftsGenerated: 0,
            draftsRegenerated: 0,
            draftsEdited: 0,
            draftsSent: 0,
            avgResponseTime: 0,
            knowledgeItemsUsed: {},
          };
        }
      } else {
        return {
          draftsGenerated: 0,
          draftsRegenerated: 0,
          draftsEdited: 0,
          draftsSent: 0,
          avgResponseTime: 0,
          knowledgeItemsUsed: {},
        };
      }
    } else {
      // Personal account - filter by user email
      query = query.eq('user_email', userEmail);
    }

    const { data, error } = await query;

    if (error) throw error;

    let draftsGenerated = 0;
    let draftsRegenerated = 0;
    let draftsEdited = 0; // Count drafts that were edited before sending
    let draftsSent = 0; // Count drafts that were actually sent
    let totalResponseTime = 0;
    let responseTimeCount = 0;
    const knowledgeItemsUsed: Record<string, number> = {};

    data?.forEach((row: any) => {
      if (row.action === 'draft_generated') draftsGenerated++;
      if (row.action === 'draft_regenerated') draftsRegenerated++;

      // FIXED: Use was_edited and was_sent flags from draft_sent action
      // Don't count draft_edited as separate action - it's tracked via was_edited flag
      if (row.action === 'draft_sent' && row.was_sent) {
        draftsSent++;
        if (row.was_edited) {
          draftsEdited++; // Draft was edited before sending
        }
      }

      if (row.response_time_ms) {
        totalResponseTime += row.response_time_ms;
        responseTimeCount++;
      }
      if (row.knowledge_item_ids && Array.isArray(row.knowledge_item_ids)) {
        row.knowledge_item_ids.forEach((id: string) => {
          knowledgeItemsUsed[id] = (knowledgeItemsUsed[id] || 0) + 1;
        });
      }
    });

    return {
      draftsGenerated,
      draftsRegenerated,
      draftsEdited,
      draftsSent,
      avgResponseTime: responseTimeCount > 0 ? totalResponseTime / responseTimeCount : 0,
      knowledgeItemsUsed,
    };
  } catch (error) {
    console.error('[Analytics] Error fetching AI usage stats:', error);
    return {
      draftsGenerated: 0,
      draftsRegenerated: 0,
      draftsEdited: 0,
      draftsSent: 0,
      avgResponseTime: 0,
      knowledgeItemsUsed: {},
    };
  }
}

/**
 * Get individual agent analytics from actual usage logs
 * This calculates real-time stats from ai_usage_logs and tickets tables
 * For business accounts, includes all users in the business
 * For personal accounts, includes only users with the same email
 */
export async function getAgentAnalytics(
  userEmail: string,
  startDate: Date,
  endDate: Date,
  businessId?: string | null
): Promise<
  Array<{
    userId: string;
    userName: string;
    ticketsAssigned: number;
    ticketsClosed: number;
    avgResponseTime: number;
    draftsGenerated: number;
    draftsSent: number;
    draftsEdited: number;
    directSends: number;
  }>
> {
  if (!supabase || !userEmail) {
    return [];
  }

  try {
    // Set end date to end of day
    const endDateWithTime = new Date(endDate);
    endDateWithTime.setHours(23, 59, 59, 999);

    // Get all users for this account
    let usersQuery = supabase
      .from('users')
      .select('id, name, user_email')
      .eq('is_active', true);

    if (businessId) {
      // Business account - get all users in the business
      usersQuery = usersQuery.eq('business_id', businessId);
    } else {
      // Personal account - get users with same email
      usersQuery = usersQuery.eq('user_email', userEmail);
    }

    const { data: users } = await usersQuery;

    if (!users || users.length === 0) {
      return [];
    }

    const userIds = users.map(u => u.id);
    const userMap = new Map(users.map(u => [u.id, u.name]));
    // Get AI usage stats per user
    let aiLogsQuery = supabase
      .from('ai_usage_logs')
      .select('user_id, action, was_edited, was_sent, response_time_ms')
      .in('user_id', userIds)
      .gte('created_at', startDate.toISOString())
      .lte('created_at', endDateWithTime.toISOString());

    if (businessId) {
      // Get all connected account emails using robust loader
      const connectedAccounts = await loadBusinessTokens(businessId);

      if (connectedAccounts && connectedAccounts.length > 0) {
        const accountEmails = [...new Set(connectedAccounts.map(t => t.email).filter(Boolean))];
        if (accountEmails.length > 0) {
          aiLogsQuery = aiLogsQuery.in('user_email', accountEmails);
        }
      }
    } else {
      // Personal account - filter by user email
      aiLogsQuery = aiLogsQuery.eq('user_email', userEmail);
    }

    const { data: aiLogs } = await aiLogsQuery;

    // Get ticket stats per user
    let ticketsQuery = supabase
      .from('tickets')
      .select('assignee_user_id, status, last_customer_reply_at, last_agent_reply_at')
      .in('assignee_user_id', userIds)
      .gte('created_at', startDate.toISOString())
      .lte('created_at', endDateWithTime.toISOString());

    if (businessId) {
      // Business account - get all connected account emails using robust loader
      const connectedAccounts = await loadBusinessTokens(businessId);

      if (connectedAccounts && connectedAccounts.length > 0) {
        const accountEmails = [...new Set(connectedAccounts.map(t => t.email).filter(Boolean))];
        if (accountEmails.length > 0) {
          ticketsQuery = ticketsQuery.in('user_email', accountEmails);
        }
      }
    } else {
      // Personal account - filter by user email
      ticketsQuery = ticketsQuery.eq('user_email', userEmail);
    }

    const { data: tickets } = await ticketsQuery;

    // Aggregate stats per user
    const agentStats = new Map<string, {
      userId: string;
      userName: string;
      ticketsAssigned: number;
      ticketsClosed: number;
      totalResponseTime: number;
      responseTimeCount: number;
      draftsGenerated: number;
      draftsSent: number;
      draftsEdited: number;
      directSends: number;
    }>();

    // Initialize stats for all users
    userIds.forEach(userId => {
      agentStats.set(userId, {
        userId,
        userName: userMap.get(userId) || 'Unknown',
        ticketsAssigned: 0,
        ticketsClosed: 0,
        totalResponseTime: 0,
        responseTimeCount: 0,
        draftsGenerated: 0,
        draftsSent: 0,
        draftsEdited: 0,
        directSends: 0, // FIXED: Added missing property
      });
    });

    // Process AI logs
    aiLogs?.forEach((log: any) => {
      if (!log.user_id) return;
      const stats = agentStats.get(log.user_id);
      if (!stats) return;

      if (log.action === 'draft_generated' || log.action === 'draft_regenerated') {
        stats.draftsGenerated++;
      }
      if (log.action === 'draft_sent' && log.was_sent) {
        stats.draftsSent++;
        if (log.was_edited) {
          stats.draftsEdited++;
        }
      }
      if (log.response_time_ms) {
        stats.totalResponseTime += log.response_time_ms;
        stats.responseTimeCount++;
      }
    });

    // Process tickets
    tickets?.forEach((ticket: any) => {
      if (!ticket.assignee_user_id) return;
      const stats = agentStats.get(ticket.assignee_user_id);
      if (!stats) return;

      stats.ticketsAssigned++;
      if (ticket.status === 'closed') {
        stats.ticketsClosed++;
      }
    });

    // Convert to array and calculate averages
    return Array.from(agentStats.values()).map(stats => ({
      userId: stats.userId,
      userName: stats.userName,
      ticketsAssigned: stats.ticketsAssigned,
      ticketsClosed: stats.ticketsClosed,
      avgResponseTime: stats.responseTimeCount > 0
        ? stats.totalResponseTime / stats.responseTimeCount
        : 0,
      draftsGenerated: stats.draftsGenerated,
      draftsSent: stats.draftsSent,
      draftsEdited: stats.draftsEdited,
      directSends: stats.draftsSent - stats.draftsEdited,
    })).sort((a, b) => b.ticketsAssigned - a.ticketsAssigned); // Sort by tickets assigned
  } catch (error) {
    console.error('[Analytics] Error fetching agent analytics:', error);
    return [];
  }
}

/**
 * Get agent performance metrics (legacy - uses aggregated table)
 */
export async function getAgentPerformance(
  userEmail: string,
  startDate: Date,
  endDate: Date
): Promise<
  Array<{
    userId: string;
    userName: string;
    ticketsAssigned: number;
    ticketsClosed: number;
    avgResponseTime: number;
    avgResolutionTime: number;
    aiDraftsGenerated: number;
    draftsSent: number;
  }>
> {
  if (!supabase || !userEmail) {
    return [];
  }

  try {
    const { data, error } = await supabase
      .from('agent_performance')
      .select('user_id, tickets_assigned, tickets_closed, avg_response_time_minutes, avg_resolution_time_minutes, ai_drafts_generated, drafts_sent')
      .eq('user_email', userEmail)
      .gte('date', startDate.toISOString().split('T')[0])
      .lte('date', endDate.toISOString().split('T')[0]);

    if (error) throw error;

    // Fetch user names
    const userIds = [...new Set(data?.map((row) => row.user_id).filter(Boolean) || [])];
    const userMap = new Map<string, string>();

    if (userIds.length > 0) {
      const { data: users } = await supabase
        .from('users')
        .select('id, name')
        .in('id', userIds);

      users?.forEach((user: any) => {
        userMap.set(user.id, user.name);
      });
    }

    return (
      data?.map((row) => ({
        userId: row.user_id || '',
        userName: userMap.get(row.user_id) || 'Unknown',
        ticketsAssigned: row.tickets_assigned || 0,
        ticketsClosed: row.tickets_closed || 0,
        avgResponseTime: row.avg_response_time_minutes || 0,
        avgResolutionTime: row.avg_resolution_time_minutes || 0,
        aiDraftsGenerated: row.ai_drafts_generated || 0,
        draftsSent: row.drafts_sent || 0,
      })) || []
    );
  } catch (error) {
    console.error('[Analytics] Error fetching agent performance:', error);
    return [];
  }
}