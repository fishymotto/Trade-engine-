import { supabase } from '../auth';

export interface SyncStoreConfig {
  tableName: string;
  storageKey: string;
  userId?: string;
}

const stableStringify = (value: unknown): string => {
  if (value === null || value === undefined) {
    return JSON.stringify(value);
  }

  if (typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
};

const isProbablyDefaultValue = <T>(value: T, defaultValue: T): boolean => {
  try {
    return stableStringify(value) === stableStringify(defaultValue);
  } catch {
    return false;
  }
};

/**
 * Hybrid sync utility: reads from localStorage (cache), writes to both localStorage and Supabase
 * This provides offline-first experience with cloud sync
 */
export class HybridSyncStore {
  private config: SyncStoreConfig;

  constructor(config: SyncStoreConfig) {
    this.config = config;
  }

  setUserId(userId?: string): void {
    this.config.userId = userId;
  }

  /**
   * Load data from localStorage (cache)
   * Fast, works offline
   */
  load<T>(defaultValue: T): T {
    try {
      const raw = localStorage.getItem(this.config.storageKey);
      if (!raw) return defaultValue;
      return JSON.parse(raw) as T;
    } catch (err) {
      console.warn(`Failed to load ${this.config.storageKey}:`, err);
      return defaultValue;
    }
  }

  /**
   * Save data to both localStorage and Supabase
   * Prioritizes localStorage success; Supabase save is async (fire and forget if needed)
   */
  async save<T>(data: T, userId?: string): Promise<void> {
    const user = userId || this.config.userId;
    if (!user) {
      // If no user, just save to localStorage
      localStorage.setItem(this.config.storageKey, JSON.stringify(data));
      return;
    }

    try {
      // Always save to localStorage first (sync)
      localStorage.setItem(this.config.storageKey, JSON.stringify(data));

      // Then sync to Supabase (async, non-blocking)
      await this.syncToSupabase(data, user);
    } catch (err) {
      console.error(`Failed to save ${this.config.storageKey}:`, err);
      throw err;
    }
  }

  /**
   * Sync data from Supabase to localStorage
   * Used after login to pull cloud data
   */
  async syncFromSupabase<T>(userId: string, defaultValue: T): Promise<T> {
    if (!userId) {
      return this.load(defaultValue);
    }

    try {
      const { data, error } = await supabase
        .from(this.config.tableName)
        .select('data')
        .eq('user_id', userId)
        .maybeSingle();

      if (error) {
        console.warn(`Failed to sync from Supabase (${this.config.tableName}):`, error);
        return this.load(defaultValue);
      }

      if (!data) {
        const localValue = this.load(defaultValue);
        if (!isProbablyDefaultValue(localValue, defaultValue)) {
          // Seed cloud on first login for accounts that have only local data.
          // This avoids a "blank on new device" experience when users had data before signing in.
          try {
            await this.syncToSupabase(localValue, userId);
          } catch (seedError) {
            console.warn(`Failed to seed Supabase (${this.config.tableName}):`, seedError);
          }
        }

        return localValue;
      }

      // Parse and cache the data locally
      const parsed = JSON.parse(data.data) as T;
      localStorage.setItem(this.config.storageKey, JSON.stringify(parsed));
      return parsed;
    } catch (err) {
      console.warn(`Failed to parse Supabase data (${this.config.tableName}):`, err);
      return this.load(defaultValue);
    }
  }

  /**
   * Internal: sync data to Supabase
   */
  private async syncToSupabase<T>(data: T, userId: string): Promise<void> {
    const dataJson = JSON.stringify(data);
    const now = new Date().toISOString();

    const { error } = await supabase
      .from(this.config.tableName)
      .upsert(
        {
          user_id: userId,
          data: dataJson,
          updated_at: now,
        },
        { onConflict: 'user_id' }
      );

    if (error) {
      console.warn(`Failed to sync to Supabase (${this.config.tableName}):`, error);
      // Don't throw - we still have localStorage backup
    }
  }

  /**
   * Clear data from both localStorage and Supabase (for logout)
   */
  async clear(userId?: string): Promise<void> {
    localStorage.removeItem(this.config.storageKey);

    const user = userId || this.config.userId;
    if (user) {
      const { error } = await supabase
        .from(this.config.tableName)
        .delete()
        .eq('user_id', user);

      if (error) {
        console.warn(`Failed to clear Supabase (${this.config.tableName}):`, error);
      }
    }
  }
}

// Pre-configured sync stores for each data type
export const syncStores = {
  tradeSessions: new HybridSyncStore({
    tableName: 'user_trade_sessions',
    storageKey: 'trade-engine-trade-sessions',
  }),
  journalPages: new HybridSyncStore({
    tableName: 'user_journal_pages',
    storageKey: 'trade-engine-journal-pages',
  }),
  settings: new HybridSyncStore({
    tableName: 'user_settings',
    storageKey: 'trade-engine-settings',
  }),
  tradeTagOptions: new HybridSyncStore({
    tableName: 'user_trade_tag_options',
    storageKey: 'trade-engine-trade-tag-options',
  }),
  tradeTagOverrides: new HybridSyncStore({
    tableName: 'user_trade_tag_overrides',
    storageKey: 'trade-engine-trade-tag-overrides',
  }),
  tradeReviews: new HybridSyncStore({
    tableName: 'user_trade_reviews',
    storageKey: 'trade-engine-trade-reviews',
  }),
  historicalBars: new HybridSyncStore({
    tableName: 'user_historical_bars',
    storageKey: 'trade-engine-historical-bars',
  }),
  journalChecklistTemplates: new HybridSyncStore({
    tableName: 'user_journal_checklist_templates',
    storageKey: 'trade-engine-journal-checklist-templates',
  }),
  workspaceState: new HybridSyncStore({
    tableName: 'user_workspace_state',
    storageKey: 'trade-engine-workspace',
  }),
  tradeTagCatalog: new HybridSyncStore({
    tableName: 'user_trade_tag_catalog',
    storageKey: 'trade-engine-trade-tag-catalog',
  }),
  playbooks: new HybridSyncStore({
    tableName: 'user_playbooks',
    storageKey: 'trade-engine-playbooks',
  }),
  libraryPages: new HybridSyncStore({
    tableName: 'user_library_pages',
    storageKey: 'trade-engine-library-pages',
  }),
  headlines: new HybridSyncStore({
    tableName: 'user_headlines',
    storageKey: 'trade-engine-headlines',
  }),
  selectOptionAdditions: new HybridSyncStore({
    tableName: 'user_select_option_additions',
    storageKey: 'trade-engine-select-option-additions',
  }),
  reviewTemplates: new HybridSyncStore({
    tableName: 'user_review_templates',
    storageKey: 'trade-engine-review-templates',
  }),
};
