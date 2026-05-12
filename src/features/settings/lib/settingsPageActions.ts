import { invoke, isTauri } from "@tauri-apps/api/core";
import { testNotionConnection } from "../../notion/lib/notionClient";
import { saveJournalPages } from "../../../lib/journal/journalStore";
import type { JournalChecklistTemplates } from "../../../lib/journal/journalTemplateStore";
import { persistJournalChecklistTemplates } from "../../../lib/journal/journalTemplateStore";
import { loadLibraryPages, saveLibraryPages } from "../../../lib/library/libraryStore";
import { loadPlaybooks, savePlaybooks } from "../../../lib/playbooks/playbookStore";
import { persistHeadlinesRecord } from "../../../lib/headlines/headlineStore";
import {
  loadReviewTemplates,
  persistReviewTemplates
} from "../../../lib/review/reviewTemplateStore";
import { saveTradeReviews } from "../../../lib/reviews/tradeReviewStore";
import { saveSettings } from "../../../lib/settings/settingsStore";
import {
  persistSelectOptionAdditions,
  type SelectOptionAdditionsRecord
} from "../../../lib/select/selectOptionAdditionsStore";
import { saveDesktopStoreBackup } from "../../../lib/storage/desktopStoreBackup";
import { requestFlushDebouncedSaves } from "../../../lib/sync/pendingSaveFlush";
import { canUseMachineLegacyData, resetAllSyncStoreMemory, syncStores } from "../../../lib/sync/syncStore";
import { saveTradeSessions } from "../../../lib/sessions/tradeSessionStore";
import { saveTradeTagOptions } from "../../../lib/trades/tradeTagOptionStore";
import { saveTradeTagOverrides } from "../../../lib/trades/tradeTagOverrideStore";
import type { WorkspaceAttachmentAuditResult } from "../../../lib/workspace/workspaceAttachmentClient";
import {
  persistWorkspaceState,
  type WorkspaceState
} from "../../../lib/workspace/workspaceStore";
import {
  applyWorkspaceTransferBundle,
  buildAppliedWorkspaceTransferSnapshot,
  collectWorkspaceTransferLocalStorage,
  extractWorkspaceAttachmentPaths,
  prepareWorkspaceTransferSnapshot,
  type WorkspaceTransferExportResult,
  type WorkspaceTransferImportResult
} from "../../../lib/workspace/workspaceTransfer";
import { persistHistoricalBarSets } from "../../../lib/charts/historicalBarStore";
import { defaultSettings } from "../../../lib/settings/settingsStore";
import { defaultReviewTemplates } from "../../../lib/review/reviewTemplateStore";
import { defaultJournalChecklistTemplates } from "../../../lib/journal/journalTemplateStore";
import { defaultWorkspaceState } from "../../../lib/workspace/workspaceStore";
import type { HistoricalBarSet } from "../../../types/chart";
import type { HeadlineItem } from "../../../types/headline";
import type { JournalPageRecord } from "../../../types/journal";
import type { LibraryPageRecord } from "../../../types/library";
import type { PlaybookRecord } from "../../../types/playbook";
import type { TradeReviewRecord } from "../../../types/review";
import type { TradeSessionRecord } from "../../../types/session";
import type { Settings } from "../../../types/trade";
import type { TradeTagOptionsRecord, TradeTagOverrideRecord } from "../../../types/tradeTags";
import type { ReviewTemplates } from "../../../types/libraryReview";

const createWorkspaceBundleFileName = (
  selectedDates?: string[],
  startDate?: string,
  endDate?: string
): string => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const seconds = String(now.getSeconds()).padStart(2, "0");
  const normalizedSelectedDates = Array.isArray(selectedDates)
    ? selectedDates.filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value))
    : [];
  const rangeLabel =
    normalizedSelectedDates.length === 1
      ? `-date-${normalizedSelectedDates[0]}`
      : normalizedSelectedDates.length > 1
        ? `-selected-${normalizedSelectedDates.length}-dates`
        : startDate && endDate
      ? `-${startDate}-to-${endDate}`
      : startDate
        ? `-from-${startDate}`
        : endDate
          ? `-through-${endDate}`
          : "";
  return `trade-engine-workspace${rangeLabel}-${year}-${month}-${day}-${hours}${minutes}${seconds}.json`;
};

