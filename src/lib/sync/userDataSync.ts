import { syncStores } from './syncStore';
import type { TradeSessionRecord } from '../../types/session';
import type { JournalPageRecord } from '../../types/journal';
import type { Settings } from '../../types/trade';
import type { TradeTagOptionsRecord, TradeTagOverrideRecord } from '../../types/tradeTags';
import type { TradeReviewRecord } from '../../types/review';
import type { HistoricalBarSet } from '../../types/chart';
import type { PlaybookRecord } from '../../types/playbook';
import type { LibraryPageRecord } from '../../types/library';
import type { HeadlineItem } from '../../types/headline';
import type { ReviewTemplates } from '../../types/libraryReview';
import { defaultJournalChecklistTemplates, type JournalChecklistTemplates } from '../../lib/journal/journalTemplateStore';
import { defaultReviewTemplates } from '../review/reviewTemplateStore';
import { defaultSettings } from '../settings/settingsStore';
import { defaultWorkspaceState, type WorkspaceState } from '../workspace/workspaceStore';

const FORCE_LOCAL_TO_CLOUD_KEY = 'trade-engine-force-cloud-seed';

/**
 * Syncs all user data from Supabase to localStorage after login
 */
export const syncUserDataOnLogin = async (userId: string): Promise<void> => {
  try {
    console.log('Syncing user data from Supabase...');
    const forcePushLocal =
      typeof window !== 'undefined' && window.localStorage.getItem(FORCE_LOCAL_TO_CLOUD_KEY) === '1';
    const syncOptions = { forcePushLocal };

    // Sync all data types in parallel
    await Promise.all([
      syncStores.tradeSessions.syncFromSupabase<TradeSessionRecord[]>(userId, [], syncOptions),
      syncStores.journalPages.syncFromSupabase<JournalPageRecord[]>(userId, [], syncOptions),
      syncStores.settings.syncFromSupabase<Settings>(userId, defaultSettings, syncOptions),
      syncStores.tradeTagOptions.syncFromSupabase<TradeTagOptionsRecord>(userId, {}, syncOptions),
      syncStores.tradeTagOverrides.syncFromSupabase<TradeTagOverrideRecord[]>(userId, [], syncOptions),
      syncStores.tradeReviews.syncFromSupabase<TradeReviewRecord[]>(userId, [], syncOptions),
      syncStores.historicalBars.syncFromSupabase<HistoricalBarSet[]>(userId, [], syncOptions),
      syncStores.journalChecklistTemplates.syncFromSupabase<JournalChecklistTemplates>(
        userId,
        defaultJournalChecklistTemplates(),
        syncOptions
      ),
      syncStores.workspaceState.syncFromSupabase<WorkspaceState>(userId, defaultWorkspaceState, syncOptions),
      syncStores.tradeTagCatalog.syncFromSupabase(userId, {}, syncOptions),
      syncStores.playbooks.syncFromSupabase<PlaybookRecord[]>(userId, [], syncOptions),
      syncStores.libraryPages.syncFromSupabase<LibraryPageRecord[]>(userId, [], syncOptions),
      syncStores.headlines.syncFromSupabase<Record<string, HeadlineItem[]>>(userId, {}, syncOptions),
      syncStores.selectOptionAdditions.syncFromSupabase<Record<string, string[]>>(userId, {}, syncOptions),
      syncStores.reviewTemplates.syncFromSupabase<ReviewTemplates>(userId, defaultReviewTemplates(), syncOptions),
    ]);

    if (forcePushLocal && typeof window !== 'undefined') {
      window.localStorage.removeItem(FORCE_LOCAL_TO_CLOUD_KEY);
    }

    console.log('User data synced successfully');
  } catch (err) {
    console.error('Failed to sync user data:', err);
    // Don't throw - localStorage data is still available as fallback
  }
};

export const forcePushLocalDataToCloud = async (userId: string): Promise<void> => {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(FORCE_LOCAL_TO_CLOUD_KEY, '1');
  }

  await syncUserDataOnLogin(userId);
};

/**
 * Sets the userId for sync stores (needed for future saves)
 */
export const setUserIdForSync = (userId: string): void => {
  Object.values(syncStores).forEach((store) => {
    store.setUserId(userId);
  });
};
