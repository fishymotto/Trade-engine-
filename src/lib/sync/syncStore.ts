import { supabase } from '../auth';

export interface SyncStoreConfig {
  tableName: string;
  storageKey: string;
  userId?: string;
}

export interface SyncFromSupabaseOptions {
  forcePushLocal?: boolean;
  preferCloud?: boolean;
}

interface SyncMetadata {
  dirty: boolean;
  localUpdatedAt?: string;
  lastSyncedAt?: string;
  lastSyncedUserId?: string;
  lastSyncedHash?: string;
  lastError?: string;
}

export interface SyncHydrationResult {
  tableName: string;
  storageKey: string;
  source: 'local' | 'cloud' | 'merged' | 'seeded-cloud' | 'forced-local' | 'error';
  pushed: boolean;
  dirty: boolean;
  error?: string;
}

export const SYNC_HYDRATED_EVENT = 'trade-engine-sync-hydrated';
const MACHINE_OWNER_USER_ID_KEY = 'trade-engine-machine-owner-user-id';

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

const hashValue = (value: unknown): string => stableStringify(value);

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  try {
    const serialized = JSON.stringify(error);
    return typeof serialized === 'string' ? serialized : String(error);
  } catch {
    return String(error);
  }
};

const isStorageQuotaExceededError = (error: unknown): boolean => {
  if (typeof DOMException !== 'undefined' && error instanceof DOMException) {
    return error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED';
  }

  const message = getErrorMessage(error).toLowerCase();
  return message.includes('quota') && (message.includes('exceeded') || message.includes('full'));
};

const hasLocalStorage = (): boolean => typeof window !== 'undefined' && Boolean(window.localStorage);

const getMachineOwnerUserIdUnsafe = (): string | null => {
  if (!hasLocalStorage()) {
    return null;
  }

  try {
    const raw = localStorage.getItem(MACHINE_OWNER_USER_ID_KEY);
    if (!raw || !raw.trim()) {
      return null;
    }

    return raw;
  } catch {
    return null;
  }
};

const setMachineOwnerUserIdUnsafe = (userId: string): void => {
  if (!hasLocalStorage() || !userId.trim()) {
    return;
  }

  try {
    localStorage.setItem(MACHINE_OWNER_USER_ID_KEY, userId);
  } catch (err) {
    console.warn('[sync] Failed to persist machine owner user id.', err);
  }
};

export const getMachineOwnerUserId = (): string | null => getMachineOwnerUserIdUnsafe();

export const canUseMachineLegacyData = (userId?: string): boolean => {
  if (!userId) {
    return true;
  }

  const ownerId = getMachineOwnerUserIdUnsafe();
  if (!ownerId) {
    setMachineOwnerUserIdUnsafe(userId);
    return true;
  }

  return ownerId === userId;
};

const isProbablyDefaultValue = <T>(value: T, defaultValue: T): boolean => {
  try {
    return stableStringify(value) === stableStringify(defaultValue);
  } catch {
    return false;
  }
};

const parseTimestamp = (value: unknown): number | null => {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const extractMaxTimestamp = (value: unknown): number | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  if (Array.isArray(value)) {
    let max: number | null = null;
    for (const entry of value) {
      const candidate = extractMaxTimestamp(entry);
      if (candidate !== null && (max === null || candidate > max)) {
        max = candidate;
      }
    }
    return max;
  }

  const record = value as Record<string, unknown>;
  const candidates = [
    record.updatedAt,
    record.updated_at,
    record.importedAt,
    record.createdAt,
    record.created_at
  ]
    .map(parseTimestamp)
    .filter((candidate): candidate is number => candidate !== null);

  if (candidates.length > 0) {
    return Math.max(...candidates);
  }

  return null;
};

