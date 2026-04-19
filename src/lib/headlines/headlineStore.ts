import type { HeadlineItem } from "../../types/headline";
import { syncStores } from "../sync/syncStore";

const STORAGE_KEY = "trade-engine-headlines";

export type HeadlinesByTradeDate = Record<string, HeadlineItem[]>;

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

const normalizeHeadlineItem = (item: LegacyHeadlineItem, tradeDate: string): HeadlineItem => ({
  ...item,
  journalDate: tradeDate,
  title: item.title.trim(),
  source: item.source.trim(),
  url: sanitizeHeadlineUrl(item.url) ?? item.url.trim(),
  ticker: item.ticker?.trim() || undefined
});

const normalizeHeadlineList = (items: unknown[], fallbackTradeDate: string): HeadlineItem[] =>
  items.filter(isHeadlineItem).map((item) => normalizeHeadlineItem(item, fallbackTradeDate));

const loadRawHeadlines = (): unknown => {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
};

export const loadHeadlinesForTradeDate = (tradeDate: string): HeadlineItem[] => {
  const parsed = loadRawHeadlines();
  if (!parsed) {
    return [];
  }

  if (Array.isArray(parsed)) {
    return normalizeHeadlineList(parsed, tradeDate);
  }

  if (typeof parsed !== "object") {
    return [];
  }

  const record = parsed as Partial<HeadlinesByTradeDate>;
  const items = record[tradeDate];
  if (!Array.isArray(items)) {
    return [];
  }

  return normalizeHeadlineList(items, tradeDate);
};

export const migrateLegacyHeadlinesToTradeDate = async (tradeDate: string): Promise<HeadlineItem[] | null> => {
  const parsed = loadRawHeadlines();
  if (!Array.isArray(parsed)) {
    return null;
  }

  const items = normalizeHeadlineList(parsed, tradeDate);
  const migrated: HeadlinesByTradeDate = {
    [tradeDate]: items
  };

  await syncStores.headlines.save(migrated);
  return items;
};

export const saveHeadlinesForTradeDate = async (tradeDate: string, items: HeadlineItem[]): Promise<void> => {
  const parsed = loadRawHeadlines();
  const normalizedItems = items.map((item) => normalizeHeadlineItem(item, tradeDate));

  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    const next: HeadlinesByTradeDate = { [tradeDate]: normalizedItems };
    await syncStores.headlines.save(next);
    return;
  }

  const record = parsed as HeadlinesByTradeDate;
  const next: HeadlinesByTradeDate = { ...record, [tradeDate]: normalizedItems };
  await syncStores.headlines.save(next);
};
