/**
 * Simple HTML-to-text conversion for client-side use
 * Strips tags and decodes entities before sending to AI
 */
export function htmlToText(html: string): string {
    if (!html) return ''

    let text = html

    // Remove script and style elements
    text = text.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')

    // Convert block elements to newlines
    text = text.replace(/<\/(div|p|br|tr|h[1-6]|li)>/gi, '\n')
    text = text.replace(/<br\s*\/?>/gi, '\n')

    // Remove all HTML tags
    text = text.replace(/<[^>]+>/g, '')

    // Decode HTML entities
    text = text.replace(/&nbsp;/g, ' ')
    text = text.replace(/&amp;/g, '&')
    text = text.replace(/&lt;/g, '<')
    text = text.replace(/&gt;/g, '>')
    text = text.replace(/&quot;/g, '"')
    text = text.replace(/&#39;/g, "'")
    text = text.replace(/&apos;/g, "'")

    // Clean up whitespace
    text = text.replace(/\n\s*\n\s*\n/g, '\n\n')
    text = text.replace(/[ \t]+/g, ' ')
    text = text.trim()

    return text
}