const getMergeKey = (value: unknown): string | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const key = record.id ?? record.tradeDate ?? record.key;
  return typeof key === 'string' && key.trim() ? key : null;
};

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const mergeSyncedValues = <T>(localValue: T, cloudValue: T): T => {
  if (isPlainRecord(localValue) && isPlainRecord(cloudValue)) {
    const merged: Record<string, unknown> = { ...cloudValue };

    for (const [key, localEntry] of Object.entries(localValue)) {
      const cloudEntry = cloudValue[key];

      if (cloudEntry === undefined) {
        merged[key] = localEntry;
        continue;
      }

      if (
        (Array.isArray(localEntry) && Array.isArray(cloudEntry)) ||
        (isPlainRecord(localEntry) && isPlainRecord(cloudEntry))
      ) {
        merged[key] = mergeSyncedValues(localEntry, cloudEntry);
        continue;
      }

      merged[key] = localEntry;
    }

    return merged as T;
  }

  if (!Array.isArray(localValue) || !Array.isArray(cloudValue)) {
    return localValue;
  }

  const merged: unknown[] = [];
  const indexByKey = new Map<string, number>();

  const addItem = (item: unknown, preferOnTie: boolean): boolean => {
    const key = getMergeKey(item);
    if (!key) {
      return false;
    }

    const existingIndex = indexByKey.get(key);
    if (existingIndex === undefined) {
      indexByKey.set(key, merged.length);
      merged.push(item);
      return true;
    }

    const existing = merged[existingIndex];
    const existingTs = extractMaxTimestamp(existing);
    const candidateTs = extractMaxTimestamp(item);
    const shouldReplace =
      candidateTs !== null && existingTs !== null
        ? candidateTs > existingTs || (candidateTs === existingTs && preferOnTie)
        : candidateTs !== null
          ? true
          : existingTs === null && preferOnTie;

    if (shouldReplace) {
      merged[existingIndex] = item;
    }

    return true;
  };

  for (const item of localValue) {
    if (!addItem(item, false)) {
      return cloudValue;
    }
  }

  for (const item of cloudValue) {
    if (!addItem(item, true)) {
      return cloudValue;
    }
  }

  return merged as T;
};

const shouldPreferLocalOverCloud = <T>(
  localValue: T,
  cloudValue: T,
  defaultValue: T,
  cloudUpdatedAt?: string | null
): boolean => {
  if (isProbablyDefaultValue(localValue, cloudValue)) {
    return false;
  }

  const localIsDefault = isProbablyDefaultValue(localValue, defaultValue);
  const cloudIsDefault = isProbablyDefaultValue(cloudValue, defaultValue);

  if (!localIsDefault && cloudIsDefault) return true;
  if (localIsDefault && !cloudIsDefault) return false;

  const localTs = extractMaxTimestamp(localValue);
  const cloudTs = extractMaxTimestamp(cloudValue) ?? parseTimestamp(cloudUpdatedAt ?? undefined);

  if (localTs !== null && cloudTs !== null) {
    return localTs > cloudTs + 30_000;
  }

  if (localTs !== null && cloudTs === null) {
    return true;
  }

  if (localTs === null && cloudTs !== null) {
    return false;
  }

  if (Array.isArray(localValue) && Array.isArray(cloudValue) && localValue.length !== cloudValue.length) {
    return localValue.length > cloudValue.length;
  }

  return false;
};

/**
 * Hybrid sync utility: reads from localStorage (cache), writes to both localStorage and Supabase
 * This provides offline-first experience with cloud sync
 */
export class HybridSyncStore {
  private config: SyncStoreConfig;
  private writeQueue: Promise<void> = Promise.resolve();
  private memoryValue: unknown = undefined;
  private hasMemoryValue = false;

  constructor(config: SyncStoreConfig) {
    this.config = config;
  }

  private setMemoryValue<T>(value: T): void {
    this.memoryValue = value;
    this.hasMemoryValue = true;
  }

  private clearMemoryValue(): void {
    this.memoryValue = undefined;
    this.hasMemoryValue = false;
  }

  setUserId(userId?: string): void {
    if (this.config.userId !== userId) {
      this.clearMemoryValue();
    }
    this.config.userId = userId;
  }

  getUserId(): string | undefined {
    return this.config.userId;
  }

