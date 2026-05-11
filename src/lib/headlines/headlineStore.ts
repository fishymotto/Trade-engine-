import type { HeadlineItem } from "../../types/headline";
import { canUseMachineLegacyData, syncStores } from "../sync/syncStore";
import { loadDesktopStoreBackup, saveDesktopStoreBackup } from "../storage/desktopStoreBackup";

export type HeadlinesByTradeDate = Record<string, HeadlineItem[]>;

const stableStringify = (value: unknown): string => {
  if (value === null || value === undefined) {
    return JSON.stringify(value);
  }

  if (typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
};

const formatLocalDateKey = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const normalizeTradeDate = (value: string): string => {
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

  return formatLocalDateKey(parsed);
};

const sanitizeHeadlineUrl = (rawUrl: string): string | null => {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return null;
  }

  const withoutViewSource = trimmed.replace(/^view-source:/i, "").trim();

  try {
    const parsed = new URL(withoutViewSource);
    const protocol = parsed.protocol.toLowerCase();
    if (protocol !== "http:" && protocol !== "https:") {
      return null;
    }

    return parsed.toString();
  } catch {
    return null;
  }
};

type LegacyHeadlineItem = Omit<HeadlineItem, "journalDate"> & { journalDate?: string };

const isHeadlineItem = (value: unknown): value is LegacyHeadlineItem => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Partial<LegacyHeadlineItem>;
  return Boolean(
    typeof record.id === "string" &&
      (record.journalDate === undefined || typeof record.journalDate === "string") &&
      typeof record.title === "string" &&
      typeof record.source === "string" &&
      typeof record.url === "string" &&
      typeof record.active === "boolean" &&
      typeof record.createdAt === "string" &&
      typeof record.updatedAt === "string"
  );
};

const inferHeadlineTradeDate = (item: LegacyHeadlineItem, fallbackTradeDate: string): string => {
  const explicitTradeDate = normalizeTradeDate(item.journalDate ?? "");
  if (explicitTradeDate) {
    return explicitTradeDate;
  }

  const createdTradeDate = normalizeTradeDate(item.createdAt);
  if (createdTradeDate) {
    return createdTradeDate;
  }

  const updatedTradeDate = normalizeTradeDate(item.updatedAt);
  if (updatedTradeDate) {
    return updatedTradeDate;
  }

  return normalizeTradeDate(fallbackTradeDate) || fallbackTradeDate.trim();
};

const normalizeHeadlineItem = (item: LegacyHeadlineItem, tradeDate: string): HeadlineItem => ({
  ...item,
  journalDate: inferHeadlineTradeDate(item, tradeDate),
  title: item.title.trim(),
  source: item.source.trim(),
  url: sanitizeHeadlineUrl(item.url) ?? item.url.trim(),
  ticker: item.ticker?.trim() || undefined
});

const normalizeHeadlineList = (items: unknown[], fallbackTradeDate: string): HeadlineItem[] =>
  items.filter(isHeadlineItem).map((item) => normalizeHeadlineItem(item, fallbackTradeDate));

const getHeadlineDateSignal = (item: HeadlineItem): string =>
  normalizeTradeDate(item.createdAt) || normalizeTradeDate(item.updatedAt);

const repairBucketTradeDate = (tradeDate: string, items: HeadlineItem[]): HeadlineItem[] => {
  const normalizedTradeDate = normalizeTradeDate(tradeDate) || tradeDate.trim();
  if (!normalizedTradeDate || items.length === 0) {
    return items;
  }

  const signalDates = items.map((item) => getHeadlineDateSignal(item));
  if (signalDates.some((signalDate) => signalDate === normalizedTradeDate)) {
    return items;
  }

  const uniqueSignalDates = Array.from(new Set(signalDates.filter(Boolean)));
  if (uniqueSignalDates.length !== 1) {
    return items;
  }

  const [signalTradeDate] = uniqueSignalDates;
  if (!signalTradeDate || signalTradeDate >= normalizedTradeDate) {
    return items;
  }

  return items.map((item, index) => {
    const explicitTradeDate = normalizeTradeDate(item.journalDate ?? "");
    if (signalDates[index] !== signalTradeDate) {
      return item;
    }

    if (explicitTradeDate && explicitTradeDate !== normalizedTradeDate) {
      return item;
    }

    return {
      ...item,
      journalDate: signalTradeDate
    };
  });
};

const choosePreferredHeadline = (existing: HeadlineItem, candidate: HeadlineItem): HeadlineItem => {
  const existingDateSignal = getHeadlineDateSignal(existing);
  const candidateDateSignal = getHeadlineDateSignal(candidate);
  const existingMatchesSignal = Boolean(existingDateSignal) && existing.journalDate === existingDateSignal;
  const candidateMatchesSignal = Boolean(candidateDateSignal) && candidate.journalDate === candidateDateSignal;

  if (existingMatchesSignal !== candidateMatchesSignal) {
    return candidateMatchesSignal ? candidate : existing;
  }

  if (candidate.updatedAt !== existing.updatedAt) {
    return candidate.updatedAt.localeCompare(existing.updatedAt) >= 0 ? candidate : existing;
  }

  const existingCompleteness = existing.title.length + existing.source.length + existing.url.length + (existing.ticker?.length ?? 0);
  const candidateCompleteness =
    candidate.title.length + candidate.source.length + candidate.url.length + (candidate.ticker?.length ?? 0);

  return candidateCompleteness >= existingCompleteness ? candidate : existing;
};

