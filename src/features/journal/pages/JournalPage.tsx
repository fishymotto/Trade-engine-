import { useEffect, useMemo, useRef, useState } from "react";
import { JournalRichTextEditor } from "../components/JournalRichTextEditor";
import { PageHero } from "../../../components/PageHero";
import { PreviewTable } from "../../../components/PreviewTable";
import { TagDrawer } from "../../../components/TagDrawer";
import { WorkspaceIcon } from "../../../components/WorkspaceIcon";
import { MPP_FORMULA_TOOLTIP, calculateMPPWindow } from "../../../lib/analytics/mppAnalytics";
import { getDatabaseStats, getTradeSummary } from "../../../lib/analytics/tradeAnalytics";
import type { JournalChecklistTemplates, NamedChecklistTemplate } from "../../../lib/journal/journalTemplateStore";
import { getTickerIcon as getTickerIconSrc, getTickerSector } from "../../../lib/tickers/tickerIcons";
import { useEditableSelectOptions } from "../../../lib/select/useEditableSelectOptions";
import { tradeTagOptionsByField as defaultTradeTagOptionsByField } from "../../../lib/trades/tradeTagCatalog";
import type {
  JournalContentField,
  JournalPageRecord,
  JournalScreenshotTagRecord,
  JournalScreenshotTradeLink
} from "../../../types/journal";
import type { EditableTradeRow, EditableTradeTagField } from "../../../types/tradeTags";
import { HeadlinesBar } from "../../headlines/components/HeadlinesBar";

interface JournalPageProps {
  pages: JournalPageRecord[];
  selectedPageId: string;
  trades: EditableTradeRow[];
  tagOptionsByField: Record<EditableTradeTagField, string[]>;
  checklistTemplates: JournalChecklistTemplates;
  externalSelectedTradeDate: string;
  onSelectPage: (pageId: string) => void;
  onSelectTrade: (tradeId: string, tradeDate: string) => void;
  onCreatePage: (tradeDate: string) => void;
  onUpdatePage: (
    pageId: string,
    updates: Partial<
      Pick<
        JournalPageRecord,
        | "tradeDate"
        | "dayGrade"
        | "marketRegime"
        | "mpp"
        | "sleepHours"
        | "sleepScore"
        | "morningMood"
        | "openMood"
        | "afternoonMood"
        | "closeMood"
        | "screenshotUrls"
        | "screenshotTags"
      >
    >
  ) => void;
  onUpdateContent: (pageId: string, field: JournalContentField, content: JournalPageRecord[JournalContentField]) => void;
  onSaveChecklistTemplateAs: (
    type: "morning" | "closing" | "mpp",
    name: string,
    content: NamedChecklistTemplate["content"]
  ) => void;
  onUpdateChecklistTemplate: (
    type: "morning" | "closing" | "mpp",
    templateId: string,
    content: NamedChecklistTemplate["content"]
  ) => void;
  onDeleteChecklistTemplate: (type: "morning" | "closing" | "mpp", templateId: string) => void;
  onUpdateTradeTag: (trade: EditableTradeRow, field: EditableTradeTagField, value: string | string[] | null) => void;
  onBulkUpdateTradeTags: (tradeIds: string[], field: EditableTradeTagField, value: string | string[] | null) => void;
  onCreateTradeTagOption: (field: EditableTradeTagField, value: string) => void;
  onRenameTradeTagOption: (field: EditableTradeTagField, currentValue: string, nextValue: string) => void;
  onDeleteTradeTagOption: (field: EditableTradeTagField, value: string) => void;
  onAttachScreenshotToTrade: (tradeId: string, screenshotUrl: string) => void;
}

const dayGradeOptions = ["", "A+", "A", "A-", "B+", "B", "B-", "C+", "C", "C-"];
const sleepHourOptions = ["", ...Array.from({ length: 11 }, (_, index) => (4 + index * 0.5).toString())];
const sleepScoreOptions = ["", "1", "2", "3", "4", "5"];
const ADD_OPTION_VALUE = "__add_option__";

const defaultMoodOptions = [
  "",
  "Flow State",
  "Locked in",
  "Focused",
  "Productive",
  "Confident",
  "Calm",
  "Well rested",
  "Excited",
  "Meh",
  "Slow Moving",
  "Tired",
  "Sore",
  "Hesitant",
  "Distracted",
  "Feeling a little behind",
  "Foggy",
  "Nervous",
  "Anxious",
  "Bummed Out",
  "Starting to get sick",
  "Stressed",
  "Frustrated",
  "Irritable",
  "Mentally Checked Out",
  "Overconfident",
  "Tilted",
  "Sick",
  "Panicked",
  "Revenge Trading"
];

const defaultMarketRegimeOptions = ["", "Trend", "Chop", "Range", "High Vol", "Low Vol", "News", "Earnings"];
const screenshotColumnLabels = ["Open Chart", "Close Chart", "Context Chart"] as const;
const TRADE_LINK_SEPARATOR = "::";
const journalDateIconModules = import.meta.glob<string>("../../../assets/ui-icons/date-calendar/*.png", {
  eager: true,
  import: "default"
});
const journalDateIconsByFileName = Object.fromEntries(
  Object.entries(journalDateIconModules).map(([path, iconSrc]) => [path.split("/").pop() ?? "", iconSrc])
) as Record<string, string>;
const journalDateIconFallback =
  journalDateIconsByFileName["Daily-Calendar--Streamline-Core-Neon.png"] ??
  journalDateIconsByFileName["Monthly-Calendar--Streamline-Core-Neon.png"] ??
  "";

const createDefaultScreenshotTag = (tradeDate: string): JournalScreenshotTagRecord => ({
  linkedTrades: [],
  linkedTradeId: "",
  linkedTradeDate: "",
  ticker: "",
  playbook: "",
  taggedDate: tradeDate
});

const dedupeScreenshotTradeLinks = (
  links: JournalScreenshotTradeLink[]
): JournalScreenshotTradeLink[] => {
  const unique = new Map<string, JournalScreenshotTradeLink>();
  for (const link of links) {
    if (!link.tradeId || !link.tradeDate) {
      continue;
    }

    unique.set(`${link.tradeId}${TRADE_LINK_SEPARATOR}${link.tradeDate}`, link);
  }

  return Array.from(unique.values());
};

const getScreenshotTradeLinks = (
  screenshotTag: JournalScreenshotTagRecord
): JournalScreenshotTradeLink[] => {
  const normalizedLinkedTrades = Array.isArray(screenshotTag.linkedTrades)
    ? screenshotTag.linkedTrades
        .map((link) => ({
          tradeId: typeof link.tradeId === "string" ? link.tradeId : "",
          tradeDate: typeof link.tradeDate === "string" ? link.tradeDate : ""
        }))
        .filter((link) => link.tradeId && link.tradeDate)
    : [];

  const legacyLink =
    screenshotTag.linkedTradeId && screenshotTag.linkedTradeDate
      ? [
          {
            tradeId: screenshotTag.linkedTradeId,
            tradeDate: screenshotTag.linkedTradeDate
          }
        ]
      : [];

  return dedupeScreenshotTradeLinks([...normalizedLinkedTrades, ...legacyLink]);
};

const normalizeScreenshotTag = (
  screenshotTag: JournalScreenshotTagRecord
): JournalScreenshotTagRecord => {
  const linkedTrades = getScreenshotTradeLinks(screenshotTag);
  const primaryLinkedTrade = linkedTrades[0] ?? null;

  return {
    ...screenshotTag,
    linkedTrades,
    linkedTradeId: primaryLinkedTrade?.tradeId ?? "",
    linkedTradeDate: primaryLinkedTrade?.tradeDate ?? ""
  };
};

const getAlignedScreenshotTags = (page: JournalPageRecord): JournalScreenshotTagRecord[] => {
  const tags = Array.isArray(page.screenshotTags) ? page.screenshotTags : [];
  return page.screenshotUrls.map(
    (_, index) =>
      normalizeScreenshotTag(tags[index] ?? createDefaultScreenshotTag(page.tradeDate))
  );
};

const serializeTradeLink = (tradeId: string, tradeDate: string): string =>
  tradeId && tradeDate ? `${tradeId}${TRADE_LINK_SEPARATOR}${tradeDate}` : "";

const parseTradeLinkValue = (value: string): { tradeId: string; tradeDate: string } | null => {
  if (!value) {
    return null;
  }

  const separatorIndex = value.indexOf(TRADE_LINK_SEPARATOR);
  if (separatorIndex <= 0) {
    return null;
  }

  const tradeId = value.slice(0, separatorIndex);
  const tradeDate = value.slice(separatorIndex + TRADE_LINK_SEPARATOR.length);
  if (!tradeId || !tradeDate) {
    return null;
  }

  return { tradeId, tradeDate };
};

const parseTradeLinkValues = (values: string[]): JournalScreenshotTradeLink[] =>
  dedupeScreenshotTradeLinks(
    values
      .map((value) => parseTradeLinkValue(value))
      .filter((value): value is JournalScreenshotTradeLink => value !== null)
  );

const collectPlaybooksFromTradeLinks = (
  links: JournalScreenshotTradeLink[],
  tradeLookup: Map<string, EditableTradeRow>
): string[] => {
  const playbooks: string[] = [];
  const seen = new Set<string>();

  for (const link of links) {
    const trade = tradeLookup.get(serializeTradeLink(link.tradeId, link.tradeDate));
    if (!trade) {
      continue;
    }

    for (const setup of trade.setups) {
      const playbook = setup.trim();
      if (!playbook || playbook === "No Setup") {
        continue;
      }

      const key = playbook.toLowerCase();
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      playbooks.push(playbook);
    }
  }

  return playbooks;
};

const buildScreenshotTagFromTradeLinks = (
  currentTag: JournalScreenshotTagRecord,
  nextLinks: JournalScreenshotTradeLink[],
  tradeLookup: Map<string, EditableTradeRow>
): JournalScreenshotTagRecord => {
  const primaryLink = nextLinks[0] ?? null;
  const tickerFromTrades = Array.from(
    new Set(
      nextLinks
        .map((link) => tradeLookup.get(serializeTradeLink(link.tradeId, link.tradeDate))?.symbol.trim() ?? "")
        .filter(Boolean)
    )
  );
  const linkedPlaybooks = collectPlaybooksFromTradeLinks(nextLinks, tradeLookup);
  const currentPlaybook = currentTag.playbook.trim();
  const matchingPlaybook =
    currentPlaybook.length > 0
      ? linkedPlaybooks.find((playbook) => playbook.toLowerCase() === currentPlaybook.toLowerCase())
      : undefined;

  return {
    ...currentTag,
    linkedTrades: nextLinks,
    linkedTradeId: primaryLink?.tradeId ?? "",
    linkedTradeDate: primaryLink?.tradeDate ?? "",
    ticker: tickerFromTrades.join(", "),
    playbook: matchingPlaybook ?? linkedPlaybooks[0] ?? currentTag.playbook,
    taggedDate: primaryLink?.tradeDate ?? currentTag.taggedDate
  };
};

