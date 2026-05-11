import { invoke, isTauri } from "@tauri-apps/api/core";
import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { AppLayout } from "../components/AppLayout";
import type { User } from "../lib/auth";
import { hasJournalDocContent } from "../lib/journal/journalContent";
import {
  defaultJournalChecklistTemplates,
  loadJournalChecklistTemplates,
  recoverJournalChecklistTemplatesFromDesktopBackup,
  saveJournalChecklistTemplates,
  type JournalChecklistTemplates
} from "../lib/journal/journalTemplateStore";
import { buildCsvContent, toExportRows } from "../features/export/lib/csvExporter";
import { dedupeJournalPages, loadJournalPages, saveJournalPages } from "../lib/journal/journalStore";
import {
  findNotionDuplicates,
  importTradesToNotion
} from "../features/notion/lib/notionClient";
import { loadTradeReviews, saveTradeReviews } from "../lib/reviews/tradeReviewStore";
import {
  buildBarSetKey,
  loadHistoricalBarSets,
  recoverHistoricalBarSetsFromDesktopBackup,
  removeHistoricalBarSet,
  saveHistoricalBarSets,
  upsertHistoricalBarSet
} from "../lib/charts/historicalBarStore";
import {
  fetchDailyHistoricalBarsFromTwelveData,
  fetchHistoricalBarsFromTwelveData
} from "../lib/charts/twelveDataClient";
import { parseHistoricalBarsCsv } from "../lib/parser/historicalBarsParser";
import { loadTradeSessions, mergeTradesIntoSessions, saveTradeSessions } from "../lib/sessions/tradeSessionStore";
import { processTradeFile } from "../features/import/lib/tradePipeline";
import {
  buildTradeTagOptionsByField,
  tradeTagFields
} from "../lib/trades/tradeTagCatalog";
import { loadTradeTagOptions, saveTradeTagOptions } from "../lib/trades/tradeTagOptionStore";
import { loadTradeTagOverrides, saveTradeTagOverrides } from "../lib/trades/tradeTagOverrideStore";
import {
  applyTradeTagOverrides,
  hasTradeTagOverridesForTradeDates,
  removeTradeTagOverridesForTradeDates
} from "../lib/trades/tradeTagOverrides";
import { createTradeTagActions } from "../lib/trades/tradeTagActions";
import {
  loadWorkspaceState,
  recoverWorkspaceStateFromDesktopBackup,
  saveWorkspaceState
} from "../lib/workspace/workspaceStore";
import { recoverHeadlinesFromDesktopBackup } from "../lib/headlines/headlineStore";
import { defaultSettings, loadSettings, saveSettings } from "../lib/settings/settingsStore";
import { useDebouncedSave } from "../lib/hooks/useDebouncedSave";
import { recoverReviewTemplatesFromDesktopBackup } from "../lib/review/reviewTemplateStore";
import { recoverSelectOptionAdditionsFromDesktopBackup } from "../lib/select/selectOptionAdditionsStore";
import { resetAllSyncStoreMemory } from "../lib/sync/syncStore";
import { requestFlushDebouncedSaves } from "../lib/sync/pendingSaveFlush";
import { setUserIdForSync } from "../lib/sync/userDataSync";
import {
  createJournalPageActions,
  createMissingJournalPages,
  normalizeJournalTradeDate
} from "../features/journal/lib/journalPageActions";
import {
  buildJournalTradeContextById,
  syncJournalPagesFromTradeReviews,
  syncTradeReviewsFromJournalPages
} from "../features/journal/lib/journalScreenshotSync";
import { createSettingsPageActions } from "../features/settings/lib/settingsPageActions";
import {
  loadPlaybooks,
  recoverPlaybooksFromDesktopBackup,
  savePlaybooks
} from "../lib/playbooks/playbookStore";
import {
  loadLibraryPages,
  recoverLibraryPagesFromDesktopBackup,
  saveLibraryPages
} from "../lib/library/libraryStore";
import type { AppNavItem, AppRoute } from "../types/app";
import type { ChartInterval, HistoricalBarSet } from "../types/chart";
import type { JournalPageRecord } from "../types/journal";
import type { JSONContent } from "@tiptap/core";
import type { TradeReviewRecord } from "../types/review";
import type { TradeSessionRecord } from "../types/session";
import type { GroupedTrade, Settings } from "../types/trade";
import type {
  EditableTradeRow,
  EditableTradeTagField,
  TradeTagOptionsRecord,
  TradeTagOverrideRecord
} from "../types/tradeTags";

const navItems: AppNavItem[] = [
  { id: "dashboard", label: "Dashboard", icon: "dashboard" },
  { id: "trades", label: "Trades", icon: "trades" },
  { id: "journal", label: "Journal", icon: "journal" },
  { id: "library", label: "Library", icon: "library" },
  { id: "reports", label: "Reports", icon: "reports" },
  { id: "import", label: "Imports", icon: "import" },
  { id: "data", label: "Data", icon: "data" },
  { id: "settings", label: "Settings", icon: "filter" }
];

const DashboardPage = lazy(() =>
  import("../features/dashboard/pages/DashboardPage").then((module) => ({ default: module.DashboardPage }))
);
const TradesPage = lazy(() =>
  import("../features/grouping/pages/TradesPage").then((module) => ({ default: module.TradesPage }))
);
const JournalPage = lazy(() =>
  import("../features/journal/pages/JournalPage").then((module) => ({ default: module.JournalPage }))
);
const LibraryPage = lazy(() =>
  import("../features/library/pages/LibraryPage").then((module) => ({ default: module.LibraryPage }))
);
const ReportsPage = lazy(() =>
  import("../features/reports/pages/ReportsPage").then((module) => ({ default: module.ReportsPage }))
);
const ImportPage = lazy(() =>
  import("../features/import/pages/ImportPage").then((module) => ({ default: module.ImportPage }))
);
const DataPage = lazy(() =>
  import("../features/data/pages/DataPage").then((module) => ({ default: module.DataPage }))
);
const SettingsPage = lazy(() =>
  import("../features/settings/pages/SettingsPage").then((module) => ({ default: module.SettingsPage }))
);

const createExportFileName = (): string => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `notion_ready_${year}-${month}-${day}.csv`;
};

const LOCAL_WORKSPACE_USER: User = {
  id: "local-workspace",
  email: "",
  username: "Local Workspace",
  isAdmin: false,
};

const toErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return fallback;
};