const upsertGroupedHeadline = (grouped: HeadlinesByTradeDate, item: HeadlineItem): void => {
  const current = grouped[item.journalDate] ?? [];
  const existingIndex = current.findIndex((entry) => entry.id === item.id);

  if (existingIndex === -1) {
    grouped[item.journalDate] = [...current, item];
    return;
  }

  const existing = current[existingIndex];
  const replacement = item.updatedAt.localeCompare(existing.updatedAt) >= 0 ? item : existing;
  grouped[item.journalDate] = current.map((entry, index) => (index === existingIndex ? replacement : entry));
};

const normalizeHeadlinesRecord = (value: Partial<HeadlinesByTradeDate>): HeadlinesByTradeDate => {
  const dedupedById = new Map<string, HeadlineItem>();

  for (const [tradeDate, items] of Object.entries(value)) {
    if (!Array.isArray(items)) {
      continue;
    }

    const normalizedItems = repairBucketTradeDate(tradeDate, normalizeHeadlineList(items, tradeDate));
    for (const item of normalizedItems) {
      const existing = dedupedById.get(item.id);
      dedupedById.set(item.id, existing ? choosePreferredHeadline(existing, item) : item);
    }
  }

  const grouped: HeadlinesByTradeDate = {};
  for (const item of dedupedById.values()) {
    upsertGroupedHeadline(grouped, item);
  }

  return grouped;
};

const loadRawHeadlines = (): unknown => {
  return syncStores.headlines.load<unknown>(null);
};

const hasHeadlines = (value: HeadlinesByTradeDate): boolean =>
  Object.values(value).some((items) => Array.isArray(items) && items.length > 0);

export const persistHeadlinesRecord = async (record: HeadlinesByTradeDate): Promise<HeadlinesByTradeDate> => {
  const normalizedRecord = normalizeHeadlinesRecord(record);
  const syncPromise = syncStores.headlines.save(normalizedRecord);
  const activeUserId = syncStores.headlines.getUserId();

  if (canUseMachineLegacyData(activeUserId)) {
    try {
      await saveDesktopStoreBackup("headlines", normalizedRecord);
    } catch (error) {
      console.warn("[headlines] Failed to save desktop headlines backup.", error);
    }
  }

  await syncPromise;
  return normalizedRecord;
};

export const recoverHeadlinesFromDesktopBackup = async (): Promise<HeadlinesByTradeDate | null> => {
  const activeUserId = syncStores.headlines.getUserId();
  if (!canUseMachineLegacyData(activeUserId)) {
    return null;
  }

  const localRecord = normalizeHeadlinesRecord((loadRawHeadlines() ?? {}) as Partial<HeadlinesByTradeDate>);
  if (hasHeadlines(localRecord)) {
    return null;
  }

  const desktopRecord = normalizeHeadlinesRecord(
    ((await loadDesktopStoreBackup<HeadlinesByTradeDate>("headlines")) ?? {}) as Partial<HeadlinesByTradeDate>
  );
  if (!hasHeadlines(desktopRecord)) {
    return null;
  }

  await persistHeadlinesRecord(desktopRecord);
  return desktopRecord;
};

export const repairStoredHeadlineBuckets = async (): Promise<boolean> => {
  const parsed = loadRawHeadlines();
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    return false;
  }

  const rawRecord = parsed as Partial<HeadlinesByTradeDate>;
  const normalizedRecord = normalizeHeadlinesRecord(rawRecord);
  if (stableStringify(rawRecord) === stableStringify(normalizedRecord)) {
    return false;
  }

  await persistHeadlinesRecord(normalizedRecord);
  return true;
};

export const loadHeadlinesForTradeDate = (tradeDate: string): HeadlineItem[] => {
  const normalizedTradeDate = normalizeTradeDate(tradeDate) || tradeDate.trim();
  const parsed = loadRawHeadlines();
  if (!parsed) {
    return [];
  }

  if (Array.isArray(parsed)) {
    const grouped = normalizeHeadlinesRecord({ [normalizedTradeDate]: parsed });
    return grouped[normalizedTradeDate] ?? [];
  }

  if (typeof parsed !== "object") {
    return [];
  }

  const record = normalizeHeadlinesRecord(parsed as Partial<HeadlinesByTradeDate>);
  return record[normalizedTradeDate] ?? [];
};

export const migrateLegacyHeadlinesToTradeDate = async (tradeDate: string): Promise<HeadlineItem[] | null> => {
  const normalizedTradeDate = normalizeTradeDate(tradeDate) || tradeDate.trim();
  const parsed = loadRawHeadlines();
  if (!Array.isArray(parsed)) {
    return null;
  }

  const migrated = normalizeHeadlinesRecord({ [normalizedTradeDate]: parsed });

  await persistHeadlinesRecord(migrated);
  return migrated[normalizedTradeDate] ?? [];
};

export const saveHeadlinesForTradeDate = async (tradeDate: string, items: HeadlineItem[]): Promise<void> => {
  const normalizedTradeDate = normalizeTradeDate(tradeDate) || tradeDate.trim();
  const parsed = loadRawHeadlines();
  const normalizedItems = items.map((item) => normalizeHeadlineItem(item, normalizedTradeDate));

  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    const next: HeadlinesByTradeDate = { [normalizedTradeDate]: normalizedItems };
    await persistHeadlinesRecord(next);
    return;
  }

  const record = normalizeHeadlinesRecord(parsed as Partial<HeadlinesByTradeDate>);
  const next: HeadlinesByTradeDate = { ...record, [normalizedTradeDate]: normalizedItems };
  await persistHeadlinesRecord(next);
};
