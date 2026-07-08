import { useEffect, useMemo, useRef, useState } from "react";
import { JournalRichTextEditor } from "../../journal/components/JournalRichTextEditor";
import { PageHero } from "../../../components/PageHero";
import { FilterSelect } from "../../../components/FilterSelect";
import { SymbolPills } from "../../../components/SymbolPills";
import { WorkspaceIcon } from "../../../components/WorkspaceIcon";
import { APlusExampleLibrary } from "../components/APlusExampleLibrary";
import { getTradeSummary } from "../../../lib/analytics/tradeAnalytics";
import { useDebouncedSave } from "../../../lib/hooks/useDebouncedSave";
import {
  addPlaybookRecord,
  loadPlaybooks,
  recoverPlaybooksFromDesktopBackup,
  savePlaybooks,
  updatePlaybookSectionContent
} from "../../../lib/playbooks/playbookStore";
import { SYNC_HYDRATED_EVENT } from "../../../lib/sync/syncStore";
import {
  resolveWorkspaceAttachmentSrc,
  saveWorkspaceInlineImage
} from "../../../lib/workspace/workspaceAttachmentClient";
import type {
  JournalPageRecord,
  JournalScreenshotTagRecord,
  JournalScreenshotTradeLink,
  JournalTradeNoteRecord
} from "../../../types/journal";
import type { PlaybookDetailPage, PlaybooksNavigationState } from "../../../types/app";
import type { PlaybookRecord, PlaybookStatus } from "../../../types/playbook";
import type { GroupedTrade } from "../../../types/trade";

interface PlaybooksPageProps {
  trades: GroupedTrade[];
  journalPages?: JournalPageRecord[];
  navigationState?: PlaybooksNavigationState;
  onNavigationStateChange?: (state: PlaybooksNavigationState) => void;
  onSelectTrade: (tradeId: string, tradeDate: string) => void;
  onOpenJournalDate?: (tradeDate: string) => void;
  onViewReportsForPlaybook?: (playbookName: string) => void;
  embedded?: boolean;
}

interface PlaybookCardData {
  playbook: PlaybookRecord;
  trades: GroupedTrade[];
  summary: ReturnType<typeof getTradeSummary>;
  status: PlaybookStatus;
  confidence: PlaybookConfidence;
  setupType: string;
  setupTypes: string[];
  topSymbols: string[];
  uniqueSymbolCount: number;
  averageWinner: number;
  averageLoser: number;
  searchText: string;
}

interface FilteredPlaybookCardData extends PlaybookCardData {
  filteredTrades: GroupedTrade[];
  filteredSummary: ReturnType<typeof getTradeSummary>;
  filteredTopSymbols: string[];
  filteredUniqueSymbolCount: number;
  filteredAverageWinner: number;
  filteredAverageLoser: number;
}

interface TaggedPlaybookChartData {
  id: string;
  screenshotUrl: string;
  label: string;
  rowLabel: string;
  taggedDate: string;
  journalDate: string;
  ticker: string;
  playbookLabel: string;
  linkedTradeKeys: string[];
  linkedTrades: GroupedTrade[];
  missingLinkedTradeCount: number;
}

type PlaybookHeroWindow = "all" | "30d" | "7d";
type PlaybookConfidence = "Low Confidence" | "Medium Confidence" | "High Confidence";
type StatusFilterValue = "all" | PlaybookStatus;
type ConfidenceFilterValue = "all" | PlaybookConfidence;
type NetPnlFilterValue = "all" | "positive" | "negative";
type PlaybookTradeFocusFilter = {
  label: string;
  description: string;
  tradeKeys: string[];
};

type PlaybookPerformanceTile = {
  label: string;
  value: string;
  detail?: string;
  actionLabel?: string;
  tone?: "positive" | "warning" | "negative";
  onClick?: () => void;
};

const playbookStatusOptions: PlaybookStatus[] = [
  "Testing",
  "Active",
  "Proven",
  "Needs Review",
  "Retired"
];

const playbookConfidenceOptions: PlaybookConfidence[] = [
  "Low Confidence",
  "Medium Confidence",
  "High Confidence"
];

const playbookHeroWindowOptions: { label: string; value: PlaybookHeroWindow }[] = [
  { label: "All", value: "all" },
  { label: "30D", value: "30d" },
  { label: "7D", value: "7d" }
];

const playbookScreenshotColumnLabels = ["Open Example", "Close Example", "Context Chart"] as const;
const TRADE_LINK_SEPARATOR = "::";

const formatSignedMoney = (value: number): string =>
  `${value >= 0 ? "+" : "-"}$${Math.abs(value).toFixed(2)}`;

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

const formatUpdatedAt = (value: string): string => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "-";
  }

  return parsed.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
};

const parseCalendarDate = (value: string): Date | null => {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const [year, month, day] = trimmed.split("-").map((token) => Number(token));
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
      return null;
    }

    const parsed = new Date(year, month - 1, day);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const getCalendarSortValue = (value: string): number => parseCalendarDate(value)?.getTime() ?? 0;

const formatCalendarDate = (value: string): string => {
  const parsed = parseCalendarDate(value);
  if (!parsed) {
    return "-";
  }

  return parsed.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
};

const formatLinkedTradeLabel = (trade: GroupedTrade): string => {
  const symbol = toSafeText(trade.symbol).trim();
  const tradeName = toSafeText(trade.name).trim();
  if (!tradeName) {
    return symbol || "Trade";
  }
  if (!symbol) {
    return tradeName;
  }
  return tradeName.toLowerCase().startsWith(symbol.toLowerCase()) ? tradeName : `${symbol} ${tradeName}`;
};

const normalizePlaybookName = (value: string): string => value.trim().toLowerCase();
const normalizeTickerValue = (value: string): string => value.trim().toUpperCase();
const toSafeText = (value: unknown): string => (typeof value === "string" ? value : "");
const toSafeArray = <T,>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

const getTradeHoldLabel = (trade: GroupedTrade): string => {
  const trimmedHoldTime = toSafeText(trade.holdTime).trim();
  if (trimmedHoldTime.length > 0) {
    return trimmedHoldTime;
  }
  return `${Math.max(0, Math.round(trade.holdSeconds / 60))}m`;
};

const filterTradesByTicker = (trades: GroupedTrade[], ticker: string): GroupedTrade[] => {
  const normalizedTicker = normalizeTickerValue(ticker);
  if (!normalizedTicker || normalizedTicker === "ALL") {
    return trades;
  }

  return trades.filter((trade) => normalizeTickerValue(toSafeText(trade.symbol)) === normalizedTicker);
};

const toTradeLinkKey = (tradeId: string, tradeDate: string): string =>
  tradeId && tradeDate ? `${tradeId}${TRADE_LINK_SEPARATOR}${tradeDate}` : "";

const dedupeTradeLinks = (links: JournalScreenshotTradeLink[]): JournalScreenshotTradeLink[] => {
  const unique = new Map<string, JournalScreenshotTradeLink>();
  for (const link of links) {
    if (!link.tradeId || !link.tradeDate) {
      continue;
    }

    unique.set(toTradeLinkKey(link.tradeId, link.tradeDate), link);
  }

  return Array.from(unique.values());
};

const getJournalTradeNoteLinks = (note: JournalTradeNoteRecord): JournalScreenshotTradeLink[] =>
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

  const currentHasContent = hasMeaningfulJournalContent(current.note.content);
  const nextHasContent = hasMeaningfulJournalContent(next.note.content);
  if (currentHasContent !== nextHasContent) {
    return nextHasContent ? next : current;
  }

  return toSafeText(next.note.updatedAt).localeCompare(toSafeText(current.note.updatedAt)) > 0 ? next : current;
};

const getScreenshotTradeLinks = (
  screenshotTag: JournalScreenshotTagRecord | undefined
): JournalScreenshotTradeLink[] => {
  if (!screenshotTag) {
    return [];
  }

  const normalizedLinkedTrades = Array.isArray(screenshotTag.linkedTrades)
    ? screenshotTag.linkedTrades
        .map((link) => ({
          tradeId: typeof link.tradeId === "string" ? link.tradeId : "",
          tradeDate: typeof link.tradeDate === "string" ? link.tradeDate : ""
        }))
        .filter((link) => link.tradeId && link.tradeDate)
    : [];
  const legacyLinkedTrade =
    screenshotTag.linkedTradeId && screenshotTag.linkedTradeDate
      ? [
          {
            tradeId: screenshotTag.linkedTradeId,
            tradeDate: screenshotTag.linkedTradeDate
          }
        ]
      : [];

  return dedupeTradeLinks([...normalizedLinkedTrades, ...legacyLinkedTrade]);
};

const getPlaybookScreenshotSlotMeta = (index: number) => {
  const rowNumber = Math.floor(index / 3) + 1;
  return {
    label: playbookScreenshotColumnLabels[index % 3],
    rowLabel: rowNumber === 1 ? "Primary Set" : `Set ${rowNumber}`
  };
};

const getTopSymbols = (trades: GroupedTrade[]): string[] =>
  Array.from(
    trades.reduce<Map<string, number>>((acc, trade) => {
      acc.set(trade.symbol, (acc.get(trade.symbol) ?? 0) + 1);
      return acc;
    }, new Map())
  )
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 4)
    .map(([symbol]) => symbol);

const getAverageWinner = (trades: GroupedTrade[]): number => {
  const winners = trades.filter((trade) => trade.netPnlUsd > 0);
  if (winners.length === 0) {
    return 0;
  }

  return winners.reduce((sum, trade) => sum + trade.netPnlUsd, 0) / winners.length;
};

const getAverageLoser = (trades: GroupedTrade[]): number => {
  const losers = trades.filter((trade) => trade.netPnlUsd < 0);
  if (losers.length === 0) {
    return 0;
  }

  return losers.reduce((sum, trade) => sum + trade.netPnlUsd, 0) / losers.length;
};

const getTradeCountLabel = (count: number): string => `${count} trade${count === 1 ? "" : "s"}`;

const parseTradeTimeMinutes = (value: string): number | null => {
  const trimmed = value.trim();
  const match = trimmed.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$/i);
  if (!match) {
    return null;
  }

  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const meridiem = match[3]?.toUpperCase();
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || minute < 0 || minute > 59) {
    return null;
  }

  if (meridiem === "PM" && hour < 12) {
    hour += 12;
  }
  if (meridiem === "AM" && hour === 12) {
    hour = 0;
  }
  if (hour < 0 || hour > 23) {
    return null;
  }

  return hour * 60 + minute;
};

const formatHourBucketLabel = (hour: number): string => {
  const normalizedHour = ((hour % 24) + 24) % 24;
  const hour12 = normalizedHour % 12 || 12;
  return `${hour12}:00 ${normalizedHour >= 12 ? "PM" : "AM"}`;
};

type PlaybookPerformanceBucket = {
  label: string;
  netPnl: number;
  trades: number;
  winCount: number;
  tradeKeys: string[];
};

const compareBestPerformanceBucket = (left: PlaybookPerformanceBucket, right: PlaybookPerformanceBucket): number =>
  right.netPnl - left.netPnl || right.trades - left.trades || left.label.localeCompare(right.label);

const compareWeakestPerformanceBucket = (left: PlaybookPerformanceBucket, right: PlaybookPerformanceBucket): number =>
  left.netPnl - right.netPnl || right.trades - left.trades || left.label.localeCompare(right.label);

const getTradeDateTimeSortValue = (trade: GroupedTrade): number =>
  getCalendarSortValue(trade.tradeDate) + (parseTradeTimeMinutes(toSafeText(trade.openTime)) ?? 0) * 60 * 1000;

const getPerformanceBucketWinRate = (bucket: PlaybookPerformanceBucket): string =>
  bucket.trades > 0 ? `${((bucket.winCount / bucket.trades) * 100).toFixed(1)}%` : "0.0%";

const getRecentTradePerformance = (
  trades: GroupedTrade[],
  limit: number
): { label: string; netPnl: number; trades: number; winRate: string; tradeKeys: string[] } | null => {
  const recentTrades = [...trades]
    .sort(
      (left, right) =>
        getTradeDateTimeSortValue(right) - getTradeDateTimeSortValue(left) ||
        toSafeText(right.id).localeCompare(toSafeText(left.id))
    )
    .slice(0, limit);

  if (recentTrades.length === 0) {
    return null;
  }

  const winCount = recentTrades.filter((trade) => trade.status === "Win").length;
  return {
    label: `Last ${recentTrades.length}`,
    netPnl: recentTrades.reduce((sum, trade) => sum + trade.netPnlUsd, 0),
    trades: recentTrades.length,
    winRate: `${((winCount / recentTrades.length) * 100).toFixed(1)}%`,
    tradeKeys: recentTrades.map((trade) => toTradeLinkKey(trade.id, trade.tradeDate))
  };
};

