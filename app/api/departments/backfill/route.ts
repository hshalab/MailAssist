import { NextRequest, NextResponse } from 'next/server';
import { runAutoClassify } from '@/lib/auto-classify';

const BATCH_SIZE = 20;
const MAX_BATCHES = 50; // Safety limit to prevent infinite loops

export async function POST(request: NextRequest) {
    try {
        console.log('[Backfill] Auto-classify endpoint called');
        const body = await request.json().catch(() => ({}));

        const days = body.days || 30;
        let totalProcessed = 0;
        let totalSuccess = 0;
        let totalFailed = 0;
        let batchCount = 0;

        // Loop until no more tickets to process (or hit safety limit)
        while (batchCount < MAX_BATCHES) {
            batchCount++;
            console.log(`[Backfill] Running batch ${batchCount} with days=${days}, limit=${BATCH_SIZE}`);

            const result = await runAutoClassify({
                days: days,
                limit: BATCH_SIZE,
            });

            totalProcessed += result.processed;
            totalSuccess += result.success;
            totalFailed += result.failed;

            console.log(`[Backfill] Batch ${batchCount} complete: processed=${result.processed}`);

            // If we processed fewer than the batch size, we're done
            if (result.processed < BATCH_SIZE) {
                console.log('[Backfill] All unclassified tickets processed');
                break;
            }

            // Small delay between batches to avoid overwhelming the system
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        console.log(`[Backfill] Auto-classify completed: ${totalProcessed} total tickets in ${batchCount} batches`);

        return NextResponse.json({
            message: `Processed ${totalProcessed} tickets in ${batchCount} batch(es).`,
            processed: totalProcessed,
            success: totalSuccess,
            failed: totalFailed,
            batches: batchCount,
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
