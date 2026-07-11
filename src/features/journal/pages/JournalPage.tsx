import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { JournalRichTextEditor } from "../components/JournalRichTextEditor";
import { PageHero } from "../../../components/PageHero";
import { PreviewTable } from "../../../components/PreviewTable";
import { TagDrawer } from "../../../components/TagDrawer";
import { WorkspaceIcon } from "../../../components/WorkspaceIcon";
import {
  MPP_FORMULA_TOOLTIP,
  calculateMPPWindow,
  type MPPDayRecord,
  type MPPWindowResult
} from "../../../lib/analytics/mppAnalytics";
import { getMPPDayRecordsForTrades } from "../../../lib/analytics/assetMppAnalytics";
import { getDatabaseStats, getTradeSummary } from "../../../lib/analytics/tradeAnalytics";
import { hasJournalDocContent } from "../../../lib/journal/journalContent";
import type { JournalChecklistTemplates, NamedChecklistTemplate } from "../../../lib/journal/journalTemplateStore";
import {
  JOURNAL_PAGES_STORAGE_KEY,
  collectRichTextAttachmentPaths,
  deleteWorkspaceAttachmentIfUnused,
  resolveWorkspaceAttachmentSrc,
  saveWorkspaceInlineImage,
  saveUploadedWorkspaceAttachment,
  type InlineImageInsertResult
} from "../../../lib/workspace/workspaceAttachmentClient";
import { getTickerIcon as getTickerIconSrc, getTickerSector } from "../../../lib/tickers/tickerIcons";
import {
  ensureWeeklyImprovementGoalsPage,
  findWeeklyImprovementGoalsPageForDate,
  formatWeeklyImprovementGoalsRange,
  getWeeklyImprovementGoalsPageRange,
  getWeeklyImprovementGoalsWeekRange,
  LIBRARY_PAGES_UPDATED_EVENT,
  loadLibraryPages,
  saveLibraryPages
} from "../../../lib/library/libraryStore";
import { useEditableSelectOptions } from "../../../lib/select/useEditableSelectOptions";
import { tradeTagOptionsByField as defaultTradeTagOptionsByField } from "../../../lib/trades/tradeTagCatalog";
import { getJournalWeekStartDate } from "../lib/journalPageActions";
import type {
  JournalContentField,
  JournalPageRecord,
  JournalScreenshotTagRecord,
  JournalScreenshotTradeLink
} from "../../../types/journal";
import type { Settings } from "../../../types/trade";
import type { LibraryPageRecord } from "../../../types/library";
import type { EditableTradeRow, EditableTradeTagField } from "../../../types/tradeTags";
import { HeadlinesBar } from "../../headlines/components/HeadlinesBar";
import { JournalTradeNotesPanel } from "../components/JournalTradeNotesPanel";

interface JournalPageProps {
  pages: JournalPageRecord[];
  selectedPageId: string;
  trades: EditableTradeRow[];
  settings: Settings;
  tagOptionsByField: Record<EditableTradeTagField, string[]>;
  checklistTemplates: JournalChecklistTemplates;
  externalSelectedTradeDate: string;
  onSelectPage: (pageId: string) => void;
  onSelectTrade: (tradeId: string, tradeDate: string) => void;
  onCreatePage: (tradeDate: string) => void;
  onCreatePages: (tradeDates: string[]) => void;
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
        | "tradeNotes"
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
  externalSelectedTradeRequestId: number;
}

interface JournalPageSummary {
  netPnl: number;
  tradeCount: number;
  winRate: number;
  avgTrade: number;
  totalSharesTraded: number;
  tickers: string[];
}

const emptyJournalPageSummary: JournalPageSummary = {
  netPnl: 0,
  tradeCount: 0,
  winRate: 0,
  avgTrade: 0,
  totalSharesTraded: 0,
  tickers: []
};

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
const acceptedWeeklyEarningsImageTypes = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif"
]);
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

const getPrimaryTradePlaybook = (trade: EditableTradeRow): string =>
  trade.setups
    .map((playbook) => playbook.trim())
    .find((playbook) => playbook && playbook !== "No Setup") ?? "";

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

const journalListWeekdayFormatter = new Intl.DateTimeFormat(undefined, { weekday: "long" });
const journalListDayFormatter = new Intl.DateTimeFormat(undefined, { day: "numeric" });

const formatJournalListDate = (tradeDate: string) => {
  if (!tradeDate) {
    return "No Date";
  }

  const normalized = `${tradeDate}T00:00:00`;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return formatJournalDate(tradeDate);
  }

  return `${journalListWeekdayFormatter.format(parsed)} ${journalListDayFormatter.format(parsed)}`;
};

const getSortableTimestamp = (value: string) => {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
};

const formatSignedMoney = (value: number) => `${value >= 0 ? "+" : ""}$${value.toFixed(2)}`;
const formatSignedWholeNumber = (value: number) => `${value >= 0 ? "+" : ""}${value.toLocaleString()}`;

interface MppLockInProjectionRow {
  step: number;
  positiveProjection: number;
  negativeProjection: number;
}

const getMppWindowNote = (mppWindow: MPPWindowResult, sourceDayCount: number): string => {
  if (sourceDayCount === 0) {
    return "No eligible days yet";
  }

  return mppWindow.isPartialWindow
    ? `Not enough days yet (${mppWindow.formulaBreakdown.eligibleDayCount}/${mppWindow.formulaBreakdown.windowSize})`
    : `${mppWindow.formulaBreakdown.excludedDaysRemoved} worst day${
        mppWindow.formulaBreakdown.excludedDaysRemoved === 1 ? "" : "s"
      } removed`;
};

