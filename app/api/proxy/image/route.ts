/**
 * GET /api/proxy/image - Proxy external images to bypass CORS/auth issues
 * Gmail/Outlook-style image proxy with privacy protection and caching
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Blocklist of known tracking domains (Gmail blocks these)
const TRACKING_DOMAINS = [
    'pixel.', 'track.', 'open.', 'click.', 'beacon.',
    'mailchimp.com/track', 'list-manage.com/track',
    'sendgrid.net/wf/', 'mandrillapp.com/track',
    'hubspot.com/e2t', 'mailgun.org/track',
];

// Size limit for proxied images (10MB like Gmail)
const MAX_IMAGE_SIZE = 10 * 1024 * 1024;

export async function GET(request: NextRequest) {
    try {
        const url = request.nextUrl.searchParams.get('url');

        if (!url) {
            return new NextResponse('Missing url parameter', { status: 400 });
        }

        // Decode the URL
        const decodedUrl = decodeURIComponent(url);

        // Validate it's an image URL (basic check)
        if (!decodedUrl.startsWith('http://') && !decodedUrl.startsWith('https://')) {
            return new NextResponse('Invalid URL', { status: 400 });
        }

        // Check if it's a known tracking pixel domain
        const isTracker = TRACKING_DOMAINS.some(domain => decodedUrl.toLowerCase().includes(domain));
        if (isTracker) {
            // Return transparent pixel without fetching (privacy protection)
            const transparentGif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
            return new NextResponse(transparentGif, {
                status: 200,
                headers: {
                    'Content-Type': 'image/gif',
                    'Cache-Control': 'public, max-age=86400',
                    'X-Proxy-Blocked': 'tracking',
                },
            });
        }

        // Fetch the image with browser-like headers (Gmail-style)
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout

        const response = await fetch(decodedUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Referer': new URL(decodedUrl).origin,
                'Sec-Fetch-Dest': 'image',
                'Sec-Fetch-Mode': 'no-cors',
                'Sec-Fetch-Site': 'cross-site',
            },
            signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!response.ok) {
            // Return a transparent 1x1 gif for failed images
            const transparentGif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
            return new NextResponse(transparentGif, {
                status: 200,
                headers: {
                    'Content-Type': 'image/gif',
                    'Cache-Control': 'public, max-age=86400',
                },
            });
        }

        // Check content type
        const contentType = response.headers.get('content-type') || 'image/png';
        const isImage = contentType.startsWith('image/') || contentType === 'application/octet-stream';
        
        if (!isImage) {
            // Not an image, return transparent pixel
            const transparentGif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
            return new NextResponse(transparentGif, {
                status: 200,
                headers: {
                    'Content-Type': 'image/gif',
                    'Cache-Control': 'public, max-age=3600',
                },
            });
        }

        // Check content length if available
        const contentLength = response.headers.get('content-length');
        if (contentLength && parseInt(contentLength) > MAX_IMAGE_SIZE) {
            return new NextResponse('Image too large', { status: 413 });
        }

        const buffer = await response.arrayBuffer();
        
        // Double-check size after download
        if (buffer.byteLength > MAX_IMAGE_SIZE) {
            return new NextResponse('Image too large', { status: 413 });
        }

        // Return with aggressive caching (Gmail caches images for weeks)
        return new NextResponse(Buffer.from(buffer), {
            status: 200,
            headers: {
                'Content-Type': contentType,
                'Cache-Control': 'public, max-age=604800, immutable', // 7 days
                'X-Content-Type-Options': 'nosniff',
            },
        });
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        
        // Don't log abort errors (timeouts)
        if (errorMessage !== 'This operation was aborted') {
            console.error('[ImageProxy] Error:', errorMessage);
        }
        
        // Return a transparent 1x1 gif for any errors
        const transparentGif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
        return new NextResponse(transparentGif, {
            status: 200,
            headers: {
                'Content-Type': 'image/gif',
                'Cache-Control': 'public, max-age=3600',
            },
        });
    }
}
