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

        // Get GROQ API key from environment
        const groqApiKey = process.env.GROQ_API_KEY

        if (!groqApiKey) {
            return NextResponse.json(
                { error: 'GROQ_API_KEY is not configured' },
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

        // Limit content length to avoid token limits (approx 4000 chars = ~1000 tokens)
        if (cleanedContent.length > 4000) {
            cleanedContent = cleanedContent.substring(0, 4000) + '...'
        }

        // Call GROQ API for summarization
        const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${groqApiKey}`,
            },
            body: JSON.stringify({
                model: 'llama-3.3-70b-versatile', // Fast and capable model
                messages: [
                    {
                        role: 'system',
                        content: 'You are a helpful assistant. Extract the core message and meaning while ignoring technical metadata, CSS, or formatting tags. Provide a brief 2-3 sentence summary that captures the main points and any action items.'
                    },
                    {
                        role: 'user',
                        content: `Summarize this email conversation (which may contain raw HTML):\n\n${cleanedContent}`
                    }
                ],
                temperature: 0.3,
                max_tokens: 200,
            }),
        })

        if (!groqResponse.ok) {
            const errorText = await groqResponse.text()
            console.error('GROQ API error:', groqResponse.status, errorText)
            return NextResponse.json(
                { error: `GROQ API error: ${groqResponse.status} ${groqResponse.statusText}` },
                { status: groqResponse.status }
            )
        }

        const groqData = await groqResponse.json()
        const summary = groqData.choices?.[0]?.message?.content?.trim()

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