  /**
   * Load data from localStorage (cache)
   * Fast, works offline
   */
  load<T>(defaultValue: T): T {
    if (this.hasMemoryValue) {
      return this.memoryValue as T;
    }

    if (!hasLocalStorage()) {
      this.setMemoryValue(defaultValue);
      return defaultValue;
    }

    try {
      const raw = localStorage.getItem(this.config.storageKey);
      if (!raw) {
        this.setMemoryValue(defaultValue);
        return defaultValue;
      }

      const parsed = JSON.parse(raw) as T;
      this.setMemoryValue(parsed);
      return parsed;
    } catch (err) {
      console.warn(`Failed to load ${this.config.storageKey}:`, err);
      this.setMemoryValue(defaultValue);
      return defaultValue;
    }
  }

  private getMetaKey(): string {
    return `${this.config.storageKey}::sync-meta`;
  }

  private loadMetadata(): SyncMetadata {
    if (!hasLocalStorage()) {
      return { dirty: false };
    }

    try {
      const raw = localStorage.getItem(this.getMetaKey());
      if (!raw) {
        return { dirty: false };
      }

      const parsed = JSON.parse(raw) as Partial<SyncMetadata>;
      return {
        dirty: Boolean(parsed.dirty),
        localUpdatedAt: typeof parsed.localUpdatedAt === 'string' ? parsed.localUpdatedAt : undefined,
        lastSyncedAt: typeof parsed.lastSyncedAt === 'string' ? parsed.lastSyncedAt : undefined,
        lastSyncedUserId: typeof parsed.lastSyncedUserId === 'string' ? parsed.lastSyncedUserId : undefined,
        lastSyncedHash: typeof parsed.lastSyncedHash === 'string' ? parsed.lastSyncedHash : undefined,
        lastError: typeof parsed.lastError === 'string' ? parsed.lastError : undefined,
      };
    } catch (err) {
      console.warn(`[sync] Failed to read sync metadata for ${this.config.tableName}:`, err);
      return { dirty: false };
    }
  }

  private saveMetadata(metadata: SyncMetadata): void {
    if (!hasLocalStorage()) {
      return;
    }

    try {
      localStorage.setItem(this.getMetaKey(), JSON.stringify(metadata));
    } catch (err) {
      if (isStorageQuotaExceededError(err)) {
        console.warn(
          `[sync] ${this.config.tableName}: local metadata cache skipped because storage quota is full.`
        );
        return;
      }

      console.warn(`[sync] ${this.config.tableName}: failed to write local metadata cache.`, err);
    }
  }

  private writeLocalCache<T>(data: T, metadata: SyncMetadata): void {
    this.setMemoryValue(data);

    if (!hasLocalStorage()) {
      return;
    }

    try {
      localStorage.setItem(this.config.storageKey, JSON.stringify(data));
    } catch (err) {
      if (isStorageQuotaExceededError(err)) {
        console.warn(
          `[sync] ${this.config.tableName}: local cache skipped because storage quota is full; continuing with cloud sync.`
        );
        return;
      }

      console.warn(`[sync] ${this.config.tableName}: failed to write local cache.`, err);
      return;
    }

    this.saveMetadata(metadata);
  }

  private cacheSyncedValue<T>(data: T, userId: string, syncedAt = new Date().toISOString()): void {
    this.writeLocalCache(data, {
      dirty: false,
      localUpdatedAt: syncedAt,
      lastSyncedAt: syncedAt,
      lastSyncedUserId: userId,
      lastSyncedHash: hashValue(data),
    });
  }

  private markRemoteFailure(error: unknown): void {
    const metadata = this.loadMetadata();
    const message = getErrorMessage(error);
    this.saveMetadata({
      ...metadata,
      dirty: true,
      lastError: message,
    });
  }

  private markRemoteSuccess<T>(data: T, userId: string, syncedAt = new Date().toISOString()): void {
    const metadata = this.loadMetadata();
    this.saveMetadata({
      ...metadata,
      dirty: false,
      lastSyncedAt: syncedAt,
      lastSyncedUserId: userId,
      lastSyncedHash: hashValue(data),
      lastError: undefined,
    });
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    const run = this.writeQueue.then(task, task);
    this.writeQueue = run.catch(() => undefined);
    return run;
  }

