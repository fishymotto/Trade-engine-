import { collectWorkspaceAttachmentPaths } from "./workspaceAttachmentClient";
import {
  readLocalStorageItem,
  removeLocalStorageItem,
  writeLocalStorageItem
} from "../storage/localStorage";

export type WorkspaceTransferScope = "full" | "since-date" | "date-range" | "selected-dates";

export interface WorkspaceTransferAttachmentRecord {
  relativePath: string;
  originalPath?: string;
  byteLength?: number;
  contentBase64?: string;
  contentHex?: string;
}

export interface WorkspaceTransferBundle {
  version: number;
  exportedAt: string;
  source: string;
  scope?: WorkspaceTransferScope;
  startDate?: string;
  endDate?: string;
  selectedDates?: string[];
  localStorage: Record<string, unknown>;
  attachments: WorkspaceTransferAttachmentRecord[];
}

export interface WorkspaceTransferExportResult {
  savedPath: string;
  attachmentCount: number;
  skippedAttachmentPaths: string[];
}

export interface WorkspaceTransferImportResult {
  bundle: WorkspaceTransferBundle;
  restoredAttachmentCount: number;
  skippedAttachmentPaths: string[];
}

export interface WorkspaceTransferPreparedSnapshot {
  localStorage: Record<string, unknown>;
  scope: WorkspaceTransferScope;
  startDate?: string;
  endDate?: string;
  selectedDates?: string[];
}

interface WorkspaceTransferDateRange {
  startDate?: string;
  endDate?: string;
  startTimestamp?: number;
  endTimestamp?: number;
  selectedDates?: string[];
  selectedDateSet?: Set<string>;
}

const PLAYBOOK_STORAGE_KEY = "trade-engine-playbooks";

const EXACT_STORAGE_KEYS = [
  "trade-engine-settings",
  "trade-engine-trade-sessions",
  "trade-engine-journal-pages",
  "trade-engine-trade-tag-options",
  "trade-engine-trade-tag-overrides",
  "trade-engine-trade-reviews",
  "trade-engine-historical-bars",
  "trade-engine-journal-checklist-templates",
  "trade-engine-workspace",
  "trade-engine-trade-tag-catalog",
  PLAYBOOK_STORAGE_KEY,
  "trade-engine-library-pages",
  "trade-engine-headlines",
  "trade-engine-select-option-additions",
  "trade-engine-review-templates"
] as const;

const PREFIX_STORAGE_KEYS = [
  "trade-engine-journal-editor-draft::",
  "playbook-aplus-dismissed:"
] as const;
const EXACT_STORAGE_KEY_SET = new Set<string>(EXACT_STORAGE_KEYS);

const SETTINGS_STORAGE_KEY = "trade-engine-settings";
const PORTABLE_SECRET_SETTING_FIELDS = ["notionToken", "twelveDataApiKey"] as const;
const WORKSPACE_ATTACHMENT_FOLDER_TOKEN = "playbook-attachments";
// Keep machine-local settings and transient workspace UI state out of incremental sync files.
const DATE_RANGE_SKIPPED_STORAGE_KEYS = new Set<string>([
  SETTINGS_STORAGE_KEY,
  "trade-engine-workspace"
]);
const DATE_RANGE_SKIPPED_PREFIXES = ["playbook-aplus-dismissed:"] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const isAbsoluteFilePath = (value: string): boolean => /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\");

const isWorkspaceAttachmentPath = (value: string): boolean =>
  isAbsoluteFilePath(value) && value.toLowerCase().includes(WORKSPACE_ATTACHMENT_FOLDER_TOKEN);

const parseStoredJson = (raw: string | null): unknown => {
  if (!raw) {
    return undefined;
  }

  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
};

const sanitizePortableSettings = (value: unknown): unknown => {
  if (!isRecord(value)) {
    return value;
  }

  const sanitizedSettings: Record<string, unknown> = { ...value };
  for (const field of PORTABLE_SECRET_SETTING_FIELDS) {
    delete sanitizedSettings[field];
  }

  return sanitizedSettings;
};

