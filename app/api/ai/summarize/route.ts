import { NextRequest, NextResponse } from "next/server"

/**
 * Convert HTML content to plain text for AI processing
 * Strips HTML tags, decodes entities, and cleans up whitespace
 */
function htmlToText(html: string): string {
  if (!html) return ''

  let text = html

  // Remove script and style elements completely
  text = text.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
  text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')

  // Convert common block elements to newlines
  text = text.replace(/<\/(div|p|br|tr|h[1-6]|li)>/gi, '\n')
  text = text.replace(/<br\s*\/?>/gi, '\n')
  text = text.replace(/<\/li>/gi, '\n')

  // Remove all remaining HTML tags
  text = text.replace(/<[^>]+>/g, '')

  // Remove CSS that appears as plain text at the start (before actual email content)
  // This handles malformed emails where CSS leaks through without style tags
  const cssAtStartMatch = text.match(/^([\s\n]*(?:\.[\w-]+\s*\{[^}]*\}|@media[^}]*\{[^}]*\}|[a-z-]+\s*:\s*[^;]+;)+[\s\n]*)+/i)
  if (cssAtStartMatch && cssAtStartMatch[0]) {
    const potentialCss = cssAtStartMatch[0]
    const afterCss = text.substring(potentialCss.length).trim()

    // Only remove if it's clearly CSS followed by actual email content
    const isCssBlock = potentialCss.includes('{') &&
      potentialCss.includes('}') &&
      (potentialCss.includes('.') || potentialCss.includes('@media'))

    const hasEmailContent = afterCss.length > 0 &&
      (/^[A-Z][a-z]+/.test(afterCss) || // Starts with capitalized word
        /placed order|order summary|view order|shipping|payment|delivery/i.test(afterCss))

    if (isCssBlock && hasEmailContent) {
      text = afterCss
    }
  }

  // Decode common HTML entities
  text = text.replace(/&nbsp;/g, ' ')
  text = text.replace(/&amp;/g, '&')
  text = text.replace(/&lt;/g, '<')
  text = text.replace(/&gt;/g, '>')
  text = text.replace(/&quot;/g, '"')
  text = text.replace(/&#39;/g, "'")
  text = text.replace(/&apos;/g, "'")

  // Clean up whitespace
  text = text.replace(/\n\s*\n\s*\n/g, '\n\n')  // Max 2 consecutive newlines
  text = text.replace(/[ \t]+/g, ' ')  // Multiple spaces to single space
  text = text.trim()

  return text
}

export async function POST(request: NextRequest) {
  try {
    const { conversation } = await request.json()

    if (!conversation || typeof conversation !== "string") {
      return NextResponse.json(
        { error: "Conversation text is required" },
        { status: 400 }
      )
    }

    const apiKey = process.env.OPENAI_API_KEY

    if (!apiKey) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY not configured" },
        { status: 500 }
      )
    }

    // Convert HTML to plain text for better AI processing
    const plainTextConversation = htmlToText(conversation)

    // Call OpenAI API to generate summary
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-5.2',
        messages: [
          {
            role: 'system',
            content: 'You are a helpful assistant that generates concise email conversation summaries. Provide a brief 2-3 sentence summary of what the conversation is about. Be direct and factual, but write in a natural, human-like manner. Use paragraphs instead of bullet points. Avoid robotic formatting.',
          },
          {
            role: 'user',
            content: `Summarize this email conversation in 2-3 sentences:\n\n${plainTextConversation}`,
          },
        ],
        temperature: 1,
        max_completion_tokens: 150,
      }),
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      console.error('OpenAI API error:', errorData)
      return NextResponse.json(
        { error: "Failed to generate summary" },
        { status: 500 }
      )
    }

    const data = await response.json()
    const summary = data.choices?.[0]?.message?.content?.trim() || "Unable to generate summary."

    return NextResponse.json({ summary })
  } catch (error) {
    console.error("Error generating summary:", error)
    return NextResponse.json(
      { error: "Failed to generate summary" },
      { status: 500 }
    )
  }
}
