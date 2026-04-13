import { syncStores } from './syncStore';
import type { TradeSessionRecord } from '../../types/session';
import type { JournalPageRecord } from '../../types/journal';
import type { Settings } from '../../types/trade';
import type { TradeTagOptionsRecord, TradeTagOverrideRecord } from '../../types/tradeTags';
import type { TradeReviewRecord } from '../../types/review';
import type { HistoricalBarSet } from '../../types/chart';
import type { JournalChecklistTemplates } from '../../lib/journal/journalTemplateStore';

/**
 * Syncs all user data from Supabase to localStorage after login
 */
export const syncUserDataOnLogin = async (userId: string): Promise<void> => {
  try {
    console.log('Syncing user data from Supabase...');

    // Sync all data types in parallel
    await Promise.all([
      syncStores.tradeSessions.syncFromSupabase<TradeSessionRecord[]>(userId, []),
      syncStores.journalPages.syncFromSupabase<JournalPageRecord[]>(userId, []),
      syncStores.settings.syncFromSupabase<Settings>(userId, {} as Settings),
      syncStores.tradeTagOptions.syncFromSupabase<TradeTagOptionsRecord>(userId, {}),
      syncStores.tradeTagOverrides.syncFromSupabase<TradeTagOverrideRecord[]>(userId, []),
      syncStores.tradeReviews.syncFromSupabase<TradeReviewRecord[]>(userId, []),
      syncStores.historicalBars.syncFromSupabase<HistoricalBarSet[]>(userId, []),
      syncStores.journalChecklistTemplates.syncFromSupabase<JournalChecklistTemplates>(userId, {}),
      syncStores.workspaceState.syncFromSupabase(userId, {}),
    ]);

    console.log('User data synced successfully');
  } catch (err) {
    console.error('Failed to sync user data:', err);
    // Don't throw - localStorage data is still available as fallback
  }
};

/**
 * Sets the userId for sync stores (needed for future saves)
 */
export const setUserIdForSync = (userId: string): void => {
  Object.values(syncStores).forEach((store) => {
    store.config.userId = userId;
  });
};