const mergePreservedPortableSettings = (existing: unknown, incoming: unknown): unknown => {
  if (!isRecord(existing) && !isRecord(incoming)) {
    return incoming;
  }

  const mergedSettings: Record<string, unknown> = isRecord(incoming) ? { ...incoming } : {};
  if (!isRecord(existing)) {
    return mergedSettings;
  }

  for (const field of PORTABLE_SECRET_SETTING_FIELDS) {
    const existingValue = existing[field];
    if (typeof existingValue === "string") {
      mergedSettings[field] = existingValue;
    }
  }

  return mergedSettings;
};

const shouldSkipDateRangeStorageKey = (storageKey: string): boolean =>
  DATE_RANGE_SKIPPED_STORAGE_KEYS.has(storageKey) ||
  DATE_RANGE_SKIPPED_PREFIXES.some((prefix) => storageKey.startsWith(prefix));

const normalizeExportDate = (value: string | undefined): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : undefined;
};

const normalizeSelectedDates = (values: string[] | undefined): string[] => {
  if (!Array.isArray(values)) {
    return [];
  }

  const unique = new Set<string>();
  const normalized: string[] = [];

  for (const value of values) {
    const nextDate = normalizeExportDate(value);
    if (!nextDate || unique.has(nextDate)) {
      continue;
    }

    unique.add(nextDate);
    normalized.push(nextDate);
  }

  return normalized.sort();
};

const buildDateRange = (
  startDateInput?: string,
  endDateInput?: string,
  selectedDatesInput?: string[]
): WorkspaceTransferDateRange => {
  const selectedDates = normalizeSelectedDates(selectedDatesInput);
  if (selectedDates.length > 0) {
    return {
      selectedDates,
      selectedDateSet: new Set(selectedDates)
    };
  }

  const startDate = normalizeExportDate(startDateInput);
  const endDate = normalizeExportDate(endDateInput);

  if (!startDate && !endDate) {
    return {};
  }

  if (startDate && endDate && endDate < startDate) {
    throw new Error("Workspace export end date must be the same day or later than the start date.");
  }

  return {
    startDate,
    endDate,
    startTimestamp: startDate ? Date.parse(`${startDate}T00:00:00`) : undefined,
    endTimestamp: endDate ? Date.parse(`${endDate}T23:59:59.999`) : undefined
  };
};

const parseTimestamp = (value: unknown): number => {
  if (typeof value !== "string" || !value.trim()) {
    return 0;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeDateOnly = (value: unknown): string => {
  if (typeof value !== "string") {
    return "";
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  return parsed.toISOString().slice(0, 10);
};

const stringifySize = (value: unknown): number => {
  try {
    return JSON.stringify(value).length;
  } catch {
    return 0;
  }
};

const timestampToLocalDate = (timestamp: number): string => {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return "";
  }

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const isTimestampWithinRange = (timestamp: number, range: WorkspaceTransferDateRange): boolean => {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return false;
  }

  if (range.selectedDateSet && range.selectedDateSet.size > 0) {
    return range.selectedDateSet.has(timestampToLocalDate(timestamp));
  }

  if (range.startTimestamp !== undefined && timestamp < range.startTimestamp) {
    return false;
  }

  if (range.endTimestamp !== undefined && timestamp > range.endTimestamp) {
    return false;
  }

  return true;
};

const isDateWithinRange = (value: string, range: WorkspaceTransferDateRange): boolean => {
  if (!value) {
    return false;
  }

  if (range.selectedDateSet && range.selectedDateSet.size > 0) {
    return range.selectedDateSet.has(value);
  }

  if (range.startDate && value < range.startDate) {
    return false;
  }

  if (range.endDate && value > range.endDate) {
    return false;
  }

  return true;
};

const shouldIncludeByDateRange = (
  value: unknown,
  range: WorkspaceTransferDateRange,
  dateFields: string[] = []
): boolean => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  const candidateTimestamps = [record.updatedAt, record.createdAt, record.importedAt].map(parseTimestamp);
  if (candidateTimestamps.some((timestamp) => isTimestampWithinRange(timestamp, range))) {
    return true;
  }

  return dateFields.some((field) => isDateWithinRange(normalizeDateOnly(record[field]), range));
};

const dedupeStrings = (values: unknown[]): string[] => {
  const unique = new Set<string>();
  const output: string[] = [];

  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }

    const trimmed = value.trim();
    if (!trimmed || unique.has(trimmed.toLowerCase())) {
      continue;
    }

    unique.add(trimmed.toLowerCase());
    output.push(trimmed);
  }

  return output;
};