const getScreenshotTickerPills = (
  screenshotTag: JournalScreenshotTagRecord,
  tradeLookup: Map<string, EditableTradeRow>
): string[] => {
  const screenshotTradeLinks = getScreenshotTradeLinks(screenshotTag);
  const linkedTickers = Array.from(
    new Set(
      screenshotTradeLinks
        .map((link) => tradeLookup.get(serializeTradeLink(link.tradeId, link.tradeDate))?.symbol.trim().toUpperCase() ?? "")
        .filter(Boolean)
    )
  );

  if (linkedTickers.length > 0) {
    return linkedTickers;
  }

  return screenshotTag.ticker
    .split(",")
    .map((ticker) => ticker.trim().toUpperCase())
    .filter(Boolean);
};

const getScreenshotCardLabel = (
  fallbackLabel: string,
  screenshotTag: JournalScreenshotTagRecord,
  tradeLookup: Map<string, EditableTradeRow>
): string => {
  const primaryTicker = getScreenshotTickerPills(screenshotTag, tradeLookup)[0];
  return primaryTicker ? `${primaryTicker} Chart` : fallbackLabel;
};

const getScreenshotSlotMeta = (index: number) => {
  const rowNumber = Math.floor(index / 3) + 1;
  const columnLabel = screenshotColumnLabels[index % 3];
  return {
    label: columnLabel,
    rowLabel: rowNumber === 1 ? "Primary Set" : `Set ${rowNumber}`
  };
};

const readFileAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }

      reject(new Error("The screenshot file could not be read."));
    };
    reader.onerror = () => reject(reader.error ?? new Error("The screenshot file could not be read."));
    reader.readAsDataURL(file);
  });

const formatJournalDate = (tradeDate: string) => {
  if (!tradeDate) {
    return "No Date";
  }

  const normalized = `${tradeDate}T00:00:00`;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return tradeDate;
  }

  return parsed.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
};

const getSortableTimestamp = (value: string) => {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
};

const formatSignedMoney = (value: number) => `${value >= 0 ? "+" : ""}$${value.toFixed(2)}`;
const formatSignedWholeNumber = (value: number) => `${value >= 0 ? "+" : ""}${value.toLocaleString()}`;

const getJournalDateIcon = (tradeDate: string): string => {
  const dayToken = tradeDate.trim().split("-")[2] ?? "";
  const dayOfMonth = Number.parseInt(dayToken, 10);
  if (Number.isNaN(dayOfMonth)) {
    return journalDateIconFallback;
  }

  return journalDateIconsByFileName[`Date-${dayOfMonth}-Calendar--Streamline-Core-Neon.png`] ?? journalDateIconFallback;
};

