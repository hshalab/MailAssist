/**
 * Manual endpoint to activate Gmail Watch for push notifications
 * This is used after Pub/Sub setup to start receiving real-time notifications
 */

import { NextRequest, NextResponse } from 'next/server';
import { getValidTokens } from '@/lib/token-refresh';
import { startHistoryWatch } from '@/lib/gmail';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
    try {
        const tokens = await getValidTokens();

        if (!tokens || !tokens.access_token) {
            return NextResponse.json(
                { error: 'Not authenticated. Please connect Gmail first.' },
                { status: 401 }
            );
        }

        // Check if GMAIL_HISTORY_TOPIC is configured
        if (!process.env.GMAIL_HISTORY_TOPIC) {
            return NextResponse.json(
                {
                    error: 'GMAIL_HISTORY_TOPIC not configured',
                    message: 'Add GMAIL_HISTORY_TOPIC environment variable with your Pub/Sub topic name'
                },
                { status: 400 }
            );
        }

        const watchInfo = await startHistoryWatch(tokens);

        return NextResponse.json({
            success: true,
            message: 'Gmail watch activated! You will now receive real-time notifications.',
            watchInfo,
        });
    } catch (error) {
        console.error('Error activating Gmail watch:', error);
        return NextResponse.json(
            {
                error: 'Failed to activate Gmail watch',
                details: error instanceof Error ? error.message : String(error),
            },
            { status: 500 }
        );
    }
}

export async function GET() {
    // Check status
    const hasTopicConfigured = !!process.env.GMAIL_HISTORY_TOPIC;

    return NextResponse.json({
        status: hasTopicConfigured ? 'ready' : 'not_configured',
        message: hasTopicConfigured
            ? 'Pub/Sub topic is configured. POST to this endpoint to activate watch.'
            : 'Set GMAIL_HISTORY_TOPIC environment variable first.',
        topic: hasTopicConfigured ? process.env.GMAIL_HISTORY_TOPIC : null,
    });
}
