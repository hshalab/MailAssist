/**
 * Department Classification using AI
 * Automatically classifies emails to departments based on content matching
 */

import { Department } from './departments';
import { supabase } from './supabase';
import { getFeedbackExamples } from './feedback-cache';
import { htmlToText } from './html-to-text';

export interface EmailContent {
    subject: string;
    body: string;
    senderEmail?: string;  // Full sender email address
    senderDomain?: string; // Extracted domain (e.g., "amazon.com")
    threadContext?: string; // Summary of previous messages in thread
    customerHistory?: { departmentId: string; departmentName: string; count: number }[]; // Previous department assignments for this customer
}

export interface ClassificationResult {
    departmentId: string | null;
    confidence: number; // 0-100
    reasoning: string;
    departmentName?: string;
}

const CONFIDENCE_THRESHOLD = 60; // Minimum confidence to auto-assign (increased to 60% to avoid false positives)

/**
 * Classify an email to the most appropriate department using AI
 * Uses OpenAI API with gpt-5.2 for fast classification
 */
export async function classifyEmailToDepartment(
    emailContent: EmailContent,
    departments: Department[],
    openaiApiKey: string,
    userEmail?: string | null,
    businessId?: string | null
): Promise<ClassificationResult> {
    // Handle edge cases
    if (!departments || departments.length === 0) {
        return {
            departmentId: null,
            confidence: 0,
            reasoning: 'No departments configured',
        };
    }

    if (departments.length === 1) {
        // Only one department, assign with 100% confidence
        return {
            departmentId: departments[0].id,
            confidence: 100,
            reasoning: 'Only one department available',
            departmentName: departments[0].name,
        };
    }

    // Build department descriptions for AI prompt
    const departmentList = departments
        .map((dept, idx) => `[${idx + 1}] ${dept.name}: ${dept.description}`)
        .join('\n');

    // Fetch feedback examples for AI learning
    const feedbackExamples = await getFeedbackExamples(userEmail || null, businessId || null);
    let feedbackSection = '';

    if (feedbackExamples.size > 0) {
        feedbackSection = '\n\n=== LEARNED FROM YOUR CORRECTIONS ===\n';
        feedbackSection += 'Based on your manual corrections, here are examples you\'ve classified:\n\n';

        for (const [deptName, examples] of feedbackExamples.entries()) {
            if (examples.length > 0) {
                feedbackSection += `**${deptName}:**\n`;
                examples.forEach(ex => {
                    feedbackSection += `- Subject: "${ex.subject}"\n`;
                    if (ex.body) {
                        feedbackSection += `  Body snippet: "${ex.body.substring(0, 100)}..."\n`;
                    }
                });
                feedbackSection += '\n';
            }
        }
    }

    // Build sender info section
    let senderSection = '';
    if (emailContent.senderEmail || emailContent.senderDomain) {
        senderSection = `\n=== SENDER INFORMATION ===
Sender Email: ${emailContent.senderEmail || 'Unknown'}
Sender Domain: ${emailContent.senderDomain || 'Unknown'}
Use this to identify the sender's organization or type of email.\n`;
    }

    // Build customer history section
    let customerHistorySection = '';
    if (emailContent.customerHistory && emailContent.customerHistory.length > 0) {
        customerHistorySection = `\n=== CUSTOMER HISTORY ===
This customer has previously contacted us and was assigned to these departments:
${emailContent.customerHistory.map(h => `- ${h.departmentName}: ${h.count} ticket(s)`).join('\n')}
IMPORTANT: If the current email topic is similar to previous interactions, consider routing to the same department for continuity.\n`;
    }

    // Build thread context section
    let threadContextSection = '';
    if (emailContent.threadContext && emailContent.threadContext.trim()) {
        threadContextSection = `\n=== CONVERSATION THREAD CONTEXT ===
Previous messages in this thread:
${emailContent.threadContext}
Use this context to understand the ongoing conversation and classify appropriately.\n`;
    }

    // Generic system prompt - no hardcoded rules
    const prompt = `You are an expert email classification assistant. Your goal is to map the email to the correct department based on its content and intent.
    
    === AVAILABLE DEPARTMENTS ===
    ${departmentList}
    
    ${senderSection}${customerHistorySection}${threadContextSection}${feedbackSection}
    
    === GUIDELINES ===
    1. **Analyze Intent**: Read the email body to understand the core request (e.g., "Where is my order?" -> Orders, "I want to return this" -> Returns).
    2. **Consistency is Key**: Similar emails must ALWAYS go to the same department.
    3. **Use Context**: If the customer has a history with a department, that is a strong signal.
    4. **No Hallucinations**: If it doesn't match a department, return 0 (Unclassified).
    
    === EMAIL CONTENT ===
    Subject: "${emailContent.subject}"
    Body: "${htmlToText(emailContent.body).substring(0, 1500)}"
    
    Respond with ONLY valid JSON in this exact format:
    {
      "departmentNumber": <integer from 1 to ${departments.length}, or 0 for Unclassified>,
      "confidence": <integer from 0-100>,
      "reasoning": "<brief explanation>"
    }`;


    try {
        const result = await callOpenAIForClassification(prompt, openaiApiKey);

        // Parse AI response
        const parsed = JSON.parse(result);
        const departmentNumber = parsed.departmentNumber;
        const confidence = Math.min(100, Math.max(0, parsed.confidence || 0));
        const reasoning = parsed.reasoning || 'AI classification';

        // Map department number to ID
        if (departmentNumber === 0 || departmentNumber > departments.length || confidence < CONFIDENCE_THRESHOLD) {
            return {
                departmentId: null,
                confidence,
                reasoning: confidence < CONFIDENCE_THRESHOLD
                    ? `Low confidence (${confidence}%): ${reasoning}`
                    : reasoning,
            };
        }

        const selectedDept = departments[departmentNumber - 1];
        return {
            departmentId: selectedDept.id,
            confidence,
            reasoning,
            departmentName: selectedDept.name,
        };
    } catch (error) {
        console.error('Error classifying email to department:', error);
        return {
            departmentId: null,
            confidence: 0,
            reasoning: `Classification failed: ${error instanceof Error ? error.message : 'Unknown error'} `,
        };
    }
}