const normalizeDateForInput = (value: string) => {
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

const getMonthKey = (tradeDate: string) => (tradeDate && tradeDate.length >= 7 ? tradeDate.slice(0, 7) : "No Date"); // "2026-04"

const formatMonthHeader = (monthKey: string) => {
  if (monthKey === "No Date") {
    return monthKey;
  }

  const [year, month] = monthKey.split("-");
  const date = new Date(`${monthKey}-01T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return monthKey;
  }
  return date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
};

const groupPagesByMonth = (pages: JournalPageRecord[]): Map<string, JournalPageRecord[]> => {
  const grouped = new Map<string, JournalPageRecord[]>();
  for (const page of pages) {
    const monthKey = getMonthKey(page.tradeDate);
    const existing = grouped.get(monthKey) ?? [];
    existing.push(page);
    grouped.set(monthKey, existing);
  }
  return grouped;
};

const getTagToneIndex = (value: string): number =>
  value.split("").reduce((sum, character) => sum + character.charCodeAt(0), 0) % 6;

export const JournalPage = ({
  pages,
  selectedPageId,
  trades,
  tagOptionsByField,
  checklistTemplates,
  externalSelectedTradeDate,
  onSelectPage,
  onSelectTrade,
  onCreatePage,
  onUpdatePage,
  onUpdateContent,
  onSaveChecklistTemplateAs,
  onUpdateChecklistTemplate,
  onDeleteChecklistTemplate,
  onUpdateTradeTag,
  onBulkUpdateTradeTags,
  onCreateTradeTagOption,
  onRenameTradeTagOption,
  onDeleteTradeTagOption,
  onAttachScreenshotToTrade
}: JournalPageProps) => {
  const [draftTradeDate, setDraftTradeDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [visibleScreenshotRows, setVisibleScreenshotRows] = useState(1);
  const [expandedScreenshotUrl, setExpandedScreenshotUrl] = useState("");
  const [isScreenshotZoomed, setIsScreenshotZoomed] = useState(false);
  const [pendingScreenshotSlotIndex, setPendingScreenshotSlotIndex] = useState<number | null>(null);
  const [openTradePickerIndex, setOpenTradePickerIndex] = useState<number | null>(null);
  const [openPlaybookPickerIndex, setOpenPlaybookPickerIndex] = useState<number | null>(null);
  const [playbookPickerSearchQuery, setPlaybookPickerSearchQuery] = useState("");
  const [selectedMorningTemplateId, setSelectedMorningTemplateId] = useState("");
  const [selectedClosingTemplateId, setSelectedClosingTemplateId] = useState("");
  const [selectedMppTemplateId, setSelectedMppTemplateId] = useState("");
  const [selectedJournalTradeId, setSelectedJournalTradeId] = useState("");
  const [selectedJournalTradeIds, setSelectedJournalTradeIds] = useState<string[]>([]);
  const [isJournalBatchPlaybookOpen, setIsJournalBatchPlaybookOpen] = useState(false);
  const [journalBatchPlaybookSearchQuery, setJournalBatchPlaybookSearchQuery] = useState("");
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [tempDate, setTempDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(() => new Set());
  const lastExternalSyncRef = useRef("");
  const expandedMonthsInitializedRef = useRef(false);
  const screenshotInputRef = useRef<HTMLInputElement | null>(null);

  const handleImageInsert = async (file: File): Promise<string> => {
    return readFileAsDataUrl(file);
  };

  const selectedPage = useMemo(
    () => pages.find((page) => page.id === selectedPageId) ?? pages[0] ?? null,
    [pages, selectedPageId]
  );
  const selectedPageHeaderIcon = useMemo(
    () => getJournalDateIcon(selectedPage?.tradeDate ?? ""),
    [selectedPage?.tradeDate]
  );

  const { options: moodOptions, addOption: addMoodOption } = useEditableSelectOptions(
    "journal.options.moods",
    defaultMoodOptions
  );
  const { options: marketRegimeOptions, addOption: addMarketRegimeOption } = useEditableSelectOptions(
    "journal.options.marketRegimes",
    defaultMarketRegimeOptions
  );
  const nonEmptyMoodOptions = useMemo(
    () =>
      moodOptions
        .filter((option) => option.trim().length > 0)
        .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" })),
    [moodOptions]
  );
  const nonEmptyMarketRegimeOptions = useMemo(
    () => marketRegimeOptions.filter((option) => option.trim().length > 0),
    [marketRegimeOptions]
  );

  const handleAddableSelectChange = (
    nextValue: string,
    addOption: (value: string) => string | null,
    onCommit: (value: string) => void
  ) => {
    if (nextValue !== ADD_OPTION_VALUE) {
      onCommit(nextValue);
      return;
    }

    const proposed = window.prompt("Add a new option:");
    if (!proposed) {
      return;
    }

    const added = addOption(proposed);
    if (!added) {
      return;
    }

    onCommit(added);
  };

  const sortedPages = useMemo(
    () =>
      [...pages].sort((left, right) => {
        const tradeDateCompare = right.tradeDate.localeCompare(left.tradeDate);
        if (tradeDateCompare !== 0) {
          return tradeDateCompare;
        }

        const updatedAtCompare = getSortableTimestamp(right.updatedAt) - getSortableTimestamp(left.updatedAt);
        if (updatedAtCompare !== 0) {
          return updatedAtCompare;
        }

        const createdAtCompare = getSortableTimestamp(right.createdAt) - getSortableTimestamp(left.createdAt);
        if (createdAtCompare !== 0) {
          return createdAtCompare;
        }

        return right.id.localeCompare(left.id);
      }),
    [pages]
  );
  const sortedPagesRef = useRef(sortedPages);

  useEffect(() => {
    sortedPagesRef.current = sortedPages;
  }, [sortedPages]);

  useEffect(() => {
    if (!expandedMonthsInitializedRef.current && sortedPages.length > 0) {
      const firstMonth = getMonthKey(sortedPages[0].tradeDate);
      setExpandedMonths(new Set([firstMonth]));
      expandedMonthsInitializedRef.current = true;
    }
  }, [sortedPages.length]);

  useEffect(() => {
    if (!selectedPage?.tradeDate) {
      return;
    }

    const monthKey = getMonthKey(selectedPage.tradeDate);
    setExpandedMonths((current) => {
      if (current.has(monthKey)) {
        return current;
      }

      const next = new Set(current);
      next.add(monthKey);
      return next;
    });
  }, [selectedPage?.tradeDate]);

  const monthGroups = useMemo(() => {
    const grouped = groupPagesByMonth(sortedPages);
    return Array.from(grouped.entries()).sort(([leftKey], [rightKey]) => {
      if (leftKey === "No Date") {
        return 1;
      }

      if (rightKey === "No Date") {
        return -1;
      }

      return rightKey.localeCompare(leftKey);
    });
  }, [sortedPages]);

  const toggleMonth = (monthKey: string) => {
    setExpandedMonths((current) => {
      const next = new Set(current);
      if (next.has(monthKey)) {
        next.delete(monthKey);
      } else {
        next.add(monthKey);
      }
      return next;
    });
  };

  const navigateToJournalDate = (value: string) => {
    const normalized = normalizeDateForInput(value);
    if (!normalized) {
      return;
    }

    const matchingPage = sortedPagesRef.current.find((page) => page.tradeDate === normalized);
    if (matchingPage) {
      onSelectPage(matchingPage.id);
    }
  };

  const promptForNewJournalDate = () => {
    const response = window.prompt("Journal date", draftTradeDate);
    const trimmed = response?.trim() ?? "";
    if (!trimmed) {
      return;
    }

    const normalized = normalizeDateForInput(trimmed);
    if (!normalized) {
      window.alert("Please enter a valid date.");
      return;
    }

    setDraftTradeDate(normalized);
    onCreatePage(normalized);
  };

  const linkedTrades = useMemo(
    () =>
      selectedPage
        ? trades
            .filter((trade) => trade.tradeDate === selectedPage.tradeDate)
            .sort((left, right) => left.openTime.localeCompare(right.openTime))
        : [],
    [selectedPage, trades]
  );

  const linkedTickers = useMemo(
    () => Array.from(new Set(linkedTrades.map((trade) => trade.symbol))).sort(),
    [linkedTrades]
  );
  const journalPageSummaries = useMemo(
    () =>
      new Map(
        pages.map((page) => {
          const pageTrades = trades.filter((trade) => trade.tradeDate === page.tradeDate);
          const summary = getTradeSummary(pageTrades);
          return [
            page.id,
            {
              netPnl: summary.totalNetPnl,
              tradeCount: summary.totalTrades,
              tickers: Array.from(new Set(pageTrades.map((trade) => trade.symbol))).sort()
            }
          ];
        })
      ),
    [pages, trades]
  );

  const linkedTradeSummary = useMemo(() => getTradeSummary(linkedTrades), [linkedTrades]);
  const linkedDatabaseStats = useMemo(() => getDatabaseStats(linkedTrades), [linkedTrades]);
  const handleBulkUpdateJournalTradeTags = (
    tradeIds: string[],
    field: EditableTradeTagField,
    value: string | string[] | null
  ) => {
    if (tradeIds.length === 0) {
      return;
    }

    const selectedTrades = linkedTrades.filter((trade) => tradeIds.includes(trade.id));
    if (selectedTrades.length === 0) {
      return;
    }

    for (const trade of selectedTrades) {
      onUpdateTradeTag(trade, field, value);
    }
  };
  const mppTradeDays = useMemo(
    () =>
      Array.from(
        trades.reduce((byTradeDate, trade) => {
          byTradeDate.set(trade.tradeDate, (byTradeDate.get(trade.tradeDate) ?? 0) + trade.netPnlUsd);
          return byTradeDate;
        }, new Map<string, number>())
      )
        .map(([tradeDate, netPnl]) => ({ tradeDate, netPnl }))
        .sort((left, right) => left.tradeDate.localeCompare(right.tradeDate)),
    [trades]
  );
  const selectedPageMPP = useMemo(
    () =>
      calculateMPPWindow(mppTradeDays, {
        anchorTradeDate: selectedPage?.tradeDate ?? ""
      }),
    [mppTradeDays, selectedPage?.tradeDate]
  );
  const selectedPageMPPNote = selectedPageMPP.isPartialWindow
    ? `Not enough days yet (${selectedPageMPP.formulaBreakdown.eligibleDayCount}/${selectedPageMPP.formulaBreakdown.windowSize})`
    : `${selectedPageMPP.formulaBreakdown.excludedDaysRemoved} worst day${
        selectedPageMPP.formulaBreakdown.excludedDaysRemoved === 1 ? "" : "s"
      } removed`;
  const mppProjectionDays = selectedPageMPP.formulaBreakdown.projectionDays;
  const mppLockInSteps = [5, 10, 20, 30] as const;
  const mppLockInProjectionRows = useMemo(() => {
    const anchorTradeDate = selectedPage?.tradeDate?.trim() ?? "";
    const {
      windowSize,
      targetExcludedDays,
      projectionDays
    } = selectedPageMPP.formulaBreakdown;

    const computeProjectedMPP = (replacementNetPnl: number): number => {
      if (!anchorTradeDate) {
        return selectedPageMPP.currentMPP;
      }

      const projectedDays = [...mppTradeDays];
      const replacementIndex = projectedDays.findIndex((day) => day.tradeDate === anchorTradeDate);

      if (replacementIndex >= 0) {
        projectedDays[replacementIndex] = {
          ...projectedDays[replacementIndex],
          netPnl: replacementNetPnl
        };
      } else {
        projectedDays.push({
          tradeDate: anchorTradeDate,
          netPnl: replacementNetPnl
        });
        projectedDays.sort((left, right) => left.tradeDate.localeCompare(right.tradeDate));
      }

      const projectedMPP = calculateMPPWindow(projectedDays, {
        anchorTradeDate,
        windowSize,
        excludedWorstDays: targetExcludedDays,
        projectionDays
      });

      return projectedMPP.currentMPP;
    };

    return mppLockInSteps.map((step) => ({
      step,
      positiveProjection: computeProjectedMPP(step),
      negativeProjection: computeProjectedMPP(-step)
    }));
  }, [mppLockInSteps, mppTradeDays, selectedPage?.tradeDate, selectedPageMPP.currentMPP, selectedPageMPP.formulaBreakdown]);
  const linkedTickerStats = useMemo(() => {
    const grouped = new Map<string, EditableTradeRow[]>();

    for (const trade of linkedTrades) {
      const ticker = trade.symbol.trim();
      if (!ticker) {
        continue;
      }

      const current = grouped.get(ticker) ?? [];
      current.push(trade);
      grouped.set(ticker, current);
    }

    return Array.from(grouped.entries())
      .map(([ticker, tickerTrades]) => ({
        ticker,
        summary: getTradeSummary(tickerTrades)
      }))
      .sort(
        (left, right) =>
          right.summary.totalNetPnl - left.summary.totalNetPnl ||
          right.summary.totalTrades - left.summary.totalTrades ||
          left.ticker.localeCompare(right.ticker)
      );
  }, [linkedTrades]);
  const linkedPlaybookStats = useMemo(() => {
    const grouped = new Map<string, EditableTradeRow[]>();

    for (const trade of linkedTrades) {
      for (const setup of trade.setups) {
        const playbook = setup.trim();
        if (!playbook || playbook === "No Setup") {
          continue;
        }

        const current = grouped.get(playbook) ?? [];
        current.push(trade);
        grouped.set(playbook, current);
      }
    }

    return Array.from(grouped.entries())
      .map(([playbook, playbookTrades]) => ({
        playbook,
        summary: getTradeSummary(playbookTrades)
      }))
      .sort(
        (left, right) =>
          right.summary.totalNetPnl - left.summary.totalNetPnl ||
          right.summary.totalTrades - left.summary.totalTrades ||
          left.playbook.localeCompare(right.playbook)
      );
  }, [linkedTrades]);
  const visibleScreenshotSlots = useMemo(() => {
    const requiredSlots = Math.max(3, selectedPage?.screenshotUrls.length ?? 0);
    return Math.max(requiredSlots, visibleScreenshotRows * 3);
  }, [selectedPage?.screenshotUrls.length, visibleScreenshotRows]);
  const journalScreenshotTags = useMemo(
    () => (selectedPage ? getAlignedScreenshotTags(selectedPage) : []),
    [selectedPage]
  );
  const screenshotTradeOptions = useMemo(
    () =>
      linkedTrades.map((trade) => ({
        value: serializeTradeLink(trade.id, trade.tradeDate),
        trade
      })),
    [linkedTrades]
  );
  const linkedTradeByLink = useMemo(
    () =>
      new Map(
        linkedTrades.map((trade) => [serializeTradeLink(trade.id, trade.tradeDate), trade])
      ),
    [linkedTrades]
  );
  const screenshotPlaybookOptions = useMemo(() => {
    const fromTrades = linkedTrades.flatMap((trade) =>
      trade.setups
        .map((setup) => setup.trim())
        .filter((setup) => setup && setup !== "No Setup")
    );
    const fromTagOptions = tagOptionsByField.playbook ?? [];
    return Array.from(new Set([...fromTrades, ...fromTagOptions])).sort((left, right) =>
      left.localeCompare(right)
    );
  }, [linkedTrades, tagOptionsByField.playbook]);

  useEffect(() => {
    setOpenTradePickerIndex(null);
    setOpenPlaybookPickerIndex(null);
    setPlaybookPickerSearchQuery("");
  }, [selectedPage?.id]);

  useEffect(() => {
    if (!selectedPage || openPlaybookPickerIndex === null) {
      return;
    }

    if (openPlaybookPickerIndex >= selectedPage.screenshotUrls.length) {
      setOpenPlaybookPickerIndex(null);
      setPlaybookPickerSearchQuery("");
    }
  }, [openPlaybookPickerIndex, selectedPage]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }

      if (target.closest(".journal-screenshot-trade-picker")) {
        return;
      }

      setOpenTradePickerIndex(null);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, []);

  const activePlaybookPickerTag = useMemo(() => {
    if (!selectedPage || openPlaybookPickerIndex === null) {
      return null;
    }

    return journalScreenshotTags[openPlaybookPickerIndex] ?? createDefaultScreenshotTag(selectedPage.tradeDate);
  }, [journalScreenshotTags, openPlaybookPickerIndex, selectedPage]);
  const selectedMorningTemplate = useMemo(
    () =>
      checklistTemplates.morningTemplates.find((template) => template.id === selectedMorningTemplateId) ??
      checklistTemplates.morningTemplates[0] ??
      null,
    [checklistTemplates.morningTemplates, selectedMorningTemplateId]
  );
  const selectedClosingTemplate = useMemo(
    () =>
      checklistTemplates.closingTemplates.find((template) => template.id === selectedClosingTemplateId) ??
      checklistTemplates.closingTemplates[0] ??
      null,
    [checklistTemplates.closingTemplates, selectedClosingTemplateId]
  );
  const selectedMppTemplate = useMemo(
    () =>
      checklistTemplates.mppTemplates.find((template) => template.id === selectedMppTemplateId) ??
      checklistTemplates.mppTemplates[0] ??
      null,
    [checklistTemplates.mppTemplates, selectedMppTemplateId]
  );

  useEffect(() => {
    if (!externalSelectedTradeDate) {
      return;
    }

    if (lastExternalSyncRef.current === externalSelectedTradeDate) {
      return;
    }

    lastExternalSyncRef.current = externalSelectedTradeDate;
    setDraftTradeDate(externalSelectedTradeDate);
    const matchingPage = sortedPagesRef.current.find((page) => page.tradeDate === externalSelectedTradeDate);
    if (matchingPage) {
      onSelectPage(matchingPage.id);
    }
  }, [externalSelectedTradeDate, onSelectPage]);

  useEffect(() => {
    const imageCount = selectedPage?.screenshotUrls.length ?? 0;
    setVisibleScreenshotRows(Math.max(1, Math.ceil(Math.max(imageCount, 3) / 3)));
    setExpandedScreenshotUrl("");
    setPendingScreenshotSlotIndex(null);
  }, [selectedPage?.id, selectedPage?.screenshotUrls.length]);

  useEffect(() => {
    if (!expandedScreenshotUrl) {
      setIsScreenshotZoomed(false);
    }
  }, [expandedScreenshotUrl]);

  useEffect(() => {
    if (selectedJournalTradeIds.length === 0 && isJournalBatchPlaybookOpen) {
      setIsJournalBatchPlaybookOpen(false);
      setJournalBatchPlaybookSearchQuery("");
    }
  }, [isJournalBatchPlaybookOpen, selectedJournalTradeIds.length]);

  useEffect(() => {
    setSelectedJournalTradeIds((current) =>
      current.filter((tradeId) => linkedTrades.some((trade) => trade.id === tradeId))
    );
    setSelectedJournalTradeId((current) =>
      linkedTrades.some((trade) => trade.id === current) ? current : linkedTrades[0]?.id ?? ""
    );
  }, [linkedTrades]);

  useEffect(() => {
    if (!selectedMorningTemplateId && checklistTemplates.morningTemplates[0]) {
      setSelectedMorningTemplateId(checklistTemplates.morningTemplates[0].id);
      return;
    }

    if (
      selectedMorningTemplateId &&
      !checklistTemplates.morningTemplates.some((template) => template.id === selectedMorningTemplateId)
    ) {
      setSelectedMorningTemplateId(checklistTemplates.morningTemplates[0]?.id ?? "");
    }
  }, [checklistTemplates.morningTemplates, selectedMorningTemplateId]);

  useEffect(() => {
    if (!selectedClosingTemplateId && checklistTemplates.closingTemplates[0]) {
      setSelectedClosingTemplateId(checklistTemplates.closingTemplates[0].id);
      return;
    }

    if (
      selectedClosingTemplateId &&
      !checklistTemplates.closingTemplates.some((template) => template.id === selectedClosingTemplateId)
    ) {
      setSelectedClosingTemplateId(checklistTemplates.closingTemplates[0]?.id ?? "");
    }
  }, [checklistTemplates.closingTemplates, selectedClosingTemplateId]);

  useEffect(() => {
    if (!selectedMppTemplateId && checklistTemplates.mppTemplates[0]) {
      setSelectedMppTemplateId(checklistTemplates.mppTemplates[0].id);
      return;
    }

    if (
      selectedMppTemplateId &&
      !checklistTemplates.mppTemplates.some((template) => template.id === selectedMppTemplateId)
    ) {
      setSelectedMppTemplateId(checklistTemplates.mppTemplates[0]?.id ?? "");
    }
  }, [checklistTemplates.mppTemplates, selectedMppTemplateId]);

  const promptForTemplateName = (type: "morning" | "closing" | "mpp") => {
    const suggestion = `${type === "morning" ? "Morning" : type === "closing" ? "Closing" : "MPP"} Template`;
    const response = window.prompt("Template name", suggestion);
    const trimmed = response?.trim();
    return trimmed || "";
  };

  const confirmDeleteTemplate = (type: "morning" | "closing" | "mpp", template: NamedChecklistTemplate | null) => {
    if (!template) {
      return;
    }

    const templateCount =
      type === "morning"
        ? checklistTemplates.morningTemplates.length
        : type === "closing"
          ? checklistTemplates.closingTemplates.length
          : checklistTemplates.mppTemplates.length;

    if (templateCount <= 1) {
      return;
    }

    const confirmed = window.confirm(`Delete the ${type} template "${template.name}"?`);
    if (!confirmed) {
      return;
    }

    onDeleteChecklistTemplate(type, template.id);
  };

  const updateSelectedPageScreenshots = (
    screenshotUrls: string[],
    screenshotTags: JournalScreenshotTagRecord[]
  ) => {
    if (!selectedPage) {
      return;
    }

    onUpdatePage(selectedPage.id, {
      screenshotUrls,
      screenshotTags
    });
  };

  const attachScreenshotIfLinked = (
    screenshotUrl: string,
    screenshotTag: JournalScreenshotTagRecord | undefined
  ) => {
    if (!screenshotTag || !screenshotUrl) {
      return;
    }

    const tradeIds = Array.from(
      new Set(
        getScreenshotTradeLinks(screenshotTag)
          .map((link) => linkedTradeByLink.get(serializeTradeLink(link.tradeId, link.tradeDate))?.id ?? "")
          .filter(Boolean)
      )
    );
    for (const tradeId of tradeIds) {
      onAttachScreenshotToTrade(tradeId, screenshotUrl);
    }
  };

  const handleScreenshotTagUpdate = (
    screenshotIndex: number,
    updater: (current: JournalScreenshotTagRecord) => JournalScreenshotTagRecord
  ) => {
    if (!selectedPage) {
      return;
    }

    const nextTags = [...journalScreenshotTags];
    const currentTag = nextTags[screenshotIndex] ?? createDefaultScreenshotTag(selectedPage.tradeDate);
    nextTags[screenshotIndex] = normalizeScreenshotTag(updater(currentTag));

    updateSelectedPageScreenshots(selectedPage.screenshotUrls, nextTags);
    attachScreenshotIfLinked(selectedPage.screenshotUrls[screenshotIndex] ?? "", nextTags[screenshotIndex]);
  };

  return (
    <main className="page-shell journal-page-shell">
      <PageHero
        eyebrow="Journal"
        title="Trading Journal"
        description="Manual daily review pages with fixed journal sections, compact trade context, and room for deeper written notes."
      />
      <section className="journal-grid">
        <aside className="journal-sidebar">
          <div className="journal-sidebar-header">
            <div>
              <strong>Daily Journal</strong>
              <span>{pages.length} saved</span>
            </div>
          </div>
          <div className="journal-create-panel">
            <div className="journal-create-row">
              <label className="journal-date-label">
                <span>Journal Date</span>
                <input
                  type="date"
                  value={draftTradeDate}
                  onChange={(event) => {
                    setDraftTradeDate(event.target.value);
                    navigateToJournalDate(event.target.value);
                  }}
                  onClick={() => navigateToJournalDate(draftTradeDate)}
                  className="journal-date-input"
                />
              </label>
              <button type="button" className="mini-action journal-create-button" onClick={promptForNewJournalDate}>
                <WorkspaceIcon icon="journal" alt="Create journal icon" className="mini-action-icon" />
                New Journal
              </button>
            </div>
          </div>
          <div className="journal-page-section">
            <div className="journal-section-heading">Entries</div>
            <div className="journal-page-list">
              {sortedPages.length === 0 ? (
                <span className="empty-inline-state">Create your first daily journal page.</span>
              ) : (
                monthGroups.map(([monthKey, monthPages]) => {
                  const expanded = expandedMonths.has(monthKey);
                  return (
                    <div key={monthKey} className="journal-month-group">
                      <button
                        type="button"
                        className={`journal-month-toggle${expanded ? " journal-month-toggle-expanded" : ""}`}
                        onClick={() => toggleMonth(monthKey)}
                      >
                        <span className="journal-month-label">{formatMonthHeader(monthKey)}</span>
                        <span className="journal-month-meta">{monthPages.length}</span>
                        <span className="journal-month-chevron" aria-hidden="true">
                          ▸
                        </span>
                      </button>
                      {expanded ? (
                        <div className="journal-month-entries">
                          {monthPages.map((page) => {
                            const pageSummary = journalPageSummaries.get(page.id);
                            const gradeLabel = page.dayGrade || "No Grade";
                            const netPnl = pageSummary?.netPnl ?? 0;
                            const tickers = pageSummary?.tickers ?? [];
                            return (
                              <button
                                key={page.id}
                                type="button"
                                className={`journal-page-item ${page.id === selectedPage?.id ? "journal-page-item-active" : ""}`}
                                onClick={() => onSelectPage(page.id)}
                              >
                                <div className="journal-page-row">
                                  <div className="journal-page-title">
                                    <WorkspaceIcon icon="journal" alt="Journal page icon" className="journal-page-icon" />
                                    <strong>{formatJournalDate(page.tradeDate)}</strong>
                                  </div>
                                  <span className={`journal-grade-pill${page.dayGrade ? "" : " journal-grade-pill-empty"}`}>
                                    {gradeLabel}
                                  </span>
                                </div>
                                <div className="journal-page-meta">
                                  <span
                                    className={`journal-page-pnl ${
                                      netPnl >= 0 ? "journal-page-pnl-positive" : "journal-page-pnl-negative"
                                    }`}
                                  >
                                    {netPnl >= 0 ? "+" : ""}${netPnl.toFixed(2)}
                                  </span>
                                  <span>{pageSummary?.tradeCount ?? 0} trades</span>
                                </div>
                                {tickers.length > 0 ? (
                                  <div className="journal-page-tickers">
                                    {tickers.slice(0, 4).map((ticker) => (
                                      <span key={`${page.id}-${ticker}`} className="journal-page-ticker-pill">
                                        {ticker}
                                      </span>
                                    ))}
                                    {tickers.length > 4 ? (
                                      <span className="journal-page-ticker-pill">+{tickers.length - 4}</span>
                                    ) : null}
                                  </div>
                                ) : null}
                              </button>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  );
                })
              )}
              </div>
          </div>
        </aside>
        <section className="journal-editor">
          {selectedPage ? (
            <>
              <header className="journal-page-header">
                <div className="journal-page-header-top">
                  <div className="journal-page-title-row">
                    {selectedPageHeaderIcon ? (
                      <img
                        src={selectedPageHeaderIcon}
                        alt={`${formatJournalDate(selectedPage.tradeDate)} calendar icon`}
                        className="journal-page-header-icon journal-page-header-icon-date"
                      />
                    ) : (
                      <WorkspaceIcon icon="journal" alt="Journal page icon" className="journal-page-header-icon" />
                    )}
                    <div>
                      <div className="journal-section-heading">Daily Journal</div>
                      <h2>{formatJournalDate(selectedPage.tradeDate)}</h2>
                      <label className="journal-market-regime-card">
                        <span>Market Regime</span>
                        <select
                          className="journal-header-select"
                          value={selectedPage.marketRegime}
                          onChange={(event) =>
                            handleAddableSelectChange(event.target.value, addMarketRegimeOption, (value) =>
                              onUpdatePage(selectedPage.id, { marketRegime: value })
                            )
                          }
                        >
                          <option value="">Select Regime</option>
                          {nonEmptyMarketRegimeOptions.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                          <option value={ADD_OPTION_VALUE}>Add…</option>
                        </select>
                      </label>
                    </div>
                  </div>
                  <div className="journal-header-ticker-card">
                    <div
                      className={`journal-ticker-pills ${
                        linkedTickers.length > 24
                          ? "journal-ticker-pills--tiny"
                          : linkedTickers.length > 15
                            ? "journal-ticker-pills--compact"
                            : "journal-ticker-pills--roomy"
                      }`}
                    >
                      {linkedTickers.length === 0 ? (
                        <span className="empty-inline-state">No linked tickers for this date yet.</span>
                      ) : (
                        linkedTickers.map((ticker) => {
                          const tickerIcon = getTickerIconSrc(ticker);
                          const tickerSector = getTickerSector(ticker);

                          return (
                            <span key={ticker} className="symbol-pill">
                              {tickerIcon ? (
                                <img
                                  src={tickerIcon}
                                  alt={tickerSector ? `${tickerSector} sector icon` : `${ticker} ticker icon`}
                                  className="symbol-pill-icon"
                                />
                              ) : (
                                <WorkspaceIcon icon="trades" alt={`${ticker} ticker icon`} className="symbol-pill-icon" />
                              )}
                              {ticker}
                            </span>
                          );
                        })
                      )}
                    </div>
                  </div>
                  <div className="journal-header-stat-group">
                    <label className="journal-header-stat-card">
                      <span>Hours Slept</span>
                      <select
                        className="journal-header-select"
                        value={selectedPage.sleepHours}
                        onChange={(event) => onUpdatePage(selectedPage.id, { sleepHours: event.target.value })}
                      >
                        {sleepHourOptions.map((option) => (
                          <option key={option || "empty"} value={option}>
                            {option || "Select Hours"}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="journal-header-stat-card">
                      <span>Sleep Score</span>
                      <select
                        className="journal-header-select"
                        value={selectedPage.sleepScore}
                        onChange={(event) => onUpdatePage(selectedPage.id, { sleepScore: event.target.value })}
                      >
                        {sleepScoreOptions.map((option) => (
                          <option key={option || "empty"} value={option}>
                            {option || "Select Score"}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="journal-header-stat-card">
                      <span>Day Grade</span>
                      <select
                        className="journal-header-select"
                        value={selectedPage.dayGrade}
                        onChange={(event) => onUpdatePage(selectedPage.id, { dayGrade: event.target.value })}
                      >
                        {dayGradeOptions.map((option) => (
                          <option key={option || "empty"} value={option}>
                            {option || "Select Grade"}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="journal-header-stat-card" title={MPP_FORMULA_TOOLTIP}>
                      <span>{selectedPageMPP.isPartialWindow ? "MPP partial" : "MPP"}</span>
                      <input
                        type="text"
                        className="journal-header-stat-input"
                        value={selectedPageMPP.currentMPP.toLocaleString()}
                        aria-label="Calculated MPP value"
                        readOnly
                      />
                      <small className="journal-header-stat-note">{selectedPageMPPNote}</small>
                    </label>
                    <label className="journal-header-stat-card">
                      <span>Morning</span>
                      <select
                        className="journal-header-select"
                        value={selectedPage.morningMood}
                        onChange={(event) =>
                          handleAddableSelectChange(event.target.value, addMoodOption, (value) =>
                            onUpdatePage(selectedPage.id, { morningMood: value })
                          )
                        }
                      >
                        <option value="">Select Mood</option>
                        {nonEmptyMoodOptions.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                        <option value={ADD_OPTION_VALUE}>Add…</option>
                      </select>
                    </label>
                    <label className="journal-header-stat-card">
                      <span>Open</span>
                      <select
                        className="journal-header-select"
                        value={selectedPage.openMood}
                        onChange={(event) =>
                          handleAddableSelectChange(event.target.value, addMoodOption, (value) =>
                            onUpdatePage(selectedPage.id, { openMood: value })
                          )
                        }
                      >
                        <option value="">Select Mood</option>
                        {nonEmptyMoodOptions.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                        <option value={ADD_OPTION_VALUE}>Add…</option>
                      </select>
                    </label>
                    <label className="journal-header-stat-card">
                      <span>Afternoon</span>
                      <select
                        className="journal-header-select"
                        value={selectedPage.afternoonMood}
                        onChange={(event) =>
                          handleAddableSelectChange(event.target.value, addMoodOption, (value) =>
                            onUpdatePage(selectedPage.id, { afternoonMood: value })
                          )
                        }
                      >
                        <option value="">Select Mood</option>
                        {nonEmptyMoodOptions.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                        <option value={ADD_OPTION_VALUE}>Add…</option>
                      </select>
                    </label>
                    <label className="journal-header-stat-card">
                      <span>Close</span>
                      <select
                        className="journal-header-select"
                        value={selectedPage.closeMood}
                        onChange={(event) =>
                          handleAddableSelectChange(event.target.value, addMoodOption, (value) =>
                            onUpdatePage(selectedPage.id, { closeMood: value })
                          )
                        }
                      >
                        <option value="">Select Mood</option>
                        {nonEmptyMoodOptions.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                        <option value={ADD_OPTION_VALUE}>Add…</option>
                      </select>
                    </label>
                  </div>
                </div>
                <div>
                  <div className="journal-meta">
                    <span>{linkedTrades.length} linked trades</span>
                    <span>Updated {new Date(selectedPage.updatedAt).toLocaleString()}</span>
                  </div>
                </div>
              </header>

              <section className="journal-properties-grid">
                <div className="journal-property-card journal-property-card-wide">
                  <div className="journal-property-metric-grid">
                    <section className="journal-metric-card">
                      <div className="journal-metric-card-header">
                        <strong>Overall Performance</strong>
                        <span>{formatJournalDate(selectedPage.tradeDate)}</span>
                      </div>
                      <div className="journal-metric-list">
                        <div>
                          <span>Net P&amp;L</span>
                          <strong>{formatSignedMoney(linkedTradeSummary.totalNetPnl)}</strong>
                        </div>
                        <div>
                          <span>Gross P&amp;L</span>
                          <strong>{formatSignedMoney(linkedTradeSummary.totalGrossPnl)}</strong>
                        </div>
                        <div>
                          <span>Win Rate</span>
                          <strong>{linkedTradeSummary.winRate.toFixed(1)}%</strong>
                        </div>
                        <div>
                          <span>Trades</span>
                          <strong>{linkedTradeSummary.totalTrades}</strong>
                        </div>
                        <div>
                          <span>Fees</span>
                          <strong>${linkedTradeSummary.totalFees.toFixed(2)}</strong>
                        </div>
                        <div>
                          <span>Avg Trade</span>
                          <strong>{formatSignedMoney(linkedTradeSummary.avgTrade)}</strong>
                        </div>
                        <div>
                          <span>Profit Factor</span>
                          <strong>{linkedTradeSummary.profitFactor.toFixed(2)}</strong>
                        </div>
                      </div>
                    </section>

                    <section className="journal-metric-card">
                      <div className="journal-metric-card-header">
                        <strong>Database Stats</strong>
                      </div>
                      <div className="journal-metric-list">
                        <div>
                          <span>Total Trades</span>
                          <strong>{linkedDatabaseStats.totalTrades}</strong>
                        </div>
                        <div>
                          <span>Executions</span>
                          <strong>{linkedDatabaseStats.totalExecutions}</strong>
                        </div>
                        <div>
                          <span>Shares Traded</span>
                          <strong>{linkedDatabaseStats.totalSharesTraded.toLocaleString()}</strong>
                        </div>
                        <div>
                          <span>Gross P&amp;L</span>
                          <strong>{formatSignedMoney(linkedDatabaseStats.totalGrossPnl)}</strong>
                        </div>
                        <div>
                          <span>Fees</span>
                          <strong>${linkedDatabaseStats.totalFees.toFixed(2)}</strong>
                        </div>
                        <div>
                          <span>Sessions</span>
                          <strong>{linkedDatabaseStats.sessions}</strong>
                        </div>
                        <div>
                          <span>Symbols</span>
                          <strong>{linkedDatabaseStats.symbols}</strong>
                        </div>
                      </div>
                    </section>

                    <section className="journal-metric-card">
                      <div className="journal-metric-card-header">
                        <strong>Ticker Stats</strong>
                        <span>{linkedTickerStats.length} symbols</span>
                      </div>
                      {linkedTickerStats.length === 0 ? (
                        <span className="empty-inline-state">No trades on this day yet.</span>
                      ) : (
                        <div
                          className="journal-playbook-stat-scroll"
                          role="region"
                          aria-label="Ticker stats list"
                          tabIndex={0}
                        >
                          <div className="journal-playbook-stat-list">
                            {linkedTickerStats.map(({ ticker, summary }) => (
                              <div key={ticker} className="journal-playbook-stat-row">
                                <div>
                                  <strong>{ticker}</strong>
                                  <span>
                                    {summary.totalTrades} trade{summary.totalTrades === 1 ? "" : "s"} ·{" "}
                                    {summary.totalSharesTraded.toLocaleString()} shares · {summary.winRate.toFixed(1)}%
                                    {" "}WR · ${summary.totalFees.toFixed(2)} fees · Gross{" "}
                                    {formatSignedMoney(summary.totalGrossPnl)}
                                  </span>
                                </div>
                                <strong
                                  className={
                                    summary.totalNetPnl >= 0
                                      ? "journal-page-pnl-positive"
                                      : "journal-page-pnl-negative"
                                  }
                                >
                                  {formatSignedMoney(summary.totalNetPnl)}
                                </strong>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </section>

                    <section className="journal-metric-card">
                      <div className="journal-metric-card-header">
                        <strong>MPP Lock-In (+)</strong>
                        <span>Tomorrow MPP ({mppProjectionDays}-day projection)</span>
                      </div>
                      <div className="journal-metric-list">
                        {mppLockInProjectionRows.map(({ step, positiveProjection }) => (
                          <div key={`mpp-lock-positive-${step}`}>
                            <span>Replace day with +{step}</span>
                            <strong
                              className={
                                positiveProjection >= 0 ? "journal-page-pnl-positive" : "journal-page-pnl-negative"
                              }
                            >
                              {formatSignedWholeNumber(positiveProjection)}
                            </strong>
                          </div>
                        ))}
                      </div>
                    </section>

                    <section className="journal-metric-card">
                      <div className="journal-metric-card-header">
                        <strong>MPP Lock-In (-)</strong>
                        <span>Tomorrow MPP ({mppProjectionDays}-day projection)</span>
                      </div>
                      <div className="journal-metric-list">
                        {mppLockInProjectionRows.map(({ step, negativeProjection }) => (
                          <div key={`mpp-lock-negative-${step}`}>
                            <span>Replace day with -{step}</span>
                            <strong
                              className={
                                negativeProjection >= 0 ? "journal-page-pnl-positive" : "journal-page-pnl-negative"
                              }
                            >
                              {formatSignedWholeNumber(negativeProjection)}
                            </strong>
                          </div>
                        ))}
                      </div>
                    </section>

                    <section className="journal-metric-card">
                      <div className="journal-metric-card-header">
                        <strong>Playbook Stats</strong>
                        <span>{linkedPlaybookStats.length} tagged</span>
                      </div>
                      {linkedPlaybookStats.length === 0 ? (
                        <span className="empty-inline-state">No playbooks tagged for this day yet.</span>
                      ) : (
                        <div className="journal-playbook-stat-scroll" role="region" aria-label="Playbook stats list" tabIndex={0}>
                          <div className="journal-playbook-stat-list">
                            {linkedPlaybookStats.map(({ playbook, summary }) => (
                            <div key={playbook} className="journal-playbook-stat-row">
                              <div>
                                <strong>{playbook}</strong>
                                <span>
                                  {summary.totalTrades} trade{summary.totalTrades === 1 ? "" : "s"} ·{" "}
                                  {summary.winRate.toFixed(1)}% WR · ${summary.totalFees.toFixed(2)} fees
                                </span>
                              </div>
                              <strong
                                className={
                                  summary.totalNetPnl >= 0
                                    ? "journal-page-pnl-positive"
                                    : "journal-page-pnl-negative"
                                }
                              >
                                {formatSignedMoney(summary.totalNetPnl)}
                              </strong>
                            </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </section>
                  </div>
                </div>
              </section>

                <section className="journal-writing-split-grid">
                  <section className="journal-writing-section">
                  <div className="journal-writing-header">
                    <div className="journal-writing-header-title">
                      <WorkspaceIcon icon="checklist" alt="Morning checklist icon" className="mini-action-icon" />
                      <strong>Morning Checklist</strong>
                    </div>
                    <div className="journal-writing-header-actions journal-template-disclosure-wrap">
                      <details className="journal-template-disclosure">
                        <summary className="mini-action mini-action-soft journal-template-disclosure-toggle">
                          Manage Templates
                        </summary>
                        <div className="journal-writing-header-actions journal-template-toolbar">
                          <div className="journal-template-toolbar-primary">
                            <select
                              className="calendar-date-select journal-template-select"
                              value={selectedMorningTemplate?.id ?? ""}
                              onChange={(event) => setSelectedMorningTemplateId(event.target.value)}
                            >
                              {checklistTemplates.morningTemplates.map((template) => (
                                <option key={template.id} value={template.id}>
                                  {template.name}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              className="mini-action mini-action-soft"
                              onClick={() => {
                                if (!selectedMorningTemplate) {
                                  return;
                                }

                                onUpdateContent(
                                  selectedPage.id,
                                  "morningChecklistContent",
                                  selectedMorningTemplate.content
                                );
                              }}
                            >
                              Load Template
                            </button>
                          </div>
                          <div className="journal-template-toolbar-secondary">
                            <button
                              type="button"
                              className="mini-action"
                              disabled={!selectedMorningTemplate}
                              onClick={() => {
                                if (!selectedMorningTemplate) {
                                  return;
                                }

                                const confirmed = window.confirm(
                                  `Overwrite template "${selectedMorningTemplate.name}" with the current checklist?`
                                );
                                if (!confirmed) {
                                  return;
                                }

                                onUpdateChecklistTemplate(
                                  "morning",
                                  selectedMorningTemplate.id,
                                  selectedPage.morningChecklistContent
                                );
                              }}
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              className="mini-action"
                              onClick={() => {
                                const templateName = promptForTemplateName("morning");
                                if (!templateName) {
                                  return;
                                }

                                onSaveChecklistTemplateAs(
                                  "morning",
                                  templateName,
                                  selectedPage.morningChecklistContent
                                );
                              }}
                            >
                              Save As
                            </button>
                            <button
                              type="button"
                              className="mini-action mini-action-danger"
                              disabled={checklistTemplates.morningTemplates.length <= 1 || !selectedMorningTemplate}
                              onClick={() => confirmDeleteTemplate("morning", selectedMorningTemplate)}
                            >
                              Delete Template
                            </button>
                          </div>
                        </div>
                      </details>
                    </div>
                  </div>
                    <JournalRichTextEditor
                      key={`${selectedPage.id}-morning-checklist`}
                      content={selectedPage.morningChecklistContent}
                      onChange={(content) => onUpdateContent(selectedPage.id, "morningChecklistContent", content)}
                      onImageInsert={handleImageInsert}
                      placeholder="Type '/' for commands"
                      appearance="notion"
                      taskListColumns={2}
                      compact
                      autosize
                    />
                  </section>

                  <section className="journal-writing-section">
                    <div className="journal-writing-header">
                      <div className="journal-writing-header-title">
                        <WorkspaceIcon icon="text" alt="Morning journal icon" className="mini-action-icon" />
                        <strong>Morning Journal</strong>
                      </div>
                    </div>
                    <JournalRichTextEditor
                      key={`${selectedPage.id}-morning`}
                      content={selectedPage.morningContent}
                      onChange={(content) => onUpdateContent(selectedPage.id, "morningContent", content)}
                      onImageInsert={handleImageInsert}
                      placeholder=""
                      appearance="notion"
                      compact
                      autosize
                    />
                </section>
              </section>

              <HeadlinesBar
                key={`headlines-${selectedPage.tradeDate}`}
                className="journal-headlines-bar"
                journalDate={selectedPage.tradeDate}
              />

                <section className="journal-writing-split-grid">
                  <section className="journal-writing-section">
                  <div className="journal-writing-header">
                    <div className="journal-writing-header-title">
                      <WorkspaceIcon icon="checklist" alt="Closing checklist icon" className="mini-action-icon" />
                      <strong>Closing Checklist</strong>
                    </div>
                    <div className="journal-writing-header-actions journal-template-disclosure-wrap">
                      <details className="journal-template-disclosure">
                        <summary className="mini-action mini-action-soft journal-template-disclosure-toggle">
                          Manage Templates
                        </summary>
                        <div className="journal-writing-header-actions journal-template-toolbar">
                          <div className="journal-template-toolbar-primary">
                            <select
                              className="calendar-date-select journal-template-select"
                              value={selectedClosingTemplate?.id ?? ""}
                              onChange={(event) => setSelectedClosingTemplateId(event.target.value)}
                            >
                              {checklistTemplates.closingTemplates.map((template) => (
                                <option key={template.id} value={template.id}>
                                  {template.name}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              className="mini-action mini-action-soft"
                              onClick={() => {
                                if (!selectedClosingTemplate) {
                                  return;
                                }

                                onUpdateContent(
                                  selectedPage.id,
                                  "closingChecklistContent",
                                  selectedClosingTemplate.content
                                );
                              }}
                            >
                              Load Template
                            </button>
                          </div>
                          <div className="journal-template-toolbar-secondary">
                            <button
                              type="button"
                              className="mini-action"
                              disabled={!selectedClosingTemplate}
                              onClick={() => {
                                if (!selectedClosingTemplate) {
                                  return;
                                }

                                const confirmed = window.confirm(
                                  `Overwrite template "${selectedClosingTemplate.name}" with the current checklist?`
                                );
                                if (!confirmed) {
                                  return;
                                }

                                onUpdateChecklistTemplate(
                                  "closing",
                                  selectedClosingTemplate.id,
                                  selectedPage.closingChecklistContent
                                );
                              }}
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              className="mini-action"
                              onClick={() => {
                                const templateName = promptForTemplateName("closing");
                                if (!templateName) {
                                  return;
                                }

                                onSaveChecklistTemplateAs(
                                  "closing",
                                  templateName,
                                  selectedPage.closingChecklistContent
                                );
                              }}
                            >
                              Save As
                            </button>
                            <button
                              type="button"
                              className="mini-action mini-action-danger"
                              disabled={checklistTemplates.closingTemplates.length <= 1 || !selectedClosingTemplate}
                              onClick={() => confirmDeleteTemplate("closing", selectedClosingTemplate)}
                            >
                              Delete Template
                            </button>
                          </div>
                        </div>
                      </details>
                    </div>
                  </div>
                    <JournalRichTextEditor
                      key={`${selectedPage.id}-closing-checklist`}
                      content={selectedPage.closingChecklistContent}
                      onChange={(content) => onUpdateContent(selectedPage.id, "closingChecklistContent", content)}
                      onImageInsert={handleImageInsert}
                      placeholder="Type '/' for commands"
                      appearance="notion"
                      taskListColumns={2}
                      compact
                      autosize
                    />
                  </section>

                  <section className="journal-writing-section">
                    <div className="journal-writing-header">
                      <div className="journal-writing-header-title">
                        <WorkspaceIcon icon="text" alt="Closing journal icon" className="mini-action-icon" />
                        <strong>Closing Journal</strong>
                      </div>
                    </div>
                    <JournalRichTextEditor
                      key={`${selectedPage.id}-closing`}
                      content={selectedPage.closingContent}
                      onChange={(content) => onUpdateContent(selectedPage.id, "closingContent", content)}
                      onImageInsert={handleImageInsert}
                      placeholder="Type '/' for commands"
                      appearance="notion"
                      compact
                      autosize
                    />
                </section>
              </section>

              <section className="journal-writing-split-grid">
                <section className="journal-writing-section">
                  <div className="journal-writing-header">
                    <div className="journal-writing-header-title">
                      <WorkspaceIcon icon="plan" alt="MPP plan icon" className="mini-action-icon" />
                      <strong>MPP Plan</strong>
                    </div>
                    <div className="journal-writing-header-actions journal-template-disclosure-wrap">
                      <details className="journal-template-disclosure">
                        <summary className="mini-action mini-action-soft journal-template-disclosure-toggle">
                          Manage Templates
                        </summary>
                        <div className="journal-writing-header-actions journal-template-toolbar">
                          <div className="journal-template-toolbar-primary">
                            <select
                              className="calendar-date-select journal-template-select"
                              value={selectedMppTemplate?.id ?? ""}
                              onChange={(event) => setSelectedMppTemplateId(event.target.value)}
                            >
                              {checklistTemplates.mppTemplates.map((template) => (
                                <option key={template.id} value={template.id}>
                                  {template.name}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              className="mini-action mini-action-soft"
                              onClick={() => {
                                if (!selectedMppTemplate) {
                                  return;
                                }

                                onUpdateContent(selectedPage.id, "mppPlanContent", selectedMppTemplate.content);
                              }}
                            >
                              Load Template
                            </button>
                          </div>
                          <div className="journal-template-toolbar-secondary">
                            <button
                              type="button"
                              className="mini-action"
                              disabled={!selectedMppTemplate}
                              onClick={() => {
                                if (!selectedMppTemplate) {
                                  return;
                                }

                                const confirmed = window.confirm(
                                  `Overwrite template "${selectedMppTemplate.name}" with the current plan?`
                                );
                                if (!confirmed) {
                                  return;
                                }

                                onUpdateChecklistTemplate("mpp", selectedMppTemplate.id, selectedPage.mppPlanContent);
                              }}
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              className="mini-action"
                              onClick={() => {
                                const templateName = promptForTemplateName("mpp");
                                if (!templateName) {
                                  return;
                                }

                                onSaveChecklistTemplateAs("mpp", templateName, selectedPage.mppPlanContent);
                              }}
                            >
                              Save As
                            </button>
                            <button
                              type="button"
                              className="mini-action mini-action-danger"
                              disabled={checklistTemplates.mppTemplates.length <= 1 || !selectedMppTemplate}
                              onClick={() => confirmDeleteTemplate("mpp", selectedMppTemplate)}
                            >
                              Delete Template
                            </button>
                          </div>
                        </div>
                      </details>
                    </div>
                  </div>
                  <JournalRichTextEditor
                    key={`${selectedPage.id}-mpp`}
                    content={selectedPage.mppPlanContent}
                    onChange={(content) => onUpdateContent(selectedPage.id, "mppPlanContent", content)}
                    placeholder="Type '/' for commands"
                    appearance="notion"
                    autosize
                  />
                </section>

                <section className="journal-writing-section">
                  <div className="journal-writing-header">
                    <div className="journal-writing-header-title">
                      <WorkspaceIcon icon="trades" alt="In play stocks icon" className="mini-action-icon" />
                      <strong>In Play Stocks</strong>
                    </div>
                  </div>
                  <JournalRichTextEditor
                    key={`${selectedPage.id}-in-play-stocks`}
                    content={selectedPage.inPlayStocksContent}
                    onChange={(content) => onUpdateContent(selectedPage.id, "inPlayStocksContent", content)}
                    placeholder="Type '/' for commands"
                    appearance="notion"
                    autosize
                  />
                </section>
              </section>

              <section className="journal-writing-split-grid">
                <section className="journal-writing-section">
                  <div className="journal-writing-header">
                    <div className="journal-writing-header-title">
                      <WorkspaceIcon icon="journal" alt="Trader reach outs icon" className="mini-action-icon" />
                      <strong>Trader Reach Outs</strong>
                    </div>
                  </div>
                  <JournalRichTextEditor
                    key={`${selectedPage.id}-trader-reach-outs`}
                    content={selectedPage.traderReachOutsContent}
                    onChange={(content) => onUpdateContent(selectedPage.id, "traderReachOutsContent", content)}
                    placeholder="Type '/' for commands"
                    appearance="notion"
                    autosize
                  />
                </section>

                <section className="journal-writing-section">
                  <div className="journal-writing-header">
                    <div className="journal-writing-header-title">
                      <WorkspaceIcon icon="text" alt="Day notes icon" className="mini-action-icon" />
                      <strong>Day Notes</strong>
                    </div>
                  </div>
                  <JournalRichTextEditor
                    key={`${selectedPage.id}-day-notes`}
                    content={selectedPage.notesContent}
                    onChange={(content) => onUpdateContent(selectedPage.id, "notesContent", content)}
                    placeholder="Type '/' for commands"
                    appearance="notion"
                    autosize
                  />
                </section>
              </section>

                <section className="journal-writing-section">
                  <div className="journal-writing-header">
                    <div className="journal-writing-header-title">
                      <WorkspaceIcon icon="journal" alt="Chart screenshots icon" className="mini-action-icon" />
                      <div className="journal-screenshot-section-title">
                        <strong>Chart Screenshots</strong>
                        <span>Open, close, and context charts for this trading day.</span>
                      </div>
                    </div>
                    <div className="journal-writing-header-actions">
                      <input
                        ref={screenshotInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/jpg,image/webp,image/gif"
                      multiple
                      className="drop-zone-input"
                      onChange={(event) => {
                        const files = Array.from(event.target.files ?? []);
                        if (!selectedPage || files.length === 0) {
                          event.currentTarget.value = "";
                          return;
                        }

                        void Promise.all(files.map((file) => readFileAsDataUrl(file)))
                          .then((dataUrls) => {
                            const currentTags = getAlignedScreenshotTags(selectedPage);
                            if (pendingScreenshotSlotIndex !== null) {
                              const nextScreenshotUrls = [...selectedPage.screenshotUrls];
                              const nextScreenshotTags = [...currentTags];
                              nextScreenshotUrls[pendingScreenshotSlotIndex] = dataUrls[0];
                              nextScreenshotTags[pendingScreenshotSlotIndex] =
                                nextScreenshotTags[pendingScreenshotSlotIndex] ??
                                createDefaultScreenshotTag(selectedPage.tradeDate);
                              if (dataUrls.length > 1) {
                                nextScreenshotUrls.splice(pendingScreenshotSlotIndex + 1, 0, ...dataUrls.slice(1));
                                nextScreenshotTags.splice(
                                  pendingScreenshotSlotIndex + 1,
                                  0,
                                  ...dataUrls.slice(1).map(() =>
                                    createDefaultScreenshotTag(selectedPage.tradeDate)
                                  )
                                );
                              }
                              updateSelectedPageScreenshots(nextScreenshotUrls, nextScreenshotTags);
                              attachScreenshotIfLinked(
                                dataUrls[0],
                                nextScreenshotTags[pendingScreenshotSlotIndex]
                              );
                              setVisibleScreenshotRows((current) =>
                                Math.max(current, Math.ceil(Math.max(nextScreenshotUrls.length, 3) / 3))
                              );
                              setPendingScreenshotSlotIndex(null);
                              return;
                            }

                            const nextScreenshotUrls = [...selectedPage.screenshotUrls, ...dataUrls];
                            const nextScreenshotTags = [
                              ...currentTags,
                              ...dataUrls.map(() => createDefaultScreenshotTag(selectedPage.tradeDate))
                            ];
                            updateSelectedPageScreenshots(nextScreenshotUrls, nextScreenshotTags);
                          })
                          .catch(() => undefined);

                        setPendingScreenshotSlotIndex(null);
                        event.currentTarget.value = "";
                      }}
                    />
                    <button
                      type="button"
                      className="mini-action"
                      onClick={() => {
                        setPendingScreenshotSlotIndex(null);
                        screenshotInputRef.current?.click();
                      }}
                    >
                      <WorkspaceIcon icon="camera" alt="Upload screenshot icon" className="mini-action-icon" />
                      Add Screenshots
                    </button>
                    <button
                      type="button"
                      className="mini-action"
                      onClick={() => setVisibleScreenshotRows((current) => current + 1)}
                    >
                      <WorkspaceIcon icon="plan" alt="Add screenshot row icon" className="mini-action-icon" />
                      Add Row
                    </button>
                    <button
                      type="button"
                      className="mini-action"
                      disabled={selectedPage.screenshotUrls.length === 0}
                      onClick={() =>
                        onUpdatePage(selectedPage.id, { screenshotUrls: [], screenshotTags: [] })
                      }
                    >
                      <WorkspaceIcon icon="data" alt="Clear screenshots icon" className="mini-action-icon" />
                      Clear All
                      </button>
                    </div>
                  </div>
                  <div className="journal-screenshot-gallery">
                    {Array.from({ length: visibleScreenshotSlots }).map((_, index) => {
                      const screenshotUrl = selectedPage.screenshotUrls[index];
                      const slotMeta = getScreenshotSlotMeta(index);

                      if (!screenshotUrl) {
                        return (
                          <button
                            key={`${selectedPage.id}-slot-${index}`}
                          type="button"
                          className="journal-screenshot-slot"
                          onClick={() => {
                            setPendingScreenshotSlotIndex(index);
                            screenshotInputRef.current?.click();
                          }}
                          >
                            <WorkspaceIcon icon="camera" alt="Empty screenshot slot icon" className="journal-screenshot-slot-icon" />
                            <strong>{slotMeta.label}</strong>
                            <span>{slotMeta.rowLabel}</span>
                            <em>Add Screenshot</em>
                          </button>
                        );
                      }

                      return (
                        <div key={`${selectedPage.id}-shot-${index}`} className="journal-screenshot-card">
                          <div className="journal-screenshot-card-header">
                            <div className="journal-screenshot-card-title">
                              <strong>
                                {getScreenshotCardLabel(
                                  slotMeta.label,
                                  journalScreenshotTags[index] ?? createDefaultScreenshotTag(selectedPage.tradeDate),
                                  linkedTradeByLink
                                )}
                              </strong>
                              <span>{slotMeta.rowLabel}</span>
                            </div>
                          </div>
                          <button
                            type="button"
                            className="journal-screenshot-preview-button"
                            onClick={() => setExpandedScreenshotUrl(screenshotUrl)}
                          >
                            <img
                              className="journal-screenshot-image"
                              src={screenshotUrl}
                              alt={`${formatJournalDate(selectedPage.tradeDate)} screenshot ${index + 1}`}
                            />
                          </button>
                          {(() => {
                            const screenshotTag =
                              journalScreenshotTags[index] ??
                              createDefaultScreenshotTag(selectedPage.tradeDate);
                            const screenshotTradeLinks = getScreenshotTradeLinks(screenshotTag);
                            const availableTradeValueSet = new Set(
                              screenshotTradeOptions.map((option) => option.value)
                            );
                            const selectedTradeValues = screenshotTradeLinks
                              .map((link) => serializeTradeLink(link.tradeId, link.tradeDate))
                              .filter((value) => availableTradeValueSet.has(value));
                            const selectedTradeValueSet = new Set(selectedTradeValues);
                            const selectedTradeLinks = parseTradeLinkValues(selectedTradeValues);
                            const resolvedLinkedTrades = selectedTradeLinks
                              .map((link) =>
                                linkedTradeByLink.get(serializeTradeLink(link.tradeId, link.tradeDate)) ?? null
                              )
                              .filter((trade): trade is EditableTradeRow => trade !== null);
                            const missingLinkedTradeCount = selectedTradeLinks.length - resolvedLinkedTrades.length;
                            const linkedTradeSummary = resolvedLinkedTrades
                              .slice(0, 2)
                              .map((trade) => `${trade.symbol} ${trade.name}`)
                              .join(", ");
                            const extraLinkedTradeCount = resolvedLinkedTrades.length - 2;
                            const tradePickerSummary =
                              resolvedLinkedTrades.length > 0
                                ? `${resolvedLinkedTrades.length} trade${resolvedLinkedTrades.length === 1 ? "" : "s"} selected`
                                : "Choose trades";
                            const tickerPills = getScreenshotTickerPills(screenshotTag, linkedTradeByLink);
                            const linkedPlaybookPills = collectPlaybooksFromTradeLinks(
                              selectedTradeLinks,
                              linkedTradeByLink
                            );
                            const fallbackPlaybook = screenshotTag.playbook.trim();
                            const playbookPills =
                              linkedPlaybookPills.length > 0
                                ? linkedPlaybookPills
                                : fallbackPlaybook
                                  ? [fallbackPlaybook]
                                  : [];

                            return (
                              <>
                                <div className="journal-screenshot-tag-grid">
                                  <div className="journal-screenshot-tag-field journal-screenshot-tag-field-wide">
                                    <span>Attach Trades</span>
                                    <details
                                      className="journal-screenshot-trade-picker"
                                      open={openTradePickerIndex === index}
                                    >
                                      <summary
                                        className="journal-screenshot-trade-picker-summary"
                                        onClick={(event) => {
                                          event.preventDefault();
                                          setOpenTradePickerIndex((current) => (current === index ? null : index));
                                        }}
                                      >
                                        <span>{tradePickerSummary}</span>
                                        <span className="journal-screenshot-trade-picker-caret" aria-hidden="true">
                                          ▾
                                        </span>
                                      </summary>
                                      <div className="journal-screenshot-trade-picker-controls">
                                        <button
                                          type="button"
                                          className="mini-action mini-action-soft"
                                          disabled={screenshotTradeOptions.length === 0}
                                          onClick={() =>
                                            handleScreenshotTagUpdate(index, (currentTag) =>
                                              buildScreenshotTagFromTradeLinks(
                                                currentTag,
                                                parseTradeLinkValues(
                                                  screenshotTradeOptions.map((option) => option.value)
                                                ),
                                                linkedTradeByLink
                                              )
                                            )
                                          }
                                        >
                                          Select All
                                        </button>
                                        <button
                                          type="button"
                                          className="mini-action mini-action-soft"
                                          disabled={selectedTradeValues.length === 0}
                                          onClick={() =>
                                            handleScreenshotTagUpdate(index, (currentTag) =>
                                              buildScreenshotTagFromTradeLinks(currentTag, [], linkedTradeByLink)
                                            )
                                          }
                                        >
                                          Clear
                                        </button>
                                      </div>
                                      {screenshotTradeOptions.length > 0 ? (
                                        <div className="journal-screenshot-trade-picker-list">
                                          {screenshotTradeOptions.map(({ value, trade }) => {
                                            const isChecked = selectedTradeValueSet.has(value);
                                            return (
                                              <label
                                                key={`${selectedPage.id}-${value}`}
                                                className={`journal-screenshot-trade-option${isChecked ? " is-checked" : ""}`}
                                              >
                                                <input
                                                  type="checkbox"
                                                  checked={isChecked}
                                                  onChange={() => {
                                                    const nextValues = isChecked
                                                      ? selectedTradeValues.filter((currentValue) => currentValue !== value)
                                                      : [...selectedTradeValues, value];
                                                    const nextLinks = parseTradeLinkValues(nextValues);
                                                    handleScreenshotTagUpdate(index, (currentTag) =>
                                                      buildScreenshotTagFromTradeLinks(currentTag, nextLinks, linkedTradeByLink)
                                                    );
                                                  }}
                                                />
                                                <span className="journal-screenshot-trade-option-main">
                                                  <strong>{trade.symbol}</strong>
                                                  <span>{trade.name}</span>
                                                  <span className="journal-screenshot-trade-option-time">
                                                    {trade.openTime} to {trade.closeTime}
                                                  </span>
                                                </span>
                                                <span className="journal-screenshot-trade-option-meta">
                                                  {formatSignedMoney(trade.netPnlUsd)}
                                                </span>
                                              </label>
                                            );
                                          })}
                                        </div>
                                      ) : (
                                        <div className="empty-inline-state">
                                          No trades found for this journal date.
                                        </div>
                                      )}
                                    </details>
                                  </div>
                                  <div className="journal-screenshot-tag-field">
                                    <span>Ticker</span>
                                    <div className="journal-screenshot-ticker-pill-row">
                                      {tickerPills.length > 0 ? (
                                        tickerPills.map((ticker) => (
                                          <span key={`${selectedPage.id}-${index}-ticker-${ticker}`} className="journal-screenshot-ticker-pill">
                                            {ticker}
                                          </span>
                                        ))
                                      ) : (
                                        <span className="journal-screenshot-ticker-empty">No linked tickers</span>
                                      )}
                                    </div>
                                  </div>
                                  <div className="journal-screenshot-tag-field">
                                    <span>Playbook</span>
                                    <button
                                      type="button"
                                      className={`journal-screenshot-playbook-trigger${playbookPills.length > 0 ? "" : " is-empty"}`}
                                      onClick={() => {
                                        setOpenPlaybookPickerIndex(index);
                                        setPlaybookPickerSearchQuery("");
                                        setOpenTradePickerIndex(null);
                                      }}
                                    >
                                      {playbookPills.length > 0 ? (
                                        <span className="journal-screenshot-playbook-pill-row">
                                          {playbookPills.map((playbook) => (
                                            <span
                                              key={`${selectedPage.id}-${index}-playbook-${playbook.toLowerCase()}`}
                                              className={`tag-option-pill tag-option-pill-${getTagToneIndex(playbook)}`}
                                            >
                                              {playbook}
                                            </span>
                                          ))}
                                        </span>
                                      ) : (
                                        <span>Select playbook</span>
                                      )}
                                    </button>
                                  </div>
                                  <label className="journal-screenshot-tag-field">
                                    <span>Tagged Date</span>
                                    <input
                                      type="date"
                                      value={normalizeDateForInput(screenshotTag.taggedDate)}
                                      onChange={(event) =>
                                        handleScreenshotTagUpdate(index, (currentTag) => ({
                                          ...currentTag,
                                          taggedDate:
                                            normalizeDateForInput(event.target.value) || selectedPage.tradeDate
                                        }))
                                      }
                                    />
                                  </label>
                                </div>
                                <div className="journal-screenshot-tag-actions">
                                  <span className="journal-screenshot-link-status">
                                    {resolvedLinkedTrades.length > 0
                                      ? `Attached to ${linkedTradeSummary}${extraLinkedTradeCount > 0 ? ` (+${extraLinkedTradeCount} more)` : ""}${
                                          missingLinkedTradeCount > 0 ? ` (${missingLinkedTradeCount} missing)` : ""
                                        }`
                                      : selectedTradeLinks.length > 0
                                        ? "Linked trades not found on this date."
                                        : "Not attached to a trade yet."}
                                  </span>
                                  {resolvedLinkedTrades.slice(0, 3).map((trade) => (
                                    <button
                                      key={`${selectedPage.id}-${trade.id}-${trade.tradeDate}`}
                                      type="button"
                                      className="mini-action mini-action-soft"
                                      onClick={() => onSelectTrade(trade.id, trade.tradeDate)}
                                    >
                                      Open {trade.symbol}
                                    </button>
                                  ))}
                                </div>
                              </>
                            );
                          })()}
                          <div className="journal-screenshot-actions">
                            <button
                              type="button"
                              className="mini-action"
                              onClick={() => {
                                setPendingScreenshotSlotIndex(index);
                                screenshotInputRef.current?.click();
                              }}
                            >
                              Replace
                            </button>
                            <a
                              className="review-link"
                              href={screenshotUrl}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Open
                            </a>
                            <button
                              type="button"
                              className="mini-action mini-action-danger"
                              onClick={() => {
                                const nextScreenshotUrls = selectedPage.screenshotUrls.filter(
                                  (_, screenshotIndex) => screenshotIndex !== index
                                );
                                const nextScreenshotTags = journalScreenshotTags.filter(
                                  (_, screenshotIndex) => screenshotIndex !== index
                                );
                                updateSelectedPageScreenshots(nextScreenshotUrls, nextScreenshotTags);
                              }}
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                      );
                    })}
                </div>
              </section>

              <section className="placeholder-panel journal-trade-database-panel">
                <div className="journal-sidebar-header">
                  <div>
                    <strong>Trade Database</strong>
                    <span>{linkedTrades.length} trades for {formatJournalDate(selectedPage.tradeDate)}</span>
                  </div>
                  {selectedJournalTradeIds.length > 0 ? (
                    <div className="table-selection-actions">
                      <button
                        type="button"
                        className="mini-action"
                        onClick={() => {
                          setJournalBatchPlaybookSearchQuery("");
                          setIsJournalBatchPlaybookOpen(true);
                        }}
                      >
                        Batch Playbook
                      </button>
                    </div>
                  ) : null}
                </div>
                <PreviewTable
                  trades={linkedTrades}
                  tagOptionsByField={tagOptionsByField}
                  pinLeadingColumns
                  maxTableHeight="clamp(300px, calc(100vh - 420px), 640px)"
                  enableBatchPlaybookActions={false}
                  selectedTradeId={selectedJournalTradeId}
                  selectedTradeIds={selectedJournalTradeIds}
                  onSelectTrade={(trade) => setSelectedJournalTradeId(trade.id)}
                  onToggleTradeSelection={(tradeId) =>
                    setSelectedJournalTradeIds((current) =>
                      current.includes(tradeId)
                        ? current.filter((currentTradeId) => currentTradeId !== tradeId)
                        : [...current, tradeId]
                    )
                  }
                  onToggleSelectAll={(tradeIds) =>
                    setSelectedJournalTradeIds((current) =>
                      tradeIds.every((tradeId) => current.includes(tradeId)) ? [] : tradeIds
                    )
                  }
                  onUpdateTradeTag={onUpdateTradeTag}
                  onBulkUpdateTradeTags={handleBulkUpdateJournalTradeTags}
                  onCreateTradeTagOption={onCreateTradeTagOption}
                  onRenameTradeTagOption={onRenameTradeTagOption}
                  onDeleteTradeTagOption={onDeleteTradeTagOption}
                />
              </section>
            </>
          ) : (
            <div className="journal-empty-state">
              <strong>No journal page selected</strong>
              <span>Create a dated journal entry from the left sidebar to begin writing.</span>
            </div>
          )}
        </section>
        <aside className="journal-links">
          <div className="journal-sidebar-header">
            <div>
              <strong>Linked Trades</strong>
              <span>{linkedTrades.length} matches</span>
            </div>
          </div>
          <div className="linked-trade-list">
            {linkedTrades.length === 0 ? (
              <span className="empty-inline-state">No trades linked to this date yet.</span>
            ) : (
              linkedTrades.map((trade) => {
                const tickerIcon = getTickerIconSrc(trade.symbol);
                const tickerSector = getTickerSector(trade.symbol);

                return (
                  <button
                    key={trade.id}
                    type="button"
                    className="linked-trade-card linked-trade-card-button"
                    onClick={() => onSelectTrade(trade.id, trade.tradeDate)}
                  >
                    <div className="linked-trade-title">
                      <strong>{trade.name}</strong>
                    </div>
                    <div className="linked-trade-meta">
                      {tickerIcon ? (
                        <img
                          src={tickerIcon}
                          alt={tickerSector ? `${tickerSector} sector icon` : `${trade.symbol} ticker icon`}
                          className="linked-trade-icon"
                        />
                      ) : (
                        <WorkspaceIcon icon="trades" alt={`${trade.symbol} ticker icon`} className="linked-trade-icon" />
                      )}
                      <span>
                        {trade.symbol} - {trade.side} - {trade.status}
                      </span>
                    </div>
                    <span>{trade.openTime} to {trade.closeTime}</span>
                    <span>{trade.netPnlUsd >= 0 ? "+" : ""}{trade.netPnlUsd.toFixed(2)} net</span>
                  </button>
                );
              })
            )}
          </div>
        </aside>
      </section>
      {selectedPage && isJournalBatchPlaybookOpen ? (
        <TagDrawer
          isOpen={isJournalBatchPlaybookOpen}
          title={`Batch Update - Playbook (${selectedJournalTradeIds.length} selected)`}
          options={tagOptionsByField.playbook}
          currentValue=""
          allowClear
          clearLabel="Clear Playbook"
          searchValue={journalBatchPlaybookSearchQuery}
          onSearchChange={setJournalBatchPlaybookSearchQuery}
          onSelect={(value) => {
            onBulkUpdateTradeTags(selectedJournalTradeIds, "playbook", value);
            setIsJournalBatchPlaybookOpen(false);
            setJournalBatchPlaybookSearchQuery("");
          }}
          onCreateOption={(value) => {
            onCreateTradeTagOption("playbook", value);
            onBulkUpdateTradeTags(selectedJournalTradeIds, "playbook", value);
            setIsJournalBatchPlaybookOpen(false);
            setJournalBatchPlaybookSearchQuery("");
          }}
          onRenameOption={(currentValue, nextValue) => {
            onRenameTradeTagOption("playbook", currentValue, nextValue);
          }}
          onDeleteOption={(value) => {
            onDeleteTradeTagOption("playbook", value);
          }}
          canManageOption={(value) =>
            !defaultTradeTagOptionsByField.playbook.some(
              (option) => option.toLowerCase() === value.toLowerCase()
            )
          }
          onClose={() => {
            setIsJournalBatchPlaybookOpen(false);
            setJournalBatchPlaybookSearchQuery("");
          }}
        />
      ) : null}
      {selectedPage && openPlaybookPickerIndex !== null && activePlaybookPickerTag ? (
        <TagDrawer
          isOpen
          title={`Playbook - ${getScreenshotSlotMeta(openPlaybookPickerIndex).label} ${getScreenshotSlotMeta(openPlaybookPickerIndex).rowLabel}`}
          options={screenshotPlaybookOptions}
          currentValue={activePlaybookPickerTag.playbook}
          allowClear
          clearLabel="Clear Playbook"
          searchValue={playbookPickerSearchQuery}
          onSearchChange={setPlaybookPickerSearchQuery}
          onSelect={(value) => {
            const nextValue = typeof value === "string" ? value : "";
            handleScreenshotTagUpdate(openPlaybookPickerIndex, (currentTag) => ({
              ...currentTag,
              playbook: nextValue
            }));
            setOpenPlaybookPickerIndex(null);
            setPlaybookPickerSearchQuery("");
          }}
          onCreateOption={(value) => {
            onCreateTradeTagOption("playbook", value);
            handleScreenshotTagUpdate(openPlaybookPickerIndex, (currentTag) => ({
              ...currentTag,
              playbook: value
            }));
            setOpenPlaybookPickerIndex(null);
            setPlaybookPickerSearchQuery("");
          }}
          onRenameOption={(currentValue, nextValue) => {
            onRenameTradeTagOption("playbook", currentValue, nextValue);
            handleScreenshotTagUpdate(openPlaybookPickerIndex, (currentTag) => {
              if (currentTag.playbook.trim().toLowerCase() !== currentValue.trim().toLowerCase()) {
                return currentTag;
              }

              return {
                ...currentTag,
                playbook: nextValue
              };
            });
          }}
          onDeleteOption={(value) => {
            onDeleteTradeTagOption("playbook", value);
            handleScreenshotTagUpdate(openPlaybookPickerIndex, (currentTag) => {
              if (currentTag.playbook.trim().toLowerCase() !== value.trim().toLowerCase()) {
                return currentTag;
              }

              return {
                ...currentTag,
                playbook: ""
              };
            });
          }}
          canManageOption={(value) =>
            !defaultTradeTagOptionsByField.playbook.some(
              (option) => option.toLowerCase() === value.toLowerCase()
            )
          }
          onClose={() => {
            setOpenPlaybookPickerIndex(null);
            setPlaybookPickerSearchQuery("");
          }}
        />
      ) : null}
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
                src={expandedScreenshotUrl}
                alt="Expanded journal screenshot"
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
    </main>
  );
};

