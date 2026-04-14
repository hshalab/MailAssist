import { NextRequest, NextResponse } from 'next/server';
import { runAutoClassify } from '@/lib/auto-classify';
import { getCurrentUserIdFromRequest, requirePermission } from '@/lib/permissions';
import { checkRateLimit, getRequestIdentity } from '@/lib/rate-limit';

const DEFAULT_BATCH_SIZE = 5;
const MAX_BATCH_SIZE = 10;
const MAX_BATCHES = 3; // Hard cap to prevent runaway cost

export async function POST(request: NextRequest) {
    try {
        const userId = getCurrentUserIdFromRequest(request);
        if (!userId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const permission = await requirePermission(request, ['admin', 'manager']);
        if (!permission.allowed) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const requestIp = getRequestIdentity(request.headers, userId);
        const limiter = checkRateLimit(`backfill:${userId}:${requestIp}`, 4, 10 * 60 * 1000);
        if (!limiter.allowed) {
            return NextResponse.json(
                { error: 'Rate limit exceeded. Please wait before running backfill again.' },
                { status: 429 }
            );
        }

        console.log('[Backfill] Auto-classify endpoint called');
        const body = await request.json().catch(() => ({}));

        const days = body.days || 30;
        const batchSize = Math.min(
            Math.max(parseInt(String(body.limit || DEFAULT_BATCH_SIZE), 10) || DEFAULT_BATCH_SIZE, 1),
            MAX_BATCH_SIZE
        );
        let totalProcessed = 0;
        let totalSuccess = 0;
        let totalFailed = 0;
        let batchCount = 0;

        // Loop until no more tickets to process (or hit safety limit)
        while (batchCount < MAX_BATCHES) {
            batchCount++;
            console.log(`[Backfill] Running batch ${batchCount} with days=${days}, limit=${batchSize}`);

            const result = await runAutoClassify({
                days: days,
                limit: batchSize,
            });

            totalProcessed += result.processed;
            totalSuccess += result.success;
            totalFailed += result.failed;

            console.log(`[Backfill] Batch ${batchCount} complete: processed=${result.processed}`);

            // If we processed fewer than the batch size, we're done
            if (result.processed < batchSize) {
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
