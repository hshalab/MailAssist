"use client"

import React, { useEffect, useRef, useState } from "react"
import DOMPurify from "isomorphic-dompurify"
import { cn } from "@/lib/utils"

interface EmailContentViewerProps {
    content: string
    emailId?: string
    attachments?: any[]
    className?: string
}

export function EmailContentViewer({ content, emailId, attachments, className }: EmailContentViewerProps) {
    const [processedContent, setProcessedContent] = useState("")
    const [isPlainTextContent, setIsPlainTextContent] = useState(false)
    const [iframeHeight, setIframeHeight] = useState(200)
    const [loading, setLoading] = useState(false)
    const [remoteImagesAllowed, setRemoteImagesAllowed] = useState(true)
    const [blockedRemoteCount, setBlockedRemoteCount] = useState(0)
    const iframeRef = useRef<HTMLIFrameElement>(null)

    // Reset remote image permissions when switching emails
    useEffect(() => {
        setRemoteImagesAllowed(true)
        setBlockedRemoteCount(0)
    }, [emailId])

    useEffect(() => {
        if (!content) {
            setProcessedContent("")
            setLoading(false)
            return
        }

        // If message is plain text, preserve line breaks and auto-link URLs/emails
        const isPlainText = !/<\s*(p|div|br|table|img|ul|ol|li|span|style|body|html|blockquote)/i.test(content)
        let normalizedContent = content
        // Track whether this content is plain text for CSS styling
        setIsPlainTextContent(isPlainText)

        if (isPlainText) {
            // Escape HTML entities first
            normalizedContent = normalizedContent
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')

            // Auto-link URLs (Gmail/Outlook style)
            normalizedContent = normalizedContent.replace(
                /\b(https?:\/\/[^\s<>"\]]+)/gi,
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

        // Configure DOMPurify to allow common email tags, attributes, and URI schemes
        const clean = DOMPurify.sanitize(normalizedContent, {
            USE_PROFILES: { html: true },
            // Allow common formatting tags plus style (many emails rely on inline <style>)
            ADD_TAGS: ['style', 'center', 'font', 'table', 'tbody', 'thead', 'tfoot', 'tr', 'td', 'th', 'div', 'span', 'p', 'br', 'hr', 'img', 'a', 'ul', 'ol', 'li', 'blockquote', 'b', 'strong', 'i', 'em', 'u', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
            ADD_ATTR: ['style', 'target', 'href', 'src', 'width', 'height', 'align', 'valign', 'bgcolor', 'border', 'cellpadding', 'cellspacing', 'colspan', 'rowspan', 'class', 'id', 'alt', 'title'],
            ADD_URI_SAFE_ATTR: ['src', 'href'],
            ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|data|blob):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
            // Forbid active/unsafe embeds; allow <style> for email fidelity
            FORBID_TAGS: ['script', 'object', 'embed', 'form', 'input', 'button', 'svg', 'canvas', 'video', 'audio'],
            FORBID_ATTR: ['onmouseover', 'onclick', 'onerror', 'onload', 'onmouseenter', 'onmouseleave']
        })

        setLoading(true)

        // Process the cleaned HTML to handle images
        let processed = clean
        let remoteImageCount = 0

        const transparentPixel = "data:image/gif;base64,R0lGODlhAQABAIAAAP///////ywAAAAAAQABAAACAUwAOw=="

        // Replace CID images with attachment route (robust patterns)
        // Gmail attachments use /api route, IMAP attachments may have inline data
        if (emailId && attachments?.length) {
            attachments.forEach(att => {
                const nameWithoutExt = att.filename?.replace(/\.[^.]+$/, '') || ''
                const contentId = att.contentId || att.id

                // Build list of possible CID patterns this attachment might match
                const patterns = [
                    `cid:${att.id}`,
                    `cid:${contentId}`,
                    `cid:${att.filename}`,
                    `cid:${nameWithoutExt}`,
                    `<${att.id}>`,
                    `<${contentId}>`,
                    `<${att.filename}>`,
                    `<${nameWithoutExt}>`
                ].filter(Boolean).map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))

                // Determine replacement src: inline data URI for IMAP, API route for Gmail
                let replacementSrc: string
                if (att.data) {
                    // IMAP-style: attachment has inline base64 data
                    replacementSrc = `data:${att.mimeType || 'application/octet-stream'};base64,${att.data}`
                } else {
                    // Gmail-style: fetch via API route
                    replacementSrc = `/api/emails/${emailId}/attachments/${att.id}`
                }

                const cidRegex = new RegExp(`src=["'](?:${patterns.join('|')})["']`, 'gi')
                processed = processed.replace(cidRegex, `src="${replacementSrc}"`)
            })
        }

        // Outlook/Gmail-style remote image handling: block remote loads until user opts in
        processed = processed.replace(
            /<img\s+([^>]*?)src=["']([^"']+)["']([^>]*)>/gi,
            (match, beforeSrc, srcValue, afterSrc) => {
                const hasLoading = /loading=/i.test(beforeSrc + afterSrc)
                const hasDecoding = /decoding=/i.test(beforeSrc + afterSrc)
                const isDataUri = srcValue.startsWith('data:')
                const isAlreadyProxied = srcValue.startsWith('/api/proxy/image')
                const isHttp = /^https?:\/\//i.test(srcValue)

                if (isHttp) {
                    remoteImageCount += 1

                    if (!remoteImagesAllowed) {
                        return `<img ${beforeSrc}src="${transparentPixel}" data-remote-src="${encodeURIComponent(srcValue)}" data-remote-blocked="true" alt="Remote image blocked" ${hasLoading ? '' : 'loading="lazy" '} ${hasDecoding ? '' : 'decoding="async" '} ${afterSrc}>`
                    }

                    const proxiedSrc = `/api/proxy/image?url=${encodeURIComponent(srcValue)}`
                    return `<img ${beforeSrc}src="${proxiedSrc}" ${hasLoading ? '' : 'loading="lazy" '} ${hasDecoding ? '' : 'decoding="async" '} ${afterSrc}>`
                }

                // Unresolved cid: refs (Yahoo/IMAP attachments we couldn't match).
                // Replace with a styled placeholder so users see something nice
                // instead of a browser broken-image icon + raw alt text.
                if (srcValue.toLowerCase().startsWith('cid:')) {
                    const altMatch = (beforeSrc + afterSrc).match(/\balt=["']([^"']*)["']/i)
                    const label = altMatch ? altMatch[1] : 'Inline image unavailable'
                    const escaped = label.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                    return `<span class="cid-placeholder" role="img" aria-label="${escaped}">🖼  ${escaped}</span>`
                }

                // For data/relative images just ensure lazy/async
                return `<img ${beforeSrc}src="${srcValue}" ${hasLoading ? '' : 'loading="lazy" '} ${hasDecoding ? '' : 'decoding="async" '} ${afterSrc}>`
            }
        )

        // Gmail/Outlook: Hide tracking pixels (1x1 images)
        processed = processed.replace(
            /<img\s+([^>]*?)width=["']1["']\s*height=["']1["']([^>]*)>/gi,
            '<img $1width="1" height="1" style="display:none!important" $2>'
        )
        processed = processed.replace(
            /<img\s+([^>]*?)height=["']1["']\s*width=["']1["']([^>]*)>/gi,
            '<img $1height="1" width="1" style="display:none!important" $2>'
        )

        setBlockedRemoteCount(remoteImageCount)

        // Ensure links open in new tab and add external link indicator
        processed = processed.replace(
            /<a\s+([^>]*href=["']([^"']+)["'][^>]*)>/gi,
            (match, attrs, href) => {
                const isExternal = /^https?:\/\//i.test(href) && !href.includes(window.location.hostname)
                const hasTarget = /target=/i.test(attrs)

                let newAttrs = attrs
                if (!hasTarget) {
                    newAttrs += ' target="_blank" rel="noopener noreferrer"'
                }

                // Add data attribute for external links (can be styled in CSS)
                if (isExternal) {
                    newAttrs += ' data-external="true"'
                }

                return `<a ${newAttrs}>`
            }
        )

        // Gmail-style: Collapse quoted text (lines starting with > or quoted blocks)
        // Wrap quoted sections in a collapsible container
        processed = processed.replace(
            /(<blockquote[^>]*>[\s\S]*?<\/blockquote>)/gi,
            '<div class="gmail-quote" data-collapsed="true">$1</div>'
        )

        // Detect "On ... wrote:" pattern and wrap following content
        processed = processed.replace(
            /(On\s+.+\s+wrote:?\s*<br\s*\/?>)/gi,
            '<div class="quote-header" data-collapsed="true">$1<button class="expand-quote" onclick="this.parentElement.classList.toggle(\'expanded\')">[...]</button></div><div class="quoted-content">'
        )

        setProcessedContent(processed)
    }, [content, emailId, attachments, remoteImagesAllowed])

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
                    measureHeight()
                    setLoading(false)
                })
            } catch {
                setLoading(false)
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
                    measureHeight()
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
            resizeObserver?.disconnect()
        }
    }, [processedContent])

    // Always render the email body on a white "paper" canvas, regardless of app theme.
    // Email inline CSS (text colors, backgrounds, branded styling) is designed for white;
    // forcing dark-mode rewrites breaks marketing emails. Gmail/Outlook follow the same pattern.
    // We soften the canvas a touch (#fafafa) so it doesn't burn against dark UI chrome.
    const canvasBg = '#fafafa'
    const fallbackText = '#1f2937'
    const fallbackLink = '#2563eb'

    const iframeHtml = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
                :root { color-scheme: light; }
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
                    /* Preserve user-intended line breaks and spacing for plain-text style emails
                       while still allowing HTML emails to render normally. */
                    white-space: pre-wrap;
                    word-break: break-word;
                }
                /* Add paragraph-like spacing for simple div-based layouts (common in Gmail),
                   but only when the email itself hasn't set custom styles. */
                .email-body > div:not([style]) {
                    margin: 0 0 1em 0;
                }
                /* Some providers (like Gmail) add inline left margins on the
                   first line only. Normalize those so all lines align the same. */
                .email-body > div[style*="margin-left"] {
                    margin-left: 0 !important;
                    padding-left: 0 !important;
                    text-indent: 0 !important;
                }
                /* Only apply spacing if email doesn't have its own */
                .email-body > p:not([style]) { margin: 0 0 1em 0; }
                .email-body > ul:not([style]), .email-body > ol:not([style]) { padding-left: 20px; margin: 0 0 1em 0; }
                img {
                    max-width: 100%;
                    height: auto;
                    border-radius: 6px;
                }
                /* Placeholder for unresolved cid: refs (Yahoo/IMAP inline images
                   whose attachments we couldn't match). Replaces what would
                   otherwise render as a broken-image icon + raw "Photo attachment"
                   alt text. Works without iframe scripts. */
                .cid-placeholder {
                    display: inline-flex;
                    align-items: center;
                    gap: 8px;
                    padding: 10px 14px;
                    min-height: 44px;
                    border: 1px dashed #d1d5db;
                    background: #f3f4f6;
                    color: #4b5563;
                    border-radius: 8px;
                    font-size: 13px;
                    font-style: italic;
                    line-height: 1.4;
                    margin: 4px 0;
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
                    border-left: 3px solid #cbd5e0;
                    color: #718096;
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
                    color: #718096;
                    font-size: 0.9em;
                    margin-top: 1em;
                }
                .quote-header .expand-quote {
                    background: #e5e7eb;
                    border: none;
                    border-radius: 4px;
                    padding: 2px 8px;
                    margin-left: 8px;
                    cursor: pointer;
                    font-size: 0.85em;
                    color: #0b57d0;
                }
                .quote-header .expand-quote:hover {
                    background: #d1d5db;
                }
                .quote-header:not(.expanded) + .quoted-content {
                    display: none;
                }
                .quote-header.expanded + .quoted-content {
                    display: block;
                    padding-left: 12px;
                    border-left: 3px solid #cbd5e0;
                    color: #718096;
                }
            </style>
        </head>
        <body>