  /**
   * Save data to both localStorage and Supabase
   * Prioritizes localStorage success; Supabase save is async (fire and forget if needed)
   */
  async save<T>(data: T, userId?: string): Promise<void> {
    const user = userId || this.config.userId;
    const now = new Date().toISOString();
    const dataHash = hashValue(data);
    const currentMetadata = this.loadMetadata();
    const isAlreadySynced =
      Boolean(user) &&
      currentMetadata.lastSyncedUserId === user &&
      currentMetadata.lastSyncedHash === dataHash &&
      !currentMetadata.dirty;

    // Always save to localStorage first so the UI remains offline-first.
    this.writeLocalCache(data, {
      ...currentMetadata,
      dirty: !isAlreadySynced,
      localUpdatedAt: now,
      lastError: isAlreadySynced ? undefined : currentMetadata.lastError,
    });

    if (!user) {
      console.debug(`[sync] ${this.config.tableName}: saved locally; no user session for remote push`);
      return;
    }

    if (isAlreadySynced) {
      return;
    }

    await this.enqueue(async () => {
      try {
        console.debug(`[sync] ${this.config.tableName}: pushing local changes`);
        await this.syncToSupabase(data, user);
        this.markRemoteSuccess(data, user);
      } catch (err) {
        console.warn(`[sync] ${this.config.tableName}: remote push failed; keeping dirty local cache`, err);
        this.markRemoteFailure(err);
      }
    });
  }

  /**
   * Sync data from Supabase to localStorage
   * Used after login to pull cloud data
   */
  async syncFromSupabase<T>(
    userId: string,
    defaultValue: T,
    options: SyncFromSupabaseOptions = {}
  ): Promise<T> {
    return (await this.hydrateFromSupabase<T>(userId, defaultValue, options)).value;
  }