const getTimePerformanceBuckets = (trades: GroupedTrade[]): PlaybookPerformanceBucket[] => {
  const buckets = new Map<string, PlaybookPerformanceBucket>();
  for (const trade of trades) {
    const minutes = parseTradeTimeMinutes(toSafeText(trade.openTime));
    if (minutes === null) {
      continue;
    }

    const hour = Math.floor(minutes / 60);
    const key = String(hour);
    const current = buckets.get(key) ?? {
      label: formatHourBucketLabel(hour),
      netPnl: 0,
      trades: 0,
      winCount: 0,
      tradeKeys: []
    };
    current.netPnl += trade.netPnlUsd;
    current.trades += 1;
    current.winCount += trade.status === "Win" ? 1 : 0;
    current.tradeKeys.push(toTradeLinkKey(trade.id, trade.tradeDate));
    buckets.set(key, current);
  }

  return Array.from(buckets.values());
};

const getTickerPerformanceBuckets = (trades: GroupedTrade[]): PlaybookPerformanceBucket[] => {
  const buckets = new Map<string, PlaybookPerformanceBucket>();
  for (const trade of trades) {
    const symbol = toSafeText(trade.symbol).trim().toUpperCase();
    if (!symbol) {
      continue;
    }

    const current = buckets.get(symbol) ?? { label: symbol, netPnl: 0, trades: 0, winCount: 0, tradeKeys: [] };
    current.netPnl += trade.netPnlUsd;
    current.trades += 1;
    current.winCount += trade.status === "Win" ? 1 : 0;
    current.tradeKeys.push(toTradeLinkKey(trade.id, trade.tradeDate));
    buckets.set(symbol, current);
  }

  return Array.from(buckets.values());
};

const getDayPerformanceBuckets = (trades: GroupedTrade[]): PlaybookPerformanceBucket[] => {
  const buckets = new Map<string, PlaybookPerformanceBucket>();
  for (const trade of trades) {
    const parsed = parseCalendarDate(trade.tradeDate);
    if (!parsed) {
      continue;
    }

    const key = String(parsed.getDay());
    const label = parsed.toLocaleDateString(undefined, { weekday: "long" });
    const current = buckets.get(key) ?? { label, netPnl: 0, trades: 0, winCount: 0, tradeKeys: [] };
    current.netPnl += trade.netPnlUsd;
    current.trades += 1;
    current.winCount += trade.status === "Win" ? 1 : 0;
    current.tradeKeys.push(toTradeLinkKey(trade.id, trade.tradeDate));
    buckets.set(key, current);
  }

  return Array.from(buckets.values());
};

const getBestTimePerformance = (trades: GroupedTrade[]): PlaybookPerformanceBucket | null =>
  getTimePerformanceBuckets(trades).sort(compareBestPerformanceBucket)[0] ?? null;

const getWeakestTimePerformance = (trades: GroupedTrade[]): PlaybookPerformanceBucket | null =>
  getTimePerformanceBuckets(trades).sort(compareWeakestPerformanceBucket)[0] ?? null;

const getBestTickerPerformance = (trades: GroupedTrade[]): PlaybookPerformanceBucket | null =>
  getTickerPerformanceBuckets(trades).sort(compareBestPerformanceBucket)[0] ?? null;

const getWeakestTickerPerformance = (trades: GroupedTrade[]): PlaybookPerformanceBucket | null =>
  getTickerPerformanceBuckets(trades).sort(compareWeakestPerformanceBucket)[0] ?? null;

const getBestDayPerformance = (trades: GroupedTrade[]): PlaybookPerformanceBucket | null =>
  getDayPerformanceBuckets(trades).sort(compareBestPerformanceBucket)[0] ?? null;

const getBestPnlTrade = (trades: GroupedTrade[]): GroupedTrade | null =>
  [...trades].sort(
    (left, right) =>
      right.netPnlUsd - left.netPnlUsd ||
      toSafeText(right.tradeDate).localeCompare(toSafeText(left.tradeDate)) ||
      toSafeText(right.openTime).localeCompare(toSafeText(left.openTime))
  )[0] ?? null;

const getWorstPnlTrade = (trades: GroupedTrade[]): GroupedTrade | null =>
  [...trades].sort(
    (left, right) =>
      left.netPnlUsd - right.netPnlUsd ||
      toSafeText(right.tradeDate).localeCompare(toSafeText(left.tradeDate)) ||
      toSafeText(right.openTime).localeCompare(toSafeText(left.openTime))
  )[0] ?? null;

const clampNumber = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const getEdgeScore = (
  summary: ReturnType<typeof getTradeSummary>,
  recentPerformance: ReturnType<typeof getRecentTradePerformance>
): { score: number; label: string; detail: string; tone: PlaybookPerformanceTile["tone"] } => {
  if (summary.totalTrades === 0) {
    return { score: 0, label: "No Edge Yet", detail: "No trades tagged", tone: "warning" };
  }

  const sampleScore = clampNumber(summary.totalTrades / 50, 0, 1) * 20;
  const winRateScore = clampNumber(summary.winRate / 60, 0, 1) * 25;
  const profitFactorScore = clampNumber(summary.profitFactor / 2, 0, 1) * 20;
  const netPnlScore = summary.totalNetPnl > 0 ? 20 : summary.totalNetPnl === 0 ? 10 : 0;
  const recentScore = recentPerformance ? (recentPerformance.netPnl > 0 ? 15 : recentPerformance.netPnl === 0 ? 7 : 0) : 0;
  const score = Math.round(sampleScore + winRateScore + profitFactorScore + netPnlScore + recentScore);

  if (score >= 75) {
    return { score, label: "Strong Edge", detail: "Stats support leaning in", tone: "positive" };
  }
  if (score >= 55) {
    return { score, label: "Building Edge", detail: "Good signs, keep tracking", tone: "positive" };
  }
  if (score >= 35) {
    return { score, label: "Needs Work", detail: "Mixed edge, review rules", tone: "warning" };
  }
  return { score, label: "Weak Edge", detail: "Protect size, study misses", tone: "negative" };
};

const getSampleSizeSignal = (
  tradeCount: number
): { label: string; detail: string; tone: PlaybookPerformanceTile["tone"] } => {
  if (tradeCount === 0) {
    return { label: "No Sample", detail: "Tag trades to begin tracking", tone: "warning" };
  }
  if (tradeCount < 10) {
    return { label: "Tiny Sample", detail: "Treat stats as early clues", tone: "warning" };
  }
  if (tradeCount < 25) {
    return { label: "Small Sample", detail: "Useful, but still fragile", tone: "warning" };
  }
  if (tradeCount < 50) {
    return { label: "Building Sample", detail: "Getting reliable", tone: undefined };
  }
  return { label: "Solid Sample", detail: "Enough trades to trust patterns", tone: "positive" };
};

const getRecentTradeTrend = (
  trades: GroupedTrade[],
  limit: number
): { label: string; detail: string; tradeKeys: string[]; tone: PlaybookPerformanceTile["tone"] } => {
  const sortedTrades = [...trades].sort(
    (left, right) =>
      getTradeDateTimeSortValue(right) - getTradeDateTimeSortValue(left) ||
      toSafeText(right.id).localeCompare(toSafeText(left.id))
  );
  const recentTrades = sortedTrades.slice(0, limit);
  const previousTrades = sortedTrades.slice(limit, limit * 2);
  const recentNet = recentTrades.reduce((sum, trade) => sum + trade.netPnlUsd, 0);
  const previousNet = previousTrades.reduce((sum, trade) => sum + trade.netPnlUsd, 0);
  const recentAvg = recentTrades.length > 0 ? recentNet / recentTrades.length : 0;
  const previousAvg = previousTrades.length > 0 ? previousNet / previousTrades.length : 0;
  const tradeKeys = recentTrades.map((trade) => toTradeLinkKey(trade.id, trade.tradeDate));

  if (recentTrades.length === 0) {
    return { label: "No Trend", detail: "No trades tagged", tradeKeys, tone: "warning" };
  }
  if (previousTrades.length === 0) {
    return {
      label: recentNet >= 0 ? "Starting Up" : "Starting Down",
      detail: `${formatSignedMoney(recentNet)} across ${getTradeCountLabel(recentTrades.length)}`,
      tradeKeys,
      tone: recentNet >= 0 ? "positive" : "negative"
    };
  }
  if (recentAvg > previousAvg && recentNet > 0) {
    return {
      label: "Improving",
      detail: `${formatSignedMoney(recentNet)} recent vs ${formatSignedMoney(previousNet)} prior`,
      tradeKeys,
      tone: "positive"
    };
  }
  if (recentAvg < previousAvg && recentNet < 0) {
    return {
      label: "Fading",
      detail: `${formatSignedMoney(recentNet)} recent vs ${formatSignedMoney(previousNet)} prior`,
      tradeKeys,
      tone: "negative"
    };
  }
  return {
    label: "Mixed",
    detail: `${formatSignedMoney(recentNet)} recent vs ${formatSignedMoney(previousNet)} prior`,
    tradeKeys,
    tone: "warning"
  };
};

type PlaybookConditionPick = PlaybookPerformanceBucket & {
  group: string;
};

const getBestConditionPick = (
  trades: GroupedTrade[],
  group: string,
  getValues: (trade: GroupedTrade) => string[]
): PlaybookConditionPick | null => {
  const buckets = new Map<string, PlaybookConditionPick>();
  for (const trade of trades) {
    const values = Array.from(new Set(getValues(trade).map((value) => value.trim()).filter(Boolean)));
    for (const value of values) {
      const key = value.toLowerCase();
      const current = buckets.get(key) ?? {
        group,
        label: value,
        netPnl: 0,
        trades: 0,
        winCount: 0,
        tradeKeys: []
      };
      current.netPnl += trade.netPnlUsd;
      current.trades += 1;
      current.winCount += trade.status === "Win" ? 1 : 0;
      current.tradeKeys.push(toTradeLinkKey(trade.id, trade.tradeDate));
      buckets.set(key, current);
    }
  }

  return Array.from(buckets.values()).sort(compareBestPerformanceBucket)[0] ?? null;
};

const getReviewPrompt = ({
  summary,
  recentPerformance,
  weakestTime,
  weakestTicker,
  worstTrade,
  winningTradeKeys,
  losingTradeKeys
}: {
  summary: ReturnType<typeof getTradeSummary>;
  recentPerformance: ReturnType<typeof getRecentTradePerformance>;
  weakestTime: PlaybookPerformanceBucket | null;
  weakestTicker: PlaybookPerformanceBucket | null;
  worstTrade: GroupedTrade | null;
  winningTradeKeys: string[];
  losingTradeKeys: string[];
}): { label: string; detail: string; tradeKeys: string[]; tone: PlaybookPerformanceTile["tone"] } => {
  if (summary.totalTrades === 0) {
    return { label: "Tag First Trades", detail: "No trades to review yet", tradeKeys: [], tone: "warning" };
  }
  if (summary.totalTrades < 10) {
    return { label: "Build More Sample", detail: "Review all current examples", tradeKeys: [...winningTradeKeys, ...losingTradeKeys], tone: "warning" };
  }
  if (recentPerformance && recentPerformance.netPnl < 0) {
    return { label: "Review Last 10", detail: "Recent form is negative", tradeKeys: recentPerformance.tradeKeys, tone: "negative" };
  }
  if (weakestTime && weakestTime.netPnl < 0) {
    return { label: "Study Weak Time", detail: `${weakestTime.label} is dragging P&L`, tradeKeys: weakestTime.tradeKeys, tone: "negative" };
  }
  if (weakestTicker && weakestTicker.netPnl < 0) {
    return { label: "Study Weak Ticker", detail: `${weakestTicker.label} is dragging P&L`, tradeKeys: weakestTicker.tradeKeys, tone: "negative" };
  }
  if (worstTrade && worstTrade.netPnlUsd < 0) {
    return {
      label: "Review Biggest Loss",
      detail: `${worstTrade.symbol || "Trade"} ${formatSignedMoney(worstTrade.netPnlUsd)}`,
      tradeKeys: [toTradeLinkKey(worstTrade.id, worstTrade.tradeDate)],
      tone: "warning"
    };
  }
  return { label: "Repeat Winners", detail: "Study what is working", tradeKeys: winningTradeKeys, tone: "positive" };
};

const getPlaybookConfidence = (tradeCount: number): PlaybookConfidence => {
  if (tradeCount >= 50) {
    return "High Confidence";
  }

  if (tradeCount >= 20) {
    return "Medium Confidence";
  }

  return "Low Confidence";
};

const getPlaybookStatus = (
  playbook: PlaybookRecord,
  tradeCount: number,
  totalNetPnl: number
): PlaybookStatus => {
  if (playbook.status !== "Testing") {
    return playbook.status;
  }

  if (tradeCount >= 50 && totalNetPnl >= 0) {
    return "Proven";
  }

  if (tradeCount >= 20 && totalNetPnl < 0) {
    return "Needs Review";
  }

  if (tradeCount >= 20) {
    return "Active";
  }

  return "Testing";
};

const getPlaybookStatusBadgeClassName = (status: PlaybookStatus): string => {
  switch (status) {
    case "Active":
      return "playbook-status-badge playbook-status-badge-active";
    case "Proven":
      return "playbook-status-badge playbook-status-badge-proven";
    case "Needs Review":
      return "playbook-status-badge playbook-status-badge-review";
    case "Retired":
      return "playbook-status-badge playbook-status-badge-retired";
    case "Testing":
    default:
      return "playbook-status-badge playbook-status-badge-testing";
  }
};

