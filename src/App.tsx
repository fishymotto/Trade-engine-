import { invoke, isTauri } from "@tauri-apps/api/core";
import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { AppLayout } from "./components/AppLayout";
import { AuthModal } from "./components/AuthModal";
import { authService, type User } from "./lib/auth";
import { createEmptyJournalDoc } from "./lib/journal/journalContent";
import {
  getDefaultChecklistContent,
  loadJournalChecklistTemplates,
  saveJournalChecklistTemplates,
  type JournalChecklistTemplates,
  type NamedChecklistTemplate
} from "./lib/journal/journalTemplateStore";
import { buildCsvContent, toExportRows } from "./lib/export/csvExporter";
import { dedupeJournalPages, loadJournalPages, saveJournalPages } from "./lib/journal/journalStore";
import {
  findNotionDuplicates,
  importTradesToNotion,
  testNotionConnection
} from "./lib/notion/notionClient";
import { loadTradeReviews, saveTradeReviews } from "./lib/reviews/tradeReviewStore";
import {
  buildBarSetKey,
  loadHistoricalBarSets,
  removeHistoricalBarSet,
  saveHistoricalBarSets,
  upsertHistoricalBarSet
} from "./lib/charts/historicalBarStore";
import {
  fetchDailyHistoricalBarsFromTwelveData,
  fetchHistoricalBarsFromTwelveData
} from "./lib/charts/twelveDataClient";
import { parseHistoricalBarsCsv } from "./lib/parser/historicalBarsParser";
import { loadTradeSessions, mergeTradesIntoSessions, saveTradeSessions } from "./lib/sessions/tradeSessionStore";
import { processTradeFile } from "./lib/tradePipeline";
import { buildTradeTagOptionsByField, tradeTagFields } from "./lib/trades/tradeTagCatalog";
import { loadTradeTagOptions, saveTradeTagOptions } from "./lib/trades/tradeTagOptionStore";
import { loadTradeTagOverrides, saveTradeTagOverrides } from "./lib/trades/tradeTagOverrideStore";
import {
  applyTradeTagOverrides,
  hasTradeTagOverridesForTradeDates,
  removeTradeTagOverridesForTradeDates,
  upsertTradeTagOverride
} from "./lib/trades/tradeTagOverrides";
import { loadWorkspaceState, saveWorkspaceState } from "./lib/workspace/workspaceStore";
import { defaultSettings, loadSettings, saveSettings } from "./lib/settings/settingsStore";
import type { AppNavItem, AppRoute } from "./types/app";
import type { ChartInterval, HistoricalBarSet } from "./types/chart";
import type { JournalContentField, JournalPageRecord } from "./types/journal";
import type { TradeReviewRecord } from "./types/review";
import type { TradeSessionRecord } from "./types/session";
import type { GroupedTrade, Settings } from "./types/trade";
import type {
  EditableTradeRow,
  EditableTradeTagField,
  TradeTagOptionsRecord,
  TradeTagOverrideRecord
} from "./types/tradeTags";

const navItems: AppNavItem[] = [
  { id: "dashboard", label: "Dashboard", icon: "dashboard" },
  { id: "trades", label: "Trades", icon: "trades" },
  { id: "journal", label: "Journal", icon: "journal" },
  { id: "library", label: "Library", icon: "library" },
  { id: "playbooks", label: "Playbooks", icon: "playbooks" },
  { id: "reports", label: "Reports", icon: "reports" },
  { id: "import", label: "Import", icon: "import" },
  { id: "data", label: "Data", icon: "data" }
];