const mergeArrayByKey = <T,>(
  existing: T[],
  incoming: T[],
  getKey: (entry: T) => string,
  getUpdatedAt?: (entry: T) => string | undefined
): T[] => {
  const merged = new Map<string, T>();

  const upsert = (entry: T, preferOnTie: boolean) => {
    const key = getKey(entry).trim();
    if (!key) {
      return;
    }

    const current = merged.get(key);
    if (!current) {
      merged.set(key, entry);
      return;
    }

    const nextTimestamp = getUpdatedAt ? parseTimestamp(getUpdatedAt(entry)) : 0;
    const currentTimestamp = getUpdatedAt ? parseTimestamp(getUpdatedAt(current)) : 0;

    if (nextTimestamp > currentTimestamp) {
      merged.set(key, entry);
      return;
    }

    if (nextTimestamp < currentTimestamp) {
      return;
    }

    if (preferOnTie || stringifySize(entry) >= stringifySize(current)) {
      merged.set(key, entry);
    }
  };

  for (const entry of existing) {
    upsert(entry, false);
  }

  for (const entry of incoming) {
    upsert(entry, true);
  }

  return Array.from(merged.values());
};

const mergeStringArrayRecord = (
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>
): Record<string, string[]> => {
  const merged: Record<string, string[]> = {};
  const keys = new Set([...Object.keys(existing), ...Object.keys(incoming)]);

  for (const key of keys) {
    const existingValues = Array.isArray(existing[key]) ? (existing[key] as unknown[]) : [];
    const incomingValues = Array.isArray(incoming[key]) ? (incoming[key] as unknown[]) : [];
    merged[key] = dedupeStrings([...existingValues, ...incomingValues]);
  }

  return merged;
};

const mergeHeadlinesRecord = (existing: unknown, incoming: unknown): Record<string, unknown> => {
  const mergedById = new Map<string, Record<string, unknown>>();

  const consume = (value: unknown, preferOnTie: boolean) => {
    if (!isRecord(value)) {
      return;
    }

    for (const items of Object.values(value)) {
      if (!Array.isArray(items)) {
        continue;
      }

      for (const item of items) {
        if (!isRecord(item) || typeof item.id !== "string" || !item.id.trim()) {
          continue;
        }

        const existingItem = mergedById.get(item.id);
        if (!existingItem) {
          mergedById.set(item.id, item);
          continue;
        }

        const nextTimestamp = parseTimestamp(item.updatedAt ?? item.createdAt);
        const currentTimestamp = parseTimestamp(existingItem.updatedAt ?? existingItem.createdAt);
        if (
          nextTimestamp > currentTimestamp ||
          (nextTimestamp === currentTimestamp && (preferOnTie || stringifySize(item) >= stringifySize(existingItem)))
        ) {
          mergedById.set(item.id, item);
        }
      }
    }
  };

  consume(existing, false);
  consume(incoming, true);

  const grouped: Record<string, unknown[]> = {};
  for (const item of mergedById.values()) {
    const tradeDate = normalizeDateOnly(item.journalDate ?? item.updatedAt ?? item.createdAt);
    if (!tradeDate) {
      continue;
    }

    grouped[tradeDate] = [...(grouped[tradeDate] ?? []), item];
  }

  return grouped;
};

const mergeJournalDraft = (existing: unknown, incoming: unknown): unknown => {
  const existingUpdatedAt = isRecord(existing) ? parseTimestamp(existing.updatedAt) : 0;
  const incomingUpdatedAt = isRecord(incoming) ? parseTimestamp(incoming.updatedAt) : 0;
  if (incomingUpdatedAt > existingUpdatedAt) {
    return incoming;
  }
  if (incomingUpdatedAt < existingUpdatedAt) {
    return existing;
  }
  return stringifySize(incoming) >= stringifySize(existing) ? incoming : existing;
};

const mergeDismissedTradeIds = (existing: unknown, incoming: unknown): unknown => {
  const existingValues = Array.isArray(existing) ? existing : [];
  const incomingValues = Array.isArray(incoming) ? incoming : [];
  return dedupeStrings([...existingValues, ...incomingValues]);
};