  async hydrateFromSupabase<T>(
    userId: string,
    defaultValue: T,
    options: SyncFromSupabaseOptions = {}
  ): Promise<{ value: T; result: SyncHydrationResult }> {
    if (!userId) {
      const localValue = this.load(defaultValue);
      return {
        value: localValue,
        result: {
          tableName: this.config.tableName,
          storageKey: this.config.storageKey,
          source: 'local',
          pushed: false,
          dirty: this.loadMetadata().dirty,
        },
      };
    }

    try {
      const localValue = this.load(defaultValue);
      const metadata = this.loadMetadata();
      const localBelongsToCurrentUser =
        metadata.lastSyncedUserId === userId || canUseMachineLegacyData(userId);
      const effectiveLocalValue = localBelongsToCurrentUser ? localValue : defaultValue;
      const localHash = hashValue(effectiveLocalValue);
      const hasLocalValue = !isProbablyDefaultValue(effectiveLocalValue, defaultValue);
      const localIsSyncedCloudCache =
        metadata.lastSyncedUserId === userId && metadata.lastSyncedHash === localHash && !metadata.dirty;
      const hasLegacyLocalValue = hasLocalValue && !metadata.lastSyncedHash;
      const shouldPushLocal =
        options.forcePushLocal || metadata.dirty || (hasLegacyLocalValue && options.preferCloud === false);

      if (!localBelongsToCurrentUser && !isProbablyDefaultValue(localValue, defaultValue)) {
        console.info(
          `[sync] ${this.config.tableName}: ignoring local cache because it belongs to a different user.`
        );
      }

      if (metadata.dirty) {
        console.debug(`[sync] ${this.config.tableName}: dirty local cache found during hydration`);
      }

      const { data, error } = await supabase
        .from(this.config.tableName)
        .select('data, updated_at')
        .eq('user_id', userId)
        .maybeSingle();

      if (error) {
        console.warn(`Failed to sync from Supabase (${this.config.tableName}):`, error);
        return {
          value: effectiveLocalValue,
          result: {
            tableName: this.config.tableName,
            storageKey: this.config.storageKey,
            source: 'error',
            pushed: false,
            dirty: metadata.dirty,
            error: getErrorMessage(error),
          },
        };
      }

      if (!data) {
        if (hasLocalValue) {
          // Seed cloud on first login for accounts that have only local data.
          // This avoids a "blank on new device" experience when users had data before signing in.
          try {
            console.debug(`[sync] ${this.config.tableName}: seeding cloud from local cache`);
            await this.syncToSupabase(effectiveLocalValue, userId);
            this.markRemoteSuccess(effectiveLocalValue, userId);
            return {
              value: effectiveLocalValue,
              result: {
                tableName: this.config.tableName,
                storageKey: this.config.storageKey,
                source: 'seeded-cloud',
                pushed: true,
                dirty: false,
              },
            };
          } catch (seedError) {
            console.warn(`Failed to seed Supabase (${this.config.tableName}):`, seedError);
            this.markRemoteFailure(seedError);
          }
        }

        try {
          console.debug(`[sync] ${this.config.tableName}: initializing blank workspace defaults`);
          await this.syncToSupabase(defaultValue, userId);
          this.cacheSyncedValue(defaultValue, userId);
          return {
            value: defaultValue,
            result: {
              tableName: this.config.tableName,
              storageKey: this.config.storageKey,
              source: 'seeded-cloud',
              pushed: true,
              dirty: false,
            },
          };
        } catch (seedDefaultError) {
          console.warn(`Failed to initialize defaults in Supabase (${this.config.tableName}):`, seedDefaultError);
          this.markRemoteFailure(seedDefaultError);
        }

        this.cacheSyncedValue(defaultValue, userId);
        return {
          value: defaultValue,
          result: {
            tableName: this.config.tableName,
            storageKey: this.config.storageKey,
            source: 'local',
            pushed: false,
            dirty: this.loadMetadata().dirty,
          },
        };
      }

      // Parse and cache the data locally
      const parsed = JSON.parse(data.data) as T;
      const cloudHash = hashValue(parsed);

      if (options.forcePushLocal && hasLocalValue) {
        console.debug(`[sync] ${this.config.tableName}: force-pushing local cache over cloud`);
        await this.syncToSupabase(effectiveLocalValue, userId);
        this.markRemoteSuccess(effectiveLocalValue, userId);
        return {
          value: effectiveLocalValue,
          result: {
            tableName: this.config.tableName,
            storageKey: this.config.storageKey,
            source: 'forced-local',
            pushed: true,
            dirty: false,
          },
        };
      }

      if (!shouldPushLocal || localIsSyncedCloudCache || localHash === cloudHash) {
        console.debug(`[sync] ${this.config.tableName}: hydrated from cloud`);
        this.cacheSyncedValue(parsed, userId, data.updated_at ?? new Date().toISOString());
        return {
          value: parsed,
          result: {
            tableName: this.config.tableName,
            storageKey: this.config.storageKey,
            source: 'cloud',
            pushed: false,
            dirty: false,
          },
        };
      }

      const shouldUseLocalWholeValue =
        !Array.isArray(effectiveLocalValue) &&
        !Array.isArray(parsed) &&
        (!isPlainRecord(effectiveLocalValue) || !isPlainRecord(parsed)) &&
        (metadata.dirty ||
          shouldPreferLocalOverCloud(effectiveLocalValue, parsed, defaultValue, data.updated_at));

      if (shouldUseLocalWholeValue) {
        try {
          console.debug(`[sync] ${this.config.tableName}: pushing newer local value`);
          await this.syncToSupabase(effectiveLocalValue, userId);
          this.markRemoteSuccess(effectiveLocalValue, userId);
        } catch (mergeError) {
          console.warn(`Failed to sync newer local data to Supabase (${this.config.tableName}):`, mergeError);
          this.markRemoteFailure(mergeError);
        }

        return {
          value: effectiveLocalValue,
          result: {
            tableName: this.config.tableName,
            storageKey: this.config.storageKey,
            source: 'merged',
            pushed: !this.loadMetadata().dirty,
            dirty: this.loadMetadata().dirty,
          },
        };
      }

      const merged = mergeSyncedValues(effectiveLocalValue, parsed);
      const mergedHash = hashValue(merged);

      if (mergedHash !== cloudHash) {
        try {
          console.debug(`[sync] ${this.config.tableName}: pushing merged local/cloud value`);
          await this.syncToSupabase(merged, userId);
          this.markRemoteSuccess(merged, userId);
        } catch (mergeError) {
          console.warn(`Failed to sync merged data to Supabase (${this.config.tableName}):`, mergeError);
          this.markRemoteFailure(mergeError);
          this.writeLocalCache(merged, {
            ...this.loadMetadata(),
            dirty: true,
            localUpdatedAt: new Date().toISOString(),
          });
          return {
            value: merged,
            result: {
              tableName: this.config.tableName,
              storageKey: this.config.storageKey,
              source: 'merged',
              pushed: false,
              dirty: true,
            },
          };
        }

        this.cacheSyncedValue(merged, userId);
        return {
          value: merged,
          result: {
            tableName: this.config.tableName,
            storageKey: this.config.storageKey,
            source: 'merged',
            pushed: true,
            dirty: false,
          },
        };
      }

      this.cacheSyncedValue(parsed, userId, data.updated_at ?? new Date().toISOString());
      return {
        value: parsed,
        result: {
          tableName: this.config.tableName,
          storageKey: this.config.storageKey,
          source: 'cloud',
          pushed: false,
          dirty: false,
        },
      };
    } catch (err) {
      console.warn(`Failed to parse Supabase data (${this.config.tableName}):`, err);
      const localValue = this.load(defaultValue);
      const metadata = this.loadMetadata();
      const localBelongsToCurrentUser =
        metadata.lastSyncedUserId === userId || canUseMachineLegacyData(userId);
      const effectiveLocalValue = localBelongsToCurrentUser ? localValue : defaultValue;
      return {
        value: effectiveLocalValue,
        result: {
          tableName: this.config.tableName,
          storageKey: this.config.storageKey,
          source: 'error',
          pushed: false,
          dirty: this.loadMetadata().dirty,
          error: getErrorMessage(err),
        },
      };
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
      throw new Error(error.message);
    }
  }