const DashboardPage = lazy(() =>
  import("./pages/DashboardPage").then((module) => ({ default: module.DashboardPage }))
);
const TradesPage = lazy(() =>
  import("./pages/TradesPage").then((module) => ({ default: module.TradesPage }))
);
const JournalPage = lazy(() =>
  import("./pages/JournalPage").then((module) => ({ default: module.JournalPage }))
);
const LibraryPage = lazy(() =>
  import("./pages/LibraryPage").then((module) => ({ default: module.LibraryPage }))
);
const PlaybooksPage = lazy(() =>
  import("./pages/PlaybooksPage").then((module) => ({ default: module.PlaybooksPage }))
);
const ReportsPage = lazy(() =>
  import("./pages/ReportsPage").then((module) => ({ default: module.ReportsPage }))
);
const ImportPage = lazy(() =>
  import("./pages/ImportPage").then((module) => ({ default: module.ImportPage }))
);
const DataPage = lazy(() =>
  import("./pages/DataPage").then((module) => ({ default: module.DataPage }))
);
const SettingsModal = lazy(() =>
  import("./components/SettingsModal").then((module) => ({ default: module.SettingsModal }))
);

const buildJournalTemplate = (checklistTemplates: JournalChecklistTemplates) => ({
  title: "Daily Journal",
  dayGrade: "",
  mpp: "",
  sleepHours: "7.5",
  sleepScore: "",
  morningMood: "",
  openMood: "",
  afternoonMood: "",
  closeMood: "",
  screenshotUrls: [],
  closingChecklistContent: getDefaultChecklistContent(checklistTemplates, "closing"),
  morningChecklistContent: getDefaultChecklistContent(checklistTemplates, "morning"),
  morningContent: createEmptyJournalDoc(),
  closingContent: createEmptyJournalDoc(),
  mppPlanContent: getDefaultChecklistContent(checklistTemplates, "mpp"),
  notesContent: createEmptyJournalDoc()
});

const createExportFileName = (): string => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `notion_ready_${year}-${month}-${day}.csv`;
};