const mergeWorkspaceTransferValue = (storageKey: string, existing: unknown, incoming: unknown): unknown => {
  switch (storageKey) {
    case SETTINGS_STORAGE_KEY:
      return incoming;
    case "trade-engine-trade-sessions":
      return mergeArrayByKey(
        Array.isArray(existing) ? existing : [],
        Array.isArray(incoming) ? incoming : [],
        (entry) => (isRecord(entry) && typeof entry.tradeDate === "string" ? entry.tradeDate : ""),
        (entry) => (isRecord(entry) && typeof entry.updatedAt === "string" ? entry.updatedAt : undefined)
      );
    case "trade-engine-journal-pages":
      return mergeArrayByKey(
        Array.isArray(existing) ? existing : [],
        Array.isArray(incoming) ? incoming : [],
        (entry) => (isRecord(entry) && typeof entry.id === "string" ? entry.id : ""),
        (entry) => (isRecord(entry) && typeof entry.updatedAt === "string" ? entry.updatedAt : undefined)
      );
    case "trade-engine-trade-tag-options":
    case "trade-engine-select-option-additions":
    case "trade-engine-trade-tag-catalog":
      return mergeStringArrayRecord(isRecord(existing) ? existing : {}, isRecord(incoming) ? incoming : {});
    case "trade-engine-trade-tag-overrides":
      return mergeArrayByKey(
        Array.isArray(existing) ? existing : [],
        Array.isArray(incoming) ? incoming : [],
        (entry) => (isRecord(entry) && typeof entry.key === "string" ? entry.key : ""),
        (entry) => (isRecord(entry) && typeof entry.updatedAt === "string" ? entry.updatedAt : undefined)
      );
    case "trade-engine-trade-reviews":
      return mergeArrayByKey(
        Array.isArray(existing) ? existing : [],
        Array.isArray(incoming) ? incoming : [],
        (entry) => (isRecord(entry) && typeof entry.tradeId === "string" ? entry.tradeId : ""),
        (entry) => (isRecord(entry) && typeof entry.updatedAt === "string" ? entry.updatedAt : undefined)
      );
    case "trade-engine-historical-bars":
      return mergeArrayByKey(
        Array.isArray(existing) ? existing : [],
        Array.isArray(incoming) ? incoming : [],
        (entry) => (isRecord(entry) && typeof entry.key === "string" ? entry.key : ""),
        (entry) => (isRecord(entry) && typeof entry.updatedAt === "string" ? entry.updatedAt : undefined)
      );
    case "trade-engine-workspace":
      return existing ?? incoming;
    case PLAYBOOK_STORAGE_KEY:
    case "trade-engine-library-pages":
      return mergeArrayByKey(
        Array.isArray(existing) ? existing : [],
        Array.isArray(incoming) ? incoming : [],
        (entry) => (isRecord(entry) && typeof entry.id === "string" ? entry.id : ""),
        (entry) => (isRecord(entry) && typeof entry.updatedAt === "string" ? entry.updatedAt : undefined)
      );
    case "trade-engine-headlines":
      return mergeHeadlinesRecord(existing, incoming);
    case "trade-engine-journal-checklist-templates":
    case "trade-engine-review-templates":
      return incoming;
    default:
      if (storageKey.startsWith("trade-engine-journal-editor-draft::")) {
        return mergeJournalDraft(existing, incoming);
      }

      if (storageKey.startsWith("playbook-aplus-dismissed:")) {
        return mergeDismissedTradeIds(existing, incoming);
      }

      return incoming;
  }
};

const filterHeadlineBuckets = (value: unknown, range: WorkspaceTransferDateRange): Record<string, unknown> => {
  if (!isRecord(value)) {
    return {};
  }

  const filtered: Record<string, unknown[]> = {};
  for (const [bucketDate, items] of Object.entries(value)) {
    if (!Array.isArray(items)) {
      continue;
    }

    const kept = items.filter((item) => shouldIncludeByDateRange(item, range, ["journalDate"])) as unknown[];
    if (kept.length > 0 || isDateWithinRange(bucketDate, range)) {
      filtered[bucketDate] = kept.length > 0 ? kept : [];
    }
  }

  return filtered;
};

const filterJournalDraft = (value: unknown, range: WorkspaceTransferDateRange): unknown =>
  isRecord(value) && isTimestampWithinRange(parseTimestamp(value.updatedAt), range) ? value : undefined;

