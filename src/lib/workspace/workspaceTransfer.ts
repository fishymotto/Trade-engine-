import { collectWorkspaceAttachmentPaths } from "./workspaceAttachmentClient";
import {
  readLocalStorageItem,
  removeLocalStorageItem,
  writeLocalStorageItem
} from "../storage/localStorage";
import { dedupeJournalPages } from "../journal/journalStore";
import type { JournalPageRecord } from "../../types/journal";

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

interface IncludedJournalPageRefs {
  pageIds: Set<string>;
  tradeDates: Set<string>;
}

const PLAYBOOK_STORAGE_KEY = "trade-engine-playbooks";
const LIBRARY_EDITOR_DRAFT_PREFIX = "library:";

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

const JOURNAL_EDITOR_DRAFT_STORAGE_PREFIX = "trade-engine-journal-editor-draft::";

const PREFIX_STORAGE_KEYS = [
  JOURNAL_EDITOR_DRAFT_STORAGE_PREFIX,
  "playbook-aplus-dismissed:"
] as const;
const EXACT_STORAGE_KEY_SET = new Set<string>(EXACT_STORAGE_KEYS);

const SETTINGS_STORAGE_KEY = "trade-engine-settings";
const PORTABLE_SECRET_SETTING_FIELDS = ["notionToken", "twelveDataApiKey"] as const;
const WORKSPACE_ATTACHMENT_FOLDER_TOKEN = "playbook-attachments";
// Keep transient workspace UI state out of incremental sync files. Portable settings
// are sanitized before export, so shared app preferences can still ride with scoped transfers.
const DATE_RANGE_SKIPPED_STORAGE_KEYS = new Set<string>([
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

const getRecordText = (value: unknown, field: string): string =>
  isRecord(value) && typeof value[field] === "string" ? value[field].trim() : "";

const getRecordArray = (value: unknown, field: string): unknown[] =>
  isRecord(value) && Array.isArray(value[field]) ? (value[field] as unknown[]) : [];

const collectTradeIdsFromSession = (session: unknown, tradeIds: Set<string>): void => {
  for (const trade of getRecordArray(session, "trades")) {
    const tradeId = getRecordText(trade, "id");
    if (tradeId) {
      tradeIds.add(tradeId);
    }
  }
};

const collectIncludedTradeIds = (sessions: unknown, range: WorkspaceTransferDateRange): Set<string> => {
  const tradeIds = new Set<string>();
  const rows = Array.isArray(sessions) ? sessions : [];

  for (const session of rows) {
    if (shouldIncludeByDateRange(session, range, ["tradeDate"])) {
      collectTradeIdsFromSession(session, tradeIds);
    }
  }

  return tradeIds;
};

const hasIncludedTradeId = (value: unknown, tradeIds: Set<string>): boolean => {
  const tradeId = getRecordText(value, "tradeId");
  return Boolean(tradeId && tradeIds.has(tradeId));
};

const hasLinkedIncludedTrade = (value: unknown, tradeIds: Set<string>): boolean => {
  const legacyLinkedTradeId = getRecordText(value, "linkedTradeId");
  if (hasIncludedTradeId(value, tradeIds) || (legacyLinkedTradeId && tradeIds.has(legacyLinkedTradeId))) {
    return true;
  }

  return getRecordArray(value, "linkedTrades").some((link) => hasIncludedTradeId(link, tradeIds));
};

const hasJournalPageLinkedIncludedTrade = (value: unknown, tradeIds: Set<string>): boolean => {
  if (tradeIds.size === 0 || !isRecord(value)) {
    return false;
  }

  return (
    getRecordArray(value, "tradeNotes").some((note) => hasLinkedIncludedTrade(note, tradeIds)) ||
    getRecordArray(value, "screenshotTags").some((tag) => hasLinkedIncludedTrade(tag, tradeIds))
  );
};

const shouldIncludeJournalPage = (
  value: unknown,
  range: WorkspaceTransferDateRange,
  includedTradeIds: Set<string>
): boolean =>
  shouldIncludeByDateRange(value, range, ["tradeDate"]) ||
  hasJournalPageLinkedIncludedTrade(value, includedTradeIds);

const collectIncludedJournalPageRefs = (
  pages: unknown,
  range: WorkspaceTransferDateRange,
  includedTradeIds: Set<string>
): IncludedJournalPageRefs => {
  const refs: IncludedJournalPageRefs = {
    pageIds: new Set<string>(),
    tradeDates: new Set<string>()
  };

  const rows = Array.isArray(pages) ? pages : [];
  for (const page of rows) {
    if (!shouldIncludeJournalPage(page, range, includedTradeIds)) {
      continue;
    }

    const pageId = getRecordText(page, "id");
    if (pageId) {
      refs.pageIds.add(pageId);
    }

    const tradeDate = normalizeDateOnly(getRecordText(page, "tradeDate"));
    if (tradeDate) {
      refs.tradeDates.add(tradeDate);
    }
  }

  return refs;
};

const collectLibraryPageIds = (pages: unknown): Set<string> => {
  const pageIds = new Set<string>();
  const rows = Array.isArray(pages) ? pages : [];

  for (const page of rows) {
    const pageId = getRecordText(page, "id");
    if (pageId) {
      pageIds.add(pageId);
    }
  }

  return pageIds;
};

const hasPlaybookExampleInRange = (
  value: unknown,
  range: WorkspaceTransferDateRange,
  tradeIds: Set<string>
): boolean =>
  getRecordArray(value, "aPlusExamples").some(
    (example) =>
      shouldIncludeByDateRange(example, range, ["tradeDate"]) || hasIncludedTradeId(example, tradeIds)
  );

const getRecordTimestamp = (value: unknown, field: string): string | undefined => {
  const text = getRecordText(value, field);
  return text || undefined;
};

const pickNewestRecord = (left: unknown, right: unknown): unknown => {
  const leftTimestamp = parseTimestamp(getRecordTimestamp(left, "updatedAt"));
  const rightTimestamp = parseTimestamp(getRecordTimestamp(right, "updatedAt"));

  if (rightTimestamp > leftTimestamp) {
    return right;
  }

  if (rightTimestamp < leftTimestamp) {
    return left;
  }

  return stringifySize(right) >= stringifySize(left) ? right : left;
};

const pickRicherRecord = (left: unknown, right: unknown): unknown => {
  const leftSize = stringifySize(left);
  const rightSize = stringifySize(right);
  if (rightSize > leftSize) {
    return right;
  }

  if (leftSize > rightSize) {
    return left;
  }

  return right;
};

const pickNewestTimestampText = (left: unknown, right: unknown): string | undefined => {
  const leftText = typeof left === "string" ? left : "";
  const rightText = typeof right === "string" ? right : "";
  const leftTimestamp = parseTimestamp(leftText);
  const rightTimestamp = parseTimestamp(rightText);

  if (rightTimestamp > leftTimestamp) {
    return rightText;
  }

  if (leftTimestamp > rightTimestamp) {
    return leftText;
  }

  return rightText || leftText || undefined;
};

const pickOldestTimestampText = (left: unknown, right: unknown): string | undefined => {
  const leftText = typeof left === "string" ? left : "";
  const rightText = typeof right === "string" ? right : "";
  const leftTimestamp = parseTimestamp(leftText);
  const rightTimestamp = parseTimestamp(rightText);

  if (leftTimestamp > 0 && (rightTimestamp <= 0 || leftTimestamp <= rightTimestamp)) {
    return leftText;
  }

  if (rightTimestamp > 0) {
    return rightText;
  }

  return leftText || rightText || undefined;
};

const getTradeMergeKey = (trade: unknown): string => {
  const id = getRecordText(trade, "id");
  if (id) {
    return id;
  }

  return [
    getRecordText(trade, "tradeDate"),
    getRecordText(trade, "symbol"),
    getRecordText(trade, "openTime"),
    getRecordText(trade, "closeTime"),
    getRecordText(trade, "name")
  ]
    .filter(Boolean)
    .join("|");
};

const mergeSessionTrades = (existing: unknown, incoming: unknown): unknown[] =>
  mergeArrayByKey(
    getRecordArray(existing, "trades"),
    getRecordArray(incoming, "trades"),
    getTradeMergeKey
  ).map((trade) => {
    const key = getTradeMergeKey(trade);
    if (!key) {
      return trade;
    }

    const existingTrade = getRecordArray(existing, "trades").find((candidate) => getTradeMergeKey(candidate) === key);
    const incomingTrade = getRecordArray(incoming, "trades").find((candidate) => getTradeMergeKey(candidate) === key);
    if (existingTrade && incomingTrade) {
      return pickRicherRecord(existingTrade, incomingTrade);
    }

    return trade;
  });

const mergeTradeSessionRecord = (existing: unknown, incoming: unknown): unknown => {
  if (!isRecord(existing) || !isRecord(incoming)) {
    return pickRicherRecord(existing, incoming);
  }

  const preferredMetadata = pickNewestRecord(existing, incoming);
  const base = isRecord(preferredMetadata) ? preferredMetadata : incoming;

  return {
    ...base,
    tradeDate: getRecordText(incoming, "tradeDate") || getRecordText(existing, "tradeDate") || base.tradeDate,
    sourceFileName:
      getRecordText(incoming, "sourceFileName") ||
      getRecordText(existing, "sourceFileName") ||
      base.sourceFileName,
    importedAt: pickOldestTimestampText(existing.importedAt, incoming.importedAt) ?? base.importedAt,
    updatedAt: pickNewestTimestampText(existing.updatedAt, incoming.updatedAt) ?? base.updatedAt,
    trades: mergeSessionTrades(existing, incoming)
  };
};

const mergeTradeSessions = (existing: unknown, incoming: unknown): unknown[] => {
  const merged = new Map<string, unknown>();
  const rows = [
    ...(Array.isArray(existing) ? existing : []),
    ...(Array.isArray(incoming) ? incoming : [])
  ];

  for (const session of rows) {
    const tradeDate = getRecordText(session, "tradeDate");
    if (!tradeDate) {
      continue;
    }

    const current = merged.get(tradeDate);
    merged.set(tradeDate, current ? mergeTradeSessionRecord(current, session) : session);
  }

  return Array.from(merged.values()).sort((left, right) =>
    getRecordText(right, "tradeDate").localeCompare(getRecordText(left, "tradeDate"))
  );
};

const mergeJournalPages = (existing: unknown, incoming: unknown): JournalPageRecord[] =>
  dedupeJournalPages([
    ...(Array.isArray(existing) ? (existing as JournalPageRecord[]) : []),
    ...(Array.isArray(incoming) ? (incoming as JournalPageRecord[]) : [])
  ]);

const mergePlaybookExamples = (existing: unknown[], incoming: unknown[]): unknown[] =>
  mergeArrayByKey(
    existing,
    incoming,
    (entry) => {
      const id = getRecordText(entry, "id");
      const tradeId = getRecordText(entry, "tradeId");
      const tradeDate = getRecordText(entry, "tradeDate");
      return id || [tradeId, tradeDate].filter(Boolean).join("|");
    },
    (entry) => getRecordTimestamp(entry, "updatedAt")
  );

const mergePlaybookRecord = (existing: unknown, incoming: unknown): unknown => {
  if (!isRecord(existing) || !isRecord(incoming)) {
    return pickNewestRecord(existing, incoming);
  }

  const base = pickNewestRecord(existing, incoming);
  const preferred = isRecord(base) ? base : incoming;

  return {
    ...preferred,
    aliases: dedupeStrings([
      ...getRecordArray(existing, "aliases"),
      ...getRecordArray(incoming, "aliases")
    ]),
    screenshotUrls: dedupeStrings([
      ...getRecordArray(existing, "screenshotUrls"),
      ...getRecordArray(incoming, "screenshotUrls")
    ]),
    aPlusExamples: mergePlaybookExamples(
      getRecordArray(existing, "aPlusExamples"),
      getRecordArray(incoming, "aPlusExamples")
    ),
    createdAt: pickOldestTimestampText(existing.createdAt, incoming.createdAt) ?? preferred.createdAt,
    updatedAt: pickNewestTimestampText(existing.updatedAt, incoming.updatedAt) ?? preferred.updatedAt
  };
};

const mergePlaybooks = (existing: unknown, incoming: unknown): unknown[] => {
  const merged = new Map<string, unknown>();
  const rows = [
    ...(Array.isArray(existing) ? existing : []),
    ...(Array.isArray(incoming) ? incoming : [])
  ];

  for (const playbook of rows) {
    const key = getRecordText(playbook, "id");
    if (!key) {
      continue;
    }

    const current = merged.get(key);
    merged.set(key, current ? mergePlaybookRecord(current, playbook) : playbook);
  }

  return Array.from(merged.values());
};

const getNamedTemplateKey = (entry: unknown): string => {
  const id = getRecordText(entry, "id");
  const name = getRecordText(entry, "name");
  return id || (name ? `name:${name.toLowerCase()}` : "");
};

const mergeNamedTemplateArray = (existing: unknown, incoming: unknown): unknown[] =>
  mergeArrayByKey(
    Array.isArray(existing) ? existing : [],
    Array.isArray(incoming) ? incoming : [],
    getNamedTemplateKey
  );

const mergeTemplateRecord = (
  existing: unknown,
  incoming: unknown,
  groups: string[]
): Record<string, unknown> => {
  const existingRecord = isRecord(existing) ? existing : {};
  const incomingRecord = isRecord(incoming) ? incoming : {};
  const merged: Record<string, unknown> = {
    ...existingRecord,
    ...incomingRecord
  };

  for (const group of groups) {
    merged[group] = mergeNamedTemplateArray(existingRecord[group], incomingRecord[group]);
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
      return mergeTradeSessions(existing, incoming);
    case "trade-engine-journal-pages":
      return mergeJournalPages(existing, incoming);
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
      return mergePlaybooks(existing, incoming);
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
      return mergeTemplateRecord(existing, incoming, ["morningTemplates", "closingTemplates", "mppTemplates"]);
    case "trade-engine-review-templates":
      return mergeTemplateRecord(existing, incoming, ["weeklyTemplates", "monthlyTemplates"]);
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

const getHeadlineDateCandidates = (item: unknown, bucketDate: string): string[] => {
  const candidates: string[] = [];
  if (isRecord(item)) {
    candidates.push(
      normalizeDateOnly(item.journalDate),
      normalizeDateOnly(item.updatedAt),
      normalizeDateOnly(item.createdAt)
    );
  }

  candidates.push(normalizeDateOnly(bucketDate));
  return candidates.filter(Boolean);
};

const shouldIncludeHeadlineForDateScope = (
  item: unknown,
  bucketDate: string,
  range: WorkspaceTransferDateRange,
  includedJournalTradeDates: Set<string>
): boolean => {
  const candidateDates = getHeadlineDateCandidates(item, bucketDate);
  if (
    candidateDates.some(
      (date) => includedJournalTradeDates.has(date) || isDateWithinRange(date, range)
    )
  ) {
    return true;
  }

  return shouldIncludeByDateRange(item, range, ["journalDate"]);
};

const filterHeadlineBuckets = (
  value: unknown,
  range: WorkspaceTransferDateRange,
  includedJournalTradeDates: Set<string>
): Record<string, unknown> => {
  if (!isRecord(value)) {
    return {};
  }

  const filtered: Record<string, unknown[]> = {};
  for (const [bucketDate, items] of Object.entries(value)) {
    if (!Array.isArray(items)) {
      continue;
    }

    const kept = items.filter((item) =>
      shouldIncludeHeadlineForDateScope(item, bucketDate, range, includedJournalTradeDates)
    ) as unknown[];
    if (kept.length > 0) {
      filtered[bucketDate] = kept;
    }
  }

  return filtered;
};

const isEditorDraftForIncludedPage = (
  storageKey: string,
  includedJournalPageIds: Set<string>,
  includedLibraryPageIds: Set<string>
): boolean => {
  if (!storageKey.startsWith(JOURNAL_EDITOR_DRAFT_STORAGE_PREFIX)) {
    return false;
  }

  const draftKeyBody = storageKey.slice(JOURNAL_EDITOR_DRAFT_STORAGE_PREFIX.length);
  for (const pageId of includedJournalPageIds) {
    if (draftKeyBody.startsWith(`${pageId}:`)) {
      return true;
    }
  }

  for (const pageId of includedLibraryPageIds) {
    if (draftKeyBody.startsWith(`${LIBRARY_EDITOR_DRAFT_PREFIX}${pageId}:`)) {
      return true;
    }
  }

  return false;
};

const filterJournalDraft = (
  storageKey: string,
  value: unknown,
  range: WorkspaceTransferDateRange,
  includedJournalPageIds: Set<string>,
  includedLibraryPageIds: Set<string>
): unknown => {
  if (isEditorDraftForIncludedPage(storageKey, includedJournalPageIds, includedLibraryPageIds)) {
    return value;
  }

  return isRecord(value) && isTimestampWithinRange(parseTimestamp(value.updatedAt), range) ? value : undefined;
};

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
  const includedTradeIds = collectIncludedTradeIds(snapshot["trade-engine-trade-sessions"], range);
  const includedJournalPages = collectIncludedJournalPageRefs(
    snapshot["trade-engine-journal-pages"],
    range,
    includedTradeIds
  );
  const includedLibraryPageIds = collectLibraryPageIds(snapshot["trade-engine-library-pages"]);

  for (const [storageKey, value] of Object.entries(snapshot)) {
    if (shouldSkipDateRangeStorageKey(storageKey)) {
      continue;
    }

    switch (storageKey) {
      case SETTINGS_STORAGE_KEY: {
        filtered[storageKey] = sanitizePortableSettings(value);
        break;
      }
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
        const kept = rows.filter((entry) => shouldIncludeJournalPage(entry, range, includedTradeIds));
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
        const kept = rows.filter(
          (entry) => shouldIncludeByDateRange(entry, range) || hasIncludedTradeId(entry, includedTradeIds)
        );
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
      case PLAYBOOK_STORAGE_KEY: {
        const rows = Array.isArray(value) ? value : [];
        const kept = rows.filter(
          (entry) =>
            shouldIncludeByDateRange(entry, range) ||
            hasPlaybookExampleInRange(entry, range, includedTradeIds)
        );
        if (kept.length > 0) {
          filtered[storageKey] = kept;
        }
        break;
      }
      case "trade-engine-library-pages": {
        // Library pages are shared workspace knowledge, not just trade-date records.
        // Keep the full set in scoped sync files so Weekly/Monthly Reviews and other notes merge too.
        filtered[storageKey] = value;
        break;
      }
      case "trade-engine-headlines": {
        const kept = filterHeadlineBuckets(value, range, includedJournalPages.tradeDates);
        if (Object.keys(kept).length > 0) {
          filtered[storageKey] = kept;
        }
        break;
      }
      default: {
        if (storageKey.startsWith(JOURNAL_EDITOR_DRAFT_STORAGE_PREFIX)) {
          const kept = filterJournalDraft(
            storageKey,
            value,
            range,
            includedJournalPages.pageIds,
            includedLibraryPageIds
          );
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
  const nextSnapshot: Record<string, unknown> = { ...existingSnapshot };
  for (const [storageKey, incomingValue] of Object.entries(bundle.localStorage ?? {})) {
    nextSnapshot[storageKey] = mergeWorkspaceTransferValue(
      storageKey,
      existingSnapshot[storageKey],
      incomingValue
    );
  }

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