const getPlaybookConfidenceBadgeClassName = (confidence: PlaybookConfidence): string => {
  switch (confidence) {
    case "High Confidence":
      return "playbook-confidence-badge playbook-confidence-badge-high";
    case "Medium Confidence":
      return "playbook-confidence-badge playbook-confidence-badge-medium";
    case "Low Confidence":
    default:
      return "playbook-confidence-badge playbook-confidence-badge-low";
  }
};

const getAverageWinnerLoserLabel = (
  averageWinner: number,
  averageLoser: number,
  tradeCount: number
): string => {
  if (tradeCount === 0) {
    return "-";
  }

  const averageWinnerLabel = averageWinner !== 0 ? formatSignedMoney(averageWinner) : "-";
  const averageLoserLabel = averageLoser !== 0 ? formatSignedMoney(averageLoser) : "-";
  return `${averageWinnerLabel} / ${averageLoserLabel}`;
};

const getPlaybookSectionAnchorId = (playbookId: string, sectionId: string): string =>
  `playbook-section-${playbookId}-${sectionId}`;

const formatDateToTradeKey = (value: Date): string => {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const getPlaybookHeroWindowStart = (window: PlaybookHeroWindow): string | null => {
  if (window === "all") {
    return null;
  }

  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const lookbackDays = window === "30d" ? 29 : 6;
  start.setDate(start.getDate() - lookbackDays);
  return formatDateToTradeKey(start);
};

const matchesPlaybook = (trade: GroupedTrade, playbook: PlaybookRecord): boolean =>
  toSafeArray<string>(trade.setups).some((setup) =>
    playbook.aliases.some(
      (alias) => normalizePlaybookName(alias) === normalizePlaybookName(toSafeText(setup))
    )
  );

const getPlaybookSetupTypes = (trades: GroupedTrade[], playbook: PlaybookRecord): string[] => {
  const aliasSet = new Set(
    [...playbook.aliases, playbook.name].map((alias) => normalizePlaybookName(alias))
  );
  const setupCounts = trades.reduce<Map<string, number>>((acc, trade) => {
    toSafeArray<string>(trade.setups).forEach((setup) => {
      const normalizedSetup = normalizePlaybookName(toSafeText(setup));
      if (!aliasSet.has(normalizedSetup)) {
        return;
      }

      const trimmed = toSafeText(setup).trim();
      if (!trimmed) {
        return;
      }

      acc.set(trimmed, (acc.get(trimmed) ?? 0) + 1);
    });
    return acc;
  }, new Map());

  const sorted = Array.from(setupCounts.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([setup]) => setup);

  return sorted.length > 0 ? sorted : [playbook.name];
};

const createPlaybookCardData = (playbook: PlaybookRecord, trades: GroupedTrade[]): PlaybookCardData => {
  const summary = getTradeSummary(trades);
  const setupTypes = getPlaybookSetupTypes(trades, playbook);
  const setupType = setupTypes[0] ?? playbook.name;
  const uniqueSymbols = Array.from(
    new Set(
      trades
        .map((trade) => toSafeText(trade.symbol).trim())
        .filter((symbol) => symbol.length > 0)
    )
  );
  const confidence = getPlaybookConfidence(trades.length);
  const status = getPlaybookStatus(playbook, trades.length, summary.totalNetPnl);
  const averageWinner = getAverageWinner(trades);
  const averageLoser = getAverageLoser(trades);
  const searchTokens = [
    playbook.name,
    playbook.description,
    setupType,
    ...setupTypes,
    ...uniqueSymbols
  ];

  return {
    playbook,
    trades,
    summary,
    status,
    confidence,
    setupType,
    setupTypes,
    topSymbols: getTopSymbols(trades),
    uniqueSymbolCount: uniqueSymbols.length,
    averageWinner,
    averageLoser,
    searchText: searchTokens.join(" ").toLowerCase()
  };
};

const PLACEHOLDER_DESCRIPTION = "Build this playbook out with your rules, examples, and chart notes.";

const hasMeaningfulJournalContent = (value: unknown): boolean => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const node = value as { text?: unknown; content?: unknown };
  if (typeof node.text === "string" && node.text.trim().length > 0) {
    return true;
  }

  if (!Array.isArray(node.content)) {
    return false;
  }

  return node.content.some((child) => hasMeaningfulJournalContent(child));
};

const shouldShowPlaybook = (entry: PlaybookCardData): boolean => {
  if (entry.trades.length > 0) {
    return true;
  }

  if (entry.playbook.screenshotUrls.length > 0) {
    return true;
  }

  if ((Array.isArray(entry.playbook.aPlusExamples) ? entry.playbook.aPlusExamples : []).length > 0) {
    return true;
  }

  if (entry.playbook.description !== PLACEHOLDER_DESCRIPTION) {
    return true;
  }

  return entry.playbook.sections.some((section) => hasMeaningfulJournalContent(section.content));
};