const normalizeJournalTradeDate = (value: string) => {
  if (!value) {
    return "";
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toISOString().slice(0, 10);
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
  const initialWorkspaceStateRef = useRef(loadWorkspaceState());
  const [activeRoute, setActiveRoute] = useState<AppRoute>("dashboard");
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
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
  const [reviewChartInterval, setReviewChartInterval] = useState<ChartInterval>(
    initialWorkspaceStateRef.current.reviewChartInterval
  );
  const [dayChartInterval, setDayChartInterval] = useState<ChartInterval>(
    initialWorkspaceStateRef.current.dayChartInterval
  );
  const [historicalBarSets, setHistoricalBarSets] = useState<HistoricalBarSet[]>(() => loadHistoricalBarSets());
  const [journalPages, setJournalPages] = useState<JournalPageRecord[]>(() => loadJournalPages());
  const [journalChecklistTemplates, setJournalChecklistTemplates] = useState<JournalChecklistTemplates>(() =>
    loadJournalChecklistTemplates()
  );
  const [tradeReviews, setTradeReviews] = useState<TradeReviewRecord[]>(() => loadTradeReviews());
  const [selectedJournalPageId, setSelectedJournalPageId] = useState("");
  const [isCurrentImportSaved, setIsCurrentImportSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Load one PPro8 Trade Detail CSV file, then export the cleaned CSV.");

  useEffect(() => {
    let cancelled = false;

    const initializeSettings = async () => {
      const loadedSettings = await loadSettings();
      if (cancelled) {
        return;
      }

      setSettings(loadedSettings);
      setSettingsLoaded(true);
    };

    initializeSettings();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const initializeTradeTagOptions = async () => {
      const loadedOptions = await loadTradeTagOptions();
      if (cancelled) {
        return;
      }

      setTradeTagOptions(loadedOptions);
      setTradeTagOptionsLoaded(true);
    };

    void initializeTradeTagOptions();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const initializeTradeTagOverrides = async () => {
      const loadedOverrides = await loadTradeTagOverrides();
      if (cancelled) {
        return;
      }

      setTradeTagOverrides(loadedOverrides);
      setTradeTagOverridesLoaded(true);
    };

    void initializeTradeTagOverrides();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!settingsLoaded) {
      return;
    }

    void saveSettings(settings);
  }, [settings, settingsLoaded]);

  useEffect(() => {
    let cancelled = false;

    const initializeTradeSessions = async () => {
      const loadedSessions = await loadTradeSessions();
      if (cancelled) {
        return;
      }

      setTradeSessions(loadedSessions);
      setTradeSessionsLoaded(true);
    };

    void initializeTradeSessions();

    return () => {
      cancelled = true;
    };
  }, []);

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
    const dedupedPages = dedupeJournalPages(journalPages);
    if (dedupedPages.length !== journalPages.length) {
      setJournalPages(dedupedPages);
      return;
    }

    saveJournalPages(dedupedPages);
  }, [journalPages]);

  useEffect(() => {
    saveJournalChecklistTemplates(journalChecklistTemplates);
  }, [journalChecklistTemplates]);

  useEffect(() => {
    saveTradeReviews(tradeReviews);
  }, [tradeReviews]);

  useEffect(() => {
    if (!tradeTagOptionsLoaded) {
      return;
    }

    void saveTradeTagOptions(tradeTagOptions);
  }, [tradeTagOptions, tradeTagOptionsLoaded]);

  useEffect(() => {
    if (!tradeSessionsLoaded) {
      return;
    }

    void saveTradeSessions(tradeSessions);
  }, [tradeSessions, tradeSessionsLoaded]);

  useEffect(() => {
    if (!tradeTagOverridesLoaded) {
      return;
    }

    void saveTradeTagOverrides(tradeTagOverrides);
  }, [tradeTagOverrides, tradeTagOverridesLoaded]);

  useEffect(() => {
    saveHistoricalBarSets(historicalBarSets);
  }, [historicalBarSets]);

  useEffect(() => {
    const loadedTradeDates = Array.from(new Set(trades.map((trade) => trade.tradeDate))).sort();
    saveWorkspaceState({
      activeRoute,
      loadedTradeDates,
      fileName,
      isCurrentImportSaved,
      reviewChartInterval,
      dayChartInterval
    });
  }, [activeRoute, trades, fileName, isCurrentImportSaved, reviewChartInterval, dayChartInterval]);

  useEffect(() => {
    if (journalPages.length === 0) {
      setSelectedJournalPageId("");
      return;
    }

    const pageStillExists = journalPages.some((page) => page.id === selectedJournalPageId);
    if (!pageStillExists) {
      setSelectedJournalPageId(journalPages[0].id);
    }
  }, [journalPages, selectedJournalPageId]);

  const runConnectionTest = async (): Promise<string> => {
    try {
      const result = await testNotionConnection(settings);
      if (result.ok) {
        setAllowedSymbols(result.allowedSymbolOptions);
        setHasExecutionProperty(result.hasExecutionProperty);
      }
      return result.message;
    } catch (error) {
      return error instanceof Error ? error.message : "The Notion connection test failed.";
    }
  };

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
      if (trades.length === 0) {
        throw new Error("Load a CSV file before exporting.");
      }

      const fileName = createExportFileName();
      const csvContent = buildCsvContent(toExportRows(trades, allowedSymbols));

      if (!isTauri()) {
        downloadCsvInBrowser(fileName, csvContent);
        setMessage(`CSV export downloaded as ${fileName}.`);
        return;
      }

      if (!settings.exportFolder.trim()) {
        throw new Error("Choose an export folder in Settings first.");
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
      if (trades.length === 0) {
        throw new Error("Load a CSV file before importing.");
      }

      const connectionMessage = await runConnectionTest();
      if (connectionMessage !== "Notion connection works.") {
        throw new Error(connectionMessage);
      }

      const duplicateScan = await findNotionDuplicates(settings, trades);
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
    setActiveRoute("trades");
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

  const createJournalPage = (tradeDate: string) => {
    const normalizedTradeDate = normalizeJournalTradeDate(tradeDate.trim());
    if (!normalizedTradeDate) {
      return;
    }

    const existingPage = journalPages.find((page) => page.tradeDate === normalizedTradeDate);
    if (existingPage) {
      setSelectedJournalPageId(existingPage.id);
      setMessage(`Opened the existing journal page for ${normalizedTradeDate}.`);
      return;
    }

    const timestamp = new Date().toISOString();
    const templateContent = buildJournalTemplate(journalChecklistTemplates);
    const newPage: JournalPageRecord = {
      id: `journal-${timestamp}`,
      title: templateContent.title,
      tradeDate: normalizedTradeDate,
      dayGrade: templateContent.dayGrade,
      mpp: templateContent.mpp,
      sleepHours: templateContent.sleepHours,
      sleepScore: templateContent.sleepScore,
      morningMood: templateContent.morningMood,
      openMood: templateContent.openMood,
      afternoonMood: templateContent.afternoonMood,
      closeMood: templateContent.closeMood,
      screenshotUrls: templateContent.screenshotUrls,
      closingChecklistContent: templateContent.closingChecklistContent,
      morningChecklistContent: templateContent.morningChecklistContent,
      morningContent: templateContent.morningContent,
      closingContent: templateContent.closingContent,
      mppPlanContent: templateContent.mppPlanContent,
      notesContent: templateContent.notesContent,
      morningBlocks: [],
      closingBlocks: [],
      mppPlanBlocks: [],
      blocks: [],
      createdAt: timestamp,
      updatedAt: timestamp
    };

    setJournalPages((current) =>
      [newPage, ...current].sort((left, right) => right.tradeDate.localeCompare(left.tradeDate))
    );
    setSelectedJournalPageId(newPage.id);
  };

  const updateJournalPage = (
    pageId: string,
    updates: Partial<
      Pick<
        JournalPageRecord,
        | "title"
        | "tradeDate"
        | "dayGrade"
        | "mpp"
        | "sleepHours"
        | "sleepScore"
        | "morningMood"
        | "openMood"
        | "afternoonMood"
        | "closeMood"
        | "screenshotUrls"
      >
    >
  ) => {
    setSelectedJournalPageId(pageId);
    setJournalPages((current) =>
      current
        .map((page) =>
          page.id === pageId
            ? {
                ...page,
                ...updates,
                tradeDate: updates.tradeDate
                  ? normalizeJournalTradeDate(updates.tradeDate)
                  : page.tradeDate,
                updatedAt: new Date().toISOString()
              }
            : page
        )
        .sort((left, right) => right.tradeDate.localeCompare(left.tradeDate))
    );
  };

  const updateJournalContent = (
    pageId: string,
    field: JournalContentField,
    content: JournalPageRecord[JournalContentField]
  ) => {
    setJournalPages((current) =>
      current.map((page) =>
        page.id === pageId
          ? {
              ...page,
              [field]: content,
              updatedAt: new Date().toISOString()
            }
          : page
      )
    );
  };

  const saveJournalChecklistTemplateAs = (
    type: "morning" | "closing" | "mpp",
    name: string,
    content: NamedChecklistTemplate["content"]
  ) => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      return;
    }

    setJournalChecklistTemplates((current) => ({
      ...current,
      [type === "morning" ? "morningTemplates" : type === "closing" ? "closingTemplates" : "mppTemplates"]: [
        ...(
          type === "morning"
            ? current.morningTemplates
            : type === "closing"
              ? current.closingTemplates
              : current.mppTemplates
        ).filter(
          (template) => template.name.toLowerCase() !== trimmedName.toLowerCase()
        ),
        {
          id: `template-${Date.now()}`,
          name: trimmedName,
          content
        }
      ]
    }));
    setMessage(
      `${type === "morning" ? "Morning" : type === "closing" ? "Closing" : "MPP"} template "${trimmedName}" saved.`
    );
  };

  const deleteJournalChecklistTemplate = (type: "morning" | "closing" | "mpp", templateId: string) => {
    setJournalChecklistTemplates((current) => {
      const templateKey =
        type === "morning" ? "morningTemplates" : type === "closing" ? "closingTemplates" : "mppTemplates";
      const templates = current[templateKey];

      if (templates.length <= 1) {
        return current;
      }

      const nextTemplates = templates.filter((template) => template.id !== templateId);
      if (nextTemplates.length === templates.length) {
        return current;
      }

      return {
        ...current,
        [templateKey]: nextTemplates
      };
    });

    setMessage(`${type === "morning" ? "Morning" : type === "closing" ? "Closing" : "MPP"} template deleted.`);
  };

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

  const updateTradeTag = (
    trade: EditableTradeRow,
    field: EditableTradeTagField,
    value: string | null
  ) => {
    setTradeTagOverrides((current) => upsertTradeTagOverride(current, trade, field, value));
  };

  const createTradeTagOption = (field: EditableTradeTagField, rawValue: string) => {
    const value = rawValue.trim();
    if (!value) {
      return;
    }

    if (mergedTradeTagOptionsByField[field].some((option) => option.toLowerCase() === value.toLowerCase())) {
      return;
    }

    setTradeTagOptions((current) => ({
      ...current,
      [field]: [...(current[field] ?? []), value]
    }));
    setMessage(`Added "${value}" to the ${field} tag list.`);
  };

  const bulkUpdateTradeTags = (
    tradeIds: string[],
    field: EditableTradeTagField,
    value: string | null
  ) => {
    const targetTrades = resolvedTrades.filter((trade) => tradeIds.includes(trade.id));
    if (targetTrades.length === 0) {
      return;
    }

    setTradeTagOverrides((current) =>
      targetTrades.reduce(
        (nextOverrides, trade) => upsertTradeTagOverride(nextOverrides, trade, field, value),
        current
      )
    );
    setMessage(
      `${value ? "Applied" : "Cleared"} ${field} for ${targetTrades.length} selected trade${targetTrades.length === 1 ? "" : "s"}.`
    );
  };

  const allStoredTrades = resolvedTradeSessions.flatMap(
    (session) => session.trades as EditableTradeRow[]
  );

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
              setActiveRoute("trades");
            }}
          />
        );
      case "trades":
        return (
          <TradesPage
              fileName={fileName}
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
              onClearExternalSelectedTrade={() => setDashboardSelectedTradeId("")}
            />
        );
      case "journal":
        return (
            <JournalPage
              pages={journalPages}
              selectedPageId={selectedJournalPageId}
              trades={allStoredTrades}
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
                setActiveRoute("trades");
              }}
              onCreatePage={createJournalPage}
              onUpdatePage={updateJournalPage}
              onUpdateContent={updateJournalContent}
              onSaveChecklistTemplateAs={saveJournalChecklistTemplateAs}
              onDeleteChecklistTemplate={deleteJournalChecklistTemplate}
              onUpdateTradeTag={updateTradeTag}
              onCreateTradeTagOption={createTradeTagOption}
            />
          );
      case "library":
        return <LibraryPage />;
      case "playbooks":
        return (
          <PlaybooksPage
            trades={allStoredTrades}
            onSelectTrade={(tradeId, tradeDate) => {
              setDashboardTradeDateFilterStart(tradeDate);
              setDashboardTradeDateFilterEnd(tradeDate);
              setDashboardSelectedTradeId(tradeId);
              setDashboardSelectedTradeRequestId((current) => current + 1);
              setDashboardPlaybookFilter("all");
              setActiveRoute("trades");
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
            trades={trades}
            busy={busy}
            isCurrentImportSaved={isCurrentImportSaved}
            onFileDrop={handleFileDrop}
            onSaveToDatabase={handleSaveToDatabase}
            onExport={handleExport}
            onImport={handleImport}
            onClear={handleClear}
            onSettings={() => setSettingsOpen(true)}
            tagOptionsByField={activeTradeTagOptionsByField}
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
      default:
        return null;
    }
  };

  return (
    <>
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
        <AppLayout activeRoute={activeRoute} navItems={navItems} onNavigate={setActiveRoute}>
          {renderActivePage()}
        </AppLayout>
      </Suspense>
      <footer className="status-bar">{message}</footer>
      <Suspense fallback={null}>
        <SettingsModal
          isOpen={settingsOpen}
          settings={settings}
          onClose={() => setSettingsOpen(false)}
          onChange={setSettings}
          onBrowse={handleBrowseFolder}
          onTestConnection={runConnectionTest}
        />
      </Suspense>
    </>
  );
}

export default App;