const getWorkspaceTransferRangeLabel = (
  selectedDates?: string[],
  startDate?: string,
  endDate?: string
): string => {
  const normalizedSelectedDates = Array.isArray(selectedDates)
    ? selectedDates.filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value))
    : [];
  if (normalizedSelectedDates.length === 1) {
    return ` for ${normalizedSelectedDates[0]}`;
  }

  if (normalizedSelectedDates.length > 1) {
    return normalizedSelectedDates.length <= 3
      ? ` for ${normalizedSelectedDates.join(", ")}`
      : ` for ${normalizedSelectedDates.length} selected dates`;
  }

  if (startDate && endDate) {
    return ` from ${startDate} to ${endDate}`;
  }

  if (startDate) {
    return ` from ${startDate}`;
  }

  if (endDate) {
    return ` through ${endDate}`;
  }

  return "";
};

const formatAttachmentBytes = (value: number): string => {
  if (!Number.isFinite(value) || value <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  const decimals = size >= 100 || unitIndex === 0 ? 0 : size >= 10 ? 1 : 2;
  return `${size.toFixed(decimals)} ${units[unitIndex]}`;
};

const waitForNextTask = (): Promise<void> =>
  new Promise((resolve) => window.setTimeout(resolve, 0));

const describeWorkspaceAttachmentAudit = (
  result: WorkspaceAttachmentAuditResult,
  options?: { pruned?: boolean }
): string => {
  const baseSummary = options?.pruned
    ? result.deletedFileCount > 0
      ? `Removed ${result.deletedFileCount} unused attachment${result.deletedFileCount === 1 ? "" : "s"} (${formatAttachmentBytes(result.deletedBytes)}).`
      : "No unused attachments were removed."
    : result.orphanedFileCount > 0
      ? `Found ${result.orphanedFileCount} unused attachment${result.orphanedFileCount === 1 ? "" : "s"} (${formatAttachmentBytes(result.orphanedBytes)}).`
      : "No unused attachments found.";

  const referencedSummary = `Kept ${result.referencedFileCount} referenced attachment${result.referencedFileCount === 1 ? "" : "s"} across ${result.scannedFileCount} stored file${result.scannedFileCount === 1 ? "" : "s"} (${formatAttachmentBytes(result.totalBytes)} total).`;
  const missingSummary =
    result.missingReferenceCount > 0
      ? ` ${result.missingReferenceCount} referenced attachment path${result.missingReferenceCount === 1 ? " was" : "s were"} already missing on disk.`
      : "";

  return `${baseSummary} ${referencedSummary}${missingSummary}`;
};

const SETTINGS_STORAGE_KEY = "trade-engine-settings";
const TRADE_SESSIONS_STORAGE_KEY = "trade-engine-trade-sessions";
const JOURNAL_PAGES_STORAGE_KEY = "trade-engine-journal-pages";
const TRADE_TAG_OPTIONS_STORAGE_KEY = "trade-engine-trade-tag-options";
const TRADE_TAG_OVERRIDES_STORAGE_KEY = "trade-engine-trade-tag-overrides";
const TRADE_REVIEWS_STORAGE_KEY = "trade-engine-trade-reviews";
const HISTORICAL_BARS_STORAGE_KEY = "trade-engine-historical-bars";
const JOURNAL_TEMPLATES_STORAGE_KEY = "trade-engine-journal-checklist-templates";
const WORKSPACE_STATE_STORAGE_KEY = "trade-engine-workspace";
const TRADE_TAG_CATALOG_STORAGE_KEY = "trade-engine-trade-tag-catalog";
const PLAYBOOKS_STORAGE_KEY = "trade-engine-playbooks";
const LIBRARY_PAGES_STORAGE_KEY = "trade-engine-library-pages";
const HEADLINES_STORAGE_KEY = "trade-engine-headlines";
const SELECT_OPTION_ADDITIONS_STORAGE_KEY = "trade-engine-select-option-additions";
const REVIEW_TEMPLATES_STORAGE_KEY = "trade-engine-review-templates";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const asArray = <T,>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

const toImportedSettings = (value: unknown, currentSettings: Settings): Settings => ({
  ...defaultSettings,
  ...currentSettings,
  ...(isRecord(value) ? (value as Partial<Settings>) : {})
});

type WorkspaceTransferPreviewScope = "full" | "since-date" | "date-range" | "selected-dates";

interface WorkspaceTransferBundlePreview {
  scope: WorkspaceTransferPreviewScope;
  exportedAt: string;
  startDate?: string;
  endDate?: string;
  selectedDates: string[];
  attachmentCount: number;
}

const formatWorkspaceTransferExportedAt = (value: string): string => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  return parsed.toLocaleString();
};