export const collectWorkspaceTransferLocalStorage = (): Record<string, unknown> => {
  if (typeof window === "undefined") {
    return {};
  }

  const snapshot: Record<string, unknown> = {};

  for (const storageKey of EXACT_STORAGE_KEYS) {
    const parsed = parseStoredJson(readLocalStorageItem(storageKey));
    if (parsed !== undefined) {
      snapshot[storageKey] = parsed;
    }
  }

  for (let index = 0; index < window.localStorage.length; index += 1) {
    const storageKey = window.localStorage.key(index);
    if (!storageKey || !PREFIX_STORAGE_KEYS.some((prefix) => storageKey.startsWith(prefix))) {
      continue;
    }

    const parsed = parseStoredJson(readLocalStorageItem(storageKey));
    if (parsed !== undefined) {
      snapshot[storageKey] = parsed;
    }
  }

  return snapshot;
};

export const prepareWorkspaceTransferSnapshot = (
  snapshot: Record<string, unknown>,
  startDateInput?: string,
  endDateInput?: string,
  selectedDatesInput?: string[]
): WorkspaceTransferPreparedSnapshot => {
  const range = buildDateRange(startDateInput, endDateInput, selectedDatesInput);
  if (!range.startDate && !range.endDate && (!range.selectedDateSet || range.selectedDateSet.size === 0)) {
    return {
      localStorage: snapshot,
      scope: "full",
    };
  }

  const filtered: Record<string, unknown> = {};

  for (const [storageKey, value] of Object.entries(snapshot)) {
    if (shouldSkipDateRangeStorageKey(storageKey)) {
      continue;
    }

    switch (storageKey) {
      case "trade-engine-trade-sessions": {
        const rows = Array.isArray(value) ? value : [];
        const kept = rows.filter((entry) => shouldIncludeByDateRange(entry, range, ["tradeDate"]));
        if (kept.length > 0) {
          filtered[storageKey] = kept;
        }
        break;
      }
      case "trade-engine-journal-pages": {
        const rows = Array.isArray(value) ? value : [];
        const kept = rows.filter((entry) => shouldIncludeByDateRange(entry, range, ["tradeDate"]));
        if (kept.length > 0) {
          filtered[storageKey] = kept;
        }
        break;
      }
      case "trade-engine-trade-tag-overrides": {
        const rows = Array.isArray(value) ? value : [];
        const kept = rows.filter((entry) => shouldIncludeByDateRange(entry, range, ["tradeDate"]));
        if (kept.length > 0) {
          filtered[storageKey] = kept;
        }
        break;
      }
      case "trade-engine-trade-reviews": {
        const rows = Array.isArray(value) ? value : [];
        const kept = rows.filter((entry) => shouldIncludeByDateRange(entry, range));
        if (kept.length > 0) {
          filtered[storageKey] = kept;
        }
        break;
      }
      case "trade-engine-historical-bars": {
        const rows = Array.isArray(value) ? value : [];
        const kept = rows.filter((entry) => shouldIncludeByDateRange(entry, range, ["tradeDate"]));
        if (kept.length > 0) {
          filtered[storageKey] = kept;
        }
        break;
      }
      case PLAYBOOK_STORAGE_KEY:
      case "trade-engine-library-pages": {
        const rows = Array.isArray(value) ? value : [];
        const kept = rows.filter((entry) => shouldIncludeByDateRange(entry, range));
        if (kept.length > 0) {
          filtered[storageKey] = kept;
        }
        break;
      }
      case "trade-engine-headlines": {
        const kept = filterHeadlineBuckets(value, range);
        if (Object.keys(kept).length > 0) {
          filtered[storageKey] = kept;
        }
        break;
      }
      default: {
        if (storageKey.startsWith("trade-engine-journal-editor-draft::")) {
          const kept = filterJournalDraft(value, range);
          if (kept !== undefined) {
            filtered[storageKey] = kept;
          }
          break;
        }

        filtered[storageKey] = value;
      }
    }
  }

  return {
    localStorage: filtered,
    scope:
      range.selectedDateSet && range.selectedDateSet.size > 0
        ? "selected-dates"
        : range.startDate && !range.endDate
          ? "since-date"
          : "date-range",
    startDate: range.startDate,
    endDate: range.endDate,
    selectedDates: range.selectedDates
  };
};

