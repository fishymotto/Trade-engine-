import { SYNC_HYDRATED_EVENT, syncStores, type SyncHydrationResult } from './syncStore';
import type { TradeSessionRecord } from '../../types/session';
import type { JournalPageRecord } from '../../types/journal';
import type { TradeTagOptionsRecord, TradeTagOverrideRecord } from '../../types/tradeTags';
import type { TradeReviewRecord } from '../../types/review';
import type { HistoricalBarSet } from '../../types/chart';
import type { PlaybookRecord } from '../../types/playbook';
import type { LibraryPageRecord } from '../../types/library';
import type { HeadlineItem } from '../../types/headline';
import type { ReviewTemplates } from '../../types/libraryReview';
import { defaultJournalChecklistTemplates, type JournalChecklistTemplates } from '../../lib/journal/journalTemplateStore';
import { defaultReviewTemplates } from '../review/reviewTemplateStore';
import { defaultSyncedSettings, migrateSettingsCacheToSyncedShape, type SyncedSettings } from '../settings/settingsStore';
import { defaultWorkspaceState, type WorkspaceState } from '../workspace/workspaceStore';

const FORCE_LOCAL_TO_CLOUD_KEY = 'trade-engine-force-cloud-seed';

export interface UserDataSyncSummary {
  userId: string;
  forcePushLocal: boolean;
  results: SyncHydrationResult[];
}

const dispatchHydrationEvent = (summary: UserDataSyncSummary): void => {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(new CustomEvent(SYNC_HYDRATED_EVENT, { detail: summary }));
};

/**
 * Syncs all user data from Supabase to localStorage after login
 */
export const syncUserDataOnLogin = async (userId: string): Promise<UserDataSyncSummary> => {
  setUserIdForSync(userId);
  migrateSettingsCacheToSyncedShape();
  const forcePushLocal =
    typeof window !== 'undefined' && window.localStorage.getItem(FORCE_LOCAL_TO_CLOUD_KEY) === '1';
  const emptySummary: UserDataSyncSummary = {
    userId,
    forcePushLocal,
    results: [],
  };

  try {
    console.log('[sync] Hydrating user data from Supabase...');
    const syncOptions = { forcePushLocal };

    // Sync all data types in parallel
    const hydrated = await Promise.all([
      syncStores.tradeSessions.hydrateFromSupabase<TradeSessionRecord[]>(userId, [], syncOptions),
      syncStores.journalPages.hydrateFromSupabase<JournalPageRecord[]>(userId, [], syncOptions),
      syncStores.settings.hydrateFromSupabase<SyncedSettings>(userId, defaultSyncedSettings, syncOptions),
      syncStores.tradeTagOptions.hydrateFromSupabase<TradeTagOptionsRecord>(userId, {}, syncOptions),
      syncStores.tradeTagOverrides.hydrateFromSupabase<TradeTagOverrideRecord[]>(userId, [], syncOptions),
      syncStores.tradeReviews.hydrateFromSupabase<TradeReviewRecord[]>(userId, [], syncOptions),
      syncStores.historicalBars.hydrateFromSupabase<HistoricalBarSet[]>(userId, [], syncOptions),
      syncStores.journalChecklistTemplates.hydrateFromSupabase<JournalChecklistTemplates>(
        userId,
        defaultJournalChecklistTemplates(),
        syncOptions
      ),
      syncStores.workspaceState.hydrateFromSupabase<WorkspaceState>(userId, defaultWorkspaceState, syncOptions),
      syncStores.tradeTagCatalog.hydrateFromSupabase(userId, {}, syncOptions),
      syncStores.playbooks.hydrateFromSupabase<PlaybookRecord[]>(userId, [], syncOptions),
      syncStores.libraryPages.hydrateFromSupabase<LibraryPageRecord[]>(userId, [], syncOptions),
      syncStores.headlines.hydrateFromSupabase<Record<string, HeadlineItem[]>>(userId, {}, syncOptions),
      syncStores.selectOptionAdditions.hydrateFromSupabase<Record<string, string[]>>(userId, {}, syncOptions),
      syncStores.reviewTemplates.hydrateFromSupabase<ReviewTemplates>(userId, defaultReviewTemplates(), syncOptions),
    ]);
    const summary: UserDataSyncSummary = {
      userId,
      forcePushLocal,
      results: hydrated.map((entry) => entry.result),
    };

    if (forcePushLocal && typeof window !== 'undefined') {
      window.localStorage.removeItem(FORCE_LOCAL_TO_CLOUD_KEY);
    }

    console.log('[sync] User data hydrated successfully', summary.results);
    dispatchHydrationEvent(summary);
    return summary;
  } catch (err) {
    console.error('[sync] Failed to hydrate user data:', err);
    // Don't throw - localStorage data is still available as fallback
    dispatchHydrationEvent(emptySummary);
    return emptySummary;
  }
};

export const forcePushLocalDataToCloud = async (userId: string): Promise<void> => {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(FORCE_LOCAL_TO_CLOUD_KEY, '1');
  }

  await syncUserDataOnLogin(userId);
};

export const retryDirtyUserData = async (userId: string): Promise<void> => {
  setUserIdForSync(userId);
  await Promise.all([
    syncStores.tradeSessions.retryDirty<TradeSessionRecord[]>([], userId),
    syncStores.journalPages.retryDirty<JournalPageRecord[]>([], userId),
    syncStores.settings.retryDirty<SyncedSettings>(defaultSyncedSettings, userId),
    syncStores.tradeTagOptions.retryDirty<TradeTagOptionsRecord>({}, userId),
    syncStores.tradeTagOverrides.retryDirty<TradeTagOverrideRecord[]>([], userId),
    syncStores.tradeReviews.retryDirty<TradeReviewRecord[]>([], userId),
    syncStores.historicalBars.retryDirty<HistoricalBarSet[]>([], userId),
    syncStores.journalChecklistTemplates.retryDirty<JournalChecklistTemplates>(defaultJournalChecklistTemplates(), userId),
    syncStores.workspaceState.retryDirty<WorkspaceState>(defaultWorkspaceState, userId),
    syncStores.tradeTagCatalog.retryDirty({}, userId),
    syncStores.playbooks.retryDirty<PlaybookRecord[]>([], userId),
    syncStores.libraryPages.retryDirty<LibraryPageRecord[]>([], userId),
    syncStores.headlines.retryDirty<Record<string, HeadlineItem[]>>({}, userId),
    syncStores.selectOptionAdditions.retryDirty<Record<string, string[]>>({}, userId),
    syncStores.reviewTemplates.retryDirty<ReviewTemplates>(defaultReviewTemplates(), userId),
  ]);
};

/**
 * Sets the userId for sync stores (needed for future saves)
 */
export const setUserIdForSync = (userId?: string): void => {
  Object.values(syncStores).forEach((store) => {
    store.setUserId(userId);
  });
};

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    void (async () => {
      const {
        data: { session },
      } = await import('../auth').then(({ supabase }) => supabase.auth.getSession());
      if (session?.user.id) {
        await retryDirtyUserData(session.user.id);
      }
    })();
  });
}