const buildWorkspaceImportConfirmationMessage = (
  preview: WorkspaceTransferBundlePreview
): string => {
  const scopeLabel = getWorkspaceTransferRangeLabel(
    preview.selectedDates,
    preview.startDate,
    preview.endDate
  );
  const exportedAtLabel = formatWorkspaceTransferExportedAt(preview.exportedAt);
  const exportedAtLine = exportedAtLabel ? `This transfer file was exported on ${exportedAtLabel}. ` : "";
  const attachmentLine =
    preview.attachmentCount > 0
      ? ` It also includes ${preview.attachmentCount} attachment${preview.attachmentCount === 1 ? "" : "s"}.`
      : "";

  switch (preview.scope) {
    case "selected-dates":
    case "since-date":
    case "date-range":
      return `${exportedAtLine}This transfer file contains workspace updates${scopeLabel}. Importing it will merge only those dated records into this computer and leave other dates alone.${attachmentLine} This machine keeps its own saved API keys. Continue?`;
    case "full":
    default:
      return `${exportedAtLine}This transfer file is a full workspace export. Importing it will replace imported workspace data on this computer.${attachmentLine} This machine keeps its own saved API keys. Continue?`;
  }
};

interface CreateSettingsPageActionsOptions {
  settings: Settings;
  tradeTagOptions: TradeTagOptionsRecord;
  tradeTagOverrides: TradeTagOverrideRecord[];
  tradeSessions: TradeSessionRecord[];
  journalPagesForSave: JournalPageRecord[];
  journalChecklistTemplates: JournalChecklistTemplates;
  tradeReviews: TradeReviewRecord[];
  historicalBarSets: HistoricalBarSet[];
  workspaceStateForSave: WorkspaceState;
  setAllowedSymbols: (symbols: string[]) => void;
  setHasExecutionProperty: (value: boolean) => void;
  setMessage: (message: string) => void;
  setSyncing: (syncing: boolean) => void;
  hydrateWorkspaceFromStores: () => Promise<void>;
  resetWorkspaceAfterImport: () => void;
  refreshWorkspaceAfterImport: () => void;
}

export interface SettingsPageActions {
  runConnectionTest: () => Promise<string>;
  handleLoadWorkspaceAttachmentSummary: () => Promise<WorkspaceAttachmentAuditResult | null>;
  handleAuditWorkspaceAttachments: () => Promise<string>;
  handlePruneWorkspaceAttachments: () => Promise<string>;
  handleExportWorkspaceBundle: () => Promise<string>;
  handleImportWorkspaceBundle: () => Promise<string>;
}

