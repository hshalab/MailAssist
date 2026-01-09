import { NextRequest, NextResponse } from 'next/server';
import { runAutoClassify } from '@/lib/auto-classify';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json().catch(() => ({}));
        
        const result = await runAutoClassify({
            days: body.days,
            limit: body.limit,
        });

        return NextResponse.json({
            message: `Processed ${result.processed} tickets.`,
            processed: result.processed,
            success: result.success,
            failed: result.failed,
        });
    } catch (error) {
        console.error('[Backfill] Error:', error);
        
        if ((error as Error).message === 'Unauthorized') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        
        return NextResponse.json(
            { error: 'Internal server error', details: (error as Error).message },
            { status: 500 }
        );
    }
}