export const PlaybooksPage = ({
  trades,
  journalPages = [],
  navigationState,
  onNavigationStateChange,
  onSelectTrade,
  onOpenJournalDate,
  onViewReportsForPlaybook,
  embedded = false
}: PlaybooksPageProps) => {
  const Shell = embedded ? "div" : "main";
  const [playbooks, setPlaybooks] = useState<PlaybookRecord[]>(() => loadPlaybooks());
  const [selectedPlaybookId, setSelectedPlaybookId] = useState<string | null>(
    () => navigationState?.selectedPlaybookId ?? null
  );
  const [lastOpenedPlaybookId, setLastOpenedPlaybookId] = useState<string | null>(null);
  const [heroWindow, setHeroWindow] = useState<PlaybookHeroWindow>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [tradeSearchQuery, setTradeSearchQuery] = useState("");
  const [activeTradeFocusFilter, setActiveTradeFocusFilter] = useState<PlaybookTradeFocusFilter | null>(null);
  const [expandedTradeIds, setExpandedTradeIds] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilterValue>("all");
  const [tickerFilter, setTickerFilter] = useState<string>("all");
  const [setupTypeFilter, setSetupTypeFilter] = useState<string>("all");
  const [confidenceFilter, setConfidenceFilter] = useState<ConfidenceFilterValue>("all");
  const [netPnlFilter, setNetPnlFilter] = useState<NetPnlFilterValue>("all");
  const [activePlaybookPage, setActivePlaybookPage] = useState<PlaybookDetailPage>(
    () => navigationState?.activePlaybookPage ?? "playbook"
  );
  const [expandedScreenshotUrl, setExpandedScreenshotUrl] = useState("");
  const [isScreenshotZoomed, setIsScreenshotZoomed] = useState(false);
  const hasRetriedDesktopRecoveryRef = useRef(false);
  const playbooksRef = useRef<PlaybookRecord[]>([]);
  playbooksRef.current = playbooks;

  const updatePlaybooksNavigation = (nextState: PlaybooksNavigationState) => {
    setSelectedPlaybookId(nextState.selectedPlaybookId);
    setActivePlaybookPage(nextState.activePlaybookPage);
    onNavigationStateChange?.(nextState);
  };

  const updateActivePlaybookPage = (nextPage: PlaybookDetailPage) => {
    setActivePlaybookPage(nextPage);
    onNavigationStateChange?.({
      selectedPlaybookId,
      activePlaybookPage: nextPage
    });
  };

  const persistPlaybooks = (nextPlaybooks: PlaybookRecord[]) => {
    playbooksRef.current = nextPlaybooks;
    setPlaybooks(nextPlaybooks);
  };

  const createPlaybookInlineImageInsertHandler = (playbookId: string, sectionId: string) => async (file: File) =>
    saveWorkspaceInlineImage({
      category: "playbook-inline-images",
      recordId: playbookId,
      slotKey: sectionId,
      file
    });

  useDebouncedSave(
    playbooks,
    900,
    (nextPlaybooks) => {
      savePlaybooks(nextPlaybooks);
    },
    true,
    { skipInitialSave: true }
  );

  useEffect(() => {
    if (hasRetriedDesktopRecoveryRef.current) {
      return;
    }

    hasRetriedDesktopRecoveryRef.current = true;
    void (async () => {
      const recoveredPlaybooks = await recoverPlaybooksFromDesktopBackup(playbooksRef.current);
      if (!recoveredPlaybooks) {
        return;
      }

      persistPlaybooks(recoveredPlaybooks);
    })();
  }, []);

  useEffect(() => {
    const handleHydrated = () => {
      const nextPlaybooks = loadPlaybooks();
      setPlaybooks(nextPlaybooks);
      void (async () => {
        const recoveredPlaybooks = await recoverPlaybooksFromDesktopBackup(nextPlaybooks);
        if (!recoveredPlaybooks) {
          return;
        }

        persistPlaybooks(recoveredPlaybooks);
      })();
    };

    window.addEventListener(SYNC_HYDRATED_EVENT, handleHydrated);
    return () => window.removeEventListener(SYNC_HYDRATED_EVENT, handleHydrated);
  }, []);

  useEffect(() => {
    setTradeSearchQuery("");
    setActiveTradeFocusFilter(null);
    setExpandedTradeIds([]);
  }, [selectedPlaybookId]);

  useEffect(() => {
    if (!navigationState) {
      return;
    }

    setSelectedPlaybookId((current) =>
      current === navigationState.selectedPlaybookId ? current : navigationState.selectedPlaybookId
    );
    setActivePlaybookPage((current) =>
      current === navigationState.activePlaybookPage ? current : navigationState.activePlaybookPage
    );
  }, [navigationState?.activePlaybookPage, navigationState?.selectedPlaybookId]);

  useEffect(() => {
    onNavigationStateChange?.({
      selectedPlaybookId,
      activePlaybookPage
    });
  }, [activePlaybookPage, onNavigationStateChange, selectedPlaybookId]);

  const playbookCards = useMemo<PlaybookCardData[]>(
    () =>
      playbooks
        .map((playbook) => ({
          playbook,
          trades: trades.filter((trade) => matchesPlaybook(trade, playbook))
        }))
        .map(({ playbook, trades: matchedTrades }) => createPlaybookCardData(playbook, matchedTrades))
        .filter(shouldShowPlaybook),
    [playbooks, trades]
  );

  const selectedPlaybook = useMemo(
    () => playbookCards.find((entry) => entry.playbook.id === selectedPlaybookId) ?? null,
    [playbookCards, selectedPlaybookId]
  );

  const taggedCharts = useMemo<TaggedPlaybookChartData[]>(() => {
    if (!selectedPlaybook) {
      return [];
    }

    if (journalPages.length === 0) {
      return [];
    }

    const playbookNameSet = new Set(
      [selectedPlaybook.playbook.name, ...selectedPlaybook.playbook.aliases]
        .map((name) => normalizePlaybookName(name))
        .filter(Boolean)
    );
    if (playbookNameSet.size === 0) {
      return [];
    }

    const linkedTradeByIdAndDate = new Map<string, GroupedTrade>();
    const linkedTradeById = new Map<string, GroupedTrade>();
    for (const trade of trades) {
      linkedTradeByIdAndDate.set(toTradeLinkKey(trade.id, trade.tradeDate), trade);
      if (!linkedTradeById.has(trade.id)) {
        linkedTradeById.set(trade.id, trade);
      }
    }

    const matches: TaggedPlaybookChartData[] = [];

    for (const page of journalPages) {
      const pageScreenshots = Array.isArray(page.screenshotUrls) ? page.screenshotUrls : [];
      if (pageScreenshots.length === 0) {
        continue;
      }

      const pageTags = Array.isArray(page.screenshotTags) ? page.screenshotTags : [];
      for (const [index, screenshotUrl] of pageScreenshots.entries()) {
        if (!screenshotUrl) {
          continue;
        }

        const screenshotTag = pageTags[index];
        const screenshotTradeLinks = getScreenshotTradeLinks(screenshotTag);
        const linkedTradeKeys = screenshotTradeLinks.map((link) =>
          toTradeLinkKey(link.tradeId, link.tradeDate)
        );
        const resolvedLinkedTradeMap = new Map<string, GroupedTrade>();
        for (const link of screenshotTradeLinks) {
          const resolvedTrade =
            linkedTradeByIdAndDate.get(toTradeLinkKey(link.tradeId, link.tradeDate)) ??
            linkedTradeById.get(link.tradeId) ??
            null;
          if (!resolvedTrade) {
            continue;
          }

          resolvedLinkedTradeMap.set(toTradeLinkKey(resolvedTrade.id, resolvedTrade.tradeDate), resolvedTrade);
        }
        const linkedTrades = Array.from(resolvedLinkedTradeMap.values());
        const linkedTrade = linkedTrades[0] ?? null;
        const candidatePlaybookNames = [
          screenshotTag && typeof screenshotTag.playbook === "string" ? screenshotTag.playbook : "",
          ...linkedTrades.flatMap((trade) => toSafeArray<string>(trade.setups))
        ]
          .map((name) => normalizePlaybookName(name))
          .filter(Boolean);
        if (!candidatePlaybookNames.some((name) => playbookNameSet.has(name))) {
          continue;
        }

        const slotMeta = getPlaybookScreenshotSlotMeta(index);
        const taggedDate =
          screenshotTag && typeof screenshotTag.taggedDate === "string" && screenshotTag.taggedDate.trim().length > 0
            ? screenshotTag.taggedDate
            : page.tradeDate;

        matches.push({
          id: `${page.id}-${index}`,
          screenshotUrl,
          label: slotMeta.label,
          rowLabel: slotMeta.rowLabel,
          taggedDate,
          journalDate: page.tradeDate,
          ticker:
            screenshotTag && typeof screenshotTag.ticker === "string" && screenshotTag.ticker.trim().length > 0
              ? screenshotTag.ticker.toUpperCase()
              : linkedTrade?.symbol ?? "",
          playbookLabel:
            screenshotTag && typeof screenshotTag.playbook === "string" ? screenshotTag.playbook : "",
          linkedTradeKeys,
          linkedTrades,
          missingLinkedTradeCount: Math.max(0, linkedTradeKeys.length - linkedTrades.length)
        });
      }
    }

    return matches.sort((left, right) => {
      const taggedDateCompare = getCalendarSortValue(right.taggedDate) - getCalendarSortValue(left.taggedDate);
      if (taggedDateCompare !== 0) {
        return taggedDateCompare;
      }

      const journalDateCompare = getCalendarSortValue(right.journalDate) - getCalendarSortValue(left.journalDate);
      if (journalDateCompare !== 0) {
        return journalDateCompare;
      }

      return left.id.localeCompare(right.id);
    });
  }, [journalPages, selectedPlaybook, trades]);

  const linkedTradeCount = useMemo(
    () =>
      new Set(
        taggedCharts.flatMap((entry) => entry.linkedTradeKeys)
      ).size,
    [taggedCharts]
  );

  const tradeNoteLookup = useMemo(() => {
    const byLink = new Map<string, { note: JournalTradeNoteRecord; page: JournalPageRecord }>();
    const byTradeId = new Map<string, { note: JournalTradeNoteRecord; page: JournalPageRecord }>();
    for (const page of journalPages) {
      const tradeNotes = Array.isArray(page.tradeNotes) ? page.tradeNotes : [];
      for (const note of tradeNotes) {
        for (const link of getJournalTradeNoteLinks(note)) {
          const key = toTradeLinkKey(link.tradeId, link.tradeDate);
          const preferred = pickPreferredTradeNote(byLink.get(key), { note, page });
          byLink.set(key, preferred);
          byTradeId.set(link.tradeId, pickPreferredTradeNote(byTradeId.get(link.tradeId), preferred));
        }
      }
    }

    return { byLink, byTradeId };
  }, [journalPages]);

  useEffect(() => {
    if (!selectedPlaybookId) {
      return;
    }

    if (playbookCards.some((entry) => entry.playbook.id === selectedPlaybookId)) {
      return;
    }

    setSelectedPlaybookId(null);
  }, [playbookCards, selectedPlaybookId]);

  const heroWindowStart = useMemo(() => getPlaybookHeroWindowStart(heroWindow), [heroWindow]);

  const playbookCardsInWindow = useMemo(
    () =>
      playbookCards
        .map((entry) => {
          const matchedTrades =
            heroWindowStart === null
              ? entry.trades
              : entry.trades.filter((trade) => trade.tradeDate >= heroWindowStart);
          return createPlaybookCardData(entry.playbook, matchedTrades);
        })
        .filter(shouldShowPlaybook),
    [playbookCards, heroWindowStart]
  );

  const statusFilterOptions = useMemo(
    () => [
      { label: "All Statuses", value: "all" },
      ...playbookStatusOptions.map((status) => ({ label: status, value: status }))
    ],
    []
  );

  const tickerFilterOptions = useMemo(() => {
    const tickers = Array.from(
      new Set(playbookCards.flatMap((entry) => entry.trades.map((trade) => trade.symbol)))
    ).sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }));
    return [{ label: "All Tickers", value: "all" }, ...tickers.map((ticker) => ({ label: ticker, value: ticker }))];
  }, [playbookCards]);

  const selectedPlaybookTickerOptions = useMemo(() => {
    const tickers = Array.from(
      new Set(
        (selectedPlaybook?.trades ?? [])
          .map((trade) => toSafeText(trade.symbol).trim())
          .filter((symbol) => symbol.length > 0)
      )
    ).sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }));
    return [{ label: "All Tickers", value: "all" }, ...tickers.map((ticker) => ({ label: ticker, value: ticker }))];
  }, [selectedPlaybook]);

  const setupTypeFilterOptions = useMemo(() => {
    const setupTypes = Array.from(new Set(playbookCards.flatMap((entry) => entry.setupTypes))).sort(
      (left, right) => left.localeCompare(right, undefined, { sensitivity: "base" })
    );
    return [{ label: "All Setup Types", value: "all" }, ...setupTypes.map((setupType) => ({ label: setupType, value: setupType }))];
  }, [playbookCards]);

  const confidenceFilterOptions = useMemo(
    () => [
      { label: "All Confidence", value: "all" },
      ...playbookConfidenceOptions.map((confidence) => ({ label: confidence, value: confidence }))
    ],
    []
  );

  const netPnlFilterOptions = useMemo(
    () => [
      { label: "All P&L", value: "all" },
      { label: "Positive", value: "positive" },
      { label: "Negative", value: "negative" }
    ],
    []
  );

  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const filteredPlaybookCards = useMemo<FilteredPlaybookCardData[]>(
    () =>
      playbookCardsInWindow
        .map((entry) => {
          const filteredTrades = filterTradesByTicker(entry.trades, tickerFilter);
          const filteredSymbols = Array.from(
            new Set(
              filteredTrades
                .map((trade) => toSafeText(trade.symbol).trim())
                .filter((symbol) => symbol.length > 0)
            )
          );

          return {
            ...entry,
            filteredTrades,
            filteredSummary: getTradeSummary(filteredTrades),
            filteredTopSymbols: getTopSymbols(filteredTrades),
            filteredUniqueSymbolCount: filteredSymbols.length,
            filteredAverageWinner: getAverageWinner(filteredTrades),
            filteredAverageLoser: getAverageLoser(filteredTrades)
          };
        })
        .filter((entry) => {
          if (statusFilter !== "all" && entry.status !== statusFilter) {
            return false;
          }

          if (tickerFilter !== "all" && entry.filteredTrades.length === 0) {
            return false;
          }

          if (
            setupTypeFilter !== "all" &&
            !entry.setupTypes.some(
              (setupType) => normalizePlaybookName(setupType) === normalizePlaybookName(setupTypeFilter)
            )
          ) {
            return false;
          }

          if (confidenceFilter !== "all" && entry.confidence !== confidenceFilter) {
            return false;
          }

          if (netPnlFilter === "positive" && entry.filteredSummary.totalNetPnl <= 0) {
            return false;
          }

          if (netPnlFilter === "negative" && entry.filteredSummary.totalNetPnl >= 0) {
            return false;
          }

          if (!normalizedSearchQuery) {
            return true;
          }

          return entry.searchText.includes(normalizedSearchQuery);
        }),
    [
      playbookCardsInWindow,
      statusFilter,
      tickerFilter,
      setupTypeFilter,
      confidenceFilter,
      netPnlFilter,
      normalizedSearchQuery
    ]
  );

  const totalTaggedTrades = useMemo(
    () => filteredPlaybookCards.reduce((sum, entry) => sum + entry.filteredTrades.length, 0),
    [filteredPlaybookCards]
  );

  const activePlaybookCount = useMemo(
    () =>
      filteredPlaybookCards.filter(
        (entry) => entry.status === "Active" || entry.status === "Proven"
      ).length,
    [filteredPlaybookCards]
  );

  const playbooksWithTrades = useMemo(
    () => filteredPlaybookCards.filter((entry) => entry.filteredTrades.length > 0),
    [filteredPlaybookCards]
  );

  const heroTradesInWindow = useMemo(
    () => playbooksWithTrades.reduce((sum, entry) => sum + entry.filteredTrades.length, 0),
    [playbooksWithTrades]
  );

  const heroWinsInWindow = useMemo(
    () => playbooksWithTrades.reduce((sum, entry) => sum + entry.filteredSummary.winCount, 0),
    [playbooksWithTrades]
  );

  const heroLossesInWindow = useMemo(
    () => playbooksWithTrades.reduce((sum, entry) => sum + entry.filteredSummary.lossCount, 0),
    [playbooksWithTrades]
  );

  const heroNetPnlInWindow = useMemo(
    () => playbooksWithTrades.reduce((sum, entry) => sum + entry.filteredSummary.totalNetPnl, 0),
    [playbooksWithTrades]
  );

  const heroWinRateInWindow =
    heroTradesInWindow > 0 ? (heroWinsInWindow / heroTradesInWindow) * 100 : 0;

  const comparePlaybookNames = (left: PlaybookCardData, right: PlaybookCardData): number =>
    left.playbook.name.localeCompare(right.playbook.name, undefined, { sensitivity: "base" });

  const bestPlaybook = useMemo(() => {
    if (playbooksWithTrades.length === 0) {
      return null;
    }

    return [...playbooksWithTrades].sort((left, right) => {
      const pnlCompare = right.filteredSummary.totalNetPnl - left.filteredSummary.totalNetPnl;
      if (pnlCompare !== 0) {
        return pnlCompare;
      }

      const tradeCompare = right.filteredTrades.length - left.filteredTrades.length;
      if (tradeCompare !== 0) {
        return tradeCompare;
      }

      return comparePlaybookNames(left, right);
    })[0];
  }, [playbooksWithTrades]);

  const mostTradedPlaybook = useMemo(() => {
    if (playbooksWithTrades.length === 0) {
      return null;
    }

    return [...playbooksWithTrades].sort((left, right) => {
      const tradeCompare = right.filteredTrades.length - left.filteredTrades.length;
      if (tradeCompare !== 0) {
        return tradeCompare;
      }

      const pnlCompare = right.filteredSummary.totalNetPnl - left.filteredSummary.totalNetPnl;
      if (pnlCompare !== 0) {
        return pnlCompare;
      }

      return comparePlaybookNames(left, right);
    })[0];
  }, [playbooksWithTrades]);

  const bestPlaybookLabel = bestPlaybook
    ? bestPlaybook.playbook.name
    : "No playbook data";
  const bestPlaybookMetaLabel = bestPlaybook
    ? `${formatSignedMoney(bestPlaybook.filteredSummary.totalNetPnl)} net`
    : "Tag trades to surface leaders";
  const mostTradedPlaybookLabel = mostTradedPlaybook
    ? mostTradedPlaybook.playbook.name
    : "No playbook data";
  const mostTradedPlaybookMetaLabel = mostTradedPlaybook
    ? `${mostTradedPlaybook.filteredTrades.length} trade${mostTradedPlaybook.filteredTrades.length === 1 ? "" : "s"} tagged`
    : "Tag trades to surface leaders";

  const sortedPlaybookCards = useMemo(() => {
    return [...filteredPlaybookCards].sort((left, right) => {
      const updatedCompare = right.playbook.updatedAt.localeCompare(left.playbook.updatedAt);
      if (updatedCompare !== 0) {
        return updatedCompare;
      }

      const tradeCompare = right.filteredTrades.length - left.filteredTrades.length;
      if (tradeCompare !== 0) {
        return tradeCompare;
      }

      return comparePlaybookNames(left, right);
    });
  }, [filteredPlaybookCards]);

  const hasActiveFilters =
    searchQuery.trim().length > 0 ||
    statusFilter !== "all" ||
    tickerFilter !== "all" ||
    setupTypeFilter !== "all" ||
    confidenceFilter !== "all" ||
    netPnlFilter !== "all";

  const handleOpenPlaybook = (playbookId: string) => {
    setLastOpenedPlaybookId(playbookId);
    updatePlaybooksNavigation({
      selectedPlaybookId: playbookId,
      activePlaybookPage: "playbook"
    });
  };

  const handleAddPlaybook = () => {
    const nextName = window.prompt("New playbook name");
    if (!nextName) {
      return;
    }

    const result = addPlaybookRecord(playbooks, nextName);
    if (!result.playbookId) {
      return;
    }

    persistPlaybooks(result.playbooks);
    handleOpenPlaybook(result.playbookId);
  };

  useEffect(() => {
    setExpandedScreenshotUrl("");
  }, [selectedPlaybook?.playbook.id]);

  useEffect(() => {
    if (!expandedScreenshotUrl) {
      setIsScreenshotZoomed(false);
    }
  }, [expandedScreenshotUrl]);

  const heroWindowLabel =
    playbookHeroWindowOptions.find((option) => option.value === heroWindow)?.label ?? "All";

  if (!selectedPlaybook) {
    return (
      <Shell className="page-shell">
        <PageHero
          eyebrow="Playbooks"
          title="Playbooks"
          icon="playbooks"
          className="page-hero-playbooks"
        />

        <div className="playbooks-hero-content">
          <div className="playbooks-hero-window-toolbar" aria-label="Playbook period controls">
            {playbookHeroWindowOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`playbooks-hero-window-chip${heroWindow === option.value ? " is-active" : ""}`}
                onClick={() => setHeroWindow(option.value)}
              >
                {option.label}
              </button>
            ))}
            {hasActiveFilters ? (
              <button
                type="button"
                className="mini-action mini-action-soft"
                onClick={() => {
                  setSearchQuery("");
                  setStatusFilter("all");
                  setTickerFilter("all");
                  setSetupTypeFilter("all");
                  setConfidenceFilter("all");
                  setNetPnlFilter("all");
                }}
              >
                Reset Filters
              </button>
            ) : null}
          </div>
        </div>

        <section className="playbook-database" aria-label="Playbooks table view">
          <div className="playbook-database-header">
            <div className="playbook-database-title">
              <WorkspaceIcon icon="playbooks" alt="" className="panel-header-icon" />
              <div>
                <h3>Playbooks</h3>
                <span>
                  {sortedPlaybookCards.length}
                  {sortedPlaybookCards.length !== playbookCardsInWindow.length
                    ? ` of ${playbookCardsInWindow.length}`
                    : ""}{" "}
                  playbook{sortedPlaybookCards.length === 1 ? "" : "s"} - {totalTaggedTrades} tagged trade
                  {totalTaggedTrades === 1 ? "" : "s"} - {heroWindowLabel}
                </span>
              </div>
            </div>
            <button className="button button-primary" type="button" onClick={handleAddPlaybook}>
              New Playbook
            </button>
          </div>

          <div className="playbook-database-controls" aria-label="Playbook database controls">
            <div className="playbook-database-search-row">
              <input
                type="search"
                className="playbook-search-input"
                value={searchQuery}
                placeholder="Search playbooks, tickers, setup types, and descriptions..."
                onChange={(event) => setSearchQuery(event.target.value)}
                aria-label="Search playbooks"
              />
              {searchQuery.trim().length > 0 ? (
                <button type="button" className="mini-action" onClick={() => setSearchQuery("")}>
                  Clear
                </button>
              ) : null}
            </div>
            <div className="playbook-database-filter-row">
              <FilterSelect
                value={statusFilter}
                options={statusFilterOptions}
                ariaLabel="Filter playbooks by status"
                onChange={(value) => setStatusFilter(value as StatusFilterValue)}
              />
              <FilterSelect
                value={tickerFilter}
                options={tickerFilterOptions}
                ariaLabel="Filter playbooks by ticker"
                onChange={setTickerFilter}
              />
              <FilterSelect
                value={setupTypeFilter}
                options={setupTypeFilterOptions}
                ariaLabel="Filter playbooks by setup type"
                onChange={setSetupTypeFilter}
              />
              <FilterSelect
                value={confidenceFilter}
                options={confidenceFilterOptions}
                ariaLabel="Filter playbooks by confidence"
                onChange={(value) => setConfidenceFilter(value as ConfidenceFilterValue)}
              />
              <FilterSelect
                value={netPnlFilter}
                options={netPnlFilterOptions}
                ariaLabel="Filter playbooks by net P&L sign"
                onChange={(value) => setNetPnlFilter(value as NetPnlFilterValue)}
              />
            </div>
          </div>

          <div className="library-table-wrap playbook-table-wrap">
            <table className="library-table playbook-table">
              <thead>
                <tr>
                  <th>Playbook Name</th>
                  <th>Status</th>
                  <th>Confidence</th>
                  <th>Tagged Trades</th>
                  <th>Win Rate</th>
                  <th>Net P&amp;L</th>
                  <th>Avg Winner / Loser</th>
                  <th>Symbols</th>
                  <th>Last Updated</th>
                </tr>
              </thead>
              <tbody>
                {sortedPlaybookCards.length > 0 ? (
                  sortedPlaybookCards.map((entry) => {
                    const { playbook, filteredTrades, filteredSummary } = entry;
                    const overflowSymbols = Math.max(
                      0,
                      entry.filteredUniqueSymbolCount - entry.filteredTopSymbols.length
                    );

                    return (
                      <tr
                        key={playbook.id}
                        className={
                          lastOpenedPlaybookId === playbook.id
                            ? "library-table-row-active playbook-table-row-active"
                            : ""
                        }
                        onClick={() => handleOpenPlaybook(playbook.id)}
                      >
                        <td>
                          <button
                            type="button"
                            className="library-table-title playbook-table-title"
                            onClick={(event) => {
                              event.stopPropagation();
                              handleOpenPlaybook(playbook.id);
                            }}
                          >
                            {playbook.name}
                          </button>
                          <div className="playbook-table-description">{playbook.description}</div>
                        </td>
                        <td>
                          <span className={getPlaybookStatusBadgeClassName(entry.status)}>
                            {entry.status}
                          </span>
                        </td>
                        <td>
                          <span className={getPlaybookConfidenceBadgeClassName(entry.confidence)}>
                            {entry.confidence}
                          </span>
                        </td>
                        <td>{filteredTrades.length}</td>
                        <td>{filteredSummary.totalTrades > 0 ? `${filteredSummary.winRate.toFixed(1)}%` : "-"}</td>
                        <td
                          className={filteredSummary.totalTrades > 0 ? getSignedValueClassName(filteredSummary.totalNetPnl) : ""}
                        >
                          {filteredSummary.totalTrades > 0 ? formatSignedMoney(filteredSummary.totalNetPnl) : "-"}
                        </td>
                        <td>
                          {getAverageWinnerLoserLabel(
                            entry.filteredAverageWinner,
                            entry.filteredAverageLoser,
                            filteredTrades.length
                          )}
                        </td>
                        <td className="playbook-symbol-cell">
                          <SymbolPills symbols={entry.filteredTopSymbols} overflowCount={overflowSymbols} />
                        </td>
                        <td>{formatUpdatedAt(playbook.updatedAt)}</td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={9} className="playbook-table-empty">
                      {hasActiveFilters
                        ? "No playbooks match the current search and filters."
                        : "No playbooks yet. Click \"New Playbook\" to create your first setup."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </Shell>
    );
  }
  const selectedPlaybookTickerFilter = selectedPlaybookTickerOptions.some((option) => option.value === tickerFilter)
    ? tickerFilter
    : "all";
  const scopedSelectedTrades = filterTradesByTicker(selectedPlaybook.trades, selectedPlaybookTickerFilter);
  const summary = getTradeSummary(scopedSelectedTrades);
  const symbolCount = new Set(scopedSelectedTrades.map((trade) => trade.symbol)).size;
  const topSymbols = getTopSymbols(scopedSelectedTrades);
  const averageWinner = getAverageWinner(scopedSelectedTrades);
  const averageLoser = getAverageLoser(scopedSelectedTrades);
  const recentMatchLabel =
    scopedSelectedTrades.length > 0
      ? ([...scopedSelectedTrades].sort(
          (left, right) => toSafeText(right.tradeDate).localeCompare(toSafeText(left.tradeDate))
        )[0]?.tradeDate ?? "No matches yet")
      : "No matches yet";
  const taggedTrades = [...scopedSelectedTrades]
    .sort(
      (left, right) =>
        toSafeText(right.tradeDate).localeCompare(toSafeText(left.tradeDate)) ||
        toSafeText(right.openTime).localeCompare(toSafeText(left.openTime))
    );
  const activeTradeFocusKeySet = new Set(activeTradeFocusFilter?.tradeKeys ?? []);
  const normalizedTradeSearchQuery = tradeSearchQuery.trim().toLowerCase();
  const filteredTaggedTrades = taggedTrades.filter((trade) => {
    if (activeTradeFocusFilter && !activeTradeFocusKeySet.has(toTradeLinkKey(trade.id, trade.tradeDate))) {
      return false;
    }

    if (!normalizedTradeSearchQuery) {
      return true;
    }

    const searchFields = [
      trade.name,
      trade.symbol,
      trade.side,
      trade.status,
      trade.tradeDate,
      trade.openTime,
      trade.closeTime,
      ...toSafeArray<string>(trade.setups)
    ];
    return searchFields.join(" ").toLowerCase().includes(normalizedTradeSearchQuery);
  });
  const isStudyLibraryPage = activePlaybookPage === "a-plus" || activePlaybookPage === "trades";
  const aPlusExamples = toSafeArray<PlaybookRecord["aPlusExamples"][number]>(
    selectedPlaybook.playbook.aPlusExamples
  );
  const aPlusExampleCount = aPlusExamples.length;
  const scopedTradeIdSet = new Set(scopedSelectedTrades.map((trade) => trade.id));
  const scopedAPlusExampleCount =
    selectedPlaybookTickerFilter === "all"
      ? aPlusExampleCount
      : aPlusExamples.filter((example) => {
          const selectedTicker = normalizeTickerValue(selectedPlaybookTickerFilter);
          const snapshotSymbol = normalizeTickerValue(toSafeText(example.tradeSnapshot?.symbol));
          return scopedTradeIdSet.has(example.tradeId) || snapshotSymbol === selectedTicker;
        }).length;
  const performanceStatus = getPlaybookStatus(
    selectedPlaybook.playbook,
    scopedSelectedTrades.length,
    summary.totalNetPnl
  );
  const performanceConfidence = getPlaybookConfidence(scopedSelectedTrades.length);
  const recentFormPerformance = getRecentTradePerformance(scopedSelectedTrades, 10);
  const bestTimePerformance = getBestTimePerformance(scopedSelectedTrades);
  const bestTickerPerformance = getBestTickerPerformance(scopedSelectedTrades);
  const bestDayPerformance = getBestDayPerformance(scopedSelectedTrades);
  const weakestTimePerformance = getWeakestTimePerformance(scopedSelectedTrades);
  const weakestTickerPerformance = getWeakestTickerPerformance(scopedSelectedTrades);
  const bestPnlTrade = getBestPnlTrade(scopedSelectedTrades);
  const worstPnlTrade = getWorstPnlTrade(scopedSelectedTrades);
  const winningTradeKeys = scopedSelectedTrades
    .filter((trade) => trade.status === "Win")
    .map((trade) => toTradeLinkKey(trade.id, trade.tradeDate));
  const losingTradeKeys = scopedSelectedTrades
    .filter((trade) => trade.status !== "Win")
    .map((trade) => toTradeLinkKey(trade.id, trade.tradeDate));
  const allScopedTradeKeys = scopedSelectedTrades.map((trade) => toTradeLinkKey(trade.id, trade.tradeDate));
  const recentTrend = getRecentTradeTrend(scopedSelectedTrades, 10);
  const edgeScore = getEdgeScore(summary, recentFormPerformance);
  const sampleSizeSignal = getSampleSizeSignal(scopedSelectedTrades.length);
  const bestConditionPicks = [
    getBestConditionPick(scopedSelectedTrades, "Side", (trade) => [trade.side]),
    getBestConditionPick(scopedSelectedTrades, "Setup", (trade) => toSafeArray<string>(trade.setups)),
    getBestConditionPick(scopedSelectedTrades, "Catalyst", (trade) => toSafeArray<string>(trade.catalyst)),
    getBestConditionPick(scopedSelectedTrades, "Execution", (trade) => toSafeArray<string>(trade.execution))
  ].filter((pick): pick is PlaybookConditionPick => Boolean(pick));
  const bestConditionTradeKeys = Array.from(
    new Set(bestConditionPicks.flatMap((pick) => pick.tradeKeys))
  );
  const bestConditionLabel =
    bestConditionPicks.length > 0 ? bestConditionPicks.slice(0, 3).map((pick) => pick.label).join(" / ") : "None yet";
  const bestConditionDetail =
    bestConditionPicks.length > 0
      ? bestConditionPicks
          .slice(0, 2)
          .map((pick) => `${pick.group} ${formatSignedMoney(pick.netPnl)}`)
          .join(" / ")
      : "No tagged conditions yet";
  const avoidDetail = [
    weakestTimePerformance
      ? `${weakestTimePerformance.label} ${formatSignedMoney(weakestTimePerformance.netPnl)}`
      : "",
    weakestTickerPerformance
      ? `${weakestTickerPerformance.label} ${formatSignedMoney(weakestTickerPerformance.netPnl)}`
      : ""
  ]
    .filter(Boolean)
    .join(" / ");
  const avoidTradeKeys = Array.from(
    new Set([
      ...(weakestTimePerformance?.tradeKeys ?? []),
      ...(weakestTickerPerformance?.tradeKeys ?? [])
    ])
  );
  const recentMatchTradeKeys =
    recentMatchLabel === "No matches yet"
      ? []
      : scopedSelectedTrades
          .filter((trade) => trade.tradeDate === recentMatchLabel)
          .map((trade) => toTradeLinkKey(trade.id, trade.tradeDate));
  const topSymbolTradeKeys = scopedSelectedTrades
    .filter((trade) => topSymbols.includes(toSafeText(trade.symbol)))
    .map((trade) => toTradeLinkKey(trade.id, trade.tradeDate));
  const reviewPrompt = getReviewPrompt({
    summary,
    recentPerformance: recentFormPerformance,
    weakestTime: weakestTimePerformance,
    weakestTicker: weakestTickerPerformance,
    worstTrade: worstPnlTrade,
    winningTradeKeys,
    losingTradeKeys
  });

  const focusTradeStudy = (
    label: string,
    description: string,
    tradeKeys: string[],
    options: { expandFirst?: boolean } = {}
  ) => {
    const uniqueTradeKeys = Array.from(new Set(tradeKeys));
    if (uniqueTradeKeys.length === 0) {
      return;
    }

    setActiveTradeFocusFilter({ label, description, tradeKeys: uniqueTradeKeys });
    setTradeSearchQuery("");
    setExpandedTradeIds(options.expandFirst ? uniqueTradeKeys.slice(0, 1) : []);
    updateActivePlaybookPage("trades");

    if (typeof window !== "undefined") {
      window.setTimeout(() => {
        document.getElementById("playbook-trades-study-panel")?.scrollIntoView({
          behavior: "smooth",
          block: "start"
        });
      }, 0);
    }
  };

  const performanceStatTiles: PlaybookPerformanceTile[] = [
    { label: "Status", value: performanceStatus },
    { label: "Confidence", value: performanceConfidence },
    {
      label: "Edge Score",
      value: `${edgeScore.score}/100`,
      detail: `${edgeScore.label} - ${edgeScore.detail}`,
      tone: edgeScore.tone,
      actionLabel: "View trades",
      onClick: () => focusTradeStudy("Edge Score", `${edgeScore.label} across current playbook trades.`, allScopedTradeKeys)
    },
    {
      label: "Sample Size",
      value: sampleSizeSignal.label,
      detail: `${scopedSelectedTrades.length} trade${scopedSelectedTrades.length === 1 ? "" : "s"} - ${sampleSizeSignal.detail}`,
      tone: sampleSizeSignal.tone,
      actionLabel: "View sample",
      onClick: () => focusTradeStudy("Sample Size", sampleSizeSignal.detail, allScopedTradeKeys)
    },
    {
      label: "Wins / Losses",
      value: `${summary.winCount}W - ${summary.lossCount}L`,
      actionLabel: "View all",
      onClick: () => focusTradeStudy("Wins / Losses", "All trades behind this win/loss split.", allScopedTradeKeys)
    },
    {
      label: "Win Rate",
      value: `${summary.winRate.toFixed(1)}%`,
      detail: `${summary.winCount} of ${summary.totalTrades} winners`,
      tone: summary.winRate >= 50 ? "positive" : "warning",
      actionLabel: "View wins",
      onClick: () => focusTradeStudy("Winning Trades", "Trades counted as winners in this playbook.", winningTradeKeys)
    },
    {
      label: "Recent Form",
      value: recentFormPerformance ? formatSignedMoney(recentFormPerformance.netPnl) : "None yet",
      detail: recentFormPerformance
        ? `${recentFormPerformance.label} / ${recentFormPerformance.winRate} win rate`
        : "No recent trades",
      tone: recentFormPerformance ? (recentFormPerformance.netPnl >= 0 ? "positive" : "negative") : "warning",
      actionLabel: "View recent",
      onClick: () =>
        focusTradeStudy(
          "Recent Form",
          recentFormPerformance?.label ?? "Recent trades",
          recentFormPerformance?.tradeKeys ?? []
        )
    },
    {
      label: "Recent Trend",
      value: recentTrend.label,
      detail: recentTrend.detail,
      tone: recentTrend.tone,
      actionLabel: "View trend",
      onClick: () => focusTradeStudy("Recent Trend", recentTrend.detail, recentTrend.tradeKeys)
    },
    {
      label: "Recent Match",
      value: recentMatchLabel,
      actionLabel: "View date",
      onClick: () => focusTradeStudy("Recent Match", `Trades from ${recentMatchLabel}.`, recentMatchTradeKeys)
    },
    {
      label: "Top Symbols",
      value: topSymbols.length > 0 ? topSymbols.join(", ") : "None yet",
      actionLabel: "View top",
      onClick: () => focusTradeStudy("Top Symbols", "Trades from the top symbols in this playbook.", topSymbolTradeKeys)
    },
    {
      label: "Best Conditions",
      value: bestConditionLabel,
      detail: bestConditionDetail,
      actionLabel: "View conditions",
      onClick: () => focusTradeStudy("Best Conditions", "Trades behind the strongest side/setup/catalyst/execution conditions.", bestConditionTradeKeys)
    },
    {
      label: "Avg Winner / Loser",
      value: `${formatSignedMoney(averageWinner)} / ${formatSignedMoney(averageLoser)}`,
      actionLabel: "View wins",
      onClick: () => focusTradeStudy("Average Winners", "Winning trades behind the average winner.", winningTradeKeys)
    },
    {
      label: "Best Time",
      value: bestTimePerformance?.label ?? "None yet",
      detail: bestTimePerformance
        ? `${formatSignedMoney(bestTimePerformance.netPnl)} / ${getTradeCountLabel(bestTimePerformance.trades)}`
        : "No timed trades",
      tone: bestTimePerformance && bestTimePerformance.netPnl >= 0 ? "positive" : undefined,
      actionLabel: "View time",
      onClick: () =>
        focusTradeStudy(
          "Best Time",
          bestTimePerformance ? `${bestTimePerformance.label} trades.` : "Best time trades.",
          bestTimePerformance?.tradeKeys ?? []
        )
    },
    {
      label: "Best Ticker",
      value: bestTickerPerformance?.label ?? "None yet",
      detail: bestTickerPerformance
        ? `${formatSignedMoney(bestTickerPerformance.netPnl)} / ${getTradeCountLabel(bestTickerPerformance.trades)}`
        : "No ticker trades",
      tone: bestTickerPerformance && bestTickerPerformance.netPnl >= 0 ? "positive" : undefined,
      actionLabel: "View ticker",
      onClick: () =>
        focusTradeStudy(
          "Best Ticker",
          bestTickerPerformance ? `${bestTickerPerformance.label} trades.` : "Best ticker trades.",
          bestTickerPerformance?.tradeKeys ?? []
        )
    },
    {
      label: "Best Day",
      value: bestDayPerformance?.label ?? "None yet",
      detail: bestDayPerformance
        ? `${formatSignedMoney(bestDayPerformance.netPnl)} / ${getTradeCountLabel(bestDayPerformance.trades)} / ${getPerformanceBucketWinRate(bestDayPerformance)}`
        : "No dated trades",
      tone: bestDayPerformance && bestDayPerformance.netPnl >= 0 ? "positive" : undefined,
      actionLabel: "View day",
      onClick: () =>
        focusTradeStudy(
          "Best Day",
          bestDayPerformance ? `${bestDayPerformance.label} trades.` : "Best day trades.",
          bestDayPerformance?.tradeKeys ?? []
        )
    },
    {
      label: "Avoid",
      value: weakestTimePerformance?.label ?? weakestTickerPerformance?.label ?? "None yet",
      detail: avoidDetail || "No weak spots yet",
      tone: avoidTradeKeys.length > 0 ? "negative" : undefined,
      actionLabel: "View weak spots",
      onClick: () => focusTradeStudy("Avoid", "Trades behind the weakest time and ticker spots.", avoidTradeKeys)
    },
    {
      label: "Best P/L",
      value: bestPnlTrade ? formatSignedMoney(bestPnlTrade.netPnlUsd) : "None yet",
      detail: bestPnlTrade
        ? `${bestPnlTrade.symbol || "Trade"} - ${formatCalendarDate(bestPnlTrade.tradeDate)}`
        : "No trades",
      tone: "positive",
      actionLabel: "Open trade",
      onClick: () =>
        focusTradeStudy(
          "Best P/L",
          "The strongest single trade in this playbook.",
          bestPnlTrade ? [toTradeLinkKey(bestPnlTrade.id, bestPnlTrade.tradeDate)] : [],
          { expandFirst: true }
        )
    },
    {
      label: "Worst P/L",
      value: worstPnlTrade ? formatSignedMoney(worstPnlTrade.netPnlUsd) : "None yet",
      detail: worstPnlTrade
        ? `${worstPnlTrade.symbol || "Trade"} - ${formatCalendarDate(worstPnlTrade.tradeDate)}`
        : "No trades",
      tone: worstPnlTrade && worstPnlTrade.netPnlUsd < 0 ? "negative" : undefined,
      actionLabel: "Review trade",
      onClick: () =>
        focusTradeStudy(
          "Worst P/L",
          "The weakest single trade in this playbook.",
          worstPnlTrade ? [toTradeLinkKey(worstPnlTrade.id, worstPnlTrade.tradeDate)] : [],
          { expandFirst: true }
        )
    },
    {
      label: "A+ Count",
      value: String(scopedAPlusExampleCount),
      detail:
        selectedPlaybookTickerFilter === "all"
          ? `${aPlusExampleCount} study example${aPlusExampleCount === 1 ? "" : "s"}`
          : `${selectedPlaybookTickerFilter} study example${scopedAPlusExampleCount === 1 ? "" : "s"}`,
      actionLabel: "View A+",
      onClick: () => updateActivePlaybookPage("a-plus")
    },
    {
      label: "Review Prompt",
      value: reviewPrompt.label,
      detail: reviewPrompt.detail,
      tone: reviewPrompt.tone,
      actionLabel: "Review",
      onClick: () => focusTradeStudy("Review Prompt", reviewPrompt.detail, reviewPrompt.tradeKeys, { expandFirst: true })
    }
  ];
  const performanceMetricRows = [
    { label: "Net P&L", value: formatSignedMoney(summary.totalNetPnl) },
    { label: "Gross P&L", value: formatSignedMoney(summary.totalGrossPnl) },
    { label: "Fees", value: `$${summary.totalFees.toFixed(2)}` },
    { label: "Shares Traded", value: summary.totalSharesTraded.toLocaleString() },
    { label: "Profit Factor", value: summary.profitFactor.toFixed(2) },
    { label: "Symbols", value: String(symbolCount) },
    { label: "Avg Hold", value: `${summary.avgHoldMinutes.toFixed(1)}m` },
    { label: "Avg Trade", value: formatSignedMoney(summary.avgTrade) }
  ];
  const expandedTradeIdSet = new Set(expandedTradeIds);
  const chartEntriesByTradeKey = taggedCharts.reduce<Map<string, TaggedPlaybookChartData[]>>((acc, entry) => {
    for (const key of entry.linkedTradeKeys) {
      const current = acc.get(key) ?? [];
      current.push(entry);
      acc.set(key, current);
    }
    for (const trade of entry.linkedTrades) {
      const key = toTradeLinkKey(trade.id, trade.tradeDate);
      const current = acc.get(key) ?? [];
      if (!current.some((candidate) => candidate.id === entry.id)) {
        current.push(entry);
      }
      acc.set(key, current);
    }
    return acc;
  }, new Map());

  const toggleTradeExpanded = (tradeId: string) => {
    setExpandedTradeIds((current) =>
      current.includes(tradeId)
        ? current.filter((candidate) => candidate !== tradeId)
        : [...current, tradeId]
    );
  };

  const handleScrollToSection = (sectionId: string) => {
    if (typeof document === "undefined") {
      return;
    }

    const anchorId = getPlaybookSectionAnchorId(selectedPlaybook.playbook.id, sectionId);
    const sectionElement = document.getElementById(anchorId);
    sectionElement?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <Shell className="page-shell">
      <PageHero
        eyebrow="Playbooks"
        title={selectedPlaybook.playbook.name}
        icon="playbooks"
      />

      <section className="playbook-toolbar">
        <div className="playbook-toolbar-actions">
          <button
            type="button"
            className="mini-action"
            onClick={() =>
              updatePlaybooksNavigation({
                selectedPlaybookId: null,
                activePlaybookPage
              })
            }
          >
            Back To Playbooks
          </button>
          <div className="playbook-subnav" role="tablist" aria-label="Playbook pages">
            <button
              type="button"
              role="tab"
              aria-selected={activePlaybookPage === "playbook"}
              className={`mini-action mini-action-soft${activePlaybookPage === "playbook" ? " playbook-subnav-active" : ""}`}
              onClick={() => updateActivePlaybookPage("playbook")}
            >
              Playbook
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activePlaybookPage === "tagged-charts"}
              className={`mini-action mini-action-soft${activePlaybookPage === "tagged-charts" ? " playbook-subnav-active" : ""}`}
              onClick={() => updateActivePlaybookPage("tagged-charts")}
            >
              Tagged Charts
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={isStudyLibraryPage}
              className={`mini-action mini-action-soft${isStudyLibraryPage ? " playbook-subnav-active" : ""}`}
              onClick={() => updateActivePlaybookPage("a-plus")}
            >
              A+ / Trades
            </button>
            {onViewReportsForPlaybook ? (
              <button
                type="button"
                role="tab"
                aria-selected={false}
                className="mini-action mini-action-soft"
                onClick={() => onViewReportsForPlaybook(selectedPlaybook.playbook.name)}
              >
                Reports
              </button>
            ) : null}
          </div>
          <div className="playbook-detail-ticker-filter">
            <FilterSelect
              value={selectedPlaybookTickerFilter}
              options={selectedPlaybookTickerOptions}
              ariaLabel="Filter this playbook by ticker"
              onChange={(nextTicker) => {
                setTickerFilter(nextTicker);
                setActiveTradeFocusFilter(null);
                setExpandedTradeIds([]);
              }}
            />
          </div>
        </div>
        <span>
          {activePlaybookPage === "tagged-charts"
            ? `${taggedCharts.length} tagged chart${taggedCharts.length === 1 ? "" : "s"} in journal (${linkedTradeCount} linked trade${linkedTradeCount === 1 ? "" : "s"}).`
            : isStudyLibraryPage
              ? `${filteredTaggedTrades.length} ${activeTradeFocusFilter ? "focused " : ""}trade${filteredTaggedTrades.length === 1 ? "" : "s"} shown and ${aPlusExampleCount} A+ example${aPlusExampleCount === 1 ? "" : "s"} available for ${selectedPlaybook.playbook.name}.`
              : `${symbolCount} symbol${symbolCount === 1 ? "" : "s"} matched across tagged examples - ${selectedPlaybook.playbook.sections.length} section${selectedPlaybook.playbook.sections.length === 1 ? "" : "s"}.`}
        </span>
      </section>

      {activePlaybookPage === "playbook" ? (
        <section className="playbook-section-nav" aria-label="Playbook section navigation">
          <strong>Jump To</strong>
          <div className="playbook-section-nav-list">
            {selectedPlaybook.playbook.sections.map((section) => (
              <button
                key={`${selectedPlaybook.playbook.id}-${section.id}-nav`}
                type="button"
                className="playbook-section-nav-chip"
                onClick={() => handleScrollToSection(section.id)}
              >
                {section.title}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <section className="playbook-detail-layout">
        {activePlaybookPage === "playbook" ? (
          <div className="playbook-sections-column">
            <article className="placeholder-panel playbook-section-card playbook-performance-card">
              <div className="panel-header">
                <WorkspaceIcon
                  icon="dashboard"
                  alt="Playbook stats icon"
                  className="panel-header-icon"
                />
                <h2>Playbook Performance</h2>
              </div>
              <div className="playbook-aside-stat-grid">
                {performanceStatTiles.map((tile) => {
                  const tileClassName = [
                    "playbook-aside-stat-tile",
                    tile.onClick ? "playbook-aside-stat-tile-clickable" : "",
                    tile.tone ? `playbook-aside-stat-tile-${tile.tone}` : ""
                  ]
                    .filter(Boolean)
                    .join(" ");
                  const tileContent = (
                    <>
                      <span>{tile.label}</span>
                      <strong>{tile.value}</strong>
                      {tile.detail ? <small>{tile.detail}</small> : null}
                      {tile.onClick && tile.actionLabel ? <em>{tile.actionLabel}</em> : null}
                    </>
                  );

                  return tile.onClick ? (
                    <button key={tile.label} type="button" className={tileClassName} onClick={tile.onClick}>
                      {tileContent}
                    </button>
                  ) : (
                    <div key={tile.label} className={tileClassName}>
                      {tileContent}
                    </div>
                  );
                })}
              </div>
              <div className="playbook-metric-list playbook-performance-metric-list">
                {performanceMetricRows.map((row) => (
                  <div key={row.label} className="playbook-metric-row">
                    <span>{row.label}</span>
                    <strong>{row.value}</strong>
                  </div>
                ))}
              </div>
            </article>
            {selectedPlaybook.playbook.sections.map((section) => (
              <article
                key={section.id}
                id={getPlaybookSectionAnchorId(selectedPlaybook.playbook.id, section.id)}
                className="placeholder-panel journal-writing-section playbook-section-card"
              >
                <div className="journal-writing-header">
                  <div className="journal-writing-header-title playbook-section-title">
                    <WorkspaceIcon
                      icon="text"
                      alt={`${section.title} icon`}
                      className="mini-action-icon"
                    />
                    <div className="playbook-section-title-copy">
                      <strong>{section.title}</strong>
                      <span>{section.description}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="mini-action mini-action-soft playbook-section-top-action"
                    onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
                  >
                    Top
                  </button>
                </div>
                <JournalRichTextEditor
                  content={section.content}
                  onChange={(content) =>
                    persistPlaybooks(
                      updatePlaybookSectionContent(
                        playbooksRef.current,
                        selectedPlaybook.playbook.id,
                        section.id,
                        content
                      )
                    )
                  }
                  onImageInsert={createPlaybookInlineImageInsertHandler(selectedPlaybook.playbook.id, section.id)}
                  placeholder="Type '/' for commands"
                  appearance="notion"
                />
              </article>
            ))}
          </div>
        ) : activePlaybookPage === "tagged-charts" ? (
          <div className="playbook-sections-column">
            <article className="placeholder-panel playbook-section-card playbook-tagged-charts-panel">
              <div className="panel-header">
                <WorkspaceIcon
                  icon="journal"
                  alt="Tagged charts icon"
                  className="panel-header-icon"
                />
                <h2>Tagged Charts</h2>
              </div>
              <span className="playbook-example-subtitle">
                Journal screenshots tagged to {selectedPlaybook.playbook.name}.
              </span>
              {taggedCharts.length > 0 ? (
                <div className="playbook-tagged-chart-grid">
                  {taggedCharts.map((entry, index) => {
                    const screenshotSrc = resolveWorkspaceAttachmentSrc(entry.screenshotUrl);
                    const linkedTradePreview = entry.linkedTrades
                      .slice(0, 2)
                      .map((trade) => formatLinkedTradeLabel(trade))
                      .join(", ");
                    const extraLinkedTradeCount = Math.max(0, entry.linkedTrades.length - 2);
                    const linkedTradeStatus =
                      entry.linkedTrades.length > 0
                        ? `Linked trade${entry.linkedTrades.length === 1 ? "" : "s"}: ${linkedTradePreview}${
                            extraLinkedTradeCount > 0 ? ` (+${extraLinkedTradeCount} more)` : ""
                          }${entry.missingLinkedTradeCount > 0 ? ` (${entry.missingLinkedTradeCount} missing)` : ""}`
                        : entry.playbookLabel.trim().length > 0
                          ? `Tagged playbook: ${entry.playbookLabel}`
                          : "No trade linked on this chart yet.";

                    return (
                      <article key={entry.id} className="journal-screenshot-card playbook-tagged-chart-card">
                        <div className="journal-screenshot-card-header">
                          <div className="journal-screenshot-card-title">
                            <strong>{entry.label}</strong>
                            <span>{entry.rowLabel}</span>
                          </div>
                        </div>
                        <button
                          type="button"
                          className="journal-screenshot-preview-button"
                          onClick={() => setExpandedScreenshotUrl(entry.screenshotUrl)}
                        >
                          <img
                            className="journal-screenshot-image"
                            src={screenshotSrc}
                            alt={`${selectedPlaybook.playbook.name} tagged chart ${index + 1}`}
                          />
                        </button>
                        <div className="playbook-tagged-chart-meta">
                          <span className="playbook-meta-pill">Tagged {formatCalendarDate(entry.taggedDate)}</span>
                          <span className="playbook-meta-pill">
                            Journal {formatCalendarDate(entry.journalDate)}
                          </span>
                          {entry.ticker ? <span className="playbook-meta-pill">{entry.ticker}</span> : null}
                        </div>
                        <span className="journal-screenshot-link-status playbook-tagged-chart-link-status">
                          {linkedTradeStatus}
                        </span>
                        <div className="journal-screenshot-actions playbook-tagged-chart-actions">
                          {entry.linkedTrades.slice(0, 3).map((trade) => (
                            <button
                              key={`${entry.id}-${trade.id}-${trade.tradeDate}`}
                              type="button"
                              className="mini-action mini-action-soft"
                              onClick={() => onSelectTrade(trade.id, trade.tradeDate)}
                            >
                              Open {formatLinkedTradeLabel(trade)}
                            </button>
                          ))}
                          {onOpenJournalDate ? (
                            <button
                              type="button"
                              className="mini-action mini-action-soft"
                              onClick={() => onOpenJournalDate(entry.journalDate)}
                            >
                              Open Journal Day
                            </button>
                          ) : null}
                          <a
                            className="mini-action mini-action-soft"
                            href={screenshotSrc}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Open Image
                          </a>
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="empty-state">
                  No journal screenshots are tagged to this playbook yet. Tag screenshots in Journal and they will
                  appear here.
                </div>
              )}
            </article>
          </div>
        ) : isStudyLibraryPage ? (
          <div className="playbook-sections-column">
            <APlusExampleLibrary
              playbook={selectedPlaybook.playbook}
              matchedTrades={scopedSelectedTrades}
              allTrades={trades}
              journalPages={journalPages}
              tickerFilter={selectedPlaybookTickerFilter}
              taggedCharts={taggedCharts}
              onSelectTrade={onSelectTrade}
              onOpenJournalDate={onOpenJournalDate}
              onExpandImage={setExpandedScreenshotUrl}
              setPlaybooks={setPlaybooks}
            />
            <article
              id="playbook-trades-study-panel"
              className="placeholder-panel playbook-section-card playbook-trades-panel"
            >
              <div className="panel-header">
                <WorkspaceIcon
                  icon="trades"
                  alt="Trades icon"
                  className="panel-header-icon"
                />
                <h2>Trades</h2>
              </div>
              <span className="playbook-example-subtitle">
                Study every trade tagged to {selectedPlaybook.playbook.name} with the same card layout as A+ examples.
              </span>
              {activeTradeFocusFilter ? (
                <div className="playbook-trade-focus-banner">
                  <div>
                    <span>Focused View</span>
                    <strong>{activeTradeFocusFilter.label}</strong>
                    <small>{activeTradeFocusFilter.description}</small>
                  </div>
                  <button
                    type="button"
                    className="mini-action mini-action-soft"
                    onClick={() => {
                      setActiveTradeFocusFilter(null);
                      setExpandedTradeIds([]);
                    }}
                  >
                    Clear Focus
                  </button>
                </div>
              ) : null}
              <div className="playbook-database-search-row">
                <input
                  type="search"
                  className="playbook-search-input"
                  value={tradeSearchQuery}
                  onChange={(event) => setTradeSearchQuery(event.target.value)}
                  placeholder="Search trades by symbol, name, side, status, or date"
                  aria-label="Search trades"
                />
                {tradeSearchQuery.trim().length > 0 ? (
                  <button type="button" className="mini-action mini-action-soft" onClick={() => setTradeSearchQuery("")}>
                    Clear
                  </button>
                ) : null}
              </div>
              <div className="playbook-aplus-entry-list playbook-trade-study-list">
                {filteredTaggedTrades.length > 0 ? (
                  filteredTaggedTrades.map((trade) => {
                    const tradeKey = toTradeLinkKey(trade.id, trade.tradeDate);
                    const isExpanded = expandedTradeIdSet.has(tradeKey);
                    const chartEntries = chartEntriesByTradeKey.get(tradeKey) ?? [];
                    const screenshotSrcs = chartEntries.map((entry) => resolveWorkspaceAttachmentSrc(entry.screenshotUrl));
                    const firstScreenshotSrc = screenshotSrcs[0] ?? "";
                    const screenshotCountLabel =
                      screenshotSrcs.length > 1 ? `${screenshotSrcs.length} charts` : screenshotSrcs.length === 1 ? "1 chart" : "No chart";
                    const journalTradeNoteMatch =
                      tradeNoteLookup.byLink.get(tradeKey) ?? tradeNoteLookup.byTradeId.get(trade.id);
                    const journalTradeNote = journalTradeNoteMatch?.note ?? null;
                    const journalTradeNotePage = journalTradeNoteMatch?.page ?? null;
                    const journalTradeNoteText = journalTradeNote ? extractJournalDocText(journalTradeNote.content) : "";
                    const notePreview = journalTradeNoteText
                      ? truncateText(journalTradeNoteText, 180)
                      : "No tagged journal note yet.";
                    const setupLabel =
                      toSafeArray<string>(trade.setups).find((candidate) => candidate.trim().length > 0) ??
                      selectedPlaybook.playbook.name;
                    const holdLabel = getTradeHoldLabel(trade);
                    const priceEdgePerShare =
                      trade.side === "Long" ? trade.exitPrice - trade.entryPrice : trade.entryPrice - trade.exitPrice;
                    const tradeStateLabel = `${trade.side} ${trade.status}`.trim();
                    const statsSourceLabel = `${trade.status} - ${trade.side} - ${trade.game || "No game tag"}`;
                    const scoreTiles = [
                      { label: "Game", value: trade.game || "-" },
                      {
                        label: "Net PnL",
                        value: formatSignedMoney(trade.netPnlUsd),
                        className: getSignedValueClassName(trade.netPnlUsd)
                      },
                      {
                        label: "R/Share",
                        value: formatSignedPerShare(trade.returnPerShare),
                        className: getSignedValueClassName(trade.returnPerShare)
                      },
                      {
                        label: "Price Edge",
                        value: formatSignedPerShare(priceEdgePerShare),
                        className: getSignedValueClassName(priceEdgePerShare)
                      },
                      { label: "Hold", value: holdLabel }
                    ];
                    const blueprintRows = [
                      { label: "Symbol", value: trade.symbol || "-" },
                      { label: "Setup", value: setupLabel },
                      { label: "Game", value: trade.game || "-" },
                      { label: "Side / Result", value: `${trade.side || "-"} / ${trade.status || "-"}` },
                      { label: "Date", value: formatCalendarDate(trade.tradeDate) },
                      { label: "Source", value: "Linked trade" }
                    ];
                    const executionRows = [
                      { label: "Entry / Exit", value: `${formatPrice(trade.entryPrice)} / ${formatPrice(trade.exitPrice)}` },
                      { label: "Open / Close", value: `${trade.openTime || "-"} / ${trade.closeTime || "-"}` },
                      { label: "Size", value: formatSize(trade.size) },
                      {
                        label: "Executions",
                        value: String(toSafeArray<unknown>(trade.openingExecutions).length + toSafeArray<unknown>(trade.closingExecutions).length)
                      },
                      {
                        label: "Adds",
                        value: `${toSafeArray<unknown>(trade.addSignals).length} total`
                      },
                      { label: "Fees", value: formatMoney(trade.feesUsd) }
                    ];
                    const tagGroups = [
                      { label: "Mistakes", values: journalTradeNote?.mistakes.length ? journalTradeNote.mistakes : toSafeArray<string>(trade.mistakes) },
                      { label: "Catalyst", values: toSafeArray<string>(trade.catalyst) },
                      { label: "Execution", values: toSafeArray<string>(trade.execution) },
                      { label: "Out", values: toSafeArray<string>(trade.outTag) },
                      { label: "Gateway", values: toSafeArray<string>(trade.gateways) }
                    ].filter((group) => group.values.some((value) => value.trim().length > 0));

                    return (
                      <section
                        key={tradeKey}
                        className={`playbook-aplus-entry playbook-trade-study-entry${isExpanded ? " playbook-aplus-entry-expanded" : ""}`}
                      >
                        <div className="playbook-aplus-summary-card">
                          <button
                            type="button"
                            className={`playbook-aplus-summary-media${
                              firstScreenshotSrc ? "" : " playbook-aplus-summary-media-empty"
                            }`}
                            onClick={() => (firstScreenshotSrc ? setExpandedScreenshotUrl(chartEntries[0]?.screenshotUrl ?? "") : toggleTradeExpanded(tradeKey))}
                          >
                            {firstScreenshotSrc ? (
                              <>
                                <img src={firstScreenshotSrc} alt={`${trade.name} screenshot`} />
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
                                <strong>{trade.name}</strong>
                                <span className="playbook-aplus-entry-subtitle">
                                  {trade.symbol} - {formatCalendarDate(trade.tradeDate)}
                                </span>
                              </div>
                              <div className="playbook-aplus-summary-pills">
                                <span className="playbook-aplus-link-status playbook-aplus-link-status-linked">
                                  Linked
                                </span>
                                <span className="playbook-aplus-link-status playbook-aplus-link-status-note">
                                  {journalTradeNote ? "Journal note" : "No journal note"}
                                </span>
                                <span className="playbook-aplus-link-status playbook-aplus-link-status-rating">
                                  {trade.game || "Trade"}
                                </span>
                              </div>
                            </div>
                            <div className="playbook-aplus-entry-meta">
                              <span className="playbook-meta-pill">Date {formatCalendarDate(trade.tradeDate)}</span>
                              <span className="playbook-meta-pill">Setup {setupLabel}</span>
                              <span className="playbook-meta-pill">{tradeStateLabel}</span>
                            </div>
                            <div className="playbook-aplus-summary-stat-row">
                              <span>
                                <small>Net PnL</small>
                                <strong className={getSignedValueClassName(trade.netPnlUsd)}>
                                  {formatSignedMoney(trade.netPnlUsd)}
                                </strong>
                              </span>
                              <span>
                                <small>R/Share</small>
                                <strong className={getSignedValueClassName(trade.returnPerShare)}>
                                  {formatSignedPerShare(trade.returnPerShare)}
                                </strong>
                              </span>
                              <span>
                                <small>Hold</small>
                                <strong>{holdLabel}</strong>
                              </span>
                            </div>
                            <div
                              className={`playbook-aplus-summary-note-card${
                                journalTradeNoteText ? "" : " playbook-aplus-summary-note-card-empty"
                              }`}
                            >
                              <div className="playbook-aplus-summary-note-heading">
                                <span>Tagged journal note</span>
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
                                  onClick={() => toggleTradeExpanded(tradeKey)}
                                >
                                  {isExpanded ? "Collapse" : "Study Card"}
                                </button>
                                <button
                                  type="button"
                                  className="mini-action mini-action-soft"
                                  onClick={() => onSelectTrade(trade.id, trade.tradeDate)}
                                >
                                  Open Trade
                                </button>
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
                            <section className="playbook-aplus-study-card playbook-trade-study-card" aria-label="Trade study card">
                              <div className="playbook-aplus-study-card-header">
                                <div>
                                  <span>Study Card</span>
                                  <strong>{trade.name}</strong>
                                  <small>{statsSourceLabel}</small>
                                </div>
                                <div className="playbook-aplus-study-card-pills">
                                  <span className="playbook-aplus-link-status playbook-aplus-link-status-linked">
                                    Linked trade
                                  </span>
                                  <span className="playbook-aplus-link-status playbook-aplus-link-status-note">
                                    {journalTradeNote ? "Journal note" : "No journal note"}
                                  </span>
                                  <span className="playbook-aplus-link-status playbook-aplus-link-status-rating">
                                    {trade.game || "Trade"}
                                  </span>
                                </div>
                              </div>

                              <div className="playbook-aplus-study-score-grid">
                                {scoreTiles.map((tile) => (
                                  <div key={`${tradeKey}-score-${tile.label}`}>
                                    <span>{tile.label}</span>
                                    <strong className={tile.className}>{tile.value}</strong>
                                  </div>
                                ))}
                              </div>

                              <div className="playbook-aplus-study-grid">
                                <section className="playbook-aplus-study-section">
                                  <div className="playbook-aplus-study-section-header">
                                    <span>Trade Blueprint</span>
                                  </div>
                                  <dl className="playbook-aplus-study-detail-list">
                                    {blueprintRows.map((row) => (
                                      <div key={`${tradeKey}-blueprint-${row.label}`}>
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
                                    {executionRows.map((row) => (
                                      <div key={`${tradeKey}-execution-${row.label}`}>
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
                                  {tagGroups.length > 0 ? (
                                    <div className="playbook-aplus-study-tag-groups">
                                      {tagGroups.map((group) => (
                                        <div key={`${tradeKey}-tags-${group.label}`}>
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
                                        <span>{journalTradeNote.ticker || trade.symbol || "Trade"}</span>
                                        {journalTradeNote.playbook ? <span>{journalTradeNote.playbook}</span> : null}
                                        {journalTradeNote.mistakes.map((mistake) => (
                                          <span key={`${tradeKey}-mistake-${mistake}`}>{mistake}</span>
                                        ))}
                                      </div>
                                      <JournalRichTextEditor
                                        content={journalTradeNote.content}
                                        onChange={() => undefined}
                                        readOnly
                                        compact
                                        autosize
                                        appearance="notion"
                                        onImageOpen={setExpandedScreenshotUrl}
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
                                    </>
                                  ) : (
                                    <>
                                      <p className="playbook-aplus-study-empty">
                                        No tagged journal note is linked to this trade yet.
                                      </p>
                                      {onOpenJournalDate ? (
                                        <div className="playbook-aplus-journal-note-actions">
                                          <button
                                            type="button"
                                            className="mini-action mini-action-soft"
                                            onClick={() => onOpenJournalDate(trade.tradeDate)}
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

                            <div className="playbook-aplus-highlight-grid">
                              <section
                                className="playbook-aplus-media-panel playbook-aplus-media-panel-single"
                                aria-label="Trade media"
                              >
                                {screenshotSrcs.length > 0 ? (
                                  <div className="playbook-aplus-screenshot-grid">
                                    {screenshotSrcs.map((src, index) => (
                                      <div key={`${tradeKey}-shot-${index}`} className="playbook-aplus-screenshot-card">
                                        <button
                                          type="button"
                                          className="journal-screenshot-preview-button playbook-aplus-screenshot-button"
                                          style={{ backgroundImage: `url("${src}")` }}
                                          onClick={() => setExpandedScreenshotUrl(chartEntries[index]?.screenshotUrl ?? "")}
                                        >
                                          <img
                                            className="journal-screenshot-image playbook-aplus-screenshot-image"
                                            src={src}
                                            alt={`${trade.name} tagged chart`}
                                          />
                                        </button>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <div className="playbook-aplus-media-empty">
                                    No tagged chart screenshots are linked to this trade yet.
                                  </div>
                                )}
                              </section>

                              <section className="playbook-aplus-trade-stats" aria-label="Trade stats">
                                <div className="playbook-aplus-trade-stats-header">
                                  <strong>Trade Stats</strong>
                                  <span>{statsSourceLabel}</span>
                                </div>
                                <div className="playbook-aplus-meta-grid">
                                  <div className="playbook-aplus-meta-tile">
                                    <span>Symbol</span>
                                    <strong>{trade.symbol || "-"}</strong>
                                  </div>
                                  <div className="playbook-aplus-meta-tile">
                                    <span>Setup</span>
                                    <strong>{setupLabel}</strong>
                                  </div>
                                  <div className="playbook-aplus-meta-tile">
                                    <span>Win / Loss</span>
                                    <strong>{trade.status || "-"}</strong>
                                  </div>
                                </div>
                                <div className="playbook-aplus-stat-grid">
                                  <div className="playbook-aplus-stat-tile">
                                    <span>Net PnL</span>
                                    <strong className={getSignedValueClassName(trade.netPnlUsd)}>
                                      {formatSignedMoney(trade.netPnlUsd)}
                                    </strong>
                                  </div>
                                  <div className="playbook-aplus-stat-tile">
                                    <span>Return / Share</span>
                                    <strong className={getSignedValueClassName(trade.returnPerShare)}>
                                      {formatSignedPerShare(trade.returnPerShare)}
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
                                    <strong>{formatSize(trade.size)}</strong>
                                  </div>
                                  <div className="playbook-aplus-stat-tile">
                                    <span>Entry</span>
                                    <strong>{formatPrice(trade.entryPrice)}</strong>
                                  </div>
                                  <div className="playbook-aplus-stat-tile">
                                    <span>Exit</span>
                                    <strong>{formatPrice(trade.exitPrice)}</strong>
                                  </div>
                                  <div className="playbook-aplus-stat-tile">
                                    <span>Hold Time</span>
                                    <strong>{holdLabel}</strong>
                                  </div>
                                  <div className="playbook-aplus-stat-tile">
                                    <span>Executions</span>
                                    <strong>
                                      {toSafeArray<unknown>(trade.openingExecutions).length +
                                        toSafeArray<unknown>(trade.closingExecutions).length}
                                    </strong>
                                  </div>
                                  <div className="playbook-aplus-stat-tile">
                                    <span>Adds</span>
                                    <strong>{toSafeArray<unknown>(trade.addSignals).length} total</strong>
                                  </div>
                                  <div className="playbook-aplus-stat-tile">
                                    <span>Fees</span>
                                    <strong>{formatMoney(trade.feesUsd)}</strong>
                                  </div>
                                </div>
                              </section>
                            </div>
                          </>
                        ) : null}
                      </section>
                    );
                  })
                ) : taggedTrades.length > 0 ? (
                  <div className="empty-state">
                    {activeTradeFocusFilter
                      ? tradeSearchQuery.trim().length > 0
                        ? `No focused trades match "${tradeSearchQuery.trim()}".`
                        : "No trades match this focused view."
                      : `No trades match "${tradeSearchQuery.trim()}".`}
                  </div>
                ) : (
                  <div className="empty-state">
                    Tag trades with {selectedPlaybook.playbook.name} to see examples here.
                  </div>
                )}
              </div>
            </article>
          </div>
        ) : null}

      </section>

      {expandedScreenshotUrl ? (
        <div
          className="journal-lightbox"
          role="button"
          tabIndex={0}
          onClick={() => setExpandedScreenshotUrl("")}
          onKeyDown={(event) => {
            if (event.key === "Escape" || event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              setExpandedScreenshotUrl("");
            }
          }}
        >
          <div className="journal-lightbox-content" onClick={(event) => event.stopPropagation()}>
            <button
              type="button"
              className="mini-action mini-action-soft"
              onClick={() => setExpandedScreenshotUrl("")}
            >
              Close
            </button>
            <span className="journal-lightbox-hint">
              {isScreenshotZoomed ? "Click image to reset zoom." : "Click image to zoom in."}
            </span>
            <div className="journal-lightbox-image-frame">
              <img
                className={`journal-lightbox-image${isScreenshotZoomed ? " is-zoomed" : ""}`}
                src={resolveWorkspaceAttachmentSrc(expandedScreenshotUrl)}
                alt="Expanded playbook screenshot"
                role="button"
                tabIndex={0}
                onClick={() => setIsScreenshotZoomed((current) => !current)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setIsScreenshotZoomed((current) => !current);
                  }
                }}
              />
            </div>
          </div>
        </div>
      ) : null}
    </Shell>
  );
};

