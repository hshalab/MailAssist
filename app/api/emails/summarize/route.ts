import { NextRequest, NextResponse } from 'next/server'
import { validateBusinessSession, getCurrentUserIdFromRequest } from '@/lib/session'
import { checkDailyLimit, checkRateLimit, getRequestIdentity } from '@/lib/rate-limit'
import { getCachedSummary, setCachedSummary } from '@/lib/summary-cache'

export const dynamic = 'force-dynamic'

/**
 * POST /api/emails/summarize - Summarize email thread using AI
 * 
 * Expects body: { content: string }
 * Returns: { summary: string }
 */
export async function POST(request: NextRequest) {
    try {
        const session = await validateBusinessSession()
        const userId = getCurrentUserIdFromRequest(request)
        if (!session && !userId) {
            return NextResponse.json(
                { error: 'Unauthorized' },
                { status: 401 }
            )
        }
        const identity = session?.id || userId || getRequestIdentity(request.headers)

        // Check per-account AI feature toggle
        const { getAccountAISettings } = await import('@/lib/ai-config')
        const aiCfg = await getAccountAISettings(session?.email ?? null, session?.businessId ?? null)
        if (!aiCfg.enable_ai_summarize) {
          return NextResponse.json({ error: 'AI summarization is disabled for this account.' }, { status: 403 })
        }

        const limiter = checkRateLimit(`emails-summarize:${identity}`, 30, 60 * 1000)
        if (!limiter.allowed) {
            return NextResponse.json(
                { error: 'Rate limit exceeded. Try again in a minute.' },
                { status: 429 }
            )
        }

        const body = await request.json()
        const { content } = body
        const daily = await checkDailyLimit(`emails-summarize-daily:${identity}`, 20)
        if (!daily.allowed) {
            return NextResponse.json(
                { error: 'Daily summarize limit reached for this account.' },
                { status: 429 }
            )
        }

        if (!content || typeof content !== 'string') {
            return NextResponse.json(
                { error: 'Missing or invalid content parameter' },
                { status: 400 }
            )
        }

        // Get OpenAI API key from environment
        const openaiApiKey = process.env.OPENAI_API_KEY

        if (!openaiApiKey) {
            return NextResponse.json(
                { error: 'OPENAI_API_KEY is not configured' },
                { status: 500 }
            )
        }

        // Clean content: strip excessive HTML tags and metadata for better summarization
        let cleanedContent = content
            .replace(/<script[^>]*>.*?<\/script>/gi, '')
            .replace(/<style[^>]*>.*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()

        // Remove CSS that appears as plain text at the start (before actual email content)
        // This handles malformed emails where CSS leaks through without style tags
        const cssAtStartMatch = cleanedContent.match(/^([\s\n]*(?:\.[\w-]+\s*\{[^}]*\}|@media[^}]*\{[^}]*\}|[a-z-]+\s*:\s*[^;]+;)+[\s\n]*)+/i)
        if (cssAtStartMatch && cssAtStartMatch[0]) {
            const potentialCss = cssAtStartMatch[0]
            const afterCss = cleanedContent.substring(potentialCss.length).trim()

            // Only remove if it's clearly CSS followed by actual email content
            const isCssBlock = potentialCss.includes('{') &&
                potentialCss.includes('}') &&
                (potentialCss.includes('.') || potentialCss.includes('@media'))

            const hasEmailContent = afterCss.length > 0 &&
                (/^[A-Z][a-z]+/.test(afterCss) || // Starts with capitalized word
                    /placed order|order summary|view order|shipping|payment|delivery/i.test(afterCss))

            if (isCssBlock && hasEmailContent) {
                cleanedContent = afterCss
            }
        }

        // Limit content length to avoid token limits (approx 4000 chars = ~1000 tokens)
        if (cleanedContent.length > 4000) {
            cleanedContent = cleanedContent.substring(0, 4000) + '...'
        }
        const cached = await getCachedSummary(cleanedContent)
        if (cached) {
            return NextResponse.json({ summary: cached, cached: true })
        }

        // Call OpenAI API for summarization
        const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${openaiApiKey}`,
            },
            body: JSON.stringify({
                model: 'gpt-4o-mini',
                messages: [
                    {
                        role: 'system',
                        content: 'Summarize email conversations in 2-3 sentences. Be direct and factual. No bullet points.'
                    },
                    {
                        role: 'user',
                        content: `Summarize this email conversation in 2-3 sentences:\n\n${cleanedContent.slice(0, 3000)}`
                    }
                ],
                temperature: 0.3,
                max_completion_tokens: 80,
            }),
        })

        if (!openaiResponse.ok) {
            const errorText = await openaiResponse.text()
            console.error('OpenAI API error:', openaiResponse.status, errorText)
            return NextResponse.json(
                { error: 'Failed to generate summary' },
                { status: 500 }
            )
        }

        const openaiData = await openaiResponse.json()
        const summary = openaiData.choices?.[0]?.message?.content?.trim()

        if (!summary) {
            return NextResponse.json(
                { error: 'Failed to generate summary' },
                { status: 500 }
            )
        }
        await setCachedSummary(cleanedContent, summary)

        return NextResponse.json({ summary })

    } catch (error) {
        console.error('Error summarizing email:', error)
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        )
    }
}