const getLocalTradeDateKey = (date = new Date()): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const parseTimestamp = (value: string): number => {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const cloneValue = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const JOURNAL_EDITOR_DRAFT_STORAGE_PREFIX = "trade-engine-journal-editor-draft::";
type RecoverableJournalDraftField =
  | "morningChecklistContent"
  | "closingChecklistContent"
  | "morningContent"
  | "closingContent"
  | "mppPlanContent"
  | "inPlayStocksContent"
  | "traderReachOutsContent"
  | "notesContent";

interface StoredJournalEditorDraft {
  content: JSONContent;
  updatedAt: string;
}

type StoredJournalDraftFieldMap = Partial<Record<RecoverableJournalDraftField, StoredJournalEditorDraft>>;

interface StoredJournalDraftIndex {
  byPageId: Map<string, StoredJournalDraftFieldMap>;
  latestByTradeDate: Map<string, StoredJournalDraftFieldMap>;
}

const recoverableJournalDraftFields: RecoverableJournalDraftField[] = [
  "morningChecklistContent",
  "closingChecklistContent",
  "morningContent",
  "closingContent",
  "mppPlanContent",
  "inPlayStocksContent",
  "traderReachOutsContent",
  "notesContent"
];

const recoverableJournalDraftFieldSet = new Set<RecoverableJournalDraftField>(recoverableJournalDraftFields);

const parseStoredJournalEditorDraft = (raw: string | null): StoredJournalEditorDraft | null => {
  try {
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<StoredJournalEditorDraft>;
    if (!parsed || typeof parsed !== "object" || typeof parsed.updatedAt !== "string") {
      return null;
    }

    if (!parsed.content || typeof parsed.content !== "object") {
      return null;
    }

    return {
      content: parsed.content as JSONContent,
      updatedAt: parsed.updatedAt
    };
  } catch {
    return null;
  }
};

const getTradeDateFromJournalDraftPageId = (pageId: string): string => {
  const match = pageId.match(/^journal-(\d{4}-\d{2}-\d{2})-/);
  return match?.[1] ?? "";
};

const selectPreferredStoredJournalDraft = (
  primaryDraft: StoredJournalEditorDraft | null,
  fallbackDraft: StoredJournalEditorDraft | null
): StoredJournalEditorDraft | null => {
  if (!primaryDraft) {
    return fallbackDraft;
  }

  if (!fallbackDraft) {
    return primaryDraft;
  }

  const primaryTimestamp = parseTimestamp(primaryDraft.updatedAt);
  const fallbackTimestamp = parseTimestamp(fallbackDraft.updatedAt);
  if (fallbackTimestamp !== primaryTimestamp) {
    return fallbackTimestamp > primaryTimestamp ? fallbackDraft : primaryDraft;
  }

  const primaryHasContent = hasJournalDocContent(primaryDraft.content);
  const fallbackHasContent = hasJournalDocContent(fallbackDraft.content);
  if (fallbackHasContent !== primaryHasContent) {
    return fallbackHasContent ? fallbackDraft : primaryDraft;
  }

  return primaryDraft;
};

const setStoredJournalDraftIndexEntry = (
  indexMap: Map<string, StoredJournalDraftFieldMap>,
  key: string,
  field: RecoverableJournalDraftField,
  draft: StoredJournalEditorDraft
) => {
  if (!key) {
    return;
  }

  const fieldMap = indexMap.get(key) ?? {};
  const preferredDraft = selectPreferredStoredJournalDraft(fieldMap[field] ?? null, draft);
  if (!preferredDraft) {
    return;
  }

  fieldMap[field] = preferredDraft;
  indexMap.set(key, fieldMap);
};

const buildStoredJournalDraftIndex = (): StoredJournalDraftIndex => {
  const draftIndex: StoredJournalDraftIndex = {
    byPageId: new Map(),
    latestByTradeDate: new Map()
  };

  if (typeof window === "undefined") {
    return draftIndex;
  }

  try {
    for (let storageIndex = 0; storageIndex < window.localStorage.length; storageIndex += 1) {
      const storageKey = window.localStorage.key(storageIndex);
      if (!storageKey || !storageKey.startsWith(JOURNAL_EDITOR_DRAFT_STORAGE_PREFIX)) {
        continue;
      }

      const keyBody = storageKey.slice(JOURNAL_EDITOR_DRAFT_STORAGE_PREFIX.length);
      const separatorIndex = keyBody.lastIndexOf(":");
      if (separatorIndex <= 0) {
        continue;
      }

      const pageId = keyBody.slice(0, separatorIndex);
      const fieldName = keyBody.slice(separatorIndex + 1);
      if (!recoverableJournalDraftFieldSet.has(fieldName as RecoverableJournalDraftField)) {
        continue;
      }

      const draft = parseStoredJournalEditorDraft(window.localStorage.getItem(storageKey));
      if (!draft) {
        continue;
      }

      const field = fieldName as RecoverableJournalDraftField;
      const tradeDate = getTradeDateFromJournalDraftPageId(pageId);
      setStoredJournalDraftIndexEntry(draftIndex.byPageId, pageId, field, draft);
      setStoredJournalDraftIndexEntry(draftIndex.latestByTradeDate, tradeDate, field, draft);
    }
  } catch {
    return draftIndex;
  }

  return draftIndex;
};

const getStoredJournalDraftFromIndex = (
  index: StoredJournalDraftIndex,
  pageId: string,
  tradeDate: string,
  field: RecoverableJournalDraftField
): StoredJournalEditorDraft | null =>
  selectPreferredStoredJournalDraft(
    index.byPageId.get(pageId)?.[field] ?? null,
    index.latestByTradeDate.get(tradeDate)?.[field] ?? null
  );

const recoverJournalPagesFromStoredDrafts = (pages: JournalPageRecord[]): JournalPageRecord[] => {
  const storedDraftIndex = buildStoredJournalDraftIndex();
  if (storedDraftIndex.byPageId.size === 0 && storedDraftIndex.latestByTradeDate.size === 0) {
    return pages;
  }

  let changed = false;

  const recoveredPages = pages.map((page) => {
    let nextPage = page;
    let nextUpdatedAt = page.updatedAt;

    for (const field of recoverableJournalDraftFields) {
      const storedDraft = getStoredJournalDraftFromIndex(storedDraftIndex, page.id, page.tradeDate, field);
      if (!storedDraft) {
        continue;
      }

      const draftTimestamp = parseTimestamp(storedDraft.updatedAt);
      const pageTimestamp = parseTimestamp(nextUpdatedAt);
      const currentContent = nextPage[field];
      const draftContent = storedDraft.content;
      const currentSerialized = JSON.stringify(currentContent);
      const draftSerialized = JSON.stringify(draftContent);

      if (currentSerialized === draftSerialized) {
        continue;
      }

      const shouldPromoteDraft =
        draftTimestamp > pageTimestamp + 1000 ||
        (!hasJournalDocContent(currentContent) && hasJournalDocContent(draftContent));

      if (!shouldPromoteDraft) {
        continue;
      }

      nextPage = {
        ...nextPage,
        [field]: cloneValue(draftContent),
        updatedAt: storedDraft.updatedAt
      };
      nextUpdatedAt = storedDraft.updatedAt;
      changed = true;
    }

    return nextPage;
  });

  return changed ? dedupeJournalPages(recoveredPages) : pages;
};

const downloadCsvInBrowser = (fileName: string, contents: string): void => {
  const blob = new Blob([contents], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

function App() {
  const hasRestoredWorkspaceRef = useRef(false);
  const hasRetriedJournalDesktopRecoveryRef = useRef(false);
  const hasRetriedSessionsDesktopRecoveryRef = useRef(false);
  const hasRetriedTradeTagsDesktopRecoveryRef = useRef(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [workspaceLoaded, setWorkspaceLoaded] = useState(false);
  const [journalPagesLoaded, setJournalPagesLoaded] = useState(false);
  const [journalChecklistTemplatesLoaded, setJournalChecklistTemplatesLoaded] = useState(false);
  const [tradeReviewsLoaded, setTradeReviewsLoaded] = useState(false);
  const [historicalBarSetsLoaded, setHistoricalBarSetsLoaded] = useState(false);
  const [workspaceRefreshKey, setWorkspaceRefreshKey] = useState(0);
  const [activeRoute, setActiveRoute] = useState<AppRoute>("dashboard");
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [allowedSymbols, setAllowedSymbols] = useState<string[]>([]);
  const [hasExecutionProperty, setHasExecutionProperty] = useState(false);
  const [fileName, setFileName] = useState("");
  const [trades, setTrades] = useState<GroupedTrade[]>([]);
  const [tradeSessions, setTradeSessions] = useState<TradeSessionRecord[]>([]);
  const [tradeSessionsLoaded, setTradeSessionsLoaded] = useState(false);
  const [tradeTagOverrides, setTradeTagOverrides] = useState<TradeTagOverrideRecord[]>([]);
  const [tradeTagOverridesLoaded, setTradeTagOverridesLoaded] = useState(false);
  const [tradeTagOptions, setTradeTagOptions] = useState<TradeTagOptionsRecord>({});
  const [tradeTagOptionsLoaded, setTradeTagOptionsLoaded] = useState(false);
  const [dashboardTradeDateFilterStart, setDashboardTradeDateFilterStart] = useState("");
  const [dashboardTradeDateFilterEnd, setDashboardTradeDateFilterEnd] = useState("");
  const [dashboardPlaybookFilter, setDashboardPlaybookFilter] = useState("all");
  const [dashboardSymbolFilter, setDashboardSymbolFilter] = useState("all");
  const [dashboardStatusFilter, setDashboardStatusFilter] = useState("all");
  const [dashboardGameFilter, setDashboardGameFilter] = useState("all");
  const [dashboardExecutionFilter, setDashboardExecutionFilter] = useState("all");
  const [dashboardSelectedTradeId, setDashboardSelectedTradeId] = useState("");
  const [dashboardSelectedTradeRequestId, setDashboardSelectedTradeRequestId] = useState(0);
  const [reviewChartInterval, setReviewChartInterval] = useState<ChartInterval>("1m");
  const [dayChartInterval, setDayChartInterval] = useState<ChartInterval>("1D");
  const [historicalBarSets, setHistoricalBarSets] = useState<HistoricalBarSet[]>([]);
  const [journalPages, setJournalPages] = useState<JournalPageRecord[]>([]);
  const [journalChecklistTemplates, setJournalChecklistTemplates] = useState<JournalChecklistTemplates>(
    defaultJournalChecklistTemplates()
  );
  const [tradeReviews, setTradeReviews] = useState<TradeReviewRecord[]>([]);
  const [selectedJournalPageId, setSelectedJournalPageId] = useState("");
  const [isCurrentImportSaved, setIsCurrentImportSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Load one PPro8 Trade Detail CSV file, then export the cleaned CSV.");
  const [, setBootError] = useState<string | null>(null);
  const journalPagesRef = useRef<JournalPageRecord[]>([]);
  journalPagesRef.current = journalPages;

  const persistJournalPages = (nextPages: JournalPageRecord[]) => {
    journalPagesRef.current = nextPages;
    setJournalPages(nextPages);
  };

  const hydrateWorkspaceFromStores = async () => {
    const localWorkspaceState = loadWorkspaceState();
    const localHistoricalBarSets = loadHistoricalBarSets();
    const localJournalChecklistTemplates = loadJournalChecklistTemplates();
    const localPlaybooks = loadPlaybooks();
    const localLibraryPages = loadLibraryPages();
    const [
      loadedSettings,
      loadedOptions,
      loadedOverrides,
      loadedSessions,
      loadedJournalPages,
      loadedTradeReviews,
      recoveredWorkspaceState,
      recoveredHistoricalBarSets,
      recoveredJournalChecklistTemplates,
      recoveredPlaybooks,
      recoveredLibraryPages
    ] = await Promise.all([
      loadSettings(),
      loadTradeTagOptions(),
      loadTradeTagOverrides(),
      loadTradeSessions(),
      loadJournalPages(),
      loadTradeReviews(),
      recoverWorkspaceStateFromDesktopBackup(localWorkspaceState),
      recoverHistoricalBarSetsFromDesktopBackup(localHistoricalBarSets),
      recoverJournalChecklistTemplatesFromDesktopBackup(localJournalChecklistTemplates),
      recoverPlaybooksFromDesktopBackup(localPlaybooks),
      recoverLibraryPagesFromDesktopBackup(localLibraryPages),
      recoverReviewTemplatesFromDesktopBackup(),
      recoverHeadlinesFromDesktopBackup(),
      recoverSelectOptionAdditionsFromDesktopBackup()
    ]);

    const sharedStoreRecoveryTasks: Promise<unknown>[] = [];

    if (recoveredPlaybooks) {
      sharedStoreRecoveryTasks.push(savePlaybooks(recoveredPlaybooks));
    }

    if (recoveredLibraryPages) {
      sharedStoreRecoveryTasks.push(saveLibraryPages(recoveredLibraryPages));
    }

    if (sharedStoreRecoveryTasks.length > 0) {
      await Promise.all(sharedStoreRecoveryTasks);
    }

    setSettings(loadedSettings);
    setSettingsLoaded(true);

    setTradeTagOptions(loadedOptions);
    setTradeTagOptionsLoaded(true);

    setTradeTagOverrides(loadedOverrides);
    setTradeTagOverridesLoaded(true);

    setTradeSessions(loadedSessions);
    setTradeSessionsLoaded(true);

    const workspaceState = recoveredWorkspaceState ?? localWorkspaceState;
    setActiveRoute(workspaceState.activeRoute);
    setReviewChartInterval(workspaceState.reviewChartInterval);
    setDayChartInterval(workspaceState.dayChartInterval);
    setFileName(workspaceState.fileName);
    setIsCurrentImportSaved(workspaceState.isCurrentImportSaved);
    setWorkspaceLoaded(true);

    setHistoricalBarSets(recoveredHistoricalBarSets ?? localHistoricalBarSets);
    setHistoricalBarSetsLoaded(true);

    setJournalPages(recoverJournalPagesFromStoredDrafts(loadedJournalPages));
    setJournalPagesLoaded(true);

    setJournalChecklistTemplates(recoveredJournalChecklistTemplates ?? localJournalChecklistTemplates);
    setJournalChecklistTemplatesLoaded(true);

    setTradeReviews(loadedTradeReviews);
    setTradeReviewsLoaded(true);
  };

  const journalPagesForSave = useMemo(() => dedupeJournalPages(journalPages), [journalPages]);
  const loadedTradeDates = useMemo(
    () => Array.from(new Set(trades.map((trade) => trade.tradeDate))).sort(),
    [trades]
  );
  const workspaceStateForSave = useMemo(
    () => ({
      activeRoute,
      loadedTradeDates,
      fileName,
      isCurrentImportSaved,
      reviewChartInterval,
      dayChartInterval
    }),
    [activeRoute, dayChartInterval, fileName, isCurrentImportSaved, loadedTradeDates, reviewChartInterval]
  );

  useEffect(() => {
    let cancelled = false;

    const boot = async () => {
      setSyncing(true);
      try {
        setBootError(null);
        setUserIdForSync(undefined);
        resetAllSyncStoreMemory();
        await hydrateWorkspaceFromStores();
        if (cancelled) {
          return;
        }

        setUser(LOCAL_WORKSPACE_USER);
        setBootError(null);
      } catch (error) {
        if (cancelled) {
          return;
        }

        const errorMessage = toErrorMessage(error, "Workspace failed to load. Restart the app and try again.");
        console.error("[app] Failed to bootstrap workspace.", error);
        setBootError(errorMessage);
        setMessage(errorMessage);
        setUserIdForSync(undefined);
        resetAllSyncStoreMemory();
        setUser(LOCAL_WORKSPACE_USER);
      } finally {
        if (!cancelled) {
          setAuthChecked(true);
          setSyncing(false);
        }
      }
    };

    void boot();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!tradeSessionsLoaded) {
      return;
    }

    if (tradeSessions.length > 0 || hasRetriedSessionsDesktopRecoveryRef.current) {
      return;
    }

    hasRetriedSessionsDesktopRecoveryRef.current = true;
    void (async () => {
      const desktopSessions = await loadTradeSessions();
      if (desktopSessions.length === 0) {
        return;
      }

      setTradeSessions(desktopSessions);
      setMessage(`Recovered ${desktopSessions.length} saved trade days from the desktop backup.`);
    })();
  }, [tradeSessions, tradeSessionsLoaded]);

  useEffect(() => {
    if (!tradeTagOverridesLoaded) {
      return;
    }

    if (tradeTagOverrides.length > 0 || hasRetriedTradeTagsDesktopRecoveryRef.current) {
      return;
    }

    hasRetriedTradeTagsDesktopRecoveryRef.current = true;
    void (async () => {
      const desktopOverrides = await loadTradeTagOverrides();
      if (desktopOverrides.length === 0) {
        return;
      }

      setTradeTagOverrides(desktopOverrides);
      setMessage(`Recovered ${desktopOverrides.length} trade tag overrides from the desktop backup.`);
    })();
  }, [tradeTagOverrides, tradeTagOverridesLoaded]);

  useEffect(() => {
    if (hasRestoredWorkspaceRef.current) {
      return;
    }

    if (!tradeSessionsLoaded) {
      return;
    }

    hasRestoredWorkspaceRef.current = true;
    setActiveRoute("dashboard");
    setMessage(
      tradeSessions.length > 0
        ? `Loaded ${tradeSessions.length} saved sessions from the local database. Pick a day from Dashboard or Data to load it into the workspace.`
        : "Load one PPro8 Trade Detail CSV file, then export the cleaned CSV."
    );
  }, [tradeSessions, tradeSessionsLoaded]);

  useEffect(() => {
    if (!journalPagesLoaded) {
      return;
    }

    if (journalPages.length === 0 && !hasRetriedJournalDesktopRecoveryRef.current) {
      hasRetriedJournalDesktopRecoveryRef.current = true;
      void (async () => {
        const desktopPages = await loadJournalPages();
        if (desktopPages.length === 0) {
          return;
        }

        setJournalPages(desktopPages);
        setSelectedJournalPageId(desktopPages[0]?.id ?? "");
        setMessage(`Recovered ${desktopPages.length} journal pages from the desktop backup.`);
      })();
      return;
    }

    if (journalPagesForSave.length !== journalPages.length) {
      setJournalPages(journalPagesForSave);
    }
  }, [journalPages, journalPagesForSave, journalPagesLoaded]);

  useEffect(() => {
    if (!journalPagesLoaded || !tradeReviewsLoaded) {
      return;
    }

    setTradeReviews((current) => syncTradeReviewsFromJournalPages(current, journalPages));
  }, [journalPages, journalPagesLoaded, tradeReviewsLoaded]);

  useEffect(() => {
    if (!journalPagesLoaded || !tradeReviewsLoaded || !tradeSessionsLoaded || !tradeTagOverridesLoaded) {
      return;
    }

    const tradeContextById = buildJournalTradeContextById(
      applyTradeTagOverrides(
        tradeSessions.flatMap((session) => session.trades),
        tradeTagOverrides
      )
    );

    setJournalPages((current) => syncJournalPagesFromTradeReviews(current, tradeReviews, tradeContextById));
  }, [
    journalPagesLoaded,
    tradeReviews,
    tradeReviewsLoaded,
    tradeSessions,
    tradeSessionsLoaded,
    tradeTagOverrides,
    tradeTagOverridesLoaded
  ]);

  useDebouncedSave(
    settings,
    400,
    (nextSettings) => {
      void saveSettings(nextSettings);
    },
    settingsLoaded,
    { skipInitialSave: true }
  );

  useDebouncedSave(
    journalPagesForSave,
    900,
    (nextJournalPages) => {
      void saveJournalPages(nextJournalPages);
    },
    journalPagesLoaded,
    { skipInitialSave: true }
  );

  useDebouncedSave(
    journalChecklistTemplates,
    600,
    (nextTemplates) => {
      saveJournalChecklistTemplates(nextTemplates);
    },
    journalChecklistTemplatesLoaded,
    { skipInitialSave: true }
  );

  useDebouncedSave(
    tradeReviews,
    700,
    (nextReviews) => {
      saveTradeReviews(nextReviews);
    },
    tradeReviewsLoaded,
    { skipInitialSave: true }
  );

  useDebouncedSave(
    tradeTagOptions,
    500,
    (nextOptions) => {
      void saveTradeTagOptions(nextOptions);
    },
    tradeTagOptionsLoaded,
    { skipInitialSave: true }
  );

  useDebouncedSave(
    tradeSessions,
    800,
    (nextTradeSessions) => {
      void saveTradeSessions(nextTradeSessions);
    },
    tradeSessionsLoaded,
    { skipInitialSave: true }
  );

  useDebouncedSave(
    tradeTagOverrides,
    700,
    (nextOverrides) => {
      void saveTradeTagOverrides(nextOverrides);
    },
    tradeTagOverridesLoaded,
    { skipInitialSave: true }
  );

  useDebouncedSave(
    historicalBarSets,
    900,
    (nextBarSets) => {
      saveHistoricalBarSets(nextBarSets);
    },
    historicalBarSetsLoaded,
    { skipInitialSave: true }
  );

  useDebouncedSave(
    workspaceStateForSave,
    250,
    (nextWorkspaceState) => {
      saveWorkspaceState(nextWorkspaceState);
    },
    workspaceLoaded,
    { skipInitialSave: true }
  );

  useEffect(() => {
    if (journalPages.length === 0) {
      setSelectedJournalPageId("");
      return;
    }

    const pageStillExists = journalPages.some((page) => page.id === selectedJournalPageId);
    if (!pageStillExists) {
      const todayTradeDate = getLocalTradeDateKey();
      const preferredPage = journalPages.find((page) => page.tradeDate === todayTradeDate) ?? journalPages[0];
      setSelectedJournalPageId(preferredPage.id);
    }
  }, [journalPages, selectedJournalPageId]);

  useEffect(() => {
    if (!tradeSessionsLoaded || !journalPagesLoaded || !journalChecklistTemplatesLoaded) {
      return;
    }

    const tradeDates = Array.from(
      new Set(
        tradeSessions
          .map((session) => normalizeJournalTradeDate(session.tradeDate))
          .filter((tradeDate) => tradeDate.length > 0)
      )
    );

    if (tradeDates.length === 0) {
      return;
    }

    setJournalPages((current) => {
      const missingPages = createMissingJournalPages({
        currentPages: current,
        tradeDates,
        checklistTemplates: journalChecklistTemplates,
        startTimestamp: Date.now()
      });

      if (missingPages.length === 0) {
        return current;
      }

      return [...current, ...missingPages].sort((left, right) => right.tradeDate.localeCompare(left.tradeDate));
    });
  }, [tradeSessions, tradeSessionsLoaded, journalPagesLoaded, journalChecklistTemplates, journalChecklistTemplatesLoaded]);

  const resetWorkspaceAfterImport = () => {
    hasRestoredWorkspaceRef.current = false;
    hasRetriedJournalDesktopRecoveryRef.current = false;
    hasRetriedSessionsDesktopRecoveryRef.current = false;
    hasRetriedTradeTagsDesktopRecoveryRef.current = false;
    setBootError(null);
    setTrades([]);
    setFileName("");
    setIsCurrentImportSaved(false);
    setSelectedJournalPageId("");
  };

  const refreshWorkspaceAfterImport = () => {
    setWorkspaceRefreshKey((current) => current + 1);
  };

  const {
    runConnectionTest,
    handleLoadWorkspaceAttachmentSummary,
    handleAuditWorkspaceAttachments,
    handlePruneWorkspaceAttachments,
    handleExportWorkspaceBundle,
    handleImportWorkspaceBundle
  } = createSettingsPageActions({
    settings,
    tradeTagOptions,
    tradeTagOverrides,
    tradeSessions,
    journalPagesForSave,
    journalChecklistTemplates,
    tradeReviews,
    historicalBarSets,
    workspaceStateForSave,
    setAllowedSymbols,
    setHasExecutionProperty,
    setMessage,
    setSyncing,
    hydrateWorkspaceFromStores,
    resetWorkspaceAfterImport,
    refreshWorkspaceAfterImport
  });

  const resolvedTrades = useMemo<EditableTradeRow[]>(
    () => applyTradeTagOverrides(trades, tradeTagOverrides),
    [tradeTagOverrides, trades]
  );

  const resolvedTradeSessions = useMemo<TradeSessionRecord[]>(
    () =>
      tradeSessions.map((session) => ({
        ...session,
        trades: applyTradeTagOverrides(session.trades, tradeTagOverrides)
      })),
    [tradeSessions, tradeTagOverrides]
  );

  const mergedTradeTagOptionsByField = useMemo(
    () => buildTradeTagOptionsByField(tradeTagOptions),
    [tradeTagOptions]
  );
  const activeTradeTagOptionsByField = useMemo(
    () =>
      tradeTagFields.reduce(
        (options, field) => ({
          ...options,
          [field]: settings.tradeTagVisibility[field] ? mergedTradeTagOptionsByField[field] : []
        }),
        {} as Record<EditableTradeTagField, string[]>
      ),
    [mergedTradeTagOptionsByField, settings.tradeTagVisibility]
  );
  const allStoredTrades = useMemo(
    () => resolvedTradeSessions.flatMap((session) => session.trades as EditableTradeRow[]),
    [resolvedTradeSessions]
  );
  const {
    updateTradeTag,
    createTradeTagOption,
    renameTradeTagOption,
    deleteTradeTagOption,
    bulkUpdateTradeTags
  } = createTradeTagActions({
    mergedTradeTagOptionsByField,
    tradeTagOptions,
    candidateTrades: [...resolvedTrades, ...allStoredTrades],
    setTradeTagOverrides,
    setTradeTagOptions,
    setMessage
  });

  const handleFileDrop = async (file: File) => {
    setBusy(true);
    try {
      if (!file.name.toLowerCase().endsWith(".csv")) {
        throw new Error("Use a CSV file exported from PPro8.");
      }

      const processed = await processTradeFile(file, allowedSymbols, settings);
      setFileName(file.name);
      setTrades(processed.trades);
      setIsCurrentImportSaved(false);
      setMessage(
        [
          `Loaded ${processed.trades.length} grouped trades from ${file.name}. Review them, then click Save To Database when you're ready.`,
          ...processed.warnings.filter((warning) => warning.includes("Converted"))
        ].join(" ")
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The file could not be processed.");
      setTrades([]);
      setFileName("");
      setIsCurrentImportSaved(false);
    } finally {
      setBusy(false);
    }
  };

  const handleSaveToDatabase = () => {
    if (trades.length === 0 || !fileName) {
      setMessage("Load a CSV file before saving to the database.");
      return;
    }

    const tradeDates = Array.from(new Set(trades.map((trade) => trade.tradeDate))).sort();
    const overlappingDates = tradeDates.filter((tradeDate) =>
      tradeSessions.some((session) => session.tradeDate === tradeDate)
    );

    if (overlappingDates.length > 0) {
      const shouldReplace = window.confirm(
        `A saved session already exists for ${overlappingDates.join(", ")}. Press OK to replace the saved day, or Cancel to stop.`
      );
      if (!shouldReplace) {
        setMessage("Saving to the local database was canceled.");
        return;
      }

      if (hasTradeTagOverridesForTradeDates(tradeTagOverrides, overlappingDates)) {
        const keepManualTags = window.confirm(
          `Manual tags already exist for ${overlappingDates.join(", ")}. Press OK to keep those manual tags, or Cancel to clear them for the replaced day.`
        );

        if (!keepManualTags) {
          setTradeTagOverrides((current) =>
            removeTradeTagOverridesForTradeDates(current, overlappingDates)
          );
        }
      }
    }

    setTradeSessions((currentSessions) =>
      mergeTradesIntoSessions(currentSessions, fileName, trades)
    );
    setIsCurrentImportSaved(true);

    const dateSummary =
      tradeDates.length === 1 ? tradeDates[0] : `${tradeDates[0]} to ${tradeDates[tradeDates.length - 1]}`;
    setMessage(`Saved staged trades into the local database for ${dateSummary}.`);
  };

  const handleExport = async () => {
    setBusy(true);
    try {
      if (resolvedTrades.length === 0) {
        throw new Error("Load a CSV file before exporting.");
      }

      const fileName = createExportFileName();
      const csvContent = buildCsvContent(toExportRows(resolvedTrades, allowedSymbols));

      if (!isTauri()) {
        downloadCsvInBrowser(fileName, csvContent);
        setMessage(`CSV export downloaded as ${fileName}.`);
        return;
      }

      if (!settings.exportFolder.trim()) {
        throw new Error("Choose an export destination in Send Workspace first.");
      }

      const savedPath = await invoke<string>("save_export_csv", {
        exportFolder: settings.exportFolder,
        fileName,
        contents: csvContent
      });
      setMessage(`CSV export saved to ${savedPath}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The CSV export failed.");
    } finally {
      setBusy(false);
    }
  };

  const handleBrowseFolder = async () => {
    if (!isTauri()) {
      setMessage("Folder browsing only works in the desktop app. In the browser, export downloads directly.");
      return;
    }

    const selected = await invoke<string | null>("pick_export_folder");
    if (selected) {
      setSettings((current) => ({ ...current, exportFolder: selected }));
    }
  };

  const handleImport = async () => {
    setBusy(true);
    try {
      if (resolvedTrades.length === 0) {
        throw new Error("Load a CSV file before importing.");
      }

      const connectionMessage = await runConnectionTest();
      if (connectionMessage !== "Notion connection works.") {
        throw new Error(connectionMessage);
      }

      const duplicateScan = await findNotionDuplicates(settings, resolvedTrades);
      if (duplicateScan.duplicates.length > 0) {
        const continueImport = window.confirm(
          `${duplicateScan.duplicates.length} duplicate trades already exist in Notion. Press OK to import the remaining ${duplicateScan.remaining.length} trades, or Cancel to stop.`
        );
        if (!continueImport) {
          setMessage("Notion import was canceled.");
          return;
        }
      }

      if (duplicateScan.remaining.length === 0) {
        setMessage("All grouped trades already exist in Notion.");
        return;
      }

      const createdCount = await importTradesToNotion(
        settings,
        duplicateScan.remaining,
        allowedSymbols,
        hasExecutionProperty
      );
      setMessage(`Imported ${createdCount} new trades into Notion.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The Notion import failed.");
    } finally {
      setBusy(false);
    }
  };

  const handleClear = () => {
    setFileName("");
    setTrades([]);
    setIsCurrentImportSaved(false);
    setMessage("The loaded file was cleared.");
  };

  const loadStoredSession = (tradeDate: string) => {
    const session = tradeSessions.find((entry) => entry.tradeDate === tradeDate);
    if (!session) {
      setMessage(`No saved session was found for ${tradeDate}.`);
      return;
    }

    setTrades(session.trades);
    setFileName(session.sourceFileName);
    setIsCurrentImportSaved(true);
    handleNavigate("trades");
    setMessage(`Loaded saved session for ${tradeDate} from local storage.`);
  };

  const deleteStoredSession = (tradeDate: string) => {
    const session = tradeSessions.find((entry) => entry.tradeDate === tradeDate);
    if (!session) {
      setMessage(`No saved session was found for ${tradeDate}.`);
      return;
    }

    const shouldDelete = window.confirm(
      `Delete the saved session for ${tradeDate}? This removes the stored grouped trades for that day.`
    );
    if (!shouldDelete) {
      return;
    }

    const tradeIds = new Set(session.trades.map((trade) => trade.id));

    setTradeSessions((current) => current.filter((entry) => entry.tradeDate !== tradeDate));
    setTradeTagOverrides((current) => removeTradeTagOverridesForTradeDates(current, [tradeDate]));
    setTradeReviews((current) => current.filter((review) => !tradeIds.has(review.tradeId)));
    setHistoricalBarSets((current) => current.filter((set) => set.tradeDate !== tradeDate));

    if (trades.some((trade) => trade.tradeDate === tradeDate)) {
      setTrades([]);
      setFileName("");
      setIsCurrentImportSaved(false);
    }

    setMessage(`Deleted saved session for ${tradeDate}.`);
  };

  const importHistoricalBars = async (trade: GroupedTrade, file: File) => {
    setBusy(true);
    try {
      const bars = await parseHistoricalBarsCsv(file, trade.tradeDate);
      const nextBarSet: HistoricalBarSet = {
        key: buildBarSetKey(trade.symbol, trade.tradeDate),
        symbol: trade.symbol,
        tradeDate: trade.tradeDate,
        sourceFileName: file.name,
        bars,
        updatedAt: new Date().toISOString()
      };

      setHistoricalBarSets((current) => upsertHistoricalBarSet(current, nextBarSet));
      setMessage(`Imported ${bars.length} historical bars for ${trade.symbol} on ${trade.tradeDate}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The historical bar file could not be imported.");
    } finally {
      setBusy(false);
    }
  };

  const fetchHistoricalBars = async (trade: GroupedTrade) => {
    setBusy(true);
    try {
      const [bars, dailyBars] = await Promise.all([
        fetchHistoricalBarsFromTwelveData(settings, trade),
        fetchDailyHistoricalBarsFromTwelveData(settings, trade)
      ]);
      const nextBarSet: HistoricalBarSet = {
        key: buildBarSetKey(trade.symbol, trade.tradeDate),
        symbol: trade.symbol,
        tradeDate: trade.tradeDate,
        sourceFileName: "Twelve Data · 1min",
        bars,
        dailyBars,
        updatedAt: new Date().toISOString()
      };

      setHistoricalBarSets((current) => upsertHistoricalBarSet(current, nextBarSet));
      setMessage(
        `Fetched ${bars.length} minute bars and ${dailyBars.length} day bars from Twelve Data for ${trade.symbol}.`
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The Twelve Data request failed.");
    } finally {
      setBusy(false);
    }
  };

  const clearHistoricalBars = (trade: GroupedTrade) => {
    const key = buildBarSetKey(trade.symbol, trade.tradeDate);
    setHistoricalBarSets((current) => removeHistoricalBarSet(current, key));
    setMessage(`Cleared historical bars for ${trade.symbol} on ${trade.tradeDate}.`);
  };

  const {
    createJournalPage,
    updateJournalPage,
    updateJournalContent,
    saveJournalChecklistTemplateAs,
    updateJournalChecklistTemplate,
    deleteJournalChecklistTemplate
  } = createJournalPageActions({
    getJournalPages: () => journalPagesRef.current,
    journalChecklistTemplates,
    persistJournalPages,
    setSelectedJournalPageId,
    setJournalChecklistTemplates,
    setMessage
  });

  const updateTradeReview = (
    tradeId: string,
    updates: Partial<Pick<TradeReviewRecord, "notes" | "chartContext" | "screenshotUrl" | "drawings">>
  ) => {
    setTradeReviews((current) => {
      const existing = current.find((review) => review.tradeId === tradeId);
      const updatedAt = new Date().toISOString();

      if (!existing) {
        return [
          ...current,
          {
            tradeId,
            notes: updates.notes ?? "",
            chartContext: updates.chartContext ?? "",
            screenshotUrl: updates.screenshotUrl ?? "",
            drawings: updates.drawings ?? [],
            updatedAt
          }
        ];
      }

      return current.map((review) =>
        review.tradeId === tradeId
          ? {
              ...review,
              ...updates,
              updatedAt
            }
          : review
      );
    });
  };

  const renderActivePage = () => {
    switch (activeRoute) {
      case "dashboard":
        return (
          <DashboardPage
            trades={allStoredTrades}
            externalTradeDateFilterStart={dashboardTradeDateFilterStart}
            externalTradeDateFilterEnd={dashboardTradeDateFilterEnd}
            externalPlaybookFilter={dashboardPlaybookFilter}
            externalSymbolFilter={dashboardSymbolFilter}
            externalStatusFilter={dashboardStatusFilter}
            externalGameFilter={dashboardGameFilter}
            externalExecutionFilter={dashboardExecutionFilter}
            onFiltersChange={({ startValue, endValue, playbook, symbol, status, game, execution }) => {
              setDashboardTradeDateFilterStart(startValue);
              setDashboardTradeDateFilterEnd(endValue);
              setDashboardPlaybookFilter(playbook);
              setDashboardSymbolFilter(symbol);
              setDashboardStatusFilter(status);
              setDashboardGameFilter(game);
              setDashboardExecutionFilter(execution);
            }}
            onSelectTrade={(tradeId, tradeDate) => {
              setDashboardTradeDateFilterStart(tradeDate);
              setDashboardTradeDateFilterEnd(tradeDate);
              setDashboardSelectedTradeId(tradeId);
              setDashboardSelectedTradeRequestId((current) => current + 1);
              handleNavigate("trades");
            }}
          />
        );
      case "trades":
        return (
          <TradesPage
              trades={resolvedTrades}
              databaseTrades={
                resolvedTrades.length > 0 && !isCurrentImportSaved
                  ? [...resolvedTrades, ...allStoredTrades]
                  : allStoredTrades
              }
              externalTradeDateFilterStart={dashboardTradeDateFilterStart}
              externalTradeDateFilterEnd={dashboardTradeDateFilterEnd}
              externalPlaybookFilter={dashboardPlaybookFilter}
              externalSymbolFilter={dashboardSymbolFilter}
              externalStatusFilter={dashboardStatusFilter}
              externalGameFilter={dashboardGameFilter}
              externalExecutionFilter={dashboardExecutionFilter}
              externalSelectedTradeId={dashboardSelectedTradeId}
              externalSelectedTradeRequestId={dashboardSelectedTradeRequestId}
              reviews={tradeReviews}
              historicalBarSets={historicalBarSets}
              historicalBarSetsLoaded={historicalBarSetsLoaded}
              reviewChartInterval={reviewChartInterval}
              dayChartInterval={dayChartInterval}
              tagOptionsByField={activeTradeTagOptionsByField}
              busy={busy}
              onUpdateReview={updateTradeReview}
              onImportHistoricalBars={importHistoricalBars}
              onFetchHistoricalBars={fetchHistoricalBars}
              onClearHistoricalBars={clearHistoricalBars}
              hasTwelveDataApiKey={Boolean(settings.twelveDataApiKey.trim())}
              onChangeReviewChartInterval={setReviewChartInterval}
              onChangeDayChartInterval={setDayChartInterval}
              onUpdateTradeTag={updateTradeTag}
              onBulkUpdateTradeTags={bulkUpdateTradeTags}
              onCreateTradeTagOption={createTradeTagOption}
              onRenameTradeTagOption={renameTradeTagOption}
              onDeleteTradeTagOption={deleteTradeTagOption}
              onClearExternalSelectedTrade={() => setDashboardSelectedTradeId("")}
            />
        );
      case "journal":
        return (
            <JournalPage
              pages={journalPages}
              selectedPageId={selectedJournalPageId}
              trades={allStoredTrades}
              settings={settings}
              tagOptionsByField={activeTradeTagOptionsByField}
              checklistTemplates={journalChecklistTemplates}
              externalSelectedTradeDate={
                dashboardTradeDateFilterStart &&
                dashboardTradeDateFilterEnd &&
                dashboardTradeDateFilterStart === dashboardTradeDateFilterEnd
                  ? dashboardTradeDateFilterStart
                  : ""
              }
              onSelectPage={setSelectedJournalPageId}
              onSelectTrade={(tradeId, tradeDate) => {
                setDashboardTradeDateFilterStart(tradeDate);
                setDashboardTradeDateFilterEnd(tradeDate);
                setDashboardSelectedTradeId(tradeId);
                setDashboardSelectedTradeRequestId((current) => current + 1);
                handleNavigate("trades");
              }}
              onCreatePage={createJournalPage}
              onUpdatePage={updateJournalPage}
              onUpdateContent={updateJournalContent}
              onSaveChecklistTemplateAs={saveJournalChecklistTemplateAs}
              onUpdateChecklistTemplate={updateJournalChecklistTemplate}
              onDeleteChecklistTemplate={deleteJournalChecklistTemplate}
              onUpdateTradeTag={updateTradeTag}
              onBulkUpdateTradeTags={bulkUpdateTradeTags}
              onCreateTradeTagOption={createTradeTagOption}
              onRenameTradeTagOption={renameTradeTagOption}
              onDeleteTradeTagOption={deleteTradeTagOption}
              onAttachScreenshotToTrade={(tradeId, screenshotUrl) =>
                updateTradeReview(tradeId, { screenshotUrl })
              }
            />
          );
      case "library":
        return (
          <LibraryPage
            trades={allStoredTrades}
            journalPages={journalPages}
            settings={settings}
            onSelectTrade={(tradeId, tradeDate) => {
              setDashboardTradeDateFilterStart(tradeDate);
              setDashboardTradeDateFilterEnd(tradeDate);
              setDashboardSelectedTradeId(tradeId);
              setDashboardSelectedTradeRequestId((current) => current + 1);
              setDashboardPlaybookFilter("all");
              handleNavigate("trades");
            }}
            onOpenJournalDate={(tradeDate) => {
              setDashboardTradeDateFilterStart(tradeDate);
              setDashboardTradeDateFilterEnd(tradeDate);
              handleNavigate("journal");
            }}
            onViewReportsForPlaybook={(playbookName) => {
              setDashboardTradeDateFilterStart("");
              setDashboardTradeDateFilterEnd("");
              setDashboardPlaybookFilter(playbookName);
              setDashboardSymbolFilter("all");
              setDashboardStatusFilter("all");
              setDashboardGameFilter("all");
              setDashboardExecutionFilter("all");
              handleNavigate("reports");
            }}
          />
        );
      case "playbooks":
        return (
          <LibraryPage
            trades={allStoredTrades}
            journalPages={journalPages}
            settings={settings}
            initialSection="playbooks"
            onSelectTrade={(tradeId, tradeDate) => {
              setDashboardTradeDateFilterStart(tradeDate);
              setDashboardTradeDateFilterEnd(tradeDate);
              setDashboardSelectedTradeId(tradeId);
              setDashboardSelectedTradeRequestId((current) => current + 1);
              setDashboardPlaybookFilter("all");
              handleNavigate("trades");
            }}
            onOpenJournalDate={(tradeDate) => {
              setDashboardTradeDateFilterStart(tradeDate);
              setDashboardTradeDateFilterEnd(tradeDate);
              handleNavigate("journal");
            }}
            onViewReportsForPlaybook={(playbookName) => {
              setDashboardTradeDateFilterStart("");
              setDashboardTradeDateFilterEnd("");
              setDashboardPlaybookFilter(playbookName);
              setDashboardSymbolFilter("all");
              setDashboardStatusFilter("all");
              setDashboardGameFilter("all");
              setDashboardExecutionFilter("all");
              handleNavigate("reports");
            }}
          />
        );
      case "reports":
        return (
          <ReportsPage
            trades={allStoredTrades}
            externalTradeDateFilterStart={dashboardTradeDateFilterStart}
            externalTradeDateFilterEnd={dashboardTradeDateFilterEnd}
            externalPlaybookFilter={dashboardPlaybookFilter}
            externalSymbolFilter={dashboardSymbolFilter}
            externalStatusFilter={dashboardStatusFilter}
            externalGameFilter={dashboardGameFilter}
            externalExecutionFilter={dashboardExecutionFilter}
            onFiltersChange={({ startValue, endValue, playbook, symbol, status, game, execution }) => {
              setDashboardTradeDateFilterStart(startValue);
              setDashboardTradeDateFilterEnd(endValue);
              setDashboardPlaybookFilter(playbook);
              setDashboardSymbolFilter(symbol);
              setDashboardStatusFilter(status);
              setDashboardGameFilter(game);
              setDashboardExecutionFilter(execution);
            }}
          />
        );
      case "import":
        return (
          <ImportPage
            fileName={fileName}
            trades={resolvedTrades}
            busy={busy}
            isCurrentImportSaved={isCurrentImportSaved}
            settings={settings}
            savedTradeDates={tradeSessions.map((session) => session.tradeDate)}
            onFileDrop={handleFileDrop}
            onSettingsChange={setSettings}
            onBrowseExportFolder={handleBrowseFolder}
            onSaveToDatabase={handleSaveToDatabase}
            onExport={handleExport}
            onImport={handleImport}
            onExportWorkspaceBundle={handleExportWorkspaceBundle}
            onImportWorkspaceBundle={handleImportWorkspaceBundle}
            onClear={handleClear}
            tagOptionsByField={activeTradeTagOptionsByField}
            onUpdateTradeTag={updateTradeTag}
            onCreateTradeTagOption={createTradeTagOption}
            onRenameTradeTagOption={renameTradeTagOption}
            onDeleteTradeTagOption={deleteTradeTagOption}
          />
        );
      case "data":
        return (
          <DataPage
            settings={settings}
            sessions={resolvedTradeSessions}
            onLoadSession={loadStoredSession}
            onDeleteSession={deleteStoredSession}
          />
        );
      case "settings":
        return (
          <SettingsPage
            settings={settings}
            onChange={setSettings}
            onTestConnection={runConnectionTest}
            onLoadWorkspaceAttachmentSummary={handleLoadWorkspaceAttachmentSummary}
            onAuditWorkspaceAttachments={handleAuditWorkspaceAttachments}
            onPruneWorkspaceAttachments={handlePruneWorkspaceAttachments}
          />
        );
      default:
        return null;
    }
  };

  const handleNavigate = (route: AppRoute) => {
    if (route === activeRoute) {
      return;
    }

    void (async () => {
      await requestFlushDebouncedSaves();
      setActiveRoute(route);
    })();
  };

  return (
    <>
      {!authChecked || syncing ? (
        <div className="page-loading-shell">
          <div className="page-loading-state">
            <div className="page-loading-orb" aria-hidden="true" />
            <div className="page-loading-copy">
              <strong>{!authChecked ? "Loading workspace" : "Applying workspace changes"}</strong>
              <span>Preparing charts, reports, and journal tools.</span>
            </div>
          </div>
        </div>
      ) : null}
      <Suspense
        fallback={
          <div className="page-loading-shell">
            <div className="page-loading-state">
              <div className="page-loading-orb" aria-hidden="true" />
              <div className="page-loading-copy">
                <strong>Loading workspace</strong>
                <span>Preparing charts, reports, and journal tools.</span>
              </div>
            </div>
          </div>
        }
      >
        {user ? (
          <AppLayout
            activeRoute={activeRoute}
            navItems={navItems}
            onNavigate={handleNavigate}
            accountLabel={user.username || "Local Workspace"}
          >
            <div key={`${activeRoute}-${workspaceRefreshKey}`}>{renderActivePage()}</div>
          </AppLayout>
        ) : null}
      </Suspense>
      {user ? <footer className="status-bar">{message}</footer> : null}
    </>
  );
}

export default App;