export const extractWorkspaceAttachmentPaths = (localStorageSnapshot: Record<string, unknown>): string[] => {
  return collectWorkspaceAttachmentPaths(localStorageSnapshot);
};

export const buildAppliedWorkspaceTransferSnapshot = (
  bundle: WorkspaceTransferBundle,
  existingSnapshot = collectWorkspaceTransferLocalStorage()
): Record<string, unknown> => {
  const isIncrementalScope =
    bundle.scope === "since-date" ||
    bundle.scope === "date-range" ||
    bundle.scope === "selected-dates";
  const nextSnapshot = isIncrementalScope
    ? (() => {
        const mergedSnapshot: Record<string, unknown> = { ...existingSnapshot };
        for (const [storageKey, incomingValue] of Object.entries(bundle.localStorage ?? {})) {
          if (shouldSkipDateRangeStorageKey(storageKey)) {
            continue;
          }

          mergedSnapshot[storageKey] = mergeWorkspaceTransferValue(
            storageKey,
            existingSnapshot[storageKey],
            incomingValue
          );
        }
        return mergedSnapshot;
      })()
    : { ...(bundle.localStorage ?? {}) };

  const importedSettings = sanitizePortableSettings(nextSnapshot[SETTINGS_STORAGE_KEY]);
  const nextSettings = mergePreservedPortableSettings(existingSnapshot[SETTINGS_STORAGE_KEY], importedSettings);
  if (isRecord(nextSettings)) {
    nextSnapshot[SETTINGS_STORAGE_KEY] = nextSettings;
  }

  return nextSnapshot;
};

export const clearWorkspaceTransferLocalStorage = (): void => {
  if (typeof window === "undefined") {
    return;
  }

  for (const storageKey of EXACT_STORAGE_KEYS) {
    removeLocalStorageItem(storageKey, { label: storageKey });
    removeLocalStorageItem(`${storageKey}::sync-meta`, { label: `${storageKey} sync metadata` });
  }

  const keysToRemove: string[] = [];
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const storageKey = window.localStorage.key(index);
    if (!storageKey) {
      continue;
    }

    if (PREFIX_STORAGE_KEYS.some((prefix) => storageKey.startsWith(prefix))) {
      keysToRemove.push(storageKey);
    }
  }

  for (const storageKey of keysToRemove) {
    removeLocalStorageItem(storageKey, { label: storageKey });
  }
};

const isPrefixedWorkspaceTransferStorageKey = (storageKey: string): boolean =>
  PREFIX_STORAGE_KEYS.some((prefix) => storageKey.startsWith(prefix));

export const applyWorkspaceTransferPrefixLocalStorage = (
  snapshot: Record<string, unknown>
): void => {
  if (typeof window === "undefined") {
    return;
  }

  const prefixKeysToRemove: string[] = [];
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const storageKey = window.localStorage.key(index);
    if (!storageKey || !isPrefixedWorkspaceTransferStorageKey(storageKey)) {
      continue;
    }

    if (!(storageKey in snapshot)) {
      prefixKeysToRemove.push(storageKey);
    }
  }

  for (const storageKey of prefixKeysToRemove) {
    removeLocalStorageItem(storageKey, { label: storageKey });
  }

  for (const [storageKey, value] of Object.entries(snapshot)) {
    if (!isPrefixedWorkspaceTransferStorageKey(storageKey)) {
      continue;
    }

    writeLocalStorageItem(storageKey, JSON.stringify(value), {
      label: storageKey,
      suppressQuotaWarning: true
    });
  }
};

export const applyWorkspaceTransferBundle = (bundle: WorkspaceTransferBundle): void => {
  if (typeof window === "undefined") {
    return;
  }

  const nextSnapshot = buildAppliedWorkspaceTransferSnapshot(bundle);
  clearWorkspaceTransferLocalStorage();

  for (const [storageKey, value] of Object.entries(nextSnapshot)) {
    writeLocalStorageItem(storageKey, JSON.stringify(value), {
      label: storageKey,
      suppressQuotaWarning: true
    });
    if (EXACT_STORAGE_KEY_SET.has(storageKey)) {
      removeLocalStorageItem(`${storageKey}::sync-meta`, { label: `${storageKey} sync metadata` });
    }
  }
};
