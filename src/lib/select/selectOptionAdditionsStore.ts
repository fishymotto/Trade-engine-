import { canUseMachineLegacyData, syncStores } from "../sync/syncStore";
import { loadDesktopStoreBackup, saveDesktopStoreBackup } from "../storage/desktopStoreBackup";

export type SelectOptionAdditionsRecord = Record<string, string[]>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const normalizeOption = (value: string) => value.trim().replace(/\s+/g, " ");

const normalizeSelectOptionAdditions = (value: unknown): SelectOptionAdditionsRecord => {
  if (!isRecord(value)) {
    return {};
  }

  const normalized: SelectOptionAdditionsRecord = {};
  for (const [storageKey, options] of Object.entries(value)) {
    if (!Array.isArray(options)) {
      continue;
    }

    const unique = new Set<string>();
    const nextOptions: string[] = [];
    for (const option of options) {
      if (typeof option !== "string") {
        continue;
      }

      const normalizedOption = normalizeOption(option);
      if (!normalizedOption) {
        continue;
      }

      const lookupKey = normalizedOption.toLowerCase();
      if (unique.has(lookupKey)) {
        continue;
      }

      unique.add(lookupKey);
      nextOptions.push(normalizedOption);
    }

    if (nextOptions.length > 0) {
      normalized[storageKey] = nextOptions;
    }
  }

  return normalized;
};

const hasSelectOptionAdditions = (value: SelectOptionAdditionsRecord): boolean =>
  Object.values(value).some((options) => Array.isArray(options) && options.length > 0);

export const loadSelectOptionAdditions = (): SelectOptionAdditionsRecord =>
  normalizeSelectOptionAdditions(syncStores.selectOptionAdditions.load<SelectOptionAdditionsRecord>({}));

export const persistSelectOptionAdditions = async (
  value: SelectOptionAdditionsRecord
): Promise<SelectOptionAdditionsRecord> => {
  const normalized = normalizeSelectOptionAdditions(value);
  const syncPromise = syncStores.selectOptionAdditions.save(normalized);
  const activeUserId = syncStores.selectOptionAdditions.getUserId();

  if (canUseMachineLegacyData(activeUserId)) {
    try {
      await saveDesktopStoreBackup("select-option-additions", normalized);
    } catch (error) {
      console.warn("[select-options] Failed to save desktop select option additions backup.", error);
    }
  }

  await syncPromise;
  return normalized;
};

export const recoverSelectOptionAdditionsFromDesktopBackup = async (): Promise<SelectOptionAdditionsRecord | null> => {
  const activeUserId = syncStores.selectOptionAdditions.getUserId();
  if (!canUseMachineLegacyData(activeUserId)) {
    return null;
  }

  const localValue = loadSelectOptionAdditions();
  if (hasSelectOptionAdditions(localValue)) {
    return null;
  }

  const desktopValue = normalizeSelectOptionAdditions(
    await loadDesktopStoreBackup<SelectOptionAdditionsRecord>("select-option-additions")
  );
  if (!hasSelectOptionAdditions(desktopValue)) {
    return null;
  }

  await persistSelectOptionAdditions(desktopValue);
  return desktopValue;
};
