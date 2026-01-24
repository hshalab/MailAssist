/**
 * Feedback Cache for AI Learning
 * Caches recent manual corrections to improve classification accuracy
 */

import { supabase } from './supabase';

interface FeedbackExample {
    subject: string;
    body: string;
    departmentName: string;
}

interface FeedbackCache {
    examples: Map<string, FeedbackExample[]>;
    lastUpdated: number;
}

const CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutes
const MAX_EXAMPLES_PER_DEPT = 5;

// In-memory cache
const cache: Map<string, FeedbackCache> = new Map();

/**
 * Get feedback examples for a specific account
 */
export async function getFeedbackExamples(
    userEmail: string | null,
    businessId: string | null
): Promise<Map<string, FeedbackExample[]>> {
    const cacheKey = businessId || userEmail || 'default';
    const now = Date.now();

    // Check if cache is still valid
    const cached = cache.get(cacheKey);
    if (cached && (now - cached.lastUpdated) < CACHE_DURATION_MS) {
        return cached.examples;
    }

    // Fetch fresh examples from database
    const examples = await fetchFeedbackFromDB(userEmail, businessId);

    // Update cache
    cache.set(cacheKey, {
        examples,
        lastUpdated: now,
    });

    return examples;
}

/**
 * Fetch feedback examples from database
 */
async function fetchFeedbackFromDB(
    userEmail: string | null,
    businessId: string | null
): Promise<Map<string, FeedbackExample[]>> {
    if (!supabase) {
        return new Map();
    }

    try {
        // Fetch recent feedback corrections with ticket and department info
        let query = supabase
            .from('department_feedback')
            .select(`
                ticket_id,
                final_department_id,
                tickets!inner(subject, user_email, thread_id),
                departments!department_feedback_final_department_id_fkey(name)
            `)
            .not('final_department_id', 'is', null)
            .order('created_at', { ascending: false })
            .limit(50);

        // Filter by account (tickets table only has user_email, not business_id)
        if (userEmail) {
            query = query.eq('tickets.user_email', userEmail);
        }

        const { data, error } = await query;

        if (error || !data) {
            console.error('Error fetching feedback examples:', error);
            return new Map();
        }

        // Group by department
        const grouped = new Map<string, FeedbackExample[]>();

        for (const feedback of data) {
            const deptName = feedback.departments?.name;
            const ticketId = feedback.ticket_id;

            if (!deptName || !ticketId) continue;

            // Fetch email body for this ticket using thread_id
            const threadId = feedback.tickets?.thread_id;
            let bodyContent = '';

            if (threadId) {
                const { data: emailData } = await supabase
                    .from('emails')
                    .select('body')
                    .eq('thread_id', threadId)
                    .order('date', { ascending: true })
                    .limit(1)
                    .maybeSingle();

                bodyContent = emailData?.body?.substring(0, 500) || '';
            }

            const example: FeedbackExample = {
                subject: feedback.tickets?.subject || '',
                body: bodyContent,
                departmentName: deptName,
            };

            if (!grouped.has(deptName)) {
                grouped.set(deptName, []);
            }

            const examples = grouped.get(deptName)!;
            if (examples.length < MAX_EXAMPLES_PER_DEPT) {
                examples.push(example);
            }
        }

        return grouped;
    } catch (error) {
        console.error('Error in fetchFeedbackFromDB:', error);
        return new Map();
    }
}

/**
 * Clear cache for a specific account (call when new feedback is added)
 */
export function clearFeedbackCache(userEmail: string | null, businessId: string | null) {
    const cacheKey = businessId || userEmail || 'default';
    cache.delete(cacheKey);
}