const buildMppLockInProjectionRows = ({
  anchorTradeDate,
  mppLockInSteps,
  mppTradeDays,
  selectedPageMPP
}: {
  anchorTradeDate: string;
  mppLockInSteps: number[];
  mppTradeDays: MPPDayRecord[];
  selectedPageMPP: MPPWindowResult;
}): MppLockInProjectionRow[] => {
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
};
const formatTradePrice = (value: number): string => {
  if (!Number.isFinite(value)) {
    return "-";
  }

  return value.toFixed(Math.abs(value) >= 100 ? 2 : 4);
};

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

const formatDateInputValue = (value: Date) => {
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, "0");
  const day = `${value.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const formatJournalWeekRange = (tradeDate: string): string => {
  const weekStart = getJournalWeekStartDate(tradeDate);
  if (!weekStart) {
    return "No week selected";
  }

  const weekEndDate = new Date(`${weekStart}T00:00:00`);
  if (Number.isNaN(weekEndDate.getTime())) {
    return weekStart;
  }

  weekEndDate.setDate(weekEndDate.getDate() + 4);
  return `${formatJournalDate(weekStart)} through ${formatJournalDate(formatDateInputValue(weekEndDate))}`;
};

const getNextWeekTradeDates = (anchorTradeDate: string): string[] => {
  const normalizedAnchorTradeDate = normalizeDateForInput(anchorTradeDate);
  if (!normalizedAnchorTradeDate) {
    return [];
  }

  const anchorDate = new Date(`${normalizedAnchorTradeDate}T00:00:00`);
  if (Number.isNaN(anchorDate.getTime())) {
    return [];
  }

  const mondayOffset = (anchorDate.getDay() + 6) % 7;
  const nextWeekMonday = new Date(anchorDate);
  nextWeekMonday.setDate(anchorDate.getDate() - mondayOffset + 7);

  return Array.from({ length: 5 }, (_, index) => {
    const nextDate = new Date(nextWeekMonday);
    nextDate.setDate(nextWeekMonday.getDate() + index);
    return formatDateInputValue(nextDate);
  });
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

const createWeeklyEarningsImageDoc = (
  fileName: string,
  imageResult: string | InlineImageInsertResult
): JournalPageRecord["weeklyEarningsContent"] => {
  const storageSrc = typeof imageResult === "string" ? "" : imageResult.storageSrc ?? "";
  const src = storageSrc || (typeof imageResult === "string" ? imageResult : imageResult.src);

  return {
    type: "doc",
    content: [
      {
        type: "image",
        attrs: {
          src,
          alt: fileName,
          ...(storageSrc ? { filePath: storageSrc } : {})
        }
      },
      {
        type: "paragraph"
      }
    ]
  };
};

export const JournalPage = ({
  pages,
  selectedPageId,
  trades,
  settings,
  tagOptionsByField,
  checklistTemplates,
  externalSelectedTradeDate,
  onSelectPage,
  onSelectTrade,
  onCreatePage,
  onCreatePages,
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
  onAttachScreenshotToTrade,
  externalSelectedTradeRequestId
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
  const [isWeeklyEarningsDragActive, setIsWeeklyEarningsDragActive] = useState(false);
  const [libraryPages, setLibraryPages] = useState<LibraryPageRecord[]>(() => loadLibraryPages());
  const lastExternalSyncRef = useRef("");
  const expandedMonthsInitializedRef = useRef(false);
  const draftTradeDateInputRef = useRef<HTMLInputElement | null>(null);
  const screenshotInputRef = useRef<HTMLInputElement | null>(null);
  const weeklyEarningsInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const initialPages = loadLibraryPages();
    const ensured = ensureWeeklyImprovementGoalsPage(initialPages);
    setLibraryPages(ensured.pages);
    if (ensured.created) {
      void saveLibraryPages(ensured.pages);
    }

    const handleLibraryPagesUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ pages?: LibraryPageRecord[] }>).detail;
      setLibraryPages(Array.isArray(detail?.pages) ? detail.pages : loadLibraryPages());
    };

    window.addEventListener(LIBRARY_PAGES_UPDATED_EVENT, handleLibraryPagesUpdated);
    return () => window.removeEventListener(LIBRARY_PAGES_UPDATED_EVENT, handleLibraryPagesUpdated);
  }, []);

  const createJournalInlineImageInsertHandler = (pageId: string, fieldKey: string) => async (file: File) =>
    saveWorkspaceInlineImage({
      category: "journal-inline-images",
      recordId: pageId,
      slotKey: fieldKey,
      file
    });

  const saveJournalScreenshotFiles = async (
    page: JournalPageRecord,
    files: File[],
    startIndex: number
  ): Promise<string[]> =>
    Promise.all(
      files.map((file, index) =>
        saveUploadedWorkspaceAttachment({
          category: "journal-screenshots",
          recordId: page.id,
          slotKey: `slot-${startIndex + index + 1}`,
          file
        })
      )
    );

  const buildNextPagesWithUpdatedScreenshots = (
    pageId: string,
    screenshotUrls: string[],
    screenshotTags: JournalScreenshotTagRecord[]
  ): JournalPageRecord[] =>
    pages.map((currentPage) =>
      currentPage.id === pageId
        ? {
            ...currentPage,
            screenshotUrls,
            screenshotTags
          }
        : currentPage
    );

  const discardScreenshotAttachment = (path: string, nextPages: JournalPageRecord[]) => {
    void deleteWorkspaceAttachmentIfUnused(path, {
      delayMs: 0,
      storageOverrides: {
        [JOURNAL_PAGES_STORAGE_KEY]: nextPages
      }
    }).catch(() => undefined);
  };

  const buildNextPagesWithUpdatedWeeklyEarnings = (
    page: JournalPageRecord,
    content: JournalPageRecord["weeklyEarningsContent"]
  ): JournalPageRecord[] => {
    const weekStart = getJournalWeekStartDate(page.tradeDate);
    return pages.map((currentPage) =>
      getJournalWeekStartDate(currentPage.tradeDate) === weekStart
        ? {
            ...currentPage,
            weeklyEarningsContent: content
          }
        : currentPage
    );
  };

  const discardRemovedWeeklyEarningsAttachments = (
    page: JournalPageRecord,
    nextContent: JournalPageRecord["weeklyEarningsContent"],
    nextPages: JournalPageRecord[]
  ) => {
    const weekStart = getJournalWeekStartDate(page.tradeDate);
    const previousAttachmentPaths = new Set(
      pages
        .filter((currentPage) => getJournalWeekStartDate(currentPage.tradeDate) === weekStart)
        .flatMap((currentPage) => collectRichTextAttachmentPaths(currentPage.weeklyEarningsContent))
    );
    const nextAttachmentPaths = new Set(collectRichTextAttachmentPaths(nextContent));
    Array.from(previousAttachmentPaths)
      .filter((path) => !nextAttachmentPaths.has(path))
      .forEach((path) => {
        void deleteWorkspaceAttachmentIfUnused(path, {
          delayMs: 0,
          storageOverrides: {
            [JOURNAL_PAGES_STORAGE_KEY]: nextPages
          }
        }).catch(() => undefined);
      });
  };

  const handleWeeklyEarningsImageFile = (page: JournalPageRecord, file: File) => {
    if (!acceptedWeeklyEarningsImageTypes.has(file.type)) {
      window.alert("Please use a PNG, JPG, WEBP, or GIF image.");
      return;
    }

    void createJournalInlineImageInsertHandler(page.id, "weeklyEarningsContent")(file)
      .then((imageResult) => {
        const nextContent = createWeeklyEarningsImageDoc(file.name, imageResult);
        const nextPages = buildNextPagesWithUpdatedWeeklyEarnings(page, nextContent);
        onUpdateContent(page.id, "weeklyEarningsContent", nextContent);
        discardRemovedWeeklyEarningsAttachments(page, nextContent, nextPages);
      })
      .catch(() => {
        window.alert("The weekly earnings image could not be saved.");
      });
  };

  const handleWeeklyEarningsDrop = (page: JournalPageRecord, event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsWeeklyEarningsDragActive(false);
    const imageFile = Array.from(event.dataTransfer.files ?? []).find((file) =>
      acceptedWeeklyEarningsImageTypes.has(file.type)
    );
    if (!imageFile) {
      window.alert("Drop a PNG, JPG, WEBP, or GIF image.");
      return;
    }

    handleWeeklyEarningsImageFile(page, imageFile);
  };

  const handleScreenshotFileSelection = (page: JournalPageRecord, files: File[]) => {
    if (files.length === 0) {
      setPendingScreenshotSlotIndex(null);
      return;
    }

    const replacementIndex = pendingScreenshotSlotIndex;
    const startIndex = replacementIndex ?? page.screenshotUrls.length;
    setPendingScreenshotSlotIndex(null);

    void saveJournalScreenshotFiles(page, files, startIndex)
      .then((savedPaths) => {
        if (savedPaths.length === 0) {
          return;
        }

        const currentTags = getAlignedScreenshotTags(page);
        if (replacementIndex !== null) {
          const nextScreenshotUrls = [...page.screenshotUrls];
          const nextScreenshotTags = [...currentTags];
          const replacedScreenshotUrl = nextScreenshotUrls[replacementIndex] ?? "";

          nextScreenshotUrls[replacementIndex] = savedPaths[0];
          nextScreenshotTags[replacementIndex] =
            nextScreenshotTags[replacementIndex] ?? createDefaultScreenshotTag(page.tradeDate);

          if (savedPaths.length > 1) {
            nextScreenshotUrls.splice(replacementIndex + 1, 0, ...savedPaths.slice(1));
            nextScreenshotTags.splice(
              replacementIndex + 1,
              0,
              ...savedPaths.slice(1).map(() => createDefaultScreenshotTag(page.tradeDate))
            );
          }

          const nextPages = buildNextPagesWithUpdatedScreenshots(
            page.id,
            nextScreenshotUrls,
            nextScreenshotTags
          );
          updateSelectedPageScreenshots(nextScreenshotUrls, nextScreenshotTags);
          attachScreenshotIfLinked(savedPaths[0], nextScreenshotTags[replacementIndex]);
          setVisibleScreenshotRows((current) =>
            Math.max(current, Math.ceil(Math.max(nextScreenshotUrls.length, 3) / 3))
          );

          if (replacedScreenshotUrl && replacedScreenshotUrl !== savedPaths[0]) {
            discardScreenshotAttachment(replacedScreenshotUrl, nextPages);
          }
          return;
        }

        const nextScreenshotUrls = [...page.screenshotUrls, ...savedPaths];
        const nextScreenshotTags = [
          ...currentTags,
          ...savedPaths.map(() => createDefaultScreenshotTag(page.tradeDate))
        ];
        updateSelectedPageScreenshots(nextScreenshotUrls, nextScreenshotTags);
      })
      .catch(() => {
        window.alert("The screenshot files could not be saved.");
      });
  };

  const selectedPage = useMemo(
    () => pages.find((page) => page.id === selectedPageId) ?? pages[0] ?? null,
    [pages, selectedPageId]
  );

  useEffect(() => {
    if (!selectedPage?.tradeDate) {
      return;
    }

    if (
      draftTradeDateInputRef.current &&
      typeof document !== "undefined" &&
      document.activeElement === draftTradeDateInputRef.current
    ) {
      return;
    }

    setDraftTradeDate(selectedPage.tradeDate);
  }, [selectedPage?.tradeDate]);

  const selectedPageHeaderIcon = useMemo(
    () => getJournalDateIcon(selectedPage?.tradeDate ?? ""),
    [selectedPage?.tradeDate]
  );
  const selectedWeekRangeLabel = useMemo(
    () => (selectedPage ? formatJournalWeekRange(selectedPage.tradeDate) : ""),
    [selectedPage]
  );
  const weeklyImprovementGoalsPage = useMemo(
    () =>
      selectedPage
        ? findWeeklyImprovementGoalsPageForDate(libraryPages, selectedPage.tradeDate)
        : null,
    [libraryPages, selectedPage]
  );
  const weeklyImprovementGoalsRange = useMemo(() => {
    if (weeklyImprovementGoalsPage) {
      return getWeeklyImprovementGoalsPageRange(weeklyImprovementGoalsPage);
    }

    return selectedPage ? getWeeklyImprovementGoalsWeekRange(selectedPage.tradeDate) : null;
  }, [selectedPage, weeklyImprovementGoalsPage]);
  const weeklyImprovementGoalsHasContent = useMemo(
    () => Boolean(weeklyImprovementGoalsPage && hasJournalDocContent(weeklyImprovementGoalsPage.content)),
    [weeklyImprovementGoalsPage]
  );
  const weeklyEarningsHasContent = useMemo(
    () => Boolean(selectedPage && hasJournalDocContent(selectedPage.weeklyEarningsContent)),
    [selectedPage]
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

  const selectJournalPage = (page: JournalPageRecord) => {
    setDraftTradeDate(page.tradeDate);
    onSelectPage(page.id);
  };

  const navigateToJournalDate = (value: string) => {
    const normalized = normalizeDateForInput(value);
    if (!normalized) {
      return;
    }

    const matchingPage = sortedPagesRef.current.find((page) => page.tradeDate === normalized);
    if (matchingPage) {
      selectJournalPage(matchingPage);
    }
  };

  const handleDraftTradeDateChange = (value: string) => {
    setDraftTradeDate(value);
    navigateToJournalDate(value);
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

  const handleAddNextWeekPages = () => {
    const nextWeekTradeDates = getNextWeekTradeDates(draftTradeDate);
    if (nextWeekTradeDates.length === 0) {
      window.alert("Please choose a valid journal date first.");
      return;
    }

    setDraftTradeDate(nextWeekTradeDates[0]);
    onCreatePages(nextWeekTradeDates);
  };

  const tradesByDate = useMemo(() => {
    const grouped = new Map<string, EditableTradeRow[]>();
    for (const trade of trades) {
      const current = grouped.get(trade.tradeDate) ?? [];
      current.push(trade);
      grouped.set(trade.tradeDate, current);
    }

    for (const dateTrades of grouped.values()) {
      dateTrades.sort((left, right) => left.openTime.localeCompare(right.openTime));
    }

    return grouped;
  }, [trades]);

  const tradeSummariesByDate = useMemo(() => {
    const summaries = new Map<string, JournalPageSummary>();
    for (const [tradeDate, dateTrades] of tradesByDate.entries()) {
      const summary = getTradeSummary(dateTrades);
      summaries.set(tradeDate, {
        netPnl: summary.totalNetPnl,
        tradeCount: summary.totalTrades,
        winRate: summary.winRate,
        avgTrade: summary.avgTrade,
        totalSharesTraded: summary.totalSharesTraded,
        tickers: Array.from(new Set(dateTrades.map((trade) => trade.symbol))).sort()
      });
    }

    return summaries;
  }, [tradesByDate]);

  const linkedTrades = useMemo(
    () => (selectedPage?.tradeDate ? tradesByDate.get(selectedPage.tradeDate) ?? [] : []),
    [selectedPage?.tradeDate, tradesByDate]
  );
  const linkedTradeIdSet = useMemo(() => new Set(linkedTrades.map((trade) => trade.id)), [linkedTrades]);

  const linkedTickers = useMemo(
    () => Array.from(new Set(linkedTrades.map((trade) => trade.symbol))).sort(),
    [linkedTrades]
  );
  const journalPageSummaries = useMemo(
    () =>
      new Map(
        pages.map((page) => [
          page.id,
          tradeSummariesByDate.get(page.tradeDate) ?? emptyJournalPageSummary
        ])
      ),
    [pages, tradeSummariesByDate]
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

    const selectedTradeIdSet = new Set(tradeIds);
    const selectedTrades = linkedTrades.filter((trade) => selectedTradeIdSet.has(trade.id));
    if (selectedTrades.length === 0) {
      return;
    }

    for (const trade of selectedTrades) {
      onUpdateTradeTag(trade, field, value);
    }
  };
  const stockMppTradeDays = useMemo(
    () =>
      getMPPDayRecordsForTrades(trades, {
        assetClass: "stock",
        currencySymbolList: settings.currencySymbolList
      }),
    [trades, settings.currencySymbolList]
  );
  const currencyMppTradeDays = useMemo(
    () =>
      getMPPDayRecordsForTrades(trades, {
        assetClass: "currency",
        currencySymbolList: settings.currencySymbolList
      }),
    [trades, settings.currencySymbolList]
  );
  const selectedStockPageMPP = useMemo(
    () =>
      calculateMPPWindow(stockMppTradeDays, {
        anchorTradeDate: selectedPage?.tradeDate ?? ""
      }),
    [stockMppTradeDays, selectedPage?.tradeDate]
  );
  const selectedCurrencyPageMPP = useMemo(
    () =>
      calculateMPPWindow(currencyMppTradeDays, {
        anchorTradeDate: selectedPage?.tradeDate ?? ""
      }),
    [currencyMppTradeDays, selectedPage?.tradeDate]
  );
  const selectedStockPageMPPNote = getMppWindowNote(selectedStockPageMPP, stockMppTradeDays.length);
  const selectedCurrencyPageMPPNote = getMppWindowNote(selectedCurrencyPageMPP, currencyMppTradeDays.length);
  const mppLockInSteps = settings.mppLockInSteps;
  const stockMppLockInProjectionRows = useMemo(() => {
    const anchorTradeDate = selectedPage?.tradeDate?.trim() ?? "";
    return buildMppLockInProjectionRows({
      anchorTradeDate,
      mppLockInSteps,
      mppTradeDays: stockMppTradeDays,
      selectedPageMPP: selectedStockPageMPP
    });
  }, [mppLockInSteps, stockMppTradeDays, selectedPage?.tradeDate, selectedStockPageMPP]);
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
  const screenshotTradeOptionValueSet = useMemo(
    () => new Set(screenshotTradeOptions.map((option) => option.value)),
    [screenshotTradeOptions]
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
    if (!externalSelectedTradeDate || externalSelectedTradeRequestId <= 0) {
      return;
    }

    const externalSyncKey = `${externalSelectedTradeRequestId}:${externalSelectedTradeDate}`;
    if (lastExternalSyncRef.current === externalSyncKey) {
      return;
    }

    lastExternalSyncRef.current = externalSyncKey;
    setDraftTradeDate(externalSelectedTradeDate);
    const matchingPage = sortedPagesRef.current.find((page) => page.tradeDate === externalSelectedTradeDate);
    if (matchingPage) {
      onSelectPage(matchingPage.id);
    }
  }, [externalSelectedTradeDate, externalSelectedTradeRequestId, onSelectPage]);

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
      current.filter((tradeId) => linkedTradeIdSet.has(tradeId))
    );
    setSelectedJournalTradeId((current) =>
      linkedTradeIdSet.has(current) ? current : linkedTrades[0]?.id ?? ""
    );
  }, [linkedTradeIdSet, linkedTrades]);

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

  const getLinkedTradeIdsForScreenshotTag = (
    screenshotTag: JournalScreenshotTagRecord | undefined
  ): string[] => {
    if (!screenshotTag) {
      return [];
    }

    return Array.from(
      new Set(
        getScreenshotTradeLinks(screenshotTag)
          .map((link) => linkedTradeByLink.get(serializeTradeLink(link.tradeId, link.tradeDate))?.id ?? "")
          .filter(Boolean)
      )
    );
  };

  const syncLinkedTradeScreenshot = (tradeIds: string[], screenshotUrl: string) => {
    for (const tradeId of tradeIds) {
      onAttachScreenshotToTrade(tradeId, screenshotUrl);
    }
  };

  const attachScreenshotIfLinked = (
    screenshotUrl: string,
    screenshotTag: JournalScreenshotTagRecord | undefined
  ) => {
    if (!screenshotUrl) {
      return;
    }

    syncLinkedTradeScreenshot(getLinkedTradeIdsForScreenshotTag(screenshotTag), screenshotUrl);
  };

  const clearScreenshotIfLinked = (screenshotTag: JournalScreenshotTagRecord | undefined) => {
    syncLinkedTradeScreenshot(getLinkedTradeIdsForScreenshotTag(screenshotTag), "");
  };

  const attachScreenshotForNewTradeLinks = (
    screenshotUrl: string,
    previousTag: JournalScreenshotTagRecord,
    nextTag: JournalScreenshotTagRecord
  ) => {
    if (!screenshotUrl) {
      return;
    }

    const previousTradeIds = new Set(getLinkedTradeIdsForScreenshotTag(previousTag));
    const addedTradeIds = getLinkedTradeIdsForScreenshotTag(nextTag).filter(
      (tradeId) => !previousTradeIds.has(tradeId)
    );

    if (addedTradeIds.length === 0) {
      return;
    }

    syncLinkedTradeScreenshot(addedTradeIds, screenshotUrl);
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
    attachScreenshotForNewTradeLinks(
      selectedPage.screenshotUrls[screenshotIndex] ?? "",
      currentTag,
      nextTags[screenshotIndex]
    );
  };

  return (
    <main className="page-shell journal-page-shell">
      <PageHero
        eyebrow="Journal"
        title="Trading Journal"
        icon="journal"
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
                  ref={draftTradeDateInputRef}
                  type="date"
                  value={draftTradeDate}
                  onChange={(event) => handleDraftTradeDateChange(event.target.value)}
                  className="journal-date-input"
                />
              </label>
              <button type="button" className="mini-action journal-create-button" onClick={promptForNewJournalDate}>
                <WorkspaceIcon icon="journal" alt="Create journal icon" className="mini-action-icon" />
                New Journal
              </button>
              <button type="button" className="mini-action journal-create-button" onClick={handleAddNextWeekPages}>
                <WorkspaceIcon icon="plan" alt="Add next week journals icon" className="mini-action-icon" />
                Add Next Week
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
                            const tradeCount = pageSummary?.tradeCount ?? 0;
                            const winRate = pageSummary?.winRate ?? 0;
                            const tickers = pageSummary?.tickers ?? [];
                            return (
                              <button
                                key={page.id}
                                type="button"
                                className={`journal-page-item ${page.id === selectedPage?.id ? "journal-page-item-active" : ""}`}
                                onClick={() => selectJournalPage(page)}
                              >
                                <div className="journal-page-row">
                                  <div className="journal-page-title">
                                    <WorkspaceIcon icon="journal" alt="Journal page icon" className="journal-page-icon" />
                                    <strong>{formatJournalListDate(page.tradeDate)}</strong>
                                  </div>
                                  <div className="journal-page-row-meta">
                                    <span className={`journal-grade-pill${page.dayGrade ? "" : " journal-grade-pill-empty"}`}>
                                      {gradeLabel}
                                    </span>
                                    <strong
                                      className={`journal-page-pnl ${
                                        netPnl >= 0 ? "journal-page-pnl-positive" : "journal-page-pnl-negative"
                                      }`}
                                    >
                                      {formatSignedMoney(netPnl)}
                                    </strong>
                                  </div>
                                </div>
                                <div className="journal-page-meta">
                                  <span>{tradeCount} trades</span>
                                  <span>{winRate.toFixed(1)}% WR</span>
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
                    </div>
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
                    <div className="journal-header-stat-row journal-header-stat-row-core">
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
                      <span>{selectedStockPageMPP.isPartialWindow ? "Stock MPP partial" : "Stock MPP"}</span>
                      <input
                        type="text"
                        className="journal-header-stat-input"
                        value={selectedStockPageMPP.currentMPP.toLocaleString()}
                        aria-label="Calculated stock MPP value"
                        readOnly
                      />
                      <small className="journal-header-stat-note">{selectedStockPageMPPNote}</small>
                    </label>
                    <label className="journal-header-stat-card" title={MPP_FORMULA_TOOLTIP}>
                      <span>{selectedCurrencyPageMPP.isPartialWindow ? "Currency MPP partial" : "Currency MPP"}</span>
                      <input
                        type="text"
                        className="journal-header-stat-input"
                        value={selectedCurrencyPageMPP.currentMPP.toLocaleString()}
                        aria-label="Calculated currency MPP value"
                        readOnly
                      />
                      <small className="journal-header-stat-note">{selectedCurrencyPageMPPNote}</small>
                    </label>
                    </div>
                    <div className="journal-header-stat-row journal-header-stat-row-mood">
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
                        <strong>Stock MPP Lock-In (+)</strong>
                        <span>Tomorrow MPP ({selectedStockPageMPP.formulaBreakdown.projectionDays}-day projection)</span>
                      </div>
                      <div className="journal-metric-list">
                        {stockMppLockInProjectionRows.map(({ step, positiveProjection }) => (
                          <div key={`stock-mpp-lock-positive-${step}`}>
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
                        <strong>Stock MPP Lock-In (-)</strong>
                        <span>Tomorrow MPP ({selectedStockPageMPP.formulaBreakdown.projectionDays}-day projection)</span>
                      </div>
                      <div className="journal-metric-list">
                        {stockMppLockInProjectionRows.map(({ step, negativeProjection }) => (
                          <div key={`stock-mpp-lock-negative-${step}`}>
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

              <section className="journal-writing-split-grid journal-checklist-grid">
                <section className="journal-writing-section journal-checklist-section journal-checklist-section-primary">
                  <div className="journal-writing-header">
                    <div className="journal-writing-header-title">
                      <WorkspaceIcon icon="journal-checklist" alt="Morning checklist icon" className="mini-action-icon" />
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
                    onImageInsert={createJournalInlineImageInsertHandler(selectedPage.id, "morningChecklistContent")}
                    draftStorageKey={`${selectedPage.id}:morningChecklistContent`}
                    sourceUpdatedAt={selectedPage.updatedAt}
                    placeholder="Type '/' for commands"
                    appearance="notion"
                    taskListColumns={2}
                    compact
                    autosize
                  />
                </section>

                <div className="journal-checklist-side-stack">
                  <section className="journal-writing-section journal-checklist-section journal-checklist-section-compact">
                  <div className="journal-writing-header">
                    <div className="journal-writing-header-title">
                      <WorkspaceIcon icon="journal-checklist" alt="Closing checklist icon" className="mini-action-icon" />
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
                    onImageInsert={createJournalInlineImageInsertHandler(selectedPage.id, "closingChecklistContent")}
                    draftStorageKey={`${selectedPage.id}:closingChecklistContent`}
                    sourceUpdatedAt={selectedPage.updatedAt}
                    placeholder="Type '/' for commands"
                    appearance="notion"
                    heightPreset="short"
                    compact
                    autosize
                  />
                  </section>

                  <section className="journal-writing-section journal-weekly-improvement-goals-card">
                    <div className="journal-writing-header">
                      <div className="journal-writing-header-title journal-weekly-improvement-goals-title">
                        <WorkspaceIcon icon="plan" alt="Weekly improvement goals icon" className="mini-action-icon" />
                        <div>
                          <strong>Weekly Improvement Goals</strong>
                          <span>
                            {weeklyImprovementGoalsRange
                              ? formatWeeklyImprovementGoalsRange(
                                  weeklyImprovementGoalsRange.start,
                                  weeklyImprovementGoalsRange.end
                                )
                              : "No week selected"}
                          </span>
                        </div>
                      </div>
                      <span className="journal-weekly-improvement-goals-source">Library managed</span>
                    </div>

                    {weeklyImprovementGoalsPage && weeklyImprovementGoalsHasContent ? (
                      <JournalRichTextEditor
                        key={`${weeklyImprovementGoalsPage.id}-journal-card`}
                        content={weeklyImprovementGoalsPage.content}
                        onChange={() => undefined}
                        readOnly
                        appearance="notion"
                        compact
                        showBlockActions={false}
                      />
                    ) : (
                      <div className="journal-weekly-improvement-goals-empty">
                        No goals saved for this week. Add them in Library &gt; Weekly Improvement Goals.
                      </div>
                    )}
                  </section>
                </div>
              </section>

              <section className="journal-writing-section">
                <div className="journal-writing-header">
                  <div className="journal-writing-header-title">
                    <WorkspaceIcon icon="journal-notebook" alt="Morning journal icon" className="mini-action-icon" />
                    <strong>Morning Journal</strong>
                  </div>
                </div>
                <JournalRichTextEditor
                  key={`${selectedPage.id}-morning`}
                  content={selectedPage.morningContent}
                  onChange={(content) => onUpdateContent(selectedPage.id, "morningContent", content)}
                  onImageInsert={createJournalInlineImageInsertHandler(selectedPage.id, "morningContent")}
                  draftStorageKey={`${selectedPage.id}:morningContent`}
                  sourceUpdatedAt={selectedPage.updatedAt}
                  placeholder=""
                  appearance="notion"
                  autosize
                />
              </section>

              <HeadlinesBar
                key={`headlines-${selectedPage.tradeDate}`}
                className="journal-headlines-bar"
                journalDate={selectedPage.tradeDate}
              />

              <section className="journal-writing-section">
                <div className="journal-writing-header">
                  <div className="journal-writing-header-title">
                    <WorkspaceIcon icon="journal-notebook" alt="Closing journal icon" className="mini-action-icon" />
                    <strong>Closing Journal</strong>
                  </div>
                </div>
                <JournalRichTextEditor
                  key={`${selectedPage.id}-closing`}
                  content={selectedPage.closingContent}
                  onChange={(content) => onUpdateContent(selectedPage.id, "closingContent", content)}
                  onImageInsert={createJournalInlineImageInsertHandler(selectedPage.id, "closingContent")}
                  draftStorageKey={`${selectedPage.id}:closingContent`}
                  sourceUpdatedAt={selectedPage.updatedAt}
                  placeholder="Type '/' for commands"
                  appearance="notion"
                  autosize
                />
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
                    onImageInsert={createJournalInlineImageInsertHandler(selectedPage.id, "mppPlanContent")}
                    draftStorageKey={`${selectedPage.id}:mppPlanContent`}
                    sourceUpdatedAt={selectedPage.updatedAt}
                    placeholder="Type '/' for commands"
                    appearance="notion"
                    autosize
                  />
                </section>

                <section className="journal-writing-section journal-weekly-earnings-section">
                  <div className="journal-writing-header">
                    <div className="journal-writing-header-title">
                      <WorkspaceIcon icon="money" alt="Weekly earnings icon" className="mini-action-icon" />
                      <div className="journal-weekly-title-copy">
                        <strong>Weekly Earnings</strong>
                        <span>{selectedWeekRangeLabel}</span>
                      </div>
                    </div>
                    <div className="journal-writing-header-actions">
                      <input
                        ref={weeklyEarningsInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/jpg,image/webp,image/gif"
                        className="drop-zone-input"
                        onChange={(event) => {
                          const file = event.target.files?.item(0);
                          if (file && selectedPage) {
                            handleWeeklyEarningsImageFile(selectedPage, file);
                          }

                          event.currentTarget.value = "";
                        }}
                      />
                      <button
                        type="button"
                        className="mini-action"
                        onClick={() => weeklyEarningsInputRef.current?.click()}
                      >
                        <WorkspaceIcon icon="chart-screenshots" alt="Upload weekly earnings icon" className="mini-action-icon" />
                        {weeklyEarningsHasContent ? "Replace Image" : "Add Screenshot"}
                      </button>
                    </div>
                  </div>
                  {weeklyEarningsHasContent ? (
                    <JournalRichTextEditor
                      key={`${selectedPage.id}-weekly-earnings`}
                      content={selectedPage.weeklyEarningsContent}
                      onChange={(content) => onUpdateContent(selectedPage.id, "weeklyEarningsContent", content)}
                      onImageInsert={createJournalInlineImageInsertHandler(selectedPage.id, "weeklyEarningsContent")}
                      onImageOpen={setExpandedScreenshotUrl}
                      draftStorageKey={`${selectedPage.id}:weeklyEarningsContent`}
                      sourceUpdatedAt={selectedPage.updatedAt}
                      placeholder="Drop or paste the weekly earnings image here"
                      appearance="notion"
                      autosize
                      heightPreset="short"
                    />
                  ) : (
                    <div
                      className={`journal-weekly-drop-zone${isWeeklyEarningsDragActive ? " is-dragging" : ""}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => weeklyEarningsInputRef.current?.click()}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          weeklyEarningsInputRef.current?.click();
                        }
                      }}
                      onDragEnter={(event) => {
                        event.preventDefault();
                        setIsWeeklyEarningsDragActive(true);
                      }}
                      onDragOver={(event) => {
                        event.preventDefault();
                        setIsWeeklyEarningsDragActive(true);
                      }}
                      onDragLeave={() => setIsWeeklyEarningsDragActive(false)}
                      onDrop={(event) => handleWeeklyEarningsDrop(selectedPage, event)}
                    >
                      <WorkspaceIcon icon="chart-screenshots" alt="Weekly earnings upload icon" className="journal-weekly-drop-zone-icon" />
                      <strong>Weekly Earnings</strong>
                      <span>{selectedWeekRangeLabel}</span>
                      <em>Add Screenshot</em>
                    </div>
                  )}
                </section>
              </section>

                <section className="journal-writing-section">
                  <div className="journal-writing-header">
                    <div className="journal-writing-header-title">
                      <WorkspaceIcon icon="chart-gallery" alt="Chart screenshots icon" className="mini-action-icon" />
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

                        handleScreenshotFileSelection(selectedPage, files);
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
                      <WorkspaceIcon icon="chart-screenshots" alt="Upload screenshot icon" className="mini-action-icon" />
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
                      onClick={() => {
                        const nextPages = buildNextPagesWithUpdatedScreenshots(selectedPage.id, [], []);
                        selectedPage.screenshotUrls.forEach((path) => discardScreenshotAttachment(path, nextPages));
                        journalScreenshotTags.forEach((tag) => clearScreenshotIfLinked(tag));
                        onUpdatePage(selectedPage.id, { screenshotUrls: [], screenshotTags: [] });
                      }}
                    >
                      <WorkspaceIcon icon="clear-screenshots" alt="Clear screenshots icon" className="mini-action-icon" />
                      Clear All
                    </button>
                    </div>
                  </div>
                  <div className="journal-screenshot-gallery">
                    {Array.from({ length: visibleScreenshotSlots }).map((_, index) => {
                      const screenshotUrl = selectedPage.screenshotUrls[index];
                      const screenshotSrc = resolveWorkspaceAttachmentSrc(screenshotUrl ?? "");
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
                              src={screenshotSrc}
                              alt={`${formatJournalDate(selectedPage.tradeDate)} screenshot ${index + 1}`}
                            />
                          </button>
                          {(() => {
                            const screenshotTag =
                              journalScreenshotTags[index] ??
                              createDefaultScreenshotTag(selectedPage.tradeDate);
                            const screenshotTradeLinks = getScreenshotTradeLinks(screenshotTag);
                            const selectedTradeValues = screenshotTradeLinks
                              .map((link) => serializeTradeLink(link.tradeId, link.tradeDate))
                              .filter((value) => screenshotTradeOptionValueSet.has(value));
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
                                            const primaryPlaybook = getPrimaryTradePlaybook(trade);
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
                                                  <span className="journal-screenshot-trade-option-title">
                                                    <strong>{trade.symbol}</strong>
                                                    <span className="journal-screenshot-trade-option-name">{trade.name}</span>
                                                    <span className="journal-screenshot-trade-option-time">
                                                      {trade.openTime} to {trade.closeTime}
                                                    </span>
                                                  </span>
                                                  <span className="journal-screenshot-trade-option-tags">
                                                    <span className="journal-screenshot-trade-option-chip">{trade.side}</span>
                                                    {primaryPlaybook ? (
                                                      <span
                                                        className={`journal-screenshot-trade-option-chip journal-screenshot-trade-option-playbook tag-option-pill-${getTagToneIndex(
                                                          primaryPlaybook
                                                        )}`}
                                                        title={primaryPlaybook}
                                                      >
                                                        {primaryPlaybook}
                                                      </span>
                                                    ) : (
                                                      <span className="journal-screenshot-trade-option-empty">No playbook</span>
                                                    )}
                                                  </span>
                                                </span>
                                                <span className="journal-screenshot-trade-option-prices">
                                                  <span>
                                                    <em>Entry</em>
                                                    <strong>{formatTradePrice(trade.entryPrice)}</strong>
                                                  </span>
                                                  <span>
                                                    <em>Exit</em>
                                                    <strong>{formatTradePrice(trade.exitPrice)}</strong>
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
                              href={screenshotSrc}
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
                                const nextPages = buildNextPagesWithUpdatedScreenshots(
                                  selectedPage.id,
                                  nextScreenshotUrls,
                                  nextScreenshotTags
                                );
                                clearScreenshotIfLinked(journalScreenshotTags[index]);
                                updateSelectedPageScreenshots(nextScreenshotUrls, nextScreenshotTags);
                                discardScreenshotAttachment(screenshotUrl, nextPages);
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

              <JournalTradeNotesPanel
                page={selectedPage}
                linkedTrades={linkedTrades}
                tagOptionsByField={tagOptionsByField}
                onUpdatePage={onUpdatePage}
                onSelectTrade={onSelectTrade}
                onCreateTradeTagOption={onCreateTradeTagOption}
                onRenameTradeTagOption={onRenameTradeTagOption}
                onDeleteTradeTagOption={onDeleteTradeTagOption}
              />

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
                const primaryPlaybook = trade.setups.find((setup) => setup.trim().length > 0) ?? "";
                const isSelected = selectedJournalTradeId === trade.id;

                return (
                  <button
                    key={trade.id}
                    type="button"
                    className={`linked-trade-card linked-trade-card-button${isSelected ? " linked-trade-card-active" : ""}`}
                    onClick={() => onSelectTrade(trade.id, trade.tradeDate)}
                  >
                    <div className="linked-trade-card-top">
                      <div className="linked-trade-title">
                        <strong>{trade.name}</strong>
                      </div>
                      <strong className={trade.netPnlUsd >= 0 ? "positive-value" : "negative-value"}>
                        {formatSignedMoney(trade.netPnlUsd)}
                      </strong>
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
                      <span>{trade.symbol}</span>
                    </div>
                    <div className="linked-trade-chip-row">
                      <span className="linked-trade-chip linked-trade-chip-side">{trade.side}</span>
                      <span
                        className={`linked-trade-chip linked-trade-chip-status ${
                          trade.status === "Win" ? "linked-trade-chip-status-win" : "linked-trade-chip-status-loss"
                        }`}
                      >
                        {trade.status}
                      </span>
                      {primaryPlaybook ? (
                        <span className={`linked-trade-chip tag-option-pill tag-option-pill-${getTagToneIndex(primaryPlaybook)}`}>
                          {primaryPlaybook}
                        </span>
                      ) : null}
                    </div>
                    <div className="linked-trade-stat-grid">
                      <span className="linked-trade-stat">
                        <strong>Time</strong>
                        <span className="linked-trade-stat-value-wrap">
                          <span>{trade.openTime}</span>
                          <span className="linked-trade-stat-value-soft">{trade.closeTime}</span>
                        </span>
                      </span>
                      <span className="linked-trade-stat">
                        <strong>Hold</strong>
                        <span>{trade.holdTime || "-"}</span>
                      </span>
                      <span className="linked-trade-stat">
                        <strong>Size</strong>
                        <span>{trade.size.toLocaleString()}</span>
                      </span>
                    </div>
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
                src={resolveWorkspaceAttachmentSrc(expandedScreenshotUrl)}
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

