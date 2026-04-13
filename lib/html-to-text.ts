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

  // Remove CSS that appears as plain text at the start (before actual email content)
  // This handles malformed emails where CSS leaks through without style tags
  // Match CSS patterns more aggressively - look for CSS selectors and rules
  const cssPattern = /^([\s\n]*(?:\.[\w-]+\s*\{[^}]*\}|@media[^}]*\{[^}]*\}|[a-z-]+\s*:\s*[^;]+;|@[^{]+\{[^}]*\})+[\s\n]*)+/i
  const cssAtStartMatch = text.match(cssPattern)

  if (cssAtStartMatch && cssAtStartMatch[0]) {
    const potentialCss = cssAtStartMatch[0]
    const afterCss = text.substring(potentialCss.length).trim()

    // Only remove if it's clearly CSS (has CSS structure) followed by actual email content
    const isCssBlock = potentialCss.includes('{') &&
      potentialCss.includes('}') &&
      (potentialCss.includes('.') || potentialCss.includes('@media') || potentialCss.includes('@'))

    // Check if what follows looks like email content (not more CSS)
    const hasEmailContent = afterCss.length > 0 &&
      (!afterCss.match(/^[\s\n]*(?:\.[\w-]+\s*\{|@media|@[^{]+\{)/i) && // Not more CSS
        (/^[A-Z][a-z]+/.test(afterCss) || // Starts with capitalized word (name)
          /placed order|order summary|view order|shipping|payment|delivery|total|subtotal|address/i.test(afterCss) ||
          afterCss.length > 20)) // Or substantial content

    if (isCssBlock && hasEmailContent) {
      text = afterCss
    }
  }

  // Decode HTML entities
  text = text.replace(/&nbsp;?/g, ' ')
  text = text.replace(/\u00A0/g, ' ')
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

/**
 * Decode HTML entities in plain text snippets.
 * Handles named entities and numeric entities like &#39; and &#x27;.
 */
export function decodeHtmlEntities(text: string): string {
  if (!text) return ''

  const namedEntities: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
    '#39': "'",
  }

  return text
    .replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);?/g, (_match, entity) => {
      const key = String(entity)

      if (namedEntities[key]) {
        return namedEntities[key]
      }

      if (key.startsWith('#x') || key.startsWith('#X')) {
        const codePoint = Number.parseInt(key.slice(2), 16)
        if (Number.isFinite(codePoint)) {
          return String.fromCodePoint(codePoint)
        }
      }

      if (key.startsWith('#')) {
        const codePoint = Number.parseInt(key.slice(1), 10)
        if (Number.isFinite(codePoint)) {
          return String.fromCodePoint(codePoint)
        }
      }

      return _match
    })
    .replace(/\u00A0/g, ' ')
}