/**
 * Call OpenAI API for classification
 */
// Cal OpenAI API for classification
async function callOpenAIForClassification(prompt: string, apiKey: string): Promise<string> {
    const REQUEST_TIMEOUT = 10000; // 10 seconds for faster classification
    const model = 'gpt-4o-mini'; // Much cheaper and sufficient for classification

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
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
                        content: 'You are an email classification assistant. You always respond with valid JSON only, no other text.',
                    },
                    {
                        role: 'user',
                        content: prompt,
                    },
                ],
                temperature: 0.1, // Low temperature for consistent, deterministic results
                max_completion_tokens: 150, // Short response expected
            }),
            signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            let errorMessage = `OpenAI API error: ${response.status} ${response.statusText} `;
            try {
                const errorData = await response.json();
                errorMessage = errorData.error?.message || errorData.message || errorMessage;
            } catch (parseError) {
                // Use status text if parsing fails
            }
            throw new Error(errorMessage);
        }

        const data = await response.json();

        if (!data.choices || !Array.isArray(data.choices) || data.choices.length === 0) {
            throw new Error('Invalid response format from OpenAI API');
        }

        const content = data.choices[0]?.message?.content?.trim();

        if (!content) {
            throw new Error('No content in OpenAI API response');
        }

        console.log('[Department Classifier] AI response:', content);
        return content;
    } catch (fetchError: any) {
        clearTimeout(timeoutId);
        if (fetchError.name === 'AbortError') {
            throw new Error('Classification timeout: OpenAI API took too long to respond');
        }
        throw fetchError;
    }
}

/**
 * Get OpenAI API key from environment
 */
export function getOpenAIApiKey(): string | null {
    return process.env.OPENAI_API_KEY || null;
}

/**
 * Classify email with fallback to keyword matching if AI fails
 */
export async function classifyEmailWithFallback(
    emailContent: EmailContent,
    departments: Department[],
    openaiApiKey: string | null,
    userEmail?: string | null,
    businessId?: string | null
): Promise<ClassificationResult> {
    // Try AI classification first
    if (openaiApiKey) {
        try {
            const result = await classifyEmailToDepartment(
                emailContent,
                departments,
                openaiApiKey,
                userEmail,
                businessId
            );
            if (result.departmentId) {
                return result;
            }
            // If AI returned null, fall through to keyword matching
        } catch (error) {
            console.warn('AI classification failed, falling back to keyword matching:', error);
        }
    }

    // Fallback: Simple keyword matching
    return keywordBasedClassification(emailContent, departments);
}

/**
 * Fallback: Simple keyword-based classification
 * Matches keywords in email to department descriptions
 */
function keywordBasedClassification(
    emailContent: EmailContent,
    departments: Department[]
): ClassificationResult {
    if (departments.length === 0) {
        return { departmentId: null, confidence: 0, reasoning: 'No departments available' };
    }

    const emailText = `${emailContent.subject} ${htmlToText(emailContent.body)}`.toLowerCase();

    // Score each department based on keyword matches
    const scored = departments.map(dept => {
        const keywords = dept.description.toLowerCase().split(/\s+/);
        let matches = 0;

        keywords.forEach(keyword => {
            if (keyword.length > 3 && emailText.includes(keyword)) {
                matches++;
            }
        });

        const confidence = Math.min(90, (matches / Math.max(1, keywords.length)) * 100);

        return {
            department: dept,
            confidence,
            matches,
        };
    });

    // Find best match
    const best = scored.sort((a, b) => b.confidence - a.confidence)[0];

    if (best.confidence >= 50) {
        return {
            departmentId: best.department.id,
            confidence: best.confidence,
            reasoning: `Keyword - based match(${best.matches} keywords matched)`,
            departmentName: best.department.name,
        };
    }

    // No good match found
    return {
        departmentId: null,
        confidence: best.confidence,
        reasoning: 'No strong keyword matches found',
    };
}
