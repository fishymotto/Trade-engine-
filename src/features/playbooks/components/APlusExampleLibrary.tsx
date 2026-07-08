import { useEffect, useMemo, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { JournalRichTextEditor } from "../../journal/components/JournalRichTextEditor";
import { WorkspaceIcon } from "../../../components/WorkspaceIcon";
import { createEmptyJournalDoc, hasJournalDocContent } from "../../../lib/journal/journalContent";
import {
  addPlaybookAPlusExample,
  removePlaybookAPlusExample,
  updatePlaybookAPlusExample
} from "../../../lib/playbooks/playbookStore";
import {
  deletePlaybookAttachment,
  pickAndSavePlaybookAttachment,
  resolvePlaybookAttachmentSrc
} from "../../../lib/playbooks/playbookAttachmentClient";
import {
  collectWorkspaceAttachmentPaths,
  saveWorkspaceInlineImage
} from "../../../lib/workspace/workspaceAttachmentClient";
import type {
  PlaybookExampleRating,
  PlaybookExampleTradeSnapshot,
  PlaybookRecord
} from "../../../types/playbook";
import type { JournalPageRecord, JournalScreenshotTradeLink, JournalTradeNoteRecord } from "../../../types/journal";
import type { GroupedTrade } from "../../../types/trade";

type ExampleRecord = PlaybookRecord["aPlusExamples"][number];
type APlusExampleSort = "date-desc" | "date-asc" | "rating-desc" | "pnl-desc" | "pnl-asc";

const ratingOptions: PlaybookExampleRating[] = ["A+", "A", "B+"];
const eligibleGameTags = new Set(["A Game", "B+ Game"]);
const MAX_DISMISSED_TRADE_IDS = 400;
const TRADE_LINK_SEPARATOR = "::";

const getSyncedExampleRating = (trade: GroupedTrade): PlaybookExampleRating | null => {
  if (trade.game === "A Game") {
    return "A+";
  }
  if (trade.game === "B+ Game") {
    return "B+";
  }
  return null;
};

const createExampleId = (): string => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `example-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const formatSignedMoney = (value: number): string =>
  `${value >= 0 ? "+" : "-"}$${Math.abs(value).toFixed(2)}`;

const formatCurrency = (value: number): string => `$${Math.abs(value).toFixed(2)}`;
const formatMoney = (value: number): string => `$${value.toFixed(2)}`;

const formatPrice = (value: number): string => {
  if (!Number.isFinite(value)) {
    return "-";
  }
  return `$${value.toFixed(Math.abs(value) >= 100 ? 2 : 4)}`;
};

const formatSize = (value: number): string =>
  Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "-";

const formatSignedPerShare = (value: number): string =>
  `${value >= 0 ? "+" : "-"}$${Math.abs(value).toFixed(4)}`;

const getSignedValueClassName = (value: number): "positive-value" | "negative-value" =>
  value >= 0 ? "positive-value" : "negative-value";
const getHoldLabel = (trade: GroupedTrade): string => {
  const trimmedHoldTime = trade.holdTime.trim();
  if (trimmedHoldTime.length > 0) {
    return trimmedHoldTime;
  }
  return `${Math.max(0, Math.round(trade.holdSeconds / 60))}m`;
};
const toSafeText = (value: unknown): string => (typeof value === "string" ? value : "");
const toSafeArray = <T,>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);
const toSafeNumber = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);
const isExampleRating = (value: unknown): value is PlaybookExampleRating =>
  value === "A+" || value === "A" || value === "B+";

const getExampleRatingRank = (rating: PlaybookExampleRating): number => {
  switch (rating) {
    case "A+":
      return 3;
    case "A":
      return 2;
    case "B+":
      return 1;
  }
};

const normalizeSnapshotSetups = (value: unknown): string[] =>
  toSafeArray<string>(value)
    .map((entry) => toSafeText(entry).trim())
    .filter((entry) => entry.length > 0);

const createTradeSnapshot = (trade: GroupedTrade): PlaybookExampleTradeSnapshot => {
  const openingExecutions = toSafeArray<unknown>(trade.openingExecutions);
  const closingExecutions = toSafeArray<unknown>(trade.closingExecutions);
  const addSignals = toSafeArray<{ averagedDown?: boolean; addedToWinner?: boolean }>(trade.addSignals);
  const setups = normalizeSnapshotSetups(trade.setups);

  return {
    name: toSafeText(trade.name),
    tradeDate: toSafeText(trade.tradeDate),
    symbol: toSafeText(trade.symbol),
    side: toSafeText(trade.side),
    status: toSafeText(trade.status),
    game: toSafeText(trade.game),
    setup: setups[0] ?? "",
    setups,
    openTime: toSafeText(trade.openTime),
    closeTime: toSafeText(trade.closeTime),
    holdTime: toSafeText(trade.holdTime),
    holdSeconds: toSafeNumber(trade.holdSeconds),
    size: toSafeNumber(trade.size),
    entryPrice: toSafeNumber(trade.entryPrice),
    exitPrice: toSafeNumber(trade.exitPrice),
    netPnlUsd: toSafeNumber(trade.netPnlUsd),
    returnPerShare: toSafeNumber(trade.returnPerShare),
    feesUsd: toSafeNumber(trade.feesUsd),
    executionCount: openingExecutions.length + closingExecutions.length,
    addCount: addSignals.length,
    averagedDownCount: addSignals.filter((signal) => Boolean(signal?.averagedDown)).length,
    addedToWinnerCount: addSignals.filter((signal) => Boolean(signal?.addedToWinner)).length
  };
};

const normalizeTradeSnapshot = (value: unknown): PlaybookExampleTradeSnapshot | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const snapshot: PlaybookExampleTradeSnapshot = {
    name: toSafeText(record.name),
    tradeDate: toSafeText(record.tradeDate),
    symbol: toSafeText(record.symbol),
    side: toSafeText(record.side),
    status: toSafeText(record.status),
    game: toSafeText(record.game),
    setup: toSafeText(record.setup),
    setups: normalizeSnapshotSetups(record.setups),
    openTime: toSafeText(record.openTime),
    closeTime: toSafeText(record.closeTime),
    holdTime: toSafeText(record.holdTime),
    holdSeconds: toSafeNumber(record.holdSeconds),
    size: toSafeNumber(record.size),
    entryPrice: toSafeNumber(record.entryPrice),
    exitPrice: toSafeNumber(record.exitPrice),
    netPnlUsd: toSafeNumber(record.netPnlUsd),
    returnPerShare: toSafeNumber(record.returnPerShare),
    feesUsd: toSafeNumber(record.feesUsd),
    executionCount: toSafeNumber(record.executionCount),
    addCount: toSafeNumber(record.addCount),
    averagedDownCount: toSafeNumber(record.averagedDownCount),
    addedToWinnerCount: toSafeNumber(record.addedToWinnerCount)
  };

  if (!snapshot.name && !snapshot.symbol && !snapshot.tradeDate) {
    return null;
  }

  if (!snapshot.setup && snapshot.setups.length > 0) {
    snapshot.setup = snapshot.setups[0];
  }

  return snapshot;
};

const areTradeSnapshotsEqual = (
  left: PlaybookExampleTradeSnapshot | null | undefined,
  right: PlaybookExampleTradeSnapshot | null | undefined
): boolean => JSON.stringify(left ?? null) === JSON.stringify(right ?? null);

const getSnapshotSetupLabel = (
  snapshot: PlaybookExampleTradeSnapshot | null | undefined,
  fallback: string
): string =>
  snapshot?.setup ||
  snapshot?.setups.find((candidate) => candidate.trim().length > 0) ||
  fallback;

const getSnapshotHoldLabel = (snapshot: PlaybookExampleTradeSnapshot): string => {
  const trimmedHoldTime = snapshot.holdTime.trim();
  if (trimmedHoldTime.length > 0) {
    return trimmedHoldTime;
  }
  return `${Math.max(0, Math.round(snapshot.holdSeconds / 60))}m`;
};

const normalizeExampleRecord = (entry: unknown): ExampleRecord | null => {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const now = new Date().toISOString();
  const record = entry as Record<string, unknown>;
  return {
    id: toSafeText(record.id) || createExampleId(),
    tradeId: toSafeText(record.tradeId),
    tradeDate: toSafeText(record.tradeDate),
    rating: isExampleRating(record.rating) ? record.rating : "A+",
    tradeSnapshot: normalizeTradeSnapshot(record.tradeSnapshot),
    notes: hasJournalDocContent(record.notes as Parameters<typeof hasJournalDocContent>[0])
      ? (record.notes as ExampleRecord["notes"])
      : createEmptyJournalDoc(),
    screenshotPaths: toSafeArray<string>(record.screenshotPaths)
      .map((value) => toSafeText(value))
      .filter((value) => value.length > 0),
    recordingPath: toSafeText(record.recordingPath),
    createdAt: toSafeText(record.createdAt) || now,
    updatedAt: toSafeText(record.updatedAt) || now
  };
};

const parseSortableDate = (value: string): number | null => {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Date.parse(trimmed);
  return Number.isNaN(parsed) ? null : parsed;
};

const compareDateStrings = (leftValue: string, rightValue: string): number => {
  const leftParsed = parseSortableDate(leftValue);
  const rightParsed = parseSortableDate(rightValue);
  if (leftParsed !== null && rightParsed !== null && leftParsed !== rightParsed) {
    return leftParsed - rightParsed;
  }
  if (leftValue !== rightValue) {
    return leftValue.localeCompare(rightValue);
  }
  return 0;
};

const toComparableScreenshotPath = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed.startsWith("data:")) {
    return trimmed;
  }

  let normalized = trimmed;
  try {
    const url = new URL(normalized);
    if (url.pathname) {
      normalized = url.pathname;
    }
  } catch {
    // Keep raw string when value is not a URL.
  }

  if (normalized.includes("?")) {
    normalized = normalized.split("?")[0] ?? normalized;
  }
  if (normalized.includes("#")) {
    normalized = normalized.split("#")[0] ?? normalized;
  }

  try {
    normalized = decodeURIComponent(normalized);
  } catch {
    // Keep original when decode fails.
  }

  return normalized.replace(/\\/g, "/").toLowerCase();
};

const mergeScreenshotPaths = (primary: string[], secondary: string[]): string[] => {
  const merged: string[] = [];
  const seen = new Set<string>();
  for (const path of [...primary, ...secondary]) {
    const comparable = toComparableScreenshotPath(path);
    if (!comparable || seen.has(comparable)) {
      continue;
    }
    seen.add(comparable);
    merged.push(path);
  }
  return merged;
};

const hasScreenshotPathOverlap = (left: string[], right: string[]): boolean => {
  if (left.length === 0 || right.length === 0) {
    return false;
  }
  const rightComparable = new Set(right.map((value) => toComparableScreenshotPath(value)).filter(Boolean));
  return left.some((value) => rightComparable.has(toComparableScreenshotPath(value)));
};

const parseDismissedTradeIds = (raw: string | null): string[] => {
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  } catch {
    return [];
  }
};

const pruneDismissedTradeIds = (value: string[]): string[] => {
  const unique = Array.from(new Set(value.map((item) => item.trim()).filter((item) => item.length > 0)));
  if (unique.length <= MAX_DISMISSED_TRADE_IDS) {
    return unique;
  }
  return unique.slice(unique.length - MAX_DISMISSED_TRADE_IDS);
};

const serializeTradeLink = (tradeId: string, tradeDate: string): string =>
  tradeId && tradeDate ? `${tradeId}${TRADE_LINK_SEPARATOR}${tradeDate}` : "";

const dedupeTradeLinks = (links: JournalScreenshotTradeLink[]): JournalScreenshotTradeLink[] => {
  const unique = new Map<string, JournalScreenshotTradeLink>();
  for (const link of links) {
    const tradeId = toSafeText(link.tradeId).trim();
    const tradeDate = toSafeText(link.tradeDate).trim();
    if (!tradeId || !tradeDate) {
      continue;
    }

    unique.set(serializeTradeLink(tradeId, tradeDate), { tradeId, tradeDate });
  }

  return Array.from(unique.values());
};

const collectTradeNoteLinks = (note: JournalTradeNoteRecord): JournalScreenshotTradeLink[] =>
  dedupeTradeLinks([
    ...(Array.isArray(note.linkedTrades) ? note.linkedTrades : []),
    ...(note.linkedTradeId?.trim() && note.linkedTradeDate?.trim()
      ? [
          {
            tradeId: note.linkedTradeId.trim(),
            tradeDate: note.linkedTradeDate.trim()
          }
        ]
      : [])
  ]);

const extractJournalDocText = (content: unknown): string => {
  const parts: string[] = [];
  const visit = (node: unknown) => {
    if (!node || typeof node !== "object") {
      return;
    }

    const record = node as { text?: unknown; content?: unknown };
    if (typeof record.text === "string" && record.text.trim().length > 0) {
      parts.push(record.text.trim());
    }

    if (Array.isArray(record.content)) {
      for (const child of record.content) {
        visit(child);
      }
    }
  };

  visit(content);
  return parts.join(" ").replace(/\s+/g, " ").trim();
};

const truncateText = (value: string, maxLength: number): string => {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  return `${trimmed.slice(0, maxLength).trim()}...`;
};

const formatListValue = (values: string[], fallback = "-"): string => {
  const cleaned = values.map((value) => value.trim()).filter((value) => value.length > 0);
  return cleaned.length > 0 ? cleaned.join(", ") : fallback;
};

const pickPreferredTradeNote = (
  current: { note: JournalTradeNoteRecord; page: JournalPageRecord } | undefined,
  next: { note: JournalTradeNoteRecord; page: JournalPageRecord }
): { note: JournalTradeNoteRecord; page: JournalPageRecord } => {
  if (!current) {
    return next;
  }

  const currentHasContent = hasJournalDocContent(current.note.content);
  const nextHasContent = hasJournalDocContent(next.note.content);
  if (currentHasContent !== nextHasContent) {
    return nextHasContent ? next : current;
  }

  return toSafeText(next.note.updatedAt).localeCompare(toSafeText(current.note.updatedAt)) > 0 ? next : current;
};

const readFileAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }

      reject(new Error("File could not be read."));
    };
    reader.onerror = () => reject(reader.error ?? new Error("File could not be read."));
    reader.readAsDataURL(file);
  });

interface APlusExampleLibraryProps {
  playbook: PlaybookRecord;
  matchedTrades: GroupedTrade[];
  allTrades?: GroupedTrade[];
  journalPages?: JournalPageRecord[];
  tickerFilter?: string;
  taggedCharts: {
    screenshotUrl: string;
    linkedTrades: GroupedTrade[];
  }[];
  onSelectTrade: (tradeId: string, tradeDate: string) => void;
  onOpenJournalDate?: (tradeDate: string) => void;
  onExpandImage: (src: string) => void;
  setPlaybooks: React.Dispatch<React.SetStateAction<PlaybookRecord[]>>;
}

export const APlusExampleLibrary = ({
  playbook,
  matchedTrades,
  allTrades,
  journalPages = [],
  tickerFilter = "all",
  taggedCharts,
  onSelectTrade,
  onOpenJournalDate,
  onExpandImage,
  setPlaybooks
}: APlusExampleLibraryProps) => {
  const dismissedTradeIdsStorageKey = `playbook-aplus-dismissed:${playbook.id}`;
  const normalizedTickerFilter = toSafeText(tickerFilter).trim().toUpperCase();
  const isTickerFiltered = normalizedTickerFilter.length > 0 && normalizedTickerFilter !== "ALL";
  const aPlusExamples = useMemo(() => {
    const candidates = toSafeArray<unknown>(playbook.aPlusExamples);
    return candidates
      .map((entry) => normalizeExampleRecord(entry))
      .filter((entry): entry is ExampleRecord => entry !== null);
  }, [playbook.aPlusExamples]);
  const [pendingAttachmentExampleId, setPendingAttachmentExampleId] = useState("");
  const [pendingAttachmentKind, setPendingAttachmentKind] = useState<"screenshot" | "recording">(
    "screenshot"
  );
  const [dismissedTradeIds, setDismissedTradeIds] = useState<string[]>([]);
  const [exampleSearchQuery, setExampleSearchQuery] = useState("");
  const [exampleSort, setExampleSort] = useState<APlusExampleSort>("date-desc");
  const [relinkFeedbackByExampleId, setRelinkFeedbackByExampleId] = useState<Record<string, string>>({});
  const [expandedExampleIds, setExpandedExampleIds] = useState<string[]>([]);
  const screenshotInputRef = useRef<HTMLInputElement | null>(null);
  const dismissedTradeIdSet = useMemo(() => new Set(dismissedTradeIds), [dismissedTradeIds]);
  const expandedExampleIdSet = useMemo(() => new Set(expandedExampleIds), [expandedExampleIds]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      const nextDismissedTradeIds = pruneDismissedTradeIds(
        parseDismissedTradeIds(window.localStorage.getItem(dismissedTradeIdsStorageKey))
      );
      setDismissedTradeIds(nextDismissedTradeIds);
    } catch {
      setDismissedTradeIds([]);
    }
  }, [dismissedTradeIdsStorageKey]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const pruned = pruneDismissedTradeIds(dismissedTradeIds);
    try {
      window.localStorage.setItem(dismissedTradeIdsStorageKey, JSON.stringify(pruned));
    } catch {
      // Never let storage quota errors crash rendering.
      try {
        window.localStorage.removeItem(dismissedTradeIdsStorageKey);
      } catch {
        // Ignore cleanup failures.
      }
    }
  }, [dismissedTradeIds, dismissedTradeIdsStorageKey]);

  const tradeLookupTrades = allTrades ?? matchedTrades;
  const tradeById = useMemo(() => {
    const lookup = new Map<string, GroupedTrade>();
    for (const trade of tradeLookupTrades) {
      lookup.set(trade.id, trade);
    }
    for (const trade of matchedTrades) {
      lookup.set(trade.id, trade);
    }
    return lookup;
  }, [matchedTrades, tradeLookupTrades]);

  const tradeNoteLookup = useMemo(() => {
    const byLink = new Map<string, { note: JournalTradeNoteRecord; page: JournalPageRecord }>();
    const byTradeId = new Map<string, { note: JournalTradeNoteRecord; page: JournalPageRecord }>();
    for (const page of journalPages) {
      const tradeNotes = Array.isArray(page.tradeNotes) ? page.tradeNotes : [];
      for (const note of tradeNotes) {
        for (const link of collectTradeNoteLinks(note)) {
          const key = serializeTradeLink(link.tradeId, link.tradeDate);
          const preferred = pickPreferredTradeNote(byLink.get(key), { note, page });
          byLink.set(key, preferred);
          byTradeId.set(link.tradeId, pickPreferredTradeNote(byTradeId.get(link.tradeId), preferred));
        }
      }
    }

    return { byLink, byTradeId };
  }, [journalPages]);

  const autoExampleScreenshotsByTrade = useMemo(() => {
    const grouped = new Map<string, { trade: GroupedTrade; screenshotPaths: string[] }>();
    for (const chart of taggedCharts) {
      const screenshotPath = chart.screenshotUrl;
      if (!screenshotPath) {
        continue;
      }

      for (const trade of chart.linkedTrades) {
        if (!eligibleGameTags.has(trade.game)) {
          continue;
        }

        const current = grouped.get(trade.id);
        if (current) {
          if (!current.screenshotPaths.includes(screenshotPath)) {
            current.screenshotPaths.push(screenshotPath);
          }
          continue;
        }

        grouped.set(trade.id, {
          trade,
          screenshotPaths: [screenshotPath]
        });
      }
    }

    return grouped;
  }, [taggedCharts]);

  const eligibleTrades = useMemo(
    () =>
      matchedTrades
        .filter((trade) => eligibleGameTags.has(trade.game))
        .sort(
          (left, right) =>
            toSafeText(right.tradeDate).localeCompare(toSafeText(left.tradeDate)) ||
            toSafeText(left.openTime).localeCompare(toSafeText(right.openTime))
        ),
    [matchedTrades]
  );

  const existingTradeIds = useMemo(
    () => new Set(aPlusExamples.map((entry) => entry.tradeId)),
    [aPlusExamples]
  );

  const availableEligibleTrades = useMemo(
    () => eligibleTrades.filter((trade) => !existingTradeIds.has(trade.id)),
    [eligibleTrades, existingTradeIds]
  );

  const visibleExamples = useMemo(() => {
    const normalizedQuery = exampleSearchQuery.trim().toLowerCase();
    const filtered = aPlusExamples.filter((entry) => {
      const trade = tradeById.get(entry.tradeId);
      const snapshot = trade ? createTradeSnapshot(trade) : entry.tradeSnapshot;
      const linkedNote =
        tradeNoteLookup.byLink.get(serializeTradeLink(entry.tradeId, trade?.tradeDate || entry.tradeDate)) ??
        tradeNoteLookup.byTradeId.get(entry.tradeId);
      const entryTicker = toSafeText(trade?.symbol || snapshot?.symbol || linkedNote?.note.ticker).trim().toUpperCase();

      if (isTickerFiltered && entryTicker !== normalizedTickerFilter) {
        return false;
      }

      if (!normalizedQuery) {
        return true;
      }

      const searchTokens = [
        trade?.name ?? "",
        trade?.symbol ?? "",
        trade?.tradeDate ?? "",
        snapshot?.name ?? "",
        snapshot?.symbol ?? "",
        snapshot?.tradeDate ?? "",
        snapshot?.setup ?? "",
        entry.tradeDate,
        entry.rating,
        trade?.status ?? "",
        trade?.side ?? "",
        trade?.game ?? "",
        snapshot?.status ?? "",
        snapshot?.side ?? "",
        snapshot?.game ?? "",
        ...(trade?.setups ?? []),
        ...(snapshot?.setups ?? [])
      ];
      return searchTokens.join(" ").toLowerCase().includes(normalizedQuery);
    });

    const getEntrySnapshot = (entry: ExampleRecord): PlaybookExampleTradeSnapshot | null => {
      const trade = tradeById.get(entry.tradeId);
      return trade ? createTradeSnapshot(trade) : entry.tradeSnapshot ?? null;
    };
    const getEntryDate = (entry: ExampleRecord): string => getEntrySnapshot(entry)?.tradeDate || entry.tradeDate || "";
    const getEntryPnl = (entry: ExampleRecord): number | null => getEntrySnapshot(entry)?.netPnlUsd ?? null;

    const compareNewestFirst = (leftEntry: ExampleRecord, rightEntry: ExampleRecord): number => {
      const dateComparison = compareDateStrings(getEntryDate(leftEntry), getEntryDate(rightEntry));
      if (dateComparison !== 0) {
        return -dateComparison;
      }

      const updatedAtComparison = compareDateStrings(leftEntry.updatedAt, rightEntry.updatedAt);
      if (updatedAtComparison !== 0) {
        return -updatedAtComparison;
      }

      return leftEntry.id.localeCompare(rightEntry.id);
    };

    const compareOldestFirst = (leftEntry: ExampleRecord, rightEntry: ExampleRecord): number => {
      const dateComparison = compareDateStrings(getEntryDate(leftEntry), getEntryDate(rightEntry));
      if (dateComparison !== 0) {
        return dateComparison;
      }

      const updatedAtComparison = compareDateStrings(leftEntry.updatedAt, rightEntry.updatedAt);
      if (updatedAtComparison !== 0) {
        return updatedAtComparison;
      }

      return leftEntry.id.localeCompare(rightEntry.id);
    };

    const comparePnl = (leftEntry: ExampleRecord, rightEntry: ExampleRecord, direction: "asc" | "desc"): number => {
      const leftPnl = getEntryPnl(leftEntry);
      const rightPnl = getEntryPnl(rightEntry);
      const leftMissing = leftPnl === null;
      const rightMissing = rightPnl === null;

      if (leftMissing || rightMissing) {
        if (leftMissing && rightMissing) {
          return 0;
        }
        return leftMissing ? 1 : -1;
      }

      return direction === "asc" ? leftPnl - rightPnl : rightPnl - leftPnl;
    };

    return filtered.sort((left, right) => {
      switch (exampleSort) {
        case "date-asc":
          return compareOldestFirst(left, right);
        case "rating-desc": {
          const ratingComparison = getExampleRatingRank(right.rating) - getExampleRatingRank(left.rating);
          return ratingComparison || compareNewestFirst(left, right);
        }
        case "pnl-desc": {
          const pnlComparison = comparePnl(left, right, "desc");
          return pnlComparison || compareNewestFirst(left, right);
        }
        case "pnl-asc": {
          const pnlComparison = comparePnl(left, right, "asc");
          return pnlComparison || compareNewestFirst(left, right);
        }
        case "date-desc":
          return compareNewestFirst(left, right);
      }
      return compareNewestFirst(left, right);
    });
  }, [
    aPlusExamples,
    exampleSearchQuery,
    exampleSort,
    isTickerFiltered,
    normalizedTickerFilter,
    tradeById,
    tradeNoteLookup
  ]);

  const createExampleInlineImageInsertHandler = (exampleId: string) => async (file: File) =>
    saveWorkspaceInlineImage({
      category: "playbook-aplus-inline-images",
      recordId: playbook.id,
      slotKey: exampleId,
      file
    });

  useEffect(() => {
    if (autoExampleScreenshotsByTrade.size === 0) {
      return;
    }

    setPlaybooks((current) => {
      const targetPlaybook = current.find((candidate) => candidate.id === playbook.id);
      if (!targetPlaybook) {
        return current;
      }

      const now = new Date().toISOString();
      let hasChanges = false;
      let nextExamples = [...(targetPlaybook.aPlusExamples ?? [])];

      for (const [tradeId, candidate] of autoExampleScreenshotsByTrade) {
        if (candidate.screenshotPaths.length === 0) {
          continue;
        }
        if (dismissedTradeIdSet.has(tradeId)) {
          continue;
        }

        const existingIndex = nextExamples.findIndex((entry) => entry.tradeId === tradeId);
        if (existingIndex >= 0) {
          const trade = tradeById.get(tradeId) ?? candidate.trade;
          let targetIndex = existingIndex;
          const existing = nextExamples[targetIndex];
          let mergedScreenshotPaths = mergeScreenshotPaths(existing.screenshotPaths ?? [], candidate.screenshotPaths);

          // Clean up stale orphan examples that point to the same screenshot(s).
          const orphanIndex = nextExamples.findIndex(
            (entry, index) =>
              index !== targetIndex &&
              !tradeById.has(entry.tradeId) &&
              hasScreenshotPathOverlap(entry.screenshotPaths, mergedScreenshotPaths)
          );
          if (orphanIndex >= 0) {
            const orphan = nextExamples[orphanIndex];
            mergedScreenshotPaths = mergeScreenshotPaths(mergedScreenshotPaths, orphan.screenshotPaths);
            nextExamples.splice(orphanIndex, 1);
            if (orphanIndex < targetIndex) {
              targetIndex -= 1;
            }
            hasChanges = true;
          }

          const syncedRating = getSyncedExampleRating(trade) ?? existing.rating;
          const tradeSnapshot = createTradeSnapshot(trade);
          const shouldUpdateExisting =
            mergedScreenshotPaths.length !== (existing.screenshotPaths ?? []).length ||
            existing.tradeDate !== trade.tradeDate ||
            existing.rating !== syncedRating ||
            !areTradeSnapshotsEqual(existing.tradeSnapshot, tradeSnapshot);
          if (shouldUpdateExisting) {
            nextExamples[targetIndex] = {
              ...existing,
              tradeDate: trade.tradeDate,
              rating: syncedRating,
              tradeSnapshot,
              screenshotPaths: mergedScreenshotPaths,
              updatedAt: now
            };
            hasChanges = true;
          }
          continue;
        }

        let relinkIndex = nextExamples.findIndex(
          (entry) =>
            !tradeById.has(entry.tradeId) &&
            hasScreenshotPathOverlap(entry.screenshotPaths, candidate.screenshotPaths)
        );
        if (relinkIndex < 0) {
          const tradeDateMatches = nextExamples
            .map((entry, index) => ({ entry, index }))
            .filter(
              ({ entry }) =>
                !tradeById.has(entry.tradeId) &&
                entry.tradeDate === candidate.trade.tradeDate
            );
          if (tradeDateMatches.length === 1) {
            relinkIndex = tradeDateMatches[0].index;
          }
        }
        if (relinkIndex >= 0) {
          const trade = tradeById.get(tradeId) ?? candidate.trade;
          const existing = nextExamples[relinkIndex];
          const mergedScreenshotPaths = mergeScreenshotPaths(existing.screenshotPaths ?? [], candidate.screenshotPaths);
          const syncedRating = getSyncedExampleRating(trade) ?? existing.rating;
          nextExamples[relinkIndex] = {
            ...existing,
            tradeId,
            tradeDate: trade.tradeDate,
            rating: syncedRating,
            tradeSnapshot: createTradeSnapshot(trade),
            screenshotPaths: mergedScreenshotPaths,
            updatedAt: now
          };
          hasChanges = true;
          continue;
        }

        const trade = tradeById.get(tradeId) ?? candidate.trade;
        const inferredRating = getSyncedExampleRating(trade) ?? "A+";
        nextExamples = [
          {
            id: createExampleId(),
            tradeId,
            tradeDate: trade.tradeDate,
            rating: inferredRating,
            tradeSnapshot: createTradeSnapshot(trade),
            notes: createEmptyJournalDoc(),
            screenshotPaths: [...candidate.screenshotPaths],
            recordingPath: "",
            createdAt: now,
            updatedAt: now
          },
          ...nextExamples
        ];
        hasChanges = true;
      }

      if (!hasChanges) {
        return current;
      }

      return current.map((candidate) =>
        candidate.id === playbook.id
          ? {
              ...candidate,
              updatedAt: now,
              aPlusExamples: nextExamples
            }
          : candidate
      );
    });
  }, [autoExampleScreenshotsByTrade, dismissedTradeIdSet, playbook.id, setPlaybooks, tradeById]);

  useEffect(() => {
    if (aPlusExamples.length === 0) {
      return;
    }

    setPlaybooks((current) => {
      const targetPlaybook = current.find((candidate) => candidate.id === playbook.id);
      if (!targetPlaybook) {
        return current;
      }

      const now = new Date().toISOString();
      let hasChanges = false;
      const nextExamples = targetPlaybook.aPlusExamples.map((entry) => {
        const trade = tradeById.get(entry.tradeId);
        if (!trade) {
          return entry;
        }

        const syncedRating = getSyncedExampleRating(trade);
        const tradeSnapshot = createTradeSnapshot(trade);
        const currentSnapshot = normalizeTradeSnapshot(entry.tradeSnapshot);
        const shouldUpdateRating = Boolean(syncedRating && entry.rating !== syncedRating);
        const shouldUpdateDate = entry.tradeDate !== trade.tradeDate;
        const shouldUpdateSnapshot = !areTradeSnapshotsEqual(currentSnapshot, tradeSnapshot);
        if (!shouldUpdateRating && !shouldUpdateDate && !shouldUpdateSnapshot) {
          return entry;
        }

        hasChanges = true;
        return {
          ...entry,
          tradeDate: trade.tradeDate,
          rating: syncedRating ?? entry.rating,
          tradeSnapshot,
          updatedAt: now
        };
      });

      if (!hasChanges) {
        return current;
      }

      return current.map((candidate) =>
        candidate.id === playbook.id
          ? {
              ...candidate,
              updatedAt: now,
              aPlusExamples: nextExamples
            }
          : candidate
      );
    });
  }, [aPlusExamples, playbook.id, setPlaybooks, tradeById]);

  const getEntryFromState = (playbooks: PlaybookRecord[], exampleId: string): ExampleRecord | undefined => {
    const entries = playbooks.find((candidate) => candidate.id === playbook.id)?.aPlusExamples;
    return toSafeArray<unknown>(entries)
      .map((entry) => normalizeExampleRecord(entry))
      .find((entry): entry is ExampleRecord => Boolean(entry && entry.id === exampleId));
  };

  const dismissTradeIds = (tradeIds: string[]) => {
    const uniqueIds = Array.from(new Set(tradeIds.filter((value) => value.trim().length > 0)));
    if (uniqueIds.length === 0) {
      return;
    }
    setDismissedTradeIds((current) => pruneDismissedTradeIds([...current, ...uniqueIds]));
  };

  const clearDismissedTradeId = (tradeId: string) => {
    const trimmed = tradeId.trim();
    if (!trimmed) {
      return;
    }
    setDismissedTradeIds((current) => current.filter((value) => value !== trimmed));
  };

  const toggleExampleExpanded = (exampleId: string) => {
    setExpandedExampleIds((current) =>
      current.includes(exampleId)
        ? current.filter((candidate) => candidate !== exampleId)
        : [...current, exampleId]
    );
  };

  const addExampleFromTrade = (trade: GroupedTrade) => {
    clearDismissedTradeId(trade.id);
    const now = new Date().toISOString();
    const example: ExampleRecord = {
      id: createExampleId(),
      tradeId: trade.id,
      tradeDate: trade.tradeDate,
      rating: getSyncedExampleRating(trade) ?? "A+",
      tradeSnapshot: createTradeSnapshot(trade),
      notes: createEmptyJournalDoc(),
      screenshotPaths: [],
      recordingPath: "",
      createdAt: now,
      updatedAt: now
    };

    setPlaybooks((current) => addPlaybookAPlusExample(current, playbook.id, example));
  };

  const pickScreenshot = (exampleId: string) => {
    setPendingAttachmentExampleId(exampleId);
    setPendingAttachmentKind("screenshot");

    if (isTauri()) {
      void pickAndSavePlaybookAttachment(playbook.id, exampleId, "screenshot")
        .then((path) => {
          if (!path) {
            return;
          }
          setPlaybooks((current) => {
            const entry = getEntryFromState(current, exampleId);
            const nextPaths = entry ? [...entry.screenshotPaths, path] : [path];
            return updatePlaybookAPlusExample(current, playbook.id, exampleId, { screenshotPaths: nextPaths });
          });
        })
        .finally(() => setPendingAttachmentExampleId(""));
      return;
    }

    screenshotInputRef.current?.click();
  };

  const pickRecording = (exampleId: string) => {
    setPendingAttachmentExampleId(exampleId);
    setPendingAttachmentKind("recording");

    if (!isTauri()) {
      return;
    }

    const previousRecordingPath =
      aPlusExamples.find((candidate) => candidate.id === exampleId)?.recordingPath ?? "";

    void pickAndSavePlaybookAttachment(playbook.id, exampleId, "recording")
      .then((path) => {
        if (!path) {
          return;
        }

        setPlaybooks((current) =>
          updatePlaybookAPlusExample(current, playbook.id, exampleId, { recordingPath: path })
        );
        if (previousRecordingPath && previousRecordingPath !== path) {
          void deletePlaybookAttachment(previousRecordingPath).catch(() => undefined);
        }
      })
      .finally(() => setPendingAttachmentExampleId(""));
  };

  const removeScreenshot = (exampleId: string, path: string) => {
    if (path && !path.startsWith("data:")) {
      void deletePlaybookAttachment(path).catch(() => undefined);
    }
    setPlaybooks((current) => {
      const entry = getEntryFromState(current, exampleId);
      const nextPaths = entry ? entry.screenshotPaths.filter((candidate) => candidate !== path) : [];
      return updatePlaybookAPlusExample(current, playbook.id, exampleId, { screenshotPaths: nextPaths });
    });
  };

  const clearRecording = (exampleId: string, path: string) => {
    if (path && !path.startsWith("data:")) {
      void deletePlaybookAttachment(path).catch(() => undefined);
    }
    setPlaybooks((current) =>
      updatePlaybookAPlusExample(current, playbook.id, exampleId, { recordingPath: "" })
    );
  };

  const removeExample = (exampleId: string) => {
    const entry = aPlusExamples.find((candidate) => candidate.id === exampleId);
    if (entry) {
      const tradeIdsToDismiss = new Set<string>();
      if (entry.tradeId.trim().length > 0) {
        tradeIdsToDismiss.add(entry.tradeId);
      }

      for (const [tradeId, candidate] of autoExampleScreenshotsByTrade) {
        if (hasScreenshotPathOverlap(entry.screenshotPaths, candidate.screenshotPaths)) {
          tradeIdsToDismiss.add(tradeId);
        }
      }

      for (const attachmentPath of collectWorkspaceAttachmentPaths(entry)) {
        void deletePlaybookAttachment(attachmentPath).catch(() => undefined);
      }

      dismissTradeIds(Array.from(tradeIdsToDismiss));
    }

    setPlaybooks((current) => removePlaybookAPlusExample(current, playbook.id, exampleId));
    setExpandedExampleIds((current) => current.filter((candidate) => candidate !== exampleId));
  };

  const relinkExampleByDate = (entry: ExampleRecord) => {
    const exactDateMatches = Array.from(
      new Map(
        tradeLookupTrades
          .filter((candidate) => candidate.tradeDate === entry.tradeDate)
          .map((candidate) => [candidate.id, candidate])
      ).values()
    );
    if (exactDateMatches.length === 0) {
      setRelinkFeedbackByExampleId((current) => ({
        ...current,
        [entry.id]: `No matching trade found for ${entry.tradeDate}.`
      }));
      return;
    }

    if (exactDateMatches.length > 1) {
      setRelinkFeedbackByExampleId((current) => ({
        ...current,
        [entry.id]: `Found ${exactDateMatches.length} trades on ${entry.tradeDate}. Open Trades and relink manually.`
      }));
      return;
    }

    const candidate = exactDateMatches[0];
    const isLinkedElsewhere = aPlusExamples.some(
      (existing) => existing.id !== entry.id && existing.tradeId === candidate.id
    );
    if (isLinkedElsewhere) {
      setRelinkFeedbackByExampleId((current) => ({
        ...current,
        [entry.id]: `Trade ${candidate.symbol} ${candidate.tradeDate} is already linked to another example.`
      }));
      return;
    }

    clearDismissedTradeId(candidate.id);
    setPlaybooks((current) =>
      updatePlaybookAPlusExample(current, playbook.id, entry.id, {
        tradeId: candidate.id,
        tradeDate: candidate.tradeDate,
        rating: getSyncedExampleRating(candidate) ?? entry.rating,
        tradeSnapshot: createTradeSnapshot(candidate)
      })
    );
    setRelinkFeedbackByExampleId((current) => ({
      ...current,
      [entry.id]: `Relinked to ${candidate.symbol} on ${candidate.tradeDate}.`
    }));
  };

  return (
    <div className="playbook-sections-column">
      <input
        ref={screenshotInputRef}
        type="file"
        accept="image/png,image/jpeg,image/jpg,image/webp,image/gif"
        className="drop-zone-input"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          const exampleId = pendingAttachmentExampleId;
          if (!exampleId || pendingAttachmentKind !== "screenshot" || files.length === 0) {
            event.currentTarget.value = "";
            return;
          }

          void readFileAsDataUrl(files[0])
            .then((dataUrl) => {
              setPlaybooks((current) => {
                const entry = getEntryFromState(current, exampleId);
                const nextPaths = entry ? [...entry.screenshotPaths, dataUrl] : [dataUrl];
                return updatePlaybookAPlusExample(current, playbook.id, exampleId, { screenshotPaths: nextPaths });
              });
            })
            .catch(() => undefined);

          setPendingAttachmentExampleId("");
          event.currentTarget.value = "";
        }}
      />

      <article className="placeholder-panel playbook-section-card playbook-aplus-panel">
        <div className="panel-header">
          <WorkspaceIcon icon="library" alt="A+ example library icon" className="panel-header-icon" />
          <h2>A+ Example Library</h2>
        </div>
        <span className="playbook-example-subtitle">
          Curate your best B+ and A game trades with screenshots, recordings, and notes. Tagged chart screenshots for
          B+ and A game trades are added here automatically.
        </span>
        {aPlusExamples.length > 0 ? (
          <div className="playbook-aplus-controls">
            <div className="playbook-database-search-row">
              <input
                type="search"
                className="playbook-search-input playbook-aplus-search-input"
                value={exampleSearchQuery}
                onChange={(event) => setExampleSearchQuery(event.target.value)}
                placeholder="Search examples by trade, symbol, setup, rating, or date"
                aria-label="Search A plus examples"
              />
              <label className="playbook-aplus-sort-field">
                <span>Sort By</span>
                <select
                  className="journal-header-select"
                  value={exampleSort}
                  onChange={(event) => setExampleSort(event.target.value as APlusExampleSort)}
                  aria-label="Sort examples"
                >
                  <option value="date-desc">Newest first</option>
                  <option value="date-asc">Oldest first</option>
                  <option value="rating-desc">Highest rank</option>
                  <option value="pnl-desc">Highest P/L</option>
                  <option value="pnl-asc">Lowest P/L</option>
                </select>
              </label>
              {exampleSearchQuery.trim().length > 0 ? (
                <button type="button" className="mini-action mini-action-soft" onClick={() => setExampleSearchQuery("")}>
                  Clear
                </button>
              ) : null}
            </div>
            <span className="playbook-aplus-controls-meta">
              Showing {visibleExamples.length} of {aPlusExamples.length} example
              {aPlusExamples.length === 1 ? "" : "s"}
            </span>
          </div>
        ) : null}

        <div className="playbook-aplus-entry-list">
          {aPlusExamples.length === 0 ? (
            <div className="empty-state">
              No examples yet. Add a tagged B+ or A game trade below to start building your A+ library.
            </div>
          ) : visibleExamples.length === 0 ? (
            <div className="empty-state">
              No examples match the current search. Try a different symbol, setup, or date.
            </div>
          ) : (
            visibleExamples.map((entry) => {
              const trade = tradeById.get(entry.tradeId);
              const screenshotSrcs = entry.screenshotPaths.map((path) =>
                path.startsWith("data:") ? path : resolvePlaybookAttachmentSrc(path)
              );
              const recordingSrc = entry.recordingPath
                ? entry.recordingPath.startsWith("data:")
                  ? entry.recordingPath
                  : resolvePlaybookAttachmentSrc(entry.recordingPath)
                : "";
              const displaySnapshot = trade ? createTradeSnapshot(trade) : entry.tradeSnapshot;
              const setupLabel = getSnapshotSetupLabel(displaySnapshot, playbook.name);
              const headerDate = trade?.tradeDate || displaySnapshot?.tradeDate || entry.tradeDate || "-";
              const entryTitle = trade?.name || displaySnapshot?.name || "Saved Example";
              const entrySubtitle = trade
                ? `${trade.symbol} - ${trade.tradeDate}`
                : displaySnapshot
                  ? `${displaySnapshot.symbol || "Trade"} - ${headerDate} - saved snapshot`
                  : `Trade date ${entry.tradeDate || "-"} - link missing`;
              const entryStateLabel = trade
                ? `${displaySnapshot?.side || trade.side} ${displaySnapshot?.status || trade.status}`.trim()
                : displaySnapshot
                  ? `${displaySnapshot.side} ${displaySnapshot.status}`.trim() || "Saved snapshot"
                  : "Link missing";
              const statsSourceLabel = trade
                ? `${displaySnapshot?.status || trade.status} - ${displaySnapshot?.side || trade.side} - ${
                    displaySnapshot?.game || trade.game || "No game tag"
                  }`
                : displaySnapshot
                  ? `${displaySnapshot.status || "Saved"} - ${displaySnapshot.side || "Trade"} - ${
                      displaySnapshot.game || "No game tag"
                    }`
                  : "Linked trade unavailable";
              const priceEdgePerShare = displaySnapshot
                ? displaySnapshot.side === "Long"
                  ? displaySnapshot.exitPrice - displaySnapshot.entryPrice
                  : displaySnapshot.entryPrice - displaySnapshot.exitPrice
                : 0;
              const tradeNoteKey = serializeTradeLink(entry.tradeId, trade?.tradeDate || entry.tradeDate || "");
              const snapshotTradeNoteKey = serializeTradeLink(entry.tradeId, displaySnapshot?.tradeDate || "");
              const journalTradeNoteMatch =
                tradeNoteLookup.byLink.get(tradeNoteKey) ??
                tradeNoteLookup.byLink.get(snapshotTradeNoteKey) ??
                tradeNoteLookup.byTradeId.get(entry.tradeId);
              const journalTradeNote = journalTradeNoteMatch?.note ?? null;
              const journalTradeNotePage = journalTradeNoteMatch?.page ?? null;
              const journalTradeNoteText = journalTradeNote ? extractJournalDocText(journalTradeNote.content) : "";
              const localNoteText = hasJournalDocContent(entry.notes) ? extractJournalDocText(entry.notes) : "";
              const journalNotePreview = journalTradeNoteText ? truncateText(journalTradeNoteText, 180) : "";
              const localNotePreview = localNoteText ? truncateText(localNoteText, 180) : "";
              const notePreview = journalNotePreview || localNotePreview || "No trade note yet.";
              const hasNotePreview = Boolean(journalNotePreview || localNotePreview);
              const notePreviewSourceLabel = journalNotePreview
                ? "Tagged journal note"
                : localNotePreview
                  ? "Saved A+ note"
                  : "Journal note";
              const isExpanded = expandedExampleIdSet.has(entry.id);
              const linkStatusLabel = trade ? "Linked" : displaySnapshot ? "Snapshot" : "Needs relink";
              const linkStatusClass = trade
                ? "playbook-aplus-link-status-linked"
                : displaySnapshot
                  ? "playbook-aplus-link-status-snapshot"
                  : "playbook-aplus-link-status-missing";
              const journalNoteStatusLabel = journalTradeNote ? "Journal note" : "No journal note";
              const firstScreenshotSrc = screenshotSrcs[0] ?? "";
              const screenshotCountLabel =
                screenshotSrcs.length > 1 ? `${screenshotSrcs.length} charts` : screenshotSrcs.length === 1 ? "1 chart" : "No chart";
              const tradeMistakeTags = journalTradeNote?.mistakes.length
                ? journalTradeNote.mistakes
                : toSafeArray<string>(trade?.mistakes);
              const catalystTags = toSafeArray<string>(trade?.catalyst);
              const executionTags = toSafeArray<string>(trade?.execution);
              const outTags = toSafeArray<string>(trade?.outTag);
              const gatewayTags = toSafeArray<string>(trade?.gateways);
              const studyScoreTiles = displaySnapshot
                ? [
                    { label: "Rating", value: entry.rating },
                    {
                      label: "Net PnL",
                      value: formatSignedMoney(displaySnapshot.netPnlUsd),
                      className: getSignedValueClassName(displaySnapshot.netPnlUsd)
                    },
                    {
                      label: "R/Share",
                      value: formatSignedPerShare(displaySnapshot.returnPerShare),
                      className: getSignedValueClassName(displaySnapshot.returnPerShare)
                    },
                    {
                      label: "Price Edge",
                      value: formatSignedPerShare(priceEdgePerShare),
                      className: getSignedValueClassName(priceEdgePerShare)
                    },
                    { label: "Hold", value: getSnapshotHoldLabel(displaySnapshot) }
                  ]
                : [
                    { label: "Rating", value: entry.rating },
                    { label: "Date", value: headerDate },
                    { label: "State", value: entryStateLabel }
                  ];
              const tradeBlueprintRows = [
                { label: "Symbol", value: displaySnapshot?.symbol || journalTradeNote?.ticker || "-" },
                { label: "Setup", value: setupLabel || "-" },
                { label: "Game", value: displaySnapshot?.game || trade?.game || "-" },
                { label: "Side / Result", value: `${displaySnapshot?.side || trade?.side || "-"} / ${displaySnapshot?.status || trade?.status || "-"}` },
                { label: "Date", value: headerDate },
                { label: "Source", value: trade ? "Linked trade" : displaySnapshot ? "Saved snapshot" : "Missing link" }
              ];
              const executionReadRows = displaySnapshot
                ? [
                    {
                      label: "Entry / Exit",
                      value: `${formatPrice(displaySnapshot.entryPrice)} / ${formatPrice(displaySnapshot.exitPrice)}`
                    },
                    {
                      label: "Open / Close",
                      value: `${displaySnapshot.openTime || "-"} / ${displaySnapshot.closeTime || "-"}`
                    },
                    { label: "Size", value: formatSize(displaySnapshot.size) },
                    { label: "Executions", value: String(displaySnapshot.executionCount) },
                    {
                      label: "Adds",
                      value: `${displaySnapshot.addCount} total (${displaySnapshot.averagedDownCount} avg down / ${displaySnapshot.addedToWinnerCount} winner)`
                    },
                    { label: "Fees", value: formatCurrency(displaySnapshot.feesUsd) }
                  ]
                : [
                    { label: "Entry / Exit", value: "-" },
                    { label: "Open / Close", value: "-" },
                    { label: "Size", value: "-" },
                    { label: "Executions", value: "-" }
                  ];
              const studyTagGroups = [
                { label: "Mistakes", values: tradeMistakeTags },
                { label: "Catalyst", values: catalystTags },
                { label: "Execution", values: executionTags },
                { label: "Out", values: outTags },
                { label: "Gateway", values: gatewayTags }
              ].filter((group) => group.values.some((value) => value.trim().length > 0));

              return (
                <section
                  key={entry.id}
                  className={`playbook-aplus-entry${isExpanded ? " playbook-aplus-entry-expanded" : ""}`}
                >
                  <div className="playbook-aplus-summary-card">
                    <button
                      type="button"
                      className={`playbook-aplus-summary-media${
                        firstScreenshotSrc ? "" : " playbook-aplus-summary-media-empty"
                      }`}
                      onClick={() => (firstScreenshotSrc ? onExpandImage(firstScreenshotSrc) : toggleExampleExpanded(entry.id))}
                    >
                      {firstScreenshotSrc ? (
                        <>
                          <img src={firstScreenshotSrc} alt={`${entryTitle} screenshot`} />
                          <span className="playbook-aplus-summary-media-badge">{screenshotCountLabel}</span>
                        </>
                      ) : (
                        <span className="playbook-aplus-summary-media-placeholder">
                          <strong>No chart yet</strong>
                          <small>Screenshot pending</small>
                        </span>
                      )}
                    </button>
                    <div className="playbook-aplus-summary-main">
                      <div className="playbook-aplus-summary-top">
                        <div className="playbook-aplus-entry-title">
                          <strong>{entryTitle}</strong>
                          <span className="playbook-aplus-entry-subtitle">{entrySubtitle}</span>
                        </div>
                        <div className="playbook-aplus-summary-pills">
                          <span className={`playbook-aplus-link-status ${linkStatusClass}`}>{linkStatusLabel}</span>
                          <span className="playbook-aplus-link-status playbook-aplus-link-status-note">
                            {journalNoteStatusLabel}
                          </span>
                          <span className="playbook-aplus-link-status playbook-aplus-link-status-rating">
                            {entry.rating}
                          </span>
                        </div>
                      </div>
                      <div className="playbook-aplus-entry-meta">
                        <span className="playbook-meta-pill">Date {headerDate}</span>
                        <span className="playbook-meta-pill">
                          {setupLabel ? `Setup ${setupLabel}` : "Setup saved"}
                        </span>
                        <span className="playbook-meta-pill">{entryStateLabel}</span>
                      </div>
                      <div className="playbook-aplus-summary-stat-row">
                        <span>
                          <small>Net PnL</small>
                          <strong className={displaySnapshot ? getSignedValueClassName(displaySnapshot.netPnlUsd) : ""}>
                            {displaySnapshot ? formatSignedMoney(displaySnapshot.netPnlUsd) : "-"}
                          </strong>
                        </span>
                        <span>
                          <small>R/Share</small>
                          <strong className={displaySnapshot ? getSignedValueClassName(displaySnapshot.returnPerShare) : ""}>
                            {displaySnapshot ? formatSignedPerShare(displaySnapshot.returnPerShare) : "-"}
                          </strong>
                        </span>
                        <span>
                          <small>Hold</small>
                          <strong>{displaySnapshot ? getSnapshotHoldLabel(displaySnapshot) : "-"}</strong>
                        </span>
                      </div>
                      <div
                        className={`playbook-aplus-summary-note-card${
                          hasNotePreview ? "" : " playbook-aplus-summary-note-card-empty"
                        }`}
                      >
                        <div className="playbook-aplus-summary-note-heading">
                          <span>{notePreviewSourceLabel}</span>
                          {journalTradeNotePage ? <small>{journalTradeNotePage.tradeDate}</small> : null}
                        </div>
                        <p className="playbook-aplus-summary-note">{notePreview}</p>
                      </div>
                      <div className="playbook-aplus-summary-footer">
                        <span className="playbook-aplus-summary-status-line">{statsSourceLabel}</span>
                        <div className="playbook-aplus-summary-actions">
                          <button
                            type="button"
                            className="mini-action mini-action-soft"
                            onClick={() => toggleExampleExpanded(entry.id)}
                          >
                            {isExpanded ? "Collapse" : "Study Card"}
                          </button>
                          {trade ? (
                            <button
                              type="button"
                              className="mini-action mini-action-soft"
                              onClick={() => onSelectTrade(trade.id, trade.tradeDate)}
                            >
                              Open Trade
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="mini-action mini-action-soft"
                              onClick={() => relinkExampleByDate(entry)}
                            >
                              Relink
                            </button>
                          )}
                          {journalTradeNotePage && onOpenJournalDate ? (
                            <button
                              type="button"
                              className="mini-action mini-action-soft"
                              onClick={() => onOpenJournalDate(journalTradeNotePage.tradeDate)}
                            >
                              Open Journal
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </div>
                  {isExpanded ? (
                    <>
                  <header className="playbook-aplus-entry-header">
                    <div className="playbook-aplus-entry-title">
                      <strong>{entryTitle}</strong>
                      <span className="playbook-aplus-entry-subtitle">
                        {entrySubtitle}
                      </span>
                      <div className="playbook-aplus-entry-meta">
                        <span className="playbook-meta-pill">Date {headerDate}</span>
                        <span className="playbook-meta-pill">
                          {setupLabel ? `Setup ${setupLabel}` : "Setup saved"}
                        </span>
                        <span className="playbook-meta-pill">{entryStateLabel}</span>
                      </div>
                    </div>
                    <div className="playbook-aplus-entry-actions">
                      <label className="playbook-aplus-rating">
                        <span>Rating</span>
                        <select
                          className="journal-header-select"
                          value={entry.rating}
                          onChange={(event) =>
                            setPlaybooks((current) =>
                              updatePlaybookAPlusExample(current, playbook.id, entry.id, {
                                rating: event.target.value as PlaybookExampleRating
                              })
                            )
                          }
                        >
                          {ratingOptions.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="playbook-aplus-entry-action-buttons">
                        {trade ? (
                          <button
                            type="button"
                            className="mini-action mini-action-soft"
                            onClick={() => onSelectTrade(trade.id, trade.tradeDate)}
                          >
                            Open Trade
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="mini-action mini-action-soft"
                            onClick={() => relinkExampleByDate(entry)}
                          >
                            Relink by Date
                          </button>
                        )}
                        <button
                          type="button"
                          className="mini-action mini-action-danger"
                          onClick={() => removeExample(entry.id)}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  </header>

                  <section className="playbook-aplus-study-card" aria-label="Study card">
                    <div className="playbook-aplus-study-card-header">
                      <div>
                        <span>Study Card</span>
                        <strong>{entryTitle}</strong>
                        <small>{statsSourceLabel}</small>
                      </div>
                      <div className="playbook-aplus-study-card-pills">
                        <span className={`playbook-aplus-link-status ${linkStatusClass}`}>{linkStatusLabel}</span>
                        <span className="playbook-aplus-link-status playbook-aplus-link-status-note">
                          {journalNoteStatusLabel}
                        </span>
                        <span className="playbook-aplus-link-status playbook-aplus-link-status-rating">
                          {entry.rating}
                        </span>
                      </div>
                    </div>

                    <div className="playbook-aplus-study-score-grid">
                      {studyScoreTiles.map((tile) => (
                        <div key={`${entry.id}-study-score-${tile.label}`}>
                          <span>{tile.label}</span>
                          <strong className={"className" in tile ? tile.className : undefined}>{tile.value}</strong>
                        </div>
                      ))}
                    </div>

                    <div className="playbook-aplus-study-grid">
                      <section className="playbook-aplus-study-section">
                        <div className="playbook-aplus-study-section-header">
                          <span>Trade Blueprint</span>
                        </div>
                        <dl className="playbook-aplus-study-detail-list">
                          {tradeBlueprintRows.map((row) => (
                            <div key={`${entry.id}-blueprint-${row.label}`}>
                              <dt>{row.label}</dt>
                              <dd>{row.value}</dd>
                            </div>
                          ))}
                        </dl>
                      </section>

                      <section className="playbook-aplus-study-section">
                        <div className="playbook-aplus-study-section-header">
                          <span>Execution Read</span>
                        </div>
                        <dl className="playbook-aplus-study-detail-list">
                          {executionReadRows.map((row) => (
                            <div key={`${entry.id}-execution-${row.label}`}>
                              <dt>{row.label}</dt>
                              <dd>{row.value}</dd>
                            </div>
                          ))}
                        </dl>
                      </section>

                      <section className="playbook-aplus-study-section">
                        <div className="playbook-aplus-study-section-header">
                          <span>Tags</span>
                        </div>
                        {studyTagGroups.length > 0 ? (
                          <div className="playbook-aplus-study-tag-groups">
                            {studyTagGroups.map((group) => (
                              <div key={`${entry.id}-study-tags-${group.label}`}>
                                <span>{group.label}</span>
                                <strong>{formatListValue(group.values)}</strong>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="playbook-aplus-study-empty">No tags recorded.</p>
                        )}
                      </section>

                      <section className="playbook-aplus-study-section playbook-aplus-study-section-wide playbook-aplus-study-note-section">
                        <div className="playbook-aplus-study-section-header">
                          <span>{journalTradeNote ? "Tagged Journal Note" : "Tagged Journal Note Missing"}</span>
                          <small>
                            {journalTradeNotePage
                              ? `${journalTradeNotePage.tradeDate} journal note`
                              : "No linked journal note found"}
                          </small>
                        </div>
                        {journalTradeNote ? (
                          <>
                            <div className="playbook-aplus-journal-note-meta">
                              <span>{journalTradeNote.ticker || displaySnapshot?.symbol || "Trade"}</span>
                              {journalTradeNote.playbook ? <span>{journalTradeNote.playbook}</span> : null}
                              {journalTradeNote.mistakes.map((mistake) => (
                                <span key={`${entry.id}-study-mistake-${mistake}`}>{mistake}</span>
                              ))}
                            </div>
                            <JournalRichTextEditor
                              content={journalTradeNote.content}
                              onChange={() => undefined}
                              readOnly
                              compact
                              autosize
                              appearance="notion"
                              onImageOpen={onExpandImage}
                            />
                            {onOpenJournalDate && journalTradeNotePage ? (
                              <div className="playbook-aplus-journal-note-actions">
                                <button
                                  type="button"
                                  className="mini-action mini-action-soft"
                                  onClick={() => onOpenJournalDate(journalTradeNotePage.tradeDate)}
                                >
                                  Edit In Journal
                                </button>
                              </div>
                            ) : null}
                            {hasJournalDocContent(entry.notes) ? (
                              <details className="playbook-aplus-local-note-details">
                                <summary>Saved A+ note fallback</summary>
                                <JournalRichTextEditor
                                  content={entry.notes}
                                  onChange={(content) =>
                                    setPlaybooks((current) =>
                                      updatePlaybookAPlusExample(current, playbook.id, entry.id, { notes: content })
                                    )
                                  }
                                  onImageInsert={createExampleInlineImageInsertHandler(entry.id)}
                                  placeholder="Fallback A+ note"
                                  appearance="notion"
                                />
                              </details>
                            ) : null}
                          </>
                        ) : (
                          <>
                            <p className="playbook-aplus-study-empty">
                              No tagged journal note is linked to this example yet.
                            </p>
                            <JournalRichTextEditor
                              content={entry.notes}
                              onChange={(content) =>
                                setPlaybooks((current) =>
                                  updatePlaybookAPlusExample(current, playbook.id, entry.id, { notes: content })
                                )
                              }
                              onImageInsert={createExampleInlineImageInsertHandler(entry.id)}
                              placeholder="No linked Journal trade note yet. Add the trade note in Journal, or keep a fallback note here."
                              appearance="notion"
                            />
                            {onOpenJournalDate && (trade?.tradeDate || entry.tradeDate) ? (
                              <div className="playbook-aplus-journal-note-actions">
                                <button
                                  type="button"
                                  className="mini-action mini-action-soft"
                                  onClick={() => onOpenJournalDate(trade?.tradeDate || entry.tradeDate)}
                                >
                                  Open Journal Day
                                </button>
                              </div>
                            ) : null}
                          </>
                        )}
                      </section>
                    </div>
                  </section>

                  <div className="playbook-aplus-attachment-row">
                    <button
                      type="button"
                      className="mini-action"
                      disabled={pendingAttachmentExampleId === entry.id}
                      onClick={() => pickScreenshot(entry.id)}
                    >
                      <WorkspaceIcon icon="camera" alt="Add screenshot icon" className="mini-action-icon" />
                      Add Screenshot
                    </button>
                    <button
                      type="button"
                      className="mini-action"
                      disabled={!isTauri() || pendingAttachmentExampleId === entry.id}
                      onClick={() => pickRecording(entry.id)}
                    >
                      <WorkspaceIcon icon="plan" alt="Add recording icon" className="mini-action-icon" />
                      Add Recording
                    </button>
                    {!isTauri() ? (
                      <span className="playbook-aplus-hint">
                        Recording uploads require the desktop app.
                      </span>
                    ) : null}
                  </div>

                  <div className="playbook-aplus-highlight-grid">
                    <section
                      className={`playbook-aplus-media-panel${recordingSrc ? "" : " playbook-aplus-media-panel-single"}`}
                      aria-label="Example media"
                    >
                      {screenshotSrcs.length > 0 ? (
                        <div className="playbook-aplus-screenshot-grid">
                          {screenshotSrcs.map((src, index) => (
                            <div key={`${entry.id}-shot-${index}`} className="playbook-aplus-screenshot-card">
                              <button
                                type="button"
                                className="journal-screenshot-preview-button playbook-aplus-screenshot-button"
                                style={{ backgroundImage: `url("${src}")` }}
                                onClick={() => onExpandImage(src)}
                              >
                                <img
                                  className="journal-screenshot-image playbook-aplus-screenshot-image"
                                  src={src}
                                  alt="Example screenshot"
                                />
                              </button>
                              <div className="journal-screenshot-actions">
                                <button
                                  type="button"
                                  className="mini-action mini-action-danger"
                                  onClick={() => removeScreenshot(entry.id, entry.screenshotPaths[index])}
                                >
                                  Remove
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="playbook-aplus-media-empty">
                          Add a screenshot to highlight your best execution for this trade.
                        </div>
                      )}

                      {recordingSrc ? (
                        <div className="playbook-aplus-recording">
                          <video className="playbook-aplus-recording-player" controls src={recordingSrc} />
                          <button
                            type="button"
                            className="mini-action mini-action-danger"
                            onClick={() => clearRecording(entry.id, entry.recordingPath)}
                          >
                            Remove Recording
                          </button>
                        </div>
                      ) : null}
                    </section>

                    <section
                      className={`playbook-aplus-trade-stats${
                        displaySnapshot ? (trade ? "" : " playbook-aplus-trade-stats-snapshot") : " playbook-aplus-trade-stats-missing"
                      }`}
                      aria-label="Trade stats snapshot"
                    >
                      {displaySnapshot ? (
                        <>
                          <div className="playbook-aplus-trade-stats-header">
                            <strong>{trade ? "Trade Stats" : "Saved Trade Snapshot"}</strong>
                            <span>{statsSourceLabel}</span>
                          </div>
                          <div className="playbook-aplus-meta-grid">
                            <div className="playbook-aplus-meta-tile">
                              <span>Symbol</span>
                              <strong>{displaySnapshot.symbol || "-"}</strong>
                            </div>
                            <div className="playbook-aplus-meta-tile">
                              <span>Setup</span>
                              <strong>{setupLabel}</strong>
                            </div>
                            <div className="playbook-aplus-meta-tile">
                              <span>Win / Loss</span>
                              <strong>{displaySnapshot.status || "-"}</strong>
                            </div>
                          </div>
                          <div className="playbook-aplus-stat-grid">
                            <div className="playbook-aplus-stat-tile">
                              <span>Net PnL</span>
                              <strong className={getSignedValueClassName(displaySnapshot.netPnlUsd)}>
                                {formatSignedMoney(displaySnapshot.netPnlUsd)}
                              </strong>
                            </div>
                            <div className="playbook-aplus-stat-tile">
                              <span>Return / Share</span>
                              <strong className={getSignedValueClassName(displaySnapshot.returnPerShare)}>
                                {formatSignedPerShare(displaySnapshot.returnPerShare)}
                              </strong>
                            </div>
                            <div className="playbook-aplus-stat-tile">
                              <span>Price Edge / Share</span>
                              <strong className={getSignedValueClassName(priceEdgePerShare)}>
                                {formatSignedPerShare(priceEdgePerShare)}
                              </strong>
                            </div>
                            <div className="playbook-aplus-stat-tile">
                              <span>Size</span>
                              <strong>{formatSize(displaySnapshot.size)}</strong>
                            </div>
                            <div className="playbook-aplus-stat-tile">
                              <span>Entry</span>
                              <strong>{formatPrice(displaySnapshot.entryPrice)}</strong>
                            </div>
                            <div className="playbook-aplus-stat-tile">
                              <span>Exit</span>
                              <strong>{formatPrice(displaySnapshot.exitPrice)}</strong>
                            </div>
                            <div className="playbook-aplus-stat-tile">
                              <span>Hold Time</span>
                              <strong>{getSnapshotHoldLabel(displaySnapshot)}</strong>
                            </div>
                            <div className="playbook-aplus-stat-tile">
                              <span>Executions</span>
                              <strong>{displaySnapshot.executionCount}</strong>
                            </div>
                            <div className="playbook-aplus-stat-tile">
                              <span>Adds</span>
                              <strong>
                                {displaySnapshot.addCount} total ({displaySnapshot.averagedDownCount} avg down /{" "}
                                {displaySnapshot.addedToWinnerCount} winner)
                              </strong>
                            </div>
                            <div className="playbook-aplus-stat-tile">
                              <span>Fees</span>
                              <strong>{formatCurrency(displaySnapshot.feesUsd)}</strong>
                            </div>
                          </div>
                          {!trade ? (
                            <p className="playbook-aplus-missing-copy">
                              The original trade is not loaded right now, so this card is showing its saved snapshot.
                            </p>
                          ) : null}
                          {relinkFeedbackByExampleId[entry.id] ? (
                            <p className="playbook-aplus-relink-feedback">{relinkFeedbackByExampleId[entry.id]}</p>
                          ) : null}
                        </>
                      ) : (
                        <>
                          <div className="playbook-aplus-trade-stats-header">
                            <strong>Trade Stats</strong>
                            <span>Linked trade unavailable</span>
                          </div>
                          <div className="playbook-aplus-meta-grid">
                            <div className="playbook-aplus-meta-tile">
                              <span>Status</span>
                              <strong>Link missing</strong>
                            </div>
                            <div className="playbook-aplus-meta-tile">
                              <span>Trade Date</span>
                              <strong>{entry.tradeDate || "-"}</strong>
                            </div>
                            <div className="playbook-aplus-meta-tile">
                              <span>Rating</span>
                              <strong>{entry.rating}</strong>
                            </div>
                          </div>
                          <p className="playbook-aplus-missing-copy">
                            This example still has its notes and media, but no matching trade is loaded.
                          </p>
                          {relinkFeedbackByExampleId[entry.id] ? (
                            <p className="playbook-aplus-relink-feedback">{relinkFeedbackByExampleId[entry.id]}</p>
                          ) : null}
                        </>
                      )}
                    </section>
                  </div>

                    </>
                  ) : null}
                </section>
              );
            })
          )}
        </div>
      </article>

      <article className="placeholder-panel playbook-section-card playbook-aplus-panel">
        <div className="panel-header">
          <WorkspaceIcon icon="trades" alt="Tagged trades icon" className="panel-header-icon" />
          <h2>Eligible Trades (B+ and A Game)</h2>
        </div>
        <span className="playbook-example-subtitle">
          Trades are eligible when they match this playbook and have a game tag of B+ Game or A Game.
        </span>
        <div className="playbook-aplus-eligible-list">
          {availableEligibleTrades.length === 0 ? (
            <div className="empty-state">
              No eligible trades found. Tag more trades with {playbook.name} and make sure their game score is B+ or A.
            </div>
          ) : (
            availableEligibleTrades.slice(0, 24).map((trade) => (
              <div key={trade.id} className="playbook-aplus-eligible-row">
                <div className="playbook-aplus-eligible-copy">
                  <div className="playbook-aplus-eligible-top">
                    <strong>{trade.name}</strong>
                    <span className={getSignedValueClassName(trade.netPnlUsd)}>
                      {formatSignedMoney(trade.netPnlUsd)}
                    </span>
                  </div>
                  <span className="playbook-aplus-eligible-inline-row">
                    <span>Date {trade.tradeDate}</span>
                    <span>{trade.symbol}</span>
                    <span>
                      {trade.openTime} to {trade.closeTime}
                    </span>
                    <span>Hold {getHoldLabel(trade)}</span>
                  </span>
                  <span className="playbook-aplus-eligible-inline-row playbook-aplus-eligible-inline-row-tight">
                    <span>
                      {trade.side} - {trade.status}
                    </span>
                    <span>Size {formatSize(trade.size)}</span>
                    <span>In {formatMoney(trade.entryPrice)}</span>
                    <span>Out {formatMoney(trade.exitPrice)}</span>
                    <span>Fees {formatMoney(trade.feesUsd)}</span>
                  </span>
                </div>
                <div className="playbook-aplus-eligible-actions">
                  <button type="button" className="mini-action" onClick={() => addExampleFromTrade(trade)}>
                    Add To Library
                  </button>
                  <button
                    type="button"
                    className="mini-action mini-action-soft"
                    onClick={() => onSelectTrade(trade.id, trade.tradeDate)}
                  >
                    Review
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </article>
    </div>
  );
};