  async forcePushRemote<T>(data: T, userId: string): Promise<void> {
    if (!userId) {
      throw new Error(`Cannot force-push ${this.config.tableName} without a user id.`);
    }

    await this.enqueue(async () => {
      await this.syncToSupabase(data, userId);
      this.setMemoryValue(data);
      this.markRemoteSuccess(data, userId);
    });
  }

  async retryDirty<T>(defaultValue: T, userId?: string): Promise<boolean> {
    const user = userId || this.config.userId;
    if (!user) {
      return false;
    }

    const metadata = this.loadMetadata();
    if (!metadata.dirty) {
      return false;
    }

    const data = this.load(defaultValue);
    await this.enqueue(async () => {
      try {
        console.debug(`[sync] ${this.config.tableName}: retrying dirty local cache`);
        await this.syncToSupabase(data, user);
        this.markRemoteSuccess(data, user);
      } catch (err) {
        console.warn(`[sync] ${this.config.tableName}: retry failed`, err);
        this.markRemoteFailure(err);
      }
    });

    return !this.loadMetadata().dirty;
  }

  /**
   * Clear data from both localStorage and Supabase (for logout)
   */
  async clear(userId?: string): Promise<void> {
    if (hasLocalStorage()) {
      try {
        localStorage.removeItem(this.config.storageKey);
      } catch (err) {
        console.warn(`[sync] ${this.config.tableName}: failed clearing local cache key.`, err);
      }

      try {
        localStorage.removeItem(this.getMetaKey());
      } catch (err) {
        console.warn(`[sync] ${this.config.tableName}: failed clearing local metadata key.`, err);
      }
    }

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
