import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * POST /api/emails/summarize - Summarize email thread using AI
 * 
 * Expects body: { content: string }
 * Returns: { summary: string }
 */
export async function POST(request: NextRequest) {
    try {
        const body = await request.json()
        const { content } = body

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

        // Call OpenAI API for summarization
        const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${openaiApiKey}`,
            },
            body: JSON.stringify({
                model: 'gpt-5.2', // Fast and capable model
                messages: [
                    {
                        role: 'system',
                        content: 'You are a helpful assistant. Extract the core message and meaning while ignoring technical metadata, CSS, or formatting tags. Provide a brief 2-3 sentence summary that captures the main points and any action items. Write in a natural, human-like manner. Use paragraphs instead of bullet points. Avoid robotic formatting.'
                    },
                    {
                        role: 'user',
                        content: `Summarize this email conversation (which may contain raw HTML):\n\n${cleanedContent}`
                    }
                ],
                temperature: 1,
                max_completion_tokens: 200,
            }),
        })

        if (!openaiResponse.ok) {
            const errorText = await openaiResponse.text()
            console.error('OpenAI API error:', openaiResponse.status, errorText)
            return NextResponse.json(
                { error: `OpenAI API error: ${openaiResponse.status} ${openaiResponse.statusText}` },
                { status: openaiResponse.status }
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

        return NextResponse.json({ summary })

    } catch (error) {
        console.error('Error summarizing email:', error)
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Internal server error' },
            { status: 500 }
        )
    }
}
