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
  JournalScreenshotTradeLink
} from "../../../types/journal";
import type { PlaybookRecord, PlaybookStatus } from "../../../types/playbook";
import type { GroupedTrade } from "../../../types/trade";

interface PlaybooksPageProps {
  trades: GroupedTrade[];
  journalPages?: JournalPageRecord[];
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
type PlaybookDetailPage = "playbook" | "tagged-charts" | "trades" | "a-plus";

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
const toSafeText = (value: unknown): string => (typeof value === "string" ? value : "");
const toSafeArray = <T,>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

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
  onSelectTrade,
  onOpenJournalDate,
  onViewReportsForPlaybook,
  embedded = false
}: PlaybooksPageProps) => {
  const Shell = embedded ? "div" : "main";
  const [playbooks, setPlaybooks] = useState<PlaybookRecord[]>(() => loadPlaybooks());
  const [selectedPlaybookId, setSelectedPlaybookId] = useState<string | null>(null);
  const [lastOpenedPlaybookId, setLastOpenedPlaybookId] = useState<string | null>(null);
  const [heroWindow, setHeroWindow] = useState<PlaybookHeroWindow>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [tradeSearchQuery, setTradeSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilterValue>("all");
  const [tickerFilter, setTickerFilter] = useState<string>("all");
  const [setupTypeFilter, setSetupTypeFilter] = useState<string>("all");
  const [confidenceFilter, setConfidenceFilter] = useState<ConfidenceFilterValue>("all");
  const [netPnlFilter, setNetPnlFilter] = useState<NetPnlFilterValue>("all");
  const [activePlaybookPage, setActivePlaybookPage] = useState<PlaybookDetailPage>("playbook");
  const [expandedScreenshotUrl, setExpandedScreenshotUrl] = useState("");
  const [isScreenshotZoomed, setIsScreenshotZoomed] = useState(false);
  const hasRetriedDesktopRecoveryRef = useRef(false);
  const playbooksRef = useRef<PlaybookRecord[]>([]);
  playbooksRef.current = playbooks;

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
  }, [selectedPlaybookId]);

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
  const filteredPlaybookCards = useMemo(
    () =>
      playbookCardsInWindow.filter((entry) => {
        if (statusFilter !== "all" && entry.status !== statusFilter) {
          return false;
        }

        if (tickerFilter !== "all" && !entry.trades.some((trade) => trade.symbol === tickerFilter)) {
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

        if (netPnlFilter === "positive" && entry.summary.totalNetPnl <= 0) {
          return false;
        }

        if (netPnlFilter === "negative" && entry.summary.totalNetPnl >= 0) {
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
    () => filteredPlaybookCards.reduce((sum, entry) => sum + entry.trades.length, 0),
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
    () => filteredPlaybookCards.filter((entry) => entry.trades.length > 0),
    [filteredPlaybookCards]
  );

  const heroTradesInWindow = useMemo(
    () => playbooksWithTrades.reduce((sum, entry) => sum + entry.trades.length, 0),
    [playbooksWithTrades]
  );

  const heroWinsInWindow = useMemo(
    () => playbooksWithTrades.reduce((sum, entry) => sum + entry.summary.winCount, 0),
    [playbooksWithTrades]
  );

  const heroLossesInWindow = useMemo(
    () => playbooksWithTrades.reduce((sum, entry) => sum + entry.summary.lossCount, 0),
    [playbooksWithTrades]
  );

  const heroNetPnlInWindow = useMemo(
    () => playbooksWithTrades.reduce((sum, entry) => sum + entry.summary.totalNetPnl, 0),
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
      const pnlCompare = right.summary.totalNetPnl - left.summary.totalNetPnl;
      if (pnlCompare !== 0) {
        return pnlCompare;
      }

      const tradeCompare = right.trades.length - left.trades.length;
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
      const tradeCompare = right.trades.length - left.trades.length;
      if (tradeCompare !== 0) {
        return tradeCompare;
      }

      const pnlCompare = right.summary.totalNetPnl - left.summary.totalNetPnl;
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
    ? `${formatSignedMoney(bestPlaybook.summary.totalNetPnl)} net`
    : "Tag trades to surface leaders";
  const mostTradedPlaybookLabel = mostTradedPlaybook
    ? mostTradedPlaybook.playbook.name
    : "No playbook data";
  const mostTradedPlaybookMetaLabel = mostTradedPlaybook
    ? `${mostTradedPlaybook.trades.length} trade${mostTradedPlaybook.trades.length === 1 ? "" : "s"} tagged`
    : "Tag trades to surface leaders";

  const sortedPlaybookCards = useMemo(() => {
    return [...filteredPlaybookCards].sort((left, right) => {
      const updatedCompare = right.playbook.updatedAt.localeCompare(left.playbook.updatedAt);
      if (updatedCompare !== 0) {
        return updatedCompare;
      }

      const tradeCompare = right.trades.length - left.trades.length;
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
    setSelectedPlaybookId(playbookId);
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

  useEffect(() => {
    if (!selectedPlaybook?.playbook.id) {
      return;
    }

    setActivePlaybookPage("playbook");
  }, [selectedPlaybook?.playbook.id]);

  const heroWindowLabel =
    playbookHeroWindowOptions.find((option) => option.value === heroWindow)?.label ?? "All";

  if (!selectedPlaybook) {
    return (
      <Shell className="page-shell">
        <PageHero
          eyebrow="Playbooks"
          title="Playbooks"
          className="page-hero-playbooks"
          description={`Organize your setups, review examples, and track execution quality. ${heroWindowLabel} window in view.`}
          content={
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
              <div className="playbooks-hero-kpi-strip" aria-label="Playbook snapshot">
                <span className="playbook-meta-pill">
                  {heroTradesInWindow} tagged trade{heroTradesInWindow === 1 ? "" : "s"}
                </span>
                <span className="playbook-meta-pill">
                  {heroWinsInWindow}W - {heroLossesInWindow}L
                </span>
                <span
                  className={`playbook-meta-pill${
                    heroTradesInWindow > 0
                      ? heroNetPnlInWindow >= 0
                        ? " positive-value"
                        : " negative-value"
                      : ""
                  }`}
                >
                  {heroTradesInWindow > 0 ? formatSignedMoney(heroNetPnlInWindow) : "No tagged P&L yet"}
                </span>
              </div>
            </div>
          }
        >
          <div className="page-hero-stat-grid playbooks-hero-stat-grid">
            <div className="page-hero-stat-card">
              <span>Total Playbooks</span>
              <strong>{sortedPlaybookCards.length}</strong>
              <small>{heroWindowLabel} window</small>
            </div>
            <div className="page-hero-stat-card">
              <span>Active Playbooks</span>
              <strong>{activePlaybookCount}</strong>
              <small>Active plus Proven</small>
            </div>
            <div className="page-hero-stat-card">
              <span>Window Net P&amp;L</span>
              <strong className={heroTradesInWindow > 0 ? getSignedValueClassName(heroNetPnlInWindow) : ""}>
                {heroTradesInWindow > 0 ? formatSignedMoney(heroNetPnlInWindow) : "-"}
              </strong>
              <small>Combined across tagged playbooks</small>
            </div>
            <div className="page-hero-stat-card">
              <span>Window Win Rate</span>
              <strong>{heroTradesInWindow > 0 ? `${heroWinRateInWindow.toFixed(1)}%` : "-"}</strong>
              <small>
                {heroTradesInWindow > 0
                  ? `${heroWinsInWindow}W - ${heroLossesInWindow}L`
                  : "Tag trades to compute win rate"}
              </small>
            </div>
            <button
              type="button"
              className="page-hero-stat-card page-hero-stat-card-action"
              onClick={() => {
                if (bestPlaybook) {
                  handleOpenPlaybook(bestPlaybook.playbook.id);
                }
              }}
              disabled={!bestPlaybook}
            >
              <span>Best Performer</span>
              <strong>{bestPlaybookLabel}</strong>
              <small
                className={
                  bestPlaybook ? getSignedValueClassName(bestPlaybook.summary.totalNetPnl) : undefined
                }
              >
                {bestPlaybookMetaLabel}
              </small>
            </button>
            <button
              type="button"
              className="page-hero-stat-card page-hero-stat-card-action"
              onClick={() => {
                if (mostTradedPlaybook) {
                  handleOpenPlaybook(mostTradedPlaybook.playbook.id);
                }
              }}
              disabled={!mostTradedPlaybook}
            >
              <span>Most Traded</span>
              <strong>{mostTradedPlaybookLabel}</strong>
              <small>{mostTradedPlaybookMetaLabel}</small>
            </button>
          </div>
        </PageHero>

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
                    const { playbook, trades: matchedTrades, summary } = entry;
                    const overflowSymbols = Math.max(
                      0,
                      entry.uniqueSymbolCount - entry.topSymbols.length
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
                        <td>{matchedTrades.length}</td>
                        <td>{summary.totalTrades > 0 ? `${summary.winRate.toFixed(1)}%` : "-"}</td>
                        <td
                          className={summary.totalTrades > 0 ? getSignedValueClassName(summary.totalNetPnl) : ""}
                        >
                          {summary.totalTrades > 0 ? formatSignedMoney(summary.totalNetPnl) : "-"}
                        </td>
                        <td>
                          {getAverageWinnerLoserLabel(
                            entry.averageWinner,
                            entry.averageLoser,
                            matchedTrades.length
                          )}
                        </td>
                        <td className="playbook-symbol-cell">
                          <SymbolPills symbols={entry.topSymbols} overflowCount={overflowSymbols} />
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
  const summary = getTradeSummary(selectedPlaybook.trades);
  const symbolCount = new Set(selectedPlaybook.trades.map((trade) => trade.symbol)).size;
  const topSymbols = getTopSymbols(selectedPlaybook.trades);
  const averageWinner = getAverageWinner(selectedPlaybook.trades);
  const averageLoser = getAverageLoser(selectedPlaybook.trades);
  const recentMatchLabel =
    selectedPlaybook.trades.length > 0
      ? ([...selectedPlaybook.trades].sort(
          (left, right) => toSafeText(right.tradeDate).localeCompare(toSafeText(left.tradeDate))
        )[0]?.tradeDate ?? "No matches yet")
      : "No matches yet";
  const taggedTrades = [...selectedPlaybook.trades]
    .sort(
      (left, right) =>
        toSafeText(right.tradeDate).localeCompare(toSafeText(left.tradeDate)) ||
        toSafeText(right.openTime).localeCompare(toSafeText(left.openTime))
    );
  const normalizedTradeSearchQuery = tradeSearchQuery.trim().toLowerCase();
  const filteredTaggedTrades = taggedTrades.filter((trade) => {
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
        description={selectedPlaybook.playbook.focus}
      >
        <div className="playbook-hero-meta-row">
          <span className={getPlaybookStatusBadgeClassName(selectedPlaybook.status)}>
            {selectedPlaybook.status}
          </span>
          <span className={getPlaybookConfidenceBadgeClassName(selectedPlaybook.confidence)}>
            {selectedPlaybook.confidence}
          </span>
          <span className="playbook-meta-pill">Setup: {selectedPlaybook.setupType}</span>
          <span className="playbook-meta-pill">
            Updated: {formatUpdatedAt(selectedPlaybook.playbook.updatedAt)}
          </span>
        </div>
        <div className="page-hero-stat-grid playbook-detail-stat-grid">
          <div className="page-hero-stat-card">
            <span>Tagged Trades</span>
            <strong>{summary.totalTrades}</strong>
          </div>
          <div className="page-hero-stat-card">
            <span>Win Rate</span>
            <strong>{summary.winRate.toFixed(1)}%</strong>
          </div>
          <div className="page-hero-stat-card">
            <span>Net P&amp;L</span>
            <strong>{formatSignedMoney(summary.totalNetPnl)}</strong>
          </div>
          <div className="page-hero-stat-card">
            <span>Avg Trade</span>
            <strong>{formatSignedMoney(summary.avgTrade)}</strong>
          </div>
          <div className="page-hero-stat-card">
            <span>Fees</span>
            <strong>${summary.totalFees.toFixed(2)}</strong>
          </div>
          <div className="page-hero-stat-card">
            <span>Shares</span>
            <strong>{summary.totalSharesTraded.toLocaleString()}</strong>
          </div>
        </div>
      </PageHero>

      <section className="playbook-toolbar">
        <div className="playbook-toolbar-actions">
          <button type="button" className="mini-action" onClick={() => setSelectedPlaybookId(null)}>
            Back To Playbooks
          </button>
          <div className="playbook-subnav" role="tablist" aria-label="Playbook pages">
            <button
              type="button"
              role="tab"
              aria-selected={activePlaybookPage === "playbook"}
              className={`mini-action mini-action-soft${activePlaybookPage === "playbook" ? " playbook-subnav-active" : ""}`}
              onClick={() => setActivePlaybookPage("playbook")}
            >
              Playbook
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activePlaybookPage === "tagged-charts"}
              className={`mini-action mini-action-soft${activePlaybookPage === "tagged-charts" ? " playbook-subnav-active" : ""}`}
              onClick={() => setActivePlaybookPage("tagged-charts")}
            >
              Tagged Charts
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activePlaybookPage === "a-plus"}
              className={`mini-action mini-action-soft${activePlaybookPage === "a-plus" ? " playbook-subnav-active" : ""}`}
              onClick={() => setActivePlaybookPage("a-plus")}
            >
              A+ Example Library
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activePlaybookPage === "trades"}
              className={`mini-action mini-action-soft${activePlaybookPage === "trades" ? " playbook-subnav-active" : ""}`}
              onClick={() => setActivePlaybookPage("trades")}
            >
              Trades
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
        </div>
        <span>
          {activePlaybookPage === "tagged-charts"
            ? `${taggedCharts.length} tagged chart${taggedCharts.length === 1 ? "" : "s"} in journal (${linkedTradeCount} linked trade${linkedTradeCount === 1 ? "" : "s"}).`
            : activePlaybookPage === "trades"
              ? `${filteredTaggedTrades.length} trade${filteredTaggedTrades.length === 1 ? "" : "s"} shown${normalizedTradeSearchQuery ? ` (${taggedTrades.length} total)` : ""} for ${selectedPlaybook.playbook.name}.`
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
        ) : activePlaybookPage === "trades" ? (
          <div className="playbook-sections-column">
            <article className="placeholder-panel playbook-section-card">
              <div className="panel-header">
                <WorkspaceIcon
                  icon="trades"
                  alt="Trades icon"
                  className="panel-header-icon"
                />
                <h2>Trades</h2>
              </div>
              <span className="playbook-example-subtitle">
                Click any trade to jump straight into the review station.
              </span>
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
              <div className="playbook-example-list">
                {filteredTaggedTrades.length > 0 ? (
                  filteredTaggedTrades.map((trade) => {
                    const holdLabel = trade.holdTime.trim().length > 0 ? trade.holdTime : `${Math.max(0, Math.round(trade.holdSeconds / 60))}m`;
                    return (
                      <button
                        key={trade.id}
                        type="button"
                        className="playbook-example-card"
                        onClick={() => onSelectTrade(trade.id, trade.tradeDate)}
                      >
                        <div className="playbook-example-card-top">
                          <strong>{trade.name}</strong>
                          <span className={trade.netPnlUsd >= 0 ? "positive-value" : "negative-value"}>
                            {formatSignedMoney(trade.netPnlUsd)}
                          </span>
                        </div>
                        <span className="playbook-example-inline-row">
                          <span>Date {formatCalendarDate(trade.tradeDate)}</span>
                          <span>{trade.symbol}</span>
                          <span>
                            {trade.openTime} to {trade.closeTime}
                          </span>
                          <span>Hold {holdLabel}</span>
                        </span>
                        <span className="playbook-example-inline-row playbook-example-inline-row-tight">
                          <span>
                            {trade.side} - {trade.status}
                          </span>
                          <span>Size {trade.size.toLocaleString()}</span>
                          <span>In {formatMoney(trade.entryPrice)}</span>
                          <span>Out {formatMoney(trade.exitPrice)}</span>
                          <span>Fees {formatMoney(trade.feesUsd)}</span>
                        </span>
                      </button>
                    );
                  })
                ) : taggedTrades.length > 0 ? (
                  <div className="empty-state">
                    No trades match "{tradeSearchQuery.trim()}".
                  </div>
                ) : (
                  <div className="empty-state">
                    Tag trades with {selectedPlaybook.playbook.name} to see examples here.
                  </div>
                )}
              </div>
            </article>
          </div>
        ) : (
          <APlusExampleLibrary
            playbook={selectedPlaybook.playbook}
            matchedTrades={selectedPlaybook.trades}
            taggedCharts={taggedCharts}
            onSelectTrade={onSelectTrade}
            onExpandImage={setExpandedScreenshotUrl}
            setPlaybooks={setPlaybooks}
          />
        )}

        <aside className="playbook-aside-column">
          <article className="placeholder-panel playbook-aside-card">
            <div className="panel-header">
              <WorkspaceIcon
                icon="dashboard"
                alt="Playbook stats icon"
                className="panel-header-icon"
              />
              <h2>Playbook Performance</h2>
            </div>
            <div className="playbook-aside-stat-grid">
              <div className="playbook-aside-stat-tile">
                <span>Status</span>
                <strong>{selectedPlaybook.status}</strong>
              </div>
              <div className="playbook-aside-stat-tile">
                <span>Confidence</span>
                <strong>{selectedPlaybook.confidence}</strong>
              </div>
              <div className="playbook-aside-stat-tile">
                <span>Wins / Losses</span>
                <strong>
                  {summary.winCount}W - {summary.lossCount}L
                </strong>
              </div>
              <div className="playbook-aside-stat-tile">
                <span>Recent Match</span>
                <strong>{recentMatchLabel}</strong>
              </div>
              <div className="playbook-aside-stat-tile">
                <span>Top Symbols</span>
                <strong>{topSymbols.length > 0 ? topSymbols.join(", ") : "None yet"}</strong>
              </div>
              <div className="playbook-aside-stat-tile">
                <span>Avg Winner / Loser</span>
                <strong>
                  {formatSignedMoney(averageWinner)} / {formatSignedMoney(averageLoser)}
                </strong>
              </div>
            </div>
            <div className="playbook-metric-list">
              <div className="playbook-metric-row">
                <span>Net P&amp;L</span>
                <strong>{formatSignedMoney(summary.totalNetPnl)}</strong>
              </div>
              <div className="playbook-metric-row">
                <span>Gross P&amp;L</span>
                <strong>{formatSignedMoney(summary.totalGrossPnl)}</strong>
              </div>
              <div className="playbook-metric-row">
                <span>Fees</span>
                <strong>${summary.totalFees.toFixed(2)}</strong>
              </div>
              <div className="playbook-metric-row">
                <span>Shares Traded</span>
                <strong>{summary.totalSharesTraded.toLocaleString()}</strong>
              </div>
              <div className="playbook-metric-row">
                <span>Profit Factor</span>
                <strong>{summary.profitFactor.toFixed(2)}</strong>
              </div>
              <div className="playbook-metric-row">
                <span>Symbols</span>
                <strong>{symbolCount}</strong>
              </div>
              <div className="playbook-metric-row">
                <span>Avg Hold</span>
                <strong>{summary.avgHoldMinutes.toFixed(1)}m</strong>
              </div>
            </div>
          </article>

        </aside>
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

