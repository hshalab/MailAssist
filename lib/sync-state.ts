/**
 * Sync State Management
 * Tracks the last Gmail historyId per account for incremental syncing
 */

import { supabase } from './supabase';

export interface SyncState {
    id?: string;
    user_email: string;
    last_history_id: string | null;
    last_sync_at: string;
    created_at?: string;
}

/**
 * Get the last sync state for an account
 */
export async function getSyncState(userEmail: string): Promise<SyncState | null> {
    if (!supabase) {
        console.warn('[SyncState] Supabase not available');
        return null;
    }

    const { data, error } = await supabase
        .from('sync_state')
        .select('*')
        .eq('user_email', userEmail)
        .maybeSingle();

    if (error) {
        console.error('[SyncState] Error fetching sync state:', error);
        return null;
    }

    return data;
}

/**
 * Update or create sync state for an account
 */
export async function updateSyncState(
    userEmail: string,
    historyId: string
): Promise<void> {
    if (!supabase) {
        console.warn('[SyncState] Supabase not available');
        return;
    }

    const { error } = await supabase
        .from('sync_state')
        .upsert(
            {
                user_email: userEmail,
                last_history_id: historyId,
                last_sync_at: new Date().toISOString(),
            },
            { onConflict: 'user_email' }
        );

    if (error) {
        console.error('[SyncState] Error updating sync state:', error);
    }
}

/**
 * Delete sync state for an account (useful when reconnecting)
 */
export async function deleteSyncState(userEmail: string): Promise<void> {
    if (!supabase) return;

    const { error } = await supabase
        .from('sync_state')
        .delete()
        .eq('user_email', userEmail);

    if (error) {
        console.error('[SyncState] Error deleting sync state:', error);
    }
}