export const createSettingsPageActions = ({
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
}: CreateSettingsPageActionsOptions): SettingsPageActions => {
  const flushWorkspaceToLocalStores = async (): Promise<void> => {
    await requestFlushDebouncedSaves();
    await Promise.all([
      saveSettings(settings),
      saveTradeTagOptions(tradeTagOptions),
      saveTradeTagOverrides(tradeTagOverrides),
      saveTradeSessions(tradeSessions),
      saveJournalPages(journalPagesForSave)
    ]);

    await Promise.all([
      persistJournalChecklistTemplates(journalChecklistTemplates),
      saveTradeReviews(tradeReviews),
      persistHistoricalBarSets(historicalBarSets),
      persistWorkspaceState(workspaceStateForSave)
    ]);
    await waitForNextTask();
  };

  const buildWorkspaceTransferSnapshot = (): Record<string, unknown> => {
    const localStorageSnapshot = collectWorkspaceTransferLocalStorage();
    const {
      exportFolder: _exportFolder,
      workspaceExportStartDate: _workspaceExportStartDate,
      workspaceExportEndDate: _workspaceExportEndDate,
      workspaceExportSelectedDates: _workspaceExportSelectedDates,
      notionToken: _notionToken,
      twelveDataApiKey: _twelveDataApiKey,
      ...portableSettings
    } = settings;

    return {
      ...localStorageSnapshot,
      "trade-engine-settings": portableSettings,
      "trade-engine-trade-sessions": tradeSessions,
      "trade-engine-journal-pages": journalPagesForSave,
      "trade-engine-trade-tag-options": tradeTagOptions,
      "trade-engine-trade-tag-overrides": tradeTagOverrides,
      "trade-engine-trade-reviews": tradeReviews,
      "trade-engine-historical-bars": historicalBarSets,
      "trade-engine-journal-checklist-templates": journalChecklistTemplates,
      "trade-engine-workspace": workspaceStateForSave,
      "trade-engine-playbooks": loadPlaybooks(),
      "trade-engine-library-pages": loadLibraryPages(),
      "trade-engine-review-templates": loadReviewTemplates()
    };
  };

  const persistWorkspaceTransferSnapshotToStores = async (
    snapshot: Record<string, unknown>
  ): Promise<void> => {
    const importedSettings = toImportedSettings(snapshot[SETTINGS_STORAGE_KEY], settings);
    const tradeTagCatalog = isRecord(snapshot[TRADE_TAG_CATALOG_STORAGE_KEY])
      ? snapshot[TRADE_TAG_CATALOG_STORAGE_KEY]
      : {};

    await Promise.all([
      saveSettings(importedSettings),
      saveTradeSessions(asArray<TradeSessionRecord>(snapshot[TRADE_SESSIONS_STORAGE_KEY])),
      saveJournalPages(asArray<JournalPageRecord>(snapshot[JOURNAL_PAGES_STORAGE_KEY])),
      saveTradeTagOptions(
        isRecord(snapshot[TRADE_TAG_OPTIONS_STORAGE_KEY])
          ? (snapshot[TRADE_TAG_OPTIONS_STORAGE_KEY] as TradeTagOptionsRecord)
          : {}
      ),
      saveTradeTagOverrides(asArray<TradeTagOverrideRecord>(snapshot[TRADE_TAG_OVERRIDES_STORAGE_KEY])),
      saveTradeReviews(asArray<TradeReviewRecord>(snapshot[TRADE_REVIEWS_STORAGE_KEY])),
      persistHistoricalBarSets(asArray<HistoricalBarSet>(snapshot[HISTORICAL_BARS_STORAGE_KEY])),
      persistJournalChecklistTemplates(
        isRecord(snapshot[JOURNAL_TEMPLATES_STORAGE_KEY])
          ? (snapshot[JOURNAL_TEMPLATES_STORAGE_KEY] as unknown as JournalChecklistTemplates)
          : defaultJournalChecklistTemplates()
      ),
      persistWorkspaceState(
        isRecord(snapshot[WORKSPACE_STATE_STORAGE_KEY])
          ? (snapshot[WORKSPACE_STATE_STORAGE_KEY] as unknown as WorkspaceState)
          : defaultWorkspaceState
      ),
      savePlaybooks(asArray<PlaybookRecord>(snapshot[PLAYBOOKS_STORAGE_KEY])),
      saveLibraryPages(asArray<LibraryPageRecord>(snapshot[LIBRARY_PAGES_STORAGE_KEY])),
      persistHeadlinesRecord(
        isRecord(snapshot[HEADLINES_STORAGE_KEY])
          ? (snapshot[HEADLINES_STORAGE_KEY] as Record<string, HeadlineItem[]>)
          : {}
      ),
      persistSelectOptionAdditions(
        isRecord(snapshot[SELECT_OPTION_ADDITIONS_STORAGE_KEY])
          ? (snapshot[SELECT_OPTION_ADDITIONS_STORAGE_KEY] as SelectOptionAdditionsRecord)
          : {}
      ),
      persistReviewTemplates(
        isRecord(snapshot[REVIEW_TEMPLATES_STORAGE_KEY])
          ? (snapshot[REVIEW_TEMPLATES_STORAGE_KEY] as unknown as ReviewTemplates)
          : defaultReviewTemplates()
      ),
      syncStores.tradeTagCatalog.save(tradeTagCatalog)
    ]);

    if (isTauri() && canUseMachineLegacyData(syncStores.tradeTagCatalog.getUserId())) {
      try {
        await saveDesktopStoreBackup("trade-tag-catalog", tradeTagCatalog);
      } catch (error) {
        console.warn("[tags] Failed to save desktop trade tag catalog backup.", error);
      }
    }
  };

  const persistImportedWorkspaceToDesktopBackups = async (): Promise<void> => {
    await flushWorkspaceToLocalStores();
    await Promise.all([
      savePlaybooks(loadPlaybooks()),
      saveLibraryPages(loadLibraryPages()),
      persistReviewTemplates(loadReviewTemplates())
    ]);
    await waitForNextTask();
  };

  const buildWorkspaceAttachmentReferencePaths = async (): Promise<string[]> => {
    await flushWorkspaceToLocalStores();
    return extractWorkspaceAttachmentPaths(buildWorkspaceTransferSnapshot());
  };

  const loadWorkspaceAttachmentSummary = async (
    attachmentPaths?: string[]
  ): Promise<WorkspaceAttachmentAuditResult | null> => {
    if (!isTauri()) {
      return null;
    }

    const nextAttachmentPaths = attachmentPaths ?? (await buildWorkspaceAttachmentReferencePaths());
    return invoke<WorkspaceAttachmentAuditResult>("audit_workspace_attachments", {
      referencedPaths: nextAttachmentPaths
    });
  };

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

  const handleLoadWorkspaceAttachmentSummary = async (): Promise<WorkspaceAttachmentAuditResult | null> =>
    loadWorkspaceAttachmentSummary();

  const handleAuditWorkspaceAttachments = async (): Promise<string> => {
    if (!isTauri()) {
      return "Attachment audit only works in the desktop app.";
    }

    setSyncing(true);
    try {
      const result = await loadWorkspaceAttachmentSummary();
      if (!result) {
        return "Attachment audit only works in the desktop app.";
      }

      const message = `Workspace attachment audit complete. ${describeWorkspaceAttachmentAudit(result)}`;
      setMessage(message);
      return message;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Workspace attachment audit failed.";
      setMessage(errorMessage);
      return errorMessage;
    } finally {
      setSyncing(false);
    }
  };

  const handlePruneWorkspaceAttachments = async (): Promise<string> => {
    if (!isTauri()) {
      return "Attachment cleanup only works in the desktop app.";
    }

    setSyncing(true);
    try {
      const attachmentPaths = await buildWorkspaceAttachmentReferencePaths();
      const auditResult = await loadWorkspaceAttachmentSummary(attachmentPaths);
      if (!auditResult) {
        return "Attachment cleanup only works in the desktop app.";
      }

      if (auditResult.orphanedFileCount === 0) {
        const message = `Workspace attachment cleanup complete. ${describeWorkspaceAttachmentAudit(auditResult, { pruned: true })}`;
        setMessage(message);
        return message;
      }

      const shouldPrune = window.confirm(
        `Remove ${auditResult.orphanedFileCount} unused attachment${auditResult.orphanedFileCount === 1 ? "" : "s"} (${formatAttachmentBytes(auditResult.orphanedBytes)}) from the desktop workspace folder? Referenced files will be kept.`
      );
      if (!shouldPrune) {
        const canceledMessage = `Workspace attachment cleanup canceled. ${describeWorkspaceAttachmentAudit(auditResult)}`;
        setMessage(canceledMessage);
        return canceledMessage;
      }

      const pruneResult = await invoke<WorkspaceAttachmentAuditResult>("prune_workspace_attachments", {
        referencedPaths: attachmentPaths
      });
      const message = `Workspace attachment cleanup complete. ${describeWorkspaceAttachmentAudit(pruneResult, { pruned: true })}`;
      setMessage(message);
      return message;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Workspace attachment cleanup failed.";
      setMessage(errorMessage);
      return errorMessage;
    } finally {
      setSyncing(false);
    }
  };

  const handleExportWorkspaceBundle = async (): Promise<string> => {
    if (!isTauri()) {
      return "Workspace file export only works in the desktop app.";
    }

    if (!settings.exportFolder.trim()) {
      return "Choose an export destination in Send Workspace first.";
    }

    setSyncing(true);
    try {
      await flushWorkspaceToLocalStores();
      const preparedSnapshot = prepareWorkspaceTransferSnapshot(
        buildWorkspaceTransferSnapshot(),
        settings.workspaceExportStartDate,
        settings.workspaceExportEndDate,
        settings.workspaceExportSelectedDates
      );
      const attachmentPaths = extractWorkspaceAttachmentPaths(preparedSnapshot.localStorage);
      const result = await invoke<WorkspaceTransferExportResult>("export_workspace_bundle", {
        exportFolder: settings.exportFolder,
        fileName: createWorkspaceBundleFileName(
          preparedSnapshot.selectedDates,
          preparedSnapshot.startDate,
          preparedSnapshot.endDate
        ),
        bundle: {
          version: 1,
          exportedAt: new Date().toISOString(),
          source: "trade-engine-desktop",
          scope: preparedSnapshot.scope,
          startDate: preparedSnapshot.startDate,
          endDate: preparedSnapshot.endDate,
          selectedDates: preparedSnapshot.selectedDates,
          localStorage: preparedSnapshot.localStorage,
          attachments: []
        },
        attachmentPaths
      });

      const skippedCount = result.skippedAttachmentPaths.length;
      const scopeLabel = getWorkspaceTransferRangeLabel(
        preparedSnapshot.selectedDates,
        preparedSnapshot.startDate,
        preparedSnapshot.endDate
      );
      const resultMessage =
        skippedCount > 0
          ? `Workspace file saved to ${result.savedPath}${scopeLabel}. Included ${result.attachmentCount} attachments and skipped ${skippedCount} missing attachment reference${skippedCount === 1 ? "" : "s"}. Saved API keys were not included.`
          : `Workspace file saved to ${result.savedPath}${scopeLabel}. Included ${result.attachmentCount} attachment${result.attachmentCount === 1 ? "" : "s"}. Saved API keys were not included.`;
      setMessage(resultMessage);
      return resultMessage;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Workspace export failed.";
      setMessage(errorMessage);
      return errorMessage;
    } finally {
      setSyncing(false);
    }
  };

  const handleImportWorkspaceBundle = async (): Promise<string> => {
    if (!isTauri()) {
      return "Workspace file import only works in the desktop app.";
    }

    setSyncing(true);
    try {
      const selectedPath = await invoke<string | null>("pick_workspace_bundle_file");
      if (!selectedPath) {
        return "No workspace file selected.";
      }

      const preview = await invoke<WorkspaceTransferBundlePreview>("preview_workspace_bundle", {
        path: selectedPath
      });
      const shouldImport = window.confirm(buildWorkspaceImportConfirmationMessage(preview));
      if (!shouldImport) {
        const canceledMessage = "Workspace import canceled.";
        setMessage(canceledMessage);
        return canceledMessage;
      }

      await flushWorkspaceToLocalStores();

      const result = await invoke<WorkspaceTransferImportResult>("import_workspace_bundle", {
        path: selectedPath
      });

      const appliedSnapshot = buildAppliedWorkspaceTransferSnapshot(result.bundle);
      resetAllSyncStoreMemory();
      await persistWorkspaceTransferSnapshotToStores(appliedSnapshot);
      applyWorkspaceTransferBundle(result.bundle);
      resetWorkspaceAfterImport();
      await hydrateWorkspaceFromStores();
      await persistImportedWorkspaceToDesktopBackups();
      refreshWorkspaceAfterImport();

      const skippedCount = result.skippedAttachmentPaths.length;
      const wasIncremental =
        result.bundle.scope === "since-date" ||
        result.bundle.scope === "date-range" ||
        result.bundle.scope === "selected-dates";
      const scopeLabel = wasIncremental
        ? getWorkspaceTransferRangeLabel(
            result.bundle.selectedDates,
            result.bundle.startDate,
            result.bundle.endDate
          )
        : "";
      const resultMessage =
        skippedCount > 0
          ? `${wasIncremental ? "Workspace updates merged" : "Workspace imported"} from ${selectedPath}${scopeLabel}. Restored ${result.restoredAttachmentCount} attachments and skipped ${skippedCount} missing attachment reference${skippedCount === 1 ? "" : "s"}. This machine kept its saved API keys.`
          : `${wasIncremental ? "Workspace updates merged" : "Workspace imported"} from ${selectedPath}${scopeLabel}. Restored ${result.restoredAttachmentCount} attachment${result.restoredAttachmentCount === 1 ? "" : "s"}. This machine kept its saved API keys.`;
      setMessage(resultMessage);
      return resultMessage;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Workspace import failed.";
      setMessage(errorMessage);
      return errorMessage;
    } finally {
      setSyncing(false);
    }
  };

  return {
    runConnectionTest,
    handleLoadWorkspaceAttachmentSummary,
    handleAuditWorkspaceAttachments,
    handlePruneWorkspaceAttachments,
    handleExportWorkspaceBundle,
    handleImportWorkspaceBundle
  };
};
