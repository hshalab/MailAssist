"use client"

import React, { useEffect, useRef, useState, useMemo } from "react"
import DOMPurify from "isomorphic-dompurify"
import { cn } from "@/lib/utils"
import { useTheme } from "next-themes"

interface EmailContentViewerProps {
    content: string
    emailId?: string
    attachments?: any[]
    className?: string
}

// Helper function to process email content (extracted for useMemo)
function processEmailContent(
    content: string,
    emailId: string | undefined,
    attachments: any[] | undefined,
    remoteImagesAllowed: boolean
): { processedContent: string; extractedStyles: string[]; blockedRemoteCount: number } {
    if (!content) {
        return { processedContent: "", extractedStyles: [], blockedRemoteCount: 0 }
    }

    // If message is plain text, preserve line breaks and auto-link URLs/emails
    const isPlainText = !/\<\s*(p|div|br|table|img|ul|ol|li|span|style|body|html|blockquote)/i.test(content)
    let normalizedContent = content

    if (isPlainText) {
        // Escape HTML entities first
        normalizedContent = normalizedContent
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')

        // Auto-link URLs (Gmail/Outlook style)
        normalizedContent = normalizedContent.replace(
            /\b(https?:\/\/[^\s<>"]+)/gi,
            '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
        )

        // Auto-link email addresses
        normalizedContent = normalizedContent.replace(
            /\b([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,})\b/g,
            '<a href="mailto:$1">$1</a>'
        )

        // Auto-link phone numbers (basic patterns)
        normalizedContent = normalizedContent.replace(
            /\b(\+?1?[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})\b/g,
            '<a href="tel:$1">$1</a>'
        )

        // Convert newlines to <br>
        normalizedContent = normalizedContent.replace(/\n/g, '<br>')
    }

    // Extract style tags BEFORE sanitization to preserve their content
    const styleTagRegex = /<style[^>]*>([\s\S]*?)<\/style>/gi
    const styles: string[] = []
    let styleMatch

    styleTagRegex.lastIndex = 0
    while ((styleMatch = styleTagRegex.exec(normalizedContent)) !== null) {
        if (styleMatch[1]) {
            styles.push(styleMatch[1].trim())
        }
    }

    // Remove style tags from content before sanitization
    let contentWithoutStyles = normalizedContent
    contentWithoutStyles = contentWithoutStyles.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    contentWithoutStyles = contentWithoutStyles.replace(/<style[^>]*>[\s\S]*?(?=<[^>]*>|$)/gi, '')
    contentWithoutStyles = contentWithoutStyles.replace(/<style[^>]*>/gi, '')
    contentWithoutStyles = contentWithoutStyles.replace(/<\/style>/gi, '')

    // Configure DOMPurify
    const clean = DOMPurify.sanitize(contentWithoutStyles, {
        USE_PROFILES: { html: true },
        ADD_TAGS: ['center', 'font', 'table', 'tbody', 'thead', 'tfoot', 'tr', 'td', 'th', 'div', 'span', 'p', 'br', 'hr', 'img', 'a', 'ul', 'ol', 'li', 'blockquote', 'b', 'strong', 'i', 'em', 'u', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
        ADD_ATTR: ['style', 'target', 'href', 'src', 'width', 'height', 'align', 'valign', 'bgcolor', 'border', 'cellpadding', 'cellspacing', 'colspan', 'rowspan', 'class', 'id', 'alt', 'title'],
        ADD_URI_SAFE_ATTR: ['src', 'href'],
        ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|data|blob):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
        FORBID_TAGS: ['script', 'object', 'embed', 'form', 'input', 'button', 'svg', 'canvas', 'video', 'audio', 'style'],
        FORBID_ATTR: ['onmouseover', 'onclick', 'onerror', 'onload', 'onmouseenter', 'onmouseleave']
    })

    let processed = clean
    let remoteImageCount = 0
    const transparentPixel = "data:image/gif;base64,R0lGODlhAQABAIAAAP///////ywAAAAAAQABAAACAUwAOw=="

    // Replace CID images with attachment route
    if (emailId && attachments?.length) {
        attachments.forEach(att => {
            const nameWithoutExt = att.filename?.replace(/\.[^.]+$/, '') || ''
            const contentId = att.contentId || att.id
            const patterns = [
                `cid:${att.id}`, `cid:${contentId}`, `cid:${att.filename}`, `cid:${nameWithoutExt}`,
                `<${att.id}>`, `<${contentId}>`, `<${att.filename}>`, `<${nameWithoutExt}>`
            ].filter(Boolean).map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))

            const replacementSrc = att.data
                ? `data:${att.mimeType || 'application/octet-stream'};base64,${att.data}`
                : `/api/emails/${emailId}/attachments/${att.id}`

            const cidRegex = new RegExp(`src=["'](?:${patterns.join('|')})["']`, 'gi')
            processed = processed.replace(cidRegex, `src="${replacementSrc}"`)
        })
    }

    // Handle remote images
    processed = processed.replace(
        /<img\s+([^>]*?)src=["']([^"']+)["']([^>]*)>/gi,
        (match, beforeSrc, srcValue, afterSrc) => {
            const hasLoading = /loading=/i.test(beforeSrc + afterSrc)
            const hasDecoding = /decoding=/i.test(beforeSrc + afterSrc)
            const isHttp = /^https?:\/\//i.test(srcValue)

            if (isHttp) {
                remoteImageCount += 1
                if (!remoteImagesAllowed) {
                    return `<img ${beforeSrc}src="${transparentPixel}" data-remote-src="${encodeURIComponent(srcValue)}" data-remote-blocked="true" alt="Remote image blocked" ${hasLoading ? '' : 'loading="lazy" '} ${hasDecoding ? '' : 'decoding="async" '} ${afterSrc}>`
                }
                const proxiedSrc = `/api/proxy/image?url=${encodeURIComponent(srcValue)}`
                return `<img ${beforeSrc}src="${proxiedSrc}" ${hasLoading ? '' : 'loading="lazy" '} ${hasDecoding ? '' : 'decoding="async" '} ${afterSrc}>`
            }
            return `<img ${beforeSrc}src="${srcValue}" ${hasLoading ? '' : 'loading="lazy" '} ${hasDecoding ? '' : 'decoding="async" '} ${afterSrc}>`
        }
    )

    // Hide tracking pixels
    processed = processed.replace(/<img\s+([^>]*?)width=["']1["']\s*height=["']1["']([^>]*)>/gi, '<img $1width="1" height="1" style="display:none!important" $2>')
    processed = processed.replace(/<img\s+([^>]*?)height=["']1["']\s*width=["']1["']([^>]*)>/gi, '<img $1height="1" width="1" style="display:none!important" $2>')

    // Ensure links open in new tab
    processed = processed.replace(
        /<a\s+([^>]*href=["']([^"']+)["'][^>]*)>/gi,
        (match, attrs, href) => {
            const isExternal = /^https?:\/\//i.test(href) && !href.includes(window.location.hostname)
            const hasTarget = /target=/i.test(attrs)
            let newAttrs = attrs
            if (!hasTarget) {
                newAttrs += ' target="_blank" rel="noopener noreferrer"'
            }
            if (isExternal) {
                newAttrs += ' data-external="true"'
            }
            return `<a ${newAttrs}>`
        }
    )

    // Collapse quoted text - wrap blockquotes
    processed = processed.replace(/(<blockquote[^>]*>[\s\S]*?<\/blockquote>)/gi, '<div class="gmail-quote" data-collapsed="true">$1</div>')

    // Collapse "On ... wrote:" quoted sections
    // Match the FIRST "On ... wrote:" pattern and assume everything after is quoted history.
    // We allow for HTML tags inside the "On ... wrote" line (e.g. email links).
    // OPTIMIZED REGEX: Avoid unbounded [^>]+ inside repetition. simpler match.
    // We typically expect "On <date>, <someone> wrote:"
    // Matches "On " followed by up to 500 chars of anything until "wrote:", but lazy.
    // Using [\s\S] to match newlines too.
    const quoteRegex = /(On\s+[\s\S]{10,500}?\s+wrote:?:?)(?:<br\s*\/?>)?([\s\S]*)$/i

    // Only apply if we haven't already wrapped a blockquote that covers most of the content
    // And to avoid ReDoS on huge strings, we can check if the match exists in the first 2000 chars roughly?
    // Or just rely on the fixed length quantifier {10,500} which prevents catastrophic scanning
    if (!processed.includes('class="gmail-quote"') && quoteRegex.test(processed)) {
        processed = processed.replace(
            quoteRegex,
            '<div class="quote-header"><span class="quote-info">$1</span><button class="expand-quote" type="button" aria-label="Toggle quote"></button></div><div class="quoted-content">$2</div>'
        )
    }

    return { processedContent: processed, extractedStyles: styles, blockedRemoteCount: remoteImageCount }
}

export function EmailContentViewer({ content, emailId, attachments, className }: EmailContentViewerProps) {
    const [iframeHeight, setIframeHeight] = useState(200)
    const [loading, setLoading] = useState(false)
    const [remoteImagesAllowed, setRemoteImagesAllowed] = useState(true)
    const [blockedRemoteCount, setBlockedRemoteCount] = useState(0)
    const iframeRef = useRef<HTMLIFrameElement>(null)
    const previousEmailIdRef = useRef<string | undefined>(undefined)
    const { theme, resolvedTheme } = useTheme()
    const isDarkMode = (theme === "dark" || resolvedTheme === "dark")

    // Process content synchronously using useMemo to avoid flash
    const { processedContent, extractedStyles, blockedRemoteCount: computedBlockedCount } = useMemo(() => {
        return processEmailContent(content, emailId, attachments, remoteImagesAllowed)
    }, [content, emailId, attachments, remoteImagesAllowed])

    // Reset remote image permissions when switching emails
    useEffect(() => {
        setRemoteImagesAllowed(true)
        setBlockedRemoteCount(0)
    }, [emailId])

    // Update blocked count when it changes
    useEffect(() => {
        setBlockedRemoteCount(computedBlockedCount)
    }, [computedBlockedCount])

    // Set loading state when switching emails
    useEffect(() => {
        const isNewEmail = emailId !== previousEmailIdRef.current
        if (isNewEmail && processedContent) {
            setLoading(true)
            previousEmailIdRef.current = emailId
        }
    }, [emailId, processedContent])

    // Wait for all images to load before calculating height
    const waitForImages = (iframeDoc: Document): Promise<void> => {
        return new Promise((resolve) => {
            const images = iframeDoc.querySelectorAll('img')
            if (images.length === 0) {
                resolve()
                return
            }

            let loadedCount = 0
            const checkAllLoaded = () => {
                loadedCount++
                if (loadedCount === images.length) {
                    resolve()
                }
            }

            images.forEach(img => {
                if (img.complete) {
                    checkAllLoaded()
                } else {
                    img.onload = checkAllLoaded
                    img.onerror = checkAllLoaded // Count errors as loaded to not block
                }
            })
        })
    }

    const measureHeight = () => {
        const iframe = iframeRef.current
        if (!iframe) return
        try {
            const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document
            if (!iframeDoc) return

            const body = iframeDoc.body
            const html = iframeDoc.documentElement
            const actualHeight = Math.max(
                body?.scrollHeight || 0,
                body?.offsetHeight || 0,
                html?.clientHeight || 0,
                html?.scrollHeight || 0,
                html?.offsetHeight || 0
            )

            const minHeight = 100
            const calculatedHeight = actualHeight + 40
            setIframeHeight(Math.max(calculatedHeight, minHeight))
        } catch (error) {
            console.error('Error updating iframe height:', error)
        }
    }

    // Auto-resize iframe based on content with smart max height
    useEffect(() => {
        const iframe = iframeRef.current
        if (!iframe || !processedContent) return

        const loadingFallback = setTimeout(() => setLoading(false), 1500)

        // Initial height calculation (do NOT wait on images)
        const timer = setTimeout(measureHeight, 10)

        // After images load, measure again without blocking initial render
        const scheduleAfterImages = () => {
            try {
                const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document
                if (!iframeDoc) return
                waitForImages(iframeDoc).then(() => {
                    // Check if component is still mounted and iframe still exists
                    if (iframeRef.current === iframe) {
                        measureHeight()
                        setLoading(false)
                    }
                })
            } catch {
                if (iframeRef.current === iframe) {
                    setLoading(false)
                }
            }
        }
        const imagesTimer = setTimeout(scheduleAfterImages, 100)

        // Set up ResizeObserver for dynamic content changes
        let resizeObserver: ResizeObserver | null = null
        const setupObserver = () => {
            try {
                const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document
                if (!iframeDoc?.body) return

                resizeObserver = new ResizeObserver(() => {
                    // Throttle resize updates to prevent excessive re-renders
                    if (iframeRef.current === iframe) {
                        measureHeight()
                    }
                })
                resizeObserver.observe(iframeDoc.body)
            } catch (error) {
                console.error('Error setting up ResizeObserver:', error)
            }
        }
        const observerTimer = setTimeout(setupObserver, 200)

        return () => {
            clearTimeout(timer)
            clearTimeout(imagesTimer)
            clearTimeout(observerTimer)
            clearTimeout(loadingFallback)
            // CRITICAL: Always disconnect ResizeObserver to prevent memory leaks
            if (resizeObserver) {
                resizeObserver.disconnect()
                resizeObserver = null
            }
        }
    }, [processedContent])

    // Build the iframe HTML content with proper theme-matching colors
    // Match website background: white in light mode, dark teal in dark mode
    const canvasBg = isDarkMode ? '#0d1418' : '#ffffff'  // website dark bg for dark, white for light
    const fallbackText = isDarkMode ? '#e2e8f0' : '#1f2937'  // slate-200 for dark, gray-800 for light
    const fallbackLink = isDarkMode ? '#60a5fa' : '#2563eb'  // blue-400 for dark, blue-600 for light

    // Inject extracted email styles into iframe head
    const emailStylesHtml = extractedStyles.length > 0
        ? extractedStyles.map(css => `<style>${css}</style>`).join('\n')
        : ''

    const iframeHtml = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            ${emailStylesHtml}
            <style>
                :root { color-scheme: ${isDarkMode ? 'dark' : 'light'}; }
                * { box-sizing: border-box; }
                html, body {
                    margin: 0;
                    padding: 0;
                    background: ${canvasBg};
                }
                body {
                    padding: 24px;
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
                    font-size: 14px;
                    line-height: 1.6;
                    word-wrap: break-word;
                    overflow-wrap: break-word;
                    /* Fallback colors - email CSS will override if present */
                    color: ${fallbackText};
                    background: ${canvasBg};
                    -webkit-user-select: text;
                    user-select: text;
                }
                .email-body {
                    max-width: 100%;
                }
                /* Apply better paragraph spacing for sent emails */
                .email-body > p:not([style]) { margin: 0 0 1.5em 0; }
                .email-body > ul:not([style]), .email-body > ol:not([style]) { padding-left: 20px; margin: 0 0 1em 0; }
                img {
                    max-width: 100%;
                    height: auto;
                }
                img[data-remote-blocked="true"] {
                    background: repeating-linear-gradient(45deg, #f7f7f7, #f7f7f7 10px, #e5e5e5 10px, #e5e5e5 20px);
                    border: 1px dashed #c4c4c4;
                    color: #555;
                    min-height: 48px;
                }
                /* Fallback link color - email links with inline style will override */
                a:not([style*="color"]) { color: ${fallbackLink}; }
                a:hover { text-decoration: underline; }
                /* External link indicator (Gmail-style) */
                a[data-external="true"]::after {
                    content: " ↗";
                    font-size: 0.75em;
                    opacity: 0.6;
                }
                table { border-collapse: collapse; }
                td, th { padding: 2px 4px; }
                /* Preserve whitespace in preformatted blocks */
                pre, code { white-space: pre-wrap; font-family: monospace; }
                /* Quoted text styling (common in replies) */
                blockquote {
                    margin: 0 0 1em 0;
                    padding-left: 12px;
                    border-left: 3px solid ${isDarkMode ? '#4a5568' : '#cbd5e0'};
                    color: ${isDarkMode ? '#a0aec0' : '#718096'};
                }
                /* Gmail-style collapsed quotes */
                .gmail-quote[data-collapsed="true"] blockquote {
                    max-height: 100px;
                    overflow: hidden;
                    position: relative;
                }
                .gmail-quote[data-collapsed="true"] blockquote::after {
                    content: "";
                    position: absolute;
                    bottom: 0;
                    left: 0;
                    right: 0;
                    height: 40px;
                    background: linear-gradient(transparent, ${canvasBg});
                }
                .gmail-quote.expanded blockquote {
                    max-height: none;
                }
                .gmail-quote.expanded blockquote::after {
                    display: none;
                }
                /* Quote header with expand button */
                .quote-header {
                    color: ${isDarkMode ? '#a0aec0' : '#718096'};
                    font-size: 0.9em;
                    margin-top: 1em;
                    padding: 8px 12px;
                    background: ${isDarkMode ? '#1e293b' : '#f1f5f9'};
                    border-radius: 6px;
                    border: 1px solid ${isDarkMode ? '#334155' : '#e2e8f0'};
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }
                .quote-header .quote-info {
                    flex: 1;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }
                .quote-header .expand-quote {
                    background: ${isDarkMode ? '#3b82f6' : '#2563eb'};
                    border: none;
                    border-radius: 4px;
                    padding: 4px 10px;
                    cursor: pointer;
                    font-size: 0.85em;
                    color: white;
                    font-weight: 500;
                    transition: background 0.15s ease;
                    flex-shrink: 0;
                }
                .quote-header .expand-quote:hover {
                    background: ${isDarkMode ? '#2563eb' : '#1d4ed8'};
                }
                .quote-header.expanded .expand-quote {
                    background: ${isDarkMode ? '#475569' : '#64748b'};
                }
                .quote-header.expanded .expand-quote::after {
                    content: ' Hide';
                }
                .quote-header:not(.expanded) .expand-quote::after {
                    content: ' Show';
                }
                .quoted-content {
                    display: none;
                }
                .quote-header.expanded + .quoted-content {
                    display: block;
                    padding: 12px;
                    margin-top: 4px;
                    border-left: 3px solid ${isDarkMode ? '#4a5568' : '#cbd5e0'};
                    background: ${isDarkMode ? '#1e293b50' : '#f8fafc'};
                    border-radius: 0 6px 6px 0;
                    color: ${isDarkMode ? '#a0aec0' : '#718096'};
                }
                /* Print-friendly styles */
                @media print {
                    body { background: white !important; color: black !important; }
                    a { color: blue !important; }
                    .gmail-quote blockquote, .quoted-content { max-height: none !important; }
                    .gmail-quote blockquote::after { display: none !important; }
                    .expand-quote { display: none !important; }
                }
            </style>
        </head>
        <body>
            <div class="email-body">
                ${processedContent}
            </div>
            <script>
                // Set up click handlers for quote expansion buttons
                document.querySelectorAll('.expand-quote').forEach(function(btn) {
                    btn.addEventListener('click', function(e) {
                        e.preventDefault();
                        var header = this.parentElement;
                        if (header) {
                            header.classList.toggle('expanded');
                        }
                    });
                });
            </script>
        </body>
        </html>
    `

    return (
        <div className={cn("email-content-viewer w-full rounded-lg border-0", className)} aria-busy={loading}>
            {blockedRemoteCount > 0 && !remoteImagesAllowed && (
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-sm text-amber-900 dark:text-amber-200 rounded-t-lg">
                    <span>{blockedRemoteCount} remote image{blockedRemoteCount === 1 ? '' : 's'} blocked for privacy.</span>
                    <button
                        onClick={() => setRemoteImagesAllowed(true)}
                        className="rounded-md bg-amber-600 px-3 py-1 text-xs font-medium text-white shadow-sm transition hover:bg-amber-700"
                    >
                        Load remote images
                    </button>
                </div>
            )}
            <div className="relative rounded-lg">
                {loading && (
                    <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/80 backdrop-blur-sm">
                        <span className="text-sm text-muted-foreground">Loading message…</span>
                    </div>
                )}
                <iframe
                    ref={iframeRef}
                    sandbox="allow-same-origin allow-scripts"
                    srcDoc={iframeHtml}
                    className={cn(
                        "w-full border-0 block transition-opacity rounded-lg",
                        loading ? "opacity-0" : "opacity-100"
                    )}
                    style={{
                        height: `${iframeHeight}px`,
                        minHeight: '300px',
                        background: isDarkMode ? '#0d1418' : '#ffffff',
                    }}
                    onLoad={() => {
                        measureHeight()
                        setLoading(false)
                    }}
                    title="Email content"
                />
            </div>
        </div>
    )
}
