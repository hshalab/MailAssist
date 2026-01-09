import { NextRequest, NextResponse } from 'next/server';
import { runAutoClassify } from '@/lib/auto-classify';

export async function POST(request: NextRequest) {
    try {
        console.log('[Backfill] Auto-classify endpoint called');
        const body = await request.json().catch(() => ({}));
        
        console.log('[Backfill] Running auto-classify with options:', { days: body.days, limit: body.limit });
        const result = await runAutoClassify({
            days: body.days,
            limit: body.limit,
        });

        console.log('[Backfill] Auto-classify completed:', result);

        return NextResponse.json({
            message: `Processed ${result.processed} tickets.`,
            processed: result.processed,
            success: result.success,
            failed: result.failed,
        });
    } catch (error) {
        console.error('[Backfill] Error:', error);
        console.error('[Backfill] Error stack:', error instanceof Error ? error.stack : 'No stack trace');
        
        if ((error as Error).message === 'Unauthorized') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        
        return NextResponse.json(
            { error: 'Internal server error', details: (error as Error).message },
            { status: 500 }
        );
    }
}
