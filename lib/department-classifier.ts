/**
 * Department Classification using AI
 * Automatically classifies emails to departments based on content matching
 */

import { Department } from './departments';
import { supabase } from './supabase';
import { getFeedbackExamples } from './feedback-cache';

export interface EmailContent {
    subject: string;
    body: string;
}

export interface ClassificationResult {
    departmentId: string | null;
    confidence: number; // 0-100
    reasoning: string;
    departmentName?: string;
}

const CONFIDENCE_THRESHOLD = 40; // Minimum confidence to auto-assign (increased to 40% as requested)

/**
 * Classify an email to the most appropriate department using AI
 * Uses Groq API with llama model for fast classification
 */
export async function classifyEmailToDepartment(
    emailContent: EmailContent,
    departments: Department[],
    groqApiKey: string,
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

    const prompt = `You are an expert email classification assistant. Analyze the email carefully and classify it into ONE of these categories:

=== SPAM ===
Unsolicited, unwanted, or malicious emails. Classify as SPAM if the email contains ANY of these:
- Phishing attempts or security threats
- Suspicious links or requests for personal information
- Get-rich-quick schemes, lottery/prize notifications, or inheritance scams
- Cryptocurrency/forex/investment scams
- Requests for urgent action on fake account issues
- Generic mass emails from unknown senders
- Dating sites or illegal offers
- Pills, medications, or health scams
- Fake package delivery notifications
- Emails with excessive urgency ("ACT NOW!", "LIMITED TIME!", "URGENT!")
- Poor grammar, spelling errors, or suspicious formatting
- Requests for wire transfers or gift cards

Examples of SPAM:
- "Congratulations! You've won $1,000,000 - claim now!"
- "Your account has been locked - verify immediately"
- "Make money from home - no experience needed"
- "Single women in your area want to meet you"
- "You have inherited money from a distant relative"
- "Urgent: Your package is waiting - click here"
- "Buy Viagra/Cialis at lowest prices"
- "Invest in Bitcoin now - guaranteed returns"
- "IRS: You owe back taxes - pay immediately"
- "Your Amazon order #123456 has been cancelled - click to review"

=== PROMOTIONS ===
Legitimate marketing emails from recognizable brands or services. Classify as PROMOTIONS if:
- From known companies (Netflix, Amazon, Uber, Google, Microsoft, Apple, airlines, retailers, etc.)
- Social media notifications (Facebook, Instagram, Twitter, LinkedIn, TikTok)
- Streaming services (Netflix, Spotify, YouTube, Disney+, Hulu)
- E-commerce (Amazon, eBay, Etsy, Shopify stores)
- Tech companies (GitHub, GitLab, Stack Overflow, Medium)
- Food delivery (Uber Eats, DoorDash, Grubhub)
- Travel (Airbnb, Booking.com, Expedia, airlines)
- Newsletters you likely subscribed to
- Product announcements, sales, or special offers
- Event invitations from businesses
- Marketing emails with unsubscribe links
- Promotional codes, discounts, or deals
- Company updates or new feature announcements
- App notifications and updates

Examples of PROMOTIONS:
- "Netflix: New releases this week you'll love"
- "Amazon: Your order has shipped + recommendations for you"
- "Uber: 20% off your next 3 rides"
- "Spotify: Discover your personalized playlist"
- "LinkedIn: You have 5 new connection requests"
- "Airbnb: Explore destinations for your next trip"
- "GitHub: Your weekly digest of activity"
- "Instagram: See what your friends are up to"
- "Medium: Top stories picked for you"
- "Grammarly: Your weekly writing insights"
- "Duolingo: Don't lose your streak!"
- "Slack: You have 10 unread messages"

=== CLASSIFICATION RULES ===
1. Be AGGRESSIVE in classifying emails as SPAM or PROMOTIONS. Most emails fall into one of these categories.

2. If unsure between SPAM and PROMOTIONS, check for:
   - Recognizable brand name → PROMOTIONS
   - Unknown sender with urgency → SPAM
   - Unsubscribe link present → PROMOTIONS
   - Suspicious grammar/spelling → SPAM
   - ANY marketing content → PROMOTIONS
   - ANY unsolicited content → SPAM
   - Professional formatting → PROMOTIONS
   - Poor formatting/grammar → SPAM

3. ONLY return 0 (Unclassified) if the email is clearly:
   - Personal correspondence from friends/family
   - Work-related business emails (invoices, contracts, meetings)
   - Transactional emails (receipts, order confirmations, password resets)
   - Support tickets or customer service
   
4. When in doubt between SPAM and PROMOTIONS, prefer PROMOTIONS for recognizable senders, SPAM for unknown senders
${feedbackSection}
Here are the available departments:
${departmentList}

**Task:** Read the email's subject and body (provided below). Respond with ONLY valid JSON containing EXACTLY these fields:
{
  "departmentNumber": <integer from 1 to ${departments.length}, or 0 for Unclassified>,
  "confidence": <integer from 0-100>,
  "reasoning": "<brief reason string>"
}

**Email:**
Subject: "${emailContent.subject}"
Body: "${emailContent.body.substring(0, 1000)}"`;


    try {
        const result = await callGroqForClassification(prompt, groqApiKey);

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
            reasoning: `Classification failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        };
    }
}

/**
 * Call Groq API for classification
 */
async function callGroqForClassification(prompt: string, apiKey: string): Promise<string> {
    const REQUEST_TIMEOUT = 10000; // 10 seconds for faster classification
    const model = 'llama-3.1-8b-instant'; // Smaller, faster model for classification

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
                        content: 'You are an email classification assistant. You always respond with valid JSON only, no other text.',
                    },
                    {
                        role: 'user',
                        content: prompt,
                    },
                ],
                temperature: 0.1, // Very low temperature for consistent classification
                max_tokens: 150, // Short response expected
            }),
            signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            let errorMessage = `Groq API error: ${response.status} ${response.statusText}`;
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
            throw new Error('Invalid response format from Groq API');
        }

        const content = data.choices[0]?.message?.content?.trim();

        if (!content) {
            throw new Error('No content in Groq API response');
        }

        console.log('[Department Classifier] AI response:', content);
        return content;
    } catch (fetchError: any) {
        clearTimeout(timeoutId);
        if (fetchError.name === 'AbortError') {
            throw new Error('Classification timeout: Groq API took too long to respond');
        }
        throw fetchError;
    }
}

/**
 * Get Groq API key from environment
 */
export function getGroqApiKey(): string | null {
    return process.env.GROQ_API_KEY || null;
}

/**
 * Classify email with fallback to keyword matching if AI fails
 */
export async function classifyEmailWithFallback(
    emailContent: EmailContent,
    departments: Department[],
    groqApiKey: string | null,
    userEmail?: string | null,
    businessId?: string | null
): Promise<ClassificationResult> {
    // Try AI classification first
    if (groqApiKey) {
        try {
            const result = await classifyEmailToDepartment(
                emailContent,
                departments,
                groqApiKey,
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

    const emailText = `${emailContent.subject} ${emailContent.body}`.toLowerCase();

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
            reasoning: `Keyword-based match (${best.matches} keywords matched)`,
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
