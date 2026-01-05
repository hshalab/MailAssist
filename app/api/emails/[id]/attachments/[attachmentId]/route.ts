/**
 * GET /api/emails/[id]/attachments/[attachmentId] - Download an email attachment
 */

import { NextRequest, NextResponse } from 'next/server';
import { getValidTokens } from '@/lib/token-refresh';
import { getGmailClient } from '@/lib/gmail';

export const dynamic = 'force-dynamic';

export async function GET(
    request: NextRequest,
    context: { params: Promise<{ id: string; attachmentId: string }> }
) {
    try {
        const { id: messageId, attachmentId } = await context.params;

        if (!messageId || !attachmentId) {
            return new NextResponse('Missing required parameters', { status: 400 });
        }

        const tokens = await getValidTokens();
        if (!tokens || !tokens.access_token) {
            return new NextResponse('Not authenticated', { status: 401 });
        }

        const gmail = getGmailClient(tokens);

        // Fetch the attachment data from Gmail
        const response = await gmail.users.messages.attachments.get({
            userId: 'me',
            messageId: messageId,
            id: attachmentId,
        });

        const attachmentData = response.data.data;
        if (!attachmentData) {
            return new NextResponse('Attachment not found', { status: 404 });
        }

        // Decode base64url encoded data
        const base64 = attachmentData.replace(/-/g, '+').replace(/_/g, '/');
        const buffer = Buffer.from(base64, 'base64');

        // Get filename from query param if provided
        const filename = request.nextUrl.searchParams.get('filename') || 'attachment';
        const mimeType = request.nextUrl.searchParams.get('mimeType') || 'application/octet-stream';

        // Return as downloadable file
        return new NextResponse(buffer, {
            status: 200,
            headers: {
                'Content-Type': mimeType,
                'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
                'Content-Length': String(buffer.length),
                'Cache-Control': 'private, max-age=3600',
            },
        });

    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error('[Attachment] Error downloading:', errorMessage);
        return new NextResponse(`Error fetching attachment: ${errorMessage}`, { status: 500 });
    }
}