<div class="email-body${isPlainTextContent ? ' plain-text' : ''}">${processedContent}</div>
        </body>
        </html>
    `

    return (
        <div
            className={cn(
                "email-content-viewer w-full rounded-xl overflow-hidden",
                "border border-zinc-200 dark:border-white/10",
                "shadow-sm dark:shadow-lg dark:shadow-black/30",
                "bg-zinc-50 dark:bg-zinc-900/40",
                className
            )}
            aria-busy={loading}
        >
            {blockedRemoteCount > 0 && !remoteImagesAllowed && (
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 dark:border-white/10 bg-amber-50 dark:bg-amber-900/20 px-4 py-2.5 text-sm text-amber-900 dark:text-amber-200">
                    <span>
                        <span className="font-medium">{blockedRemoteCount}</span> remote image{blockedRemoteCount === 1 ? '' : 's'} blocked for privacy.
                    </span>
                    <button
                        onClick={() => setRemoteImagesAllowed(true)}
                        className="rounded-md bg-amber-600 px-3 py-1 text-xs font-medium text-white shadow-sm transition hover:bg-amber-700"
                    >
                        Load remote images
                    </button>
                </div>
            )}
            <div className="relative p-3 sm:p-4">
                <div className="rounded-lg overflow-hidden border border-zinc-200/80 dark:border-white/5 bg-[#fafafa] dark:ring-1 dark:ring-white/5">
                    {loading && (
                        <div className="absolute inset-0 z-10 flex flex-col gap-3 p-6 bg-[#fafafa] dark:bg-zinc-900/60">
                            {/* Paper-like shimmer so the message area never flashes blank */}
                            <div className="h-3 w-2/3 rounded bg-zinc-200/80 dark:bg-zinc-700/60 animate-pulse" />
                            <div className="h-3 w-11/12 rounded bg-zinc-200/70 dark:bg-zinc-700/50 animate-pulse" style={{ animationDelay: '80ms' }} />
                            <div className="h-3 w-5/6 rounded bg-zinc-200/70 dark:bg-zinc-700/50 animate-pulse" style={{ animationDelay: '160ms' }} />
                            <div className="h-3 w-3/5 rounded bg-zinc-200/60 dark:bg-zinc-700/40 animate-pulse" style={{ animationDelay: '240ms' }} />
                        </div>
                    )}
                    <iframe
                        ref={iframeRef}
                        sandbox="allow-same-origin"
                        srcDoc={iframeHtml}
                        className={cn(
                            "w-full border-0 block transition-opacity duration-200",
                            loading ? "opacity-0" : "opacity-100"
                        )}
                        style={{
                            height: `${iframeHeight}px`,
                            minHeight: '88px',
                            background: '#fafafa',
                        }}
                        onLoad={() => {
                            measureHeight()
                            setLoading(false)
                        }}
                        title="Email content"
                    />
                </div>
            </div>
        </div>
    )
}
