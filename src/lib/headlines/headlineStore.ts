import type { HeadlineItem } from "../../types/headline";

const STORAGE_KEY = "trade-engine-headlines";

const isHeadlineItem = (value: unknown): value is HeadlineItem => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Partial<HeadlineItem>;
  return Boolean(
    typeof record.id === "string" &&
      typeof record.title === "string" &&
      typeof record.source === "string" &&
      typeof record.url === "string" &&
      typeof record.active === "boolean" &&
      typeof record.createdAt === "string" &&
      typeof record.updatedAt === "string"
  );
};

export const loadHeadlines = (): HeadlineItem[] => {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(isHeadlineItem).map((item) => ({
      ...item,
      title: item.title.trim(),
      source: item.source.trim(),
      url: item.url.trim(),
      ticker: item.ticker?.trim() || undefined
    }));
  } catch {
    return [];
  }
};

export const saveHeadlines = (items: HeadlineItem[]): void => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
};

