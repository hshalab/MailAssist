/**
 * GET /api/emails/[id]/attachments/[attachmentId] - Download an email attachment
 */

import { NextRequest, NextResponse } from 'next/server';
import { getValidTokens } from '@/lib/token-refresh';
import { getGmailClient } from '@/lib/gmail';

export const dynamic = 'force-dynamic';

/**
 * Properly encode filename for Content-Disposition header
 * Uses RFC 2231 encoding for international characters
 * Provides both filename and filename* for maximum browser compatibility
 */
function encodeFilename(filename: string): string {
    // Sanitize filename - remove any control characters and problematic characters
    let sanitized = filename.replace(/[\x00-\x1F\x7F]/g, '').trim();
    
    // Ensure we have a valid filename
    if (!sanitized || sanitized.length === 0) {
        sanitized = 'attachment';
    }
    
    // Check if filename contains non-ASCII characters
    const hasNonAscii = /[^\x00-\x7F]/.test(sanitized);
    
    if (hasNonAscii) {
        // Use RFC 2231 encoding with UTF-8 for non-ASCII
        const encoded = encodeURIComponent(sanitized).replace(/'/g, "%27");
        // Provide ASCII fallback for older browsers
        const asciiFallback = sanitized.replace(/[^\x20-\x7E]/g, '_').substring(0, 100);
        return `filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
    } else {
        // For ASCII-only filenames, use simple quoted string
        // Escape quotes and backslashes, but keep spaces and other valid chars
        const escaped = sanitized.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        return `filename="${escaped}"`;
    }
}

export async function GET(
    request: NextRequest,
    context: { params: Promise<{ id: string; attachmentId: string }> }
) {
    try {
        const { id: messageId, attachmentId } = await context.params;

        if (!messageId || !attachmentId) {
            console.error('[Attachment] Missing required parameters:', { messageId: !!messageId, attachmentId: !!attachmentId });
            return new NextResponse('Missing required parameters', { status: 400 });
        }

        // Log attachment ID length for debugging (very long IDs might cause issues)
        if (attachmentId.length > 200) {
            console.log(`[Attachment] Very long attachment ID detected: ${attachmentId.length} characters`);
        }

        // Check for business session to determine which tokens to use
        const { validateBusinessSession, getSessionUserEmail } = await import('@/lib/session');
        const businessSession = await validateBusinessSession();

        // If business session exists, use the business email (shared account)
        // Otherwise fallback to personal session email
        const targetEmail = businessSession
            ? businessSession.email
            : await getSessionUserEmail();

        if (businessSession) {
            console.log(`[Attachment] Using business session tokens for: ${businessSession.email} (Agent: ${businessSession.name})`);
        }

        const tokens = await getValidTokens(targetEmail, businessSession?.businessId || undefined);
        if (!tokens || !tokens.access_token) {
            console.error('[Attachment] No valid tokens found');
            return new NextResponse('Not authenticated', { status: 401 });
        }

        const gmail = getGmailClient(tokens);

        // Fetch the attachment data from Gmail
        console.log(`[Attachment] Fetching attachment ${attachmentId} from message ${messageId}`);
        let gmailResponse;
        try {
            gmailResponse = await gmail.users.messages.attachments.get({
                userId: 'me',
                messageId: messageId,
                id: attachmentId,
            });
        } catch (gmailError: any) {
            console.error('[Attachment] Gmail API error:', gmailError?.message || gmailError);
            return new NextResponse(
                `Failed to fetch attachment from Gmail: ${gmailError?.message || 'Unknown error'}`,
                { status: 500 }
            );
        }

        const attachmentData = gmailResponse?.data?.data;
        if (!attachmentData) {
            console.error('[Attachment] No attachment data in Gmail response');
            return new NextResponse('Attachment not found', { status: 404 });
        }

        // Decode base64url encoded data
        let base64 = attachmentData.replace(/-/g, '+').replace(/_/g, '/');
        
        // Add padding if needed (base64 strings must be multiples of 4)
        const padding = base64.length % 4;
        if (padding) {
            base64 += '='.repeat(4 - padding);
        }
        
        let buffer: Buffer;
        try {
            buffer = Buffer.from(base64, 'base64');
        } catch (decodeError) {
            console.error('[Attachment] Base64 decode error:', decodeError);
            return new NextResponse('Failed to decode attachment data', { status: 500 });
        }
        
        if (!buffer || buffer.length === 0) {
            return new NextResponse('Invalid attachment data', { status: 500 });
        }

        // Get filename from query param if provided (with safe decoding)
        let filename = 'attachment';
        try {
            const filenameParam = request.nextUrl.searchParams.get('filename');
            if (filenameParam) {
                filename = decodeURIComponent(filenameParam);
            }
        } catch (e) {
            // If decoding fails, use the raw parameter or default
            const filenameParam = request.nextUrl.searchParams.get('filename');
            filename = filenameParam || 'attachment';
        }

        const mimeType = request.nextUrl.searchParams.get('mimeType') || 'application/octet-stream';

        // Properly encode filename for Content-Disposition header
        // Use both filename and filename* for maximum browser compatibility
        const contentDisposition = `attachment; ${encodeFilename(filename)}`;

        console.log(`[Attachment] Serving attachment: ${filename} (${buffer.length} bytes, type: ${mimeType})`);

        // Return as downloadable file with proper headers
        return new NextResponse(buffer, {
            status: 200,
            headers: {
                'Content-Type': mimeType,
                'Content-Disposition': contentDisposition,
                'Content-Length': String(buffer.length),
                'Cache-Control': 'private, max-age=3600',
                'Accept-Ranges': 'bytes',
                'X-Content-Type-Options': 'nosniff',
            },
        });

    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error('[Attachment] Error downloading:', errorMessage);
        return new NextResponse(`Error fetching attachment: ${errorMessage}`, { status: 500 });
    }
}
