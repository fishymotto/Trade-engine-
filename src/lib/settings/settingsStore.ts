import { invoke, isTauri } from "@tauri-apps/api/core";
import type { Settings } from "../../types/trade";
import { canUseMachineLegacyData, syncStores } from "../sync/syncStore";
import { readLocalStorageItem, writeLocalStorageItem } from "../storage/localStorage";
import {
  DEFAULT_CURRENCY_SYMBOL_LIST,
  normalizeCurrencySymbolList
} from "../trades/assetClassification";

const STORAGE_KEY = "trade-engine-settings";
const MACHINE_SETTINGS_KEY = "trade-engine-machine-settings";

export const DEFAULT_BRL_TICKER_LIST = [
  "BBAS3",
  "ITSA4",
  "BBDC4",
  "VALE3",
  "ASAI3",
  "CEAB3",
  "ABEV3",
  "PETR4",
  "PRIO3",
  "CSAN3",
  "BRAV3",
  "RECV3",
  "COGN3",
  "AMBP3",
  "GGPS3",
  "WEGE3",
  "EMBJ3",
  "HAPV3"
].join(", ");

export const DEFAULT_MPP_LOCK_IN_STEPS = [5, 10, 20, 30, 40, 50] as const;

export const defaultSettings: Settings = {
  notionToken: "",
  notionDatabaseUrl: "",
  exportFolder: "",
  workspaceExportStartDate: "",
  workspaceExportEndDate: "",
  workspaceExportSelectedDates: [],
  workspaceTransferLastExportedAt: "",
  workspaceTransferLastImportedAt: "",
  twelveDataApiKey: "",
  brlToUsdRate: 0,
  brlTickerList: DEFAULT_BRL_TICKER_LIST,
  currencySymbolList: DEFAULT_CURRENCY_SYMBOL_LIST,
  dailyShutdownRiskUsd: 0,
  currencyDailyShutdownRiskUsd: 0,
  mppLockInSteps: [...DEFAULT_MPP_LOCK_IN_STEPS],
  desktopBackupIntervalMinutes: 0,
  tradeTagVisibility: {
    status: true,
    mistake: true,
    playbook: true,
    catalyst: true,
    game: true,
    outTag: true,
    execution: true
  }
};

export type SyncedSettings = Omit<
  Settings,
  | "exportFolder"
  | "workspaceExportStartDate"
  | "workspaceExportEndDate"
  | "workspaceExportSelectedDates"
  | "workspaceTransferLastExportedAt"
  | "workspaceTransferLastImportedAt"
>;

interface MachineSettings {
  exportFolder: string;
  workspaceExportStartDate: string;
  workspaceExportEndDate: string;
  workspaceExportSelectedDates: string[];
  workspaceTransferLastExportedAt: string;
  workspaceTransferLastImportedAt: string;
}

export const toSyncedSettings = (settings: Settings): SyncedSettings => {
  const {
    exportFolder: _exportFolder,
    workspaceExportStartDate: _workspaceExportStartDate,
    workspaceExportEndDate: _workspaceExportEndDate,
    workspaceExportSelectedDates: _workspaceExportSelectedDates,
    workspaceTransferLastExportedAt: _workspaceTransferLastExportedAt,
    workspaceTransferLastImportedAt: _workspaceTransferLastImportedAt,
    ...syncedSettings
  } = settings;
  return syncedSettings;
};

export const defaultSyncedSettings: SyncedSettings = toSyncedSettings(defaultSettings);

const normalizeBackupIntervalMinutes = (value: unknown): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }

  return Math.min(60 * 24 * 30, Math.round(parsed));
};

const normalizeMppLockInSteps = (value: unknown): number[] => {
  const normalizedSteps: number[] = [];

  if (Array.isArray(value)) {
    for (const entry of value) {
      const parsed = Number(entry);
      const normalized = Math.round(Math.abs(parsed));
      if (!Number.isFinite(normalized) || normalized <= 0 || normalizedSteps.includes(normalized)) {
        continue;
      }

      normalizedSteps.push(normalized);
      if (normalizedSteps.length >= DEFAULT_MPP_LOCK_IN_STEPS.length) {
        break;
      }
    }
  }

  for (const fallbackStep of DEFAULT_MPP_LOCK_IN_STEPS) {
    if (normalizedSteps.includes(fallbackStep)) {
      continue;
    }

    normalizedSteps.push(fallbackStep);
    if (normalizedSteps.length >= DEFAULT_MPP_LOCK_IN_STEPS.length) {
      break;
    }
  }

  return normalizedSteps;
};

const normalizeWorkspaceExportStartDate = (value: unknown): string => {
  if (typeof value !== "string") {
    return "";
  }

  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : "";
};

const normalizeWorkspaceExportEndDate = (value: unknown): string => {
  if (typeof value !== "string") {
    return "";
  }

  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : "";
};

const normalizeWorkspaceExportSelectedDates = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const unique = new Set<string>();
  const normalized: string[] = [];

  for (const entry of value) {
    const nextDate = normalizeWorkspaceExportStartDate(entry);
    if (!nextDate || unique.has(nextDate)) {
      continue;
    }

    unique.add(nextDate);
    normalized.push(nextDate);
  }

  return normalized.sort();
};

const normalizeWorkspaceTransferTimestamp = (value: unknown): string => {
  if (typeof value !== "string") {
    return "";
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
};

const loadMachineSettings = (): MachineSettings => {
  const fallback: MachineSettings = {
    exportFolder: "",
    workspaceExportStartDate: "",
    workspaceExportEndDate: "",
    workspaceExportSelectedDates: [],
    workspaceTransferLastExportedAt: "",
    workspaceTransferLastImportedAt: ""
  };

  try {
    const raw = readLocalStorageItem(MACHINE_SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<MachineSettings>;
      return {
        exportFolder: typeof parsed.exportFolder === "string" ? parsed.exportFolder : "",
        workspaceExportStartDate: normalizeWorkspaceExportStartDate(parsed.workspaceExportStartDate),
        workspaceExportEndDate: normalizeWorkspaceExportEndDate(parsed.workspaceExportEndDate),
        workspaceExportSelectedDates: normalizeWorkspaceExportSelectedDates(
          parsed.workspaceExportSelectedDates
        ),
        workspaceTransferLastExportedAt: normalizeWorkspaceTransferTimestamp(
          parsed.workspaceTransferLastExportedAt
        ),
        workspaceTransferLastImportedAt: normalizeWorkspaceTransferTimestamp(
          parsed.workspaceTransferLastImportedAt
        )
      };
    }

    const legacyRaw = readLocalStorageItem(STORAGE_KEY);
    if (legacyRaw) {
      const legacy = JSON.parse(legacyRaw) as Partial<Settings>;
      return {
        exportFolder: typeof legacy.exportFolder === "string" ? legacy.exportFolder : "",
        workspaceExportStartDate: normalizeWorkspaceExportStartDate(legacy.workspaceExportStartDate),
        workspaceExportEndDate: normalizeWorkspaceExportEndDate(legacy.workspaceExportEndDate),
        workspaceExportSelectedDates: normalizeWorkspaceExportSelectedDates(
          legacy.workspaceExportSelectedDates
        ),
        workspaceTransferLastExportedAt: normalizeWorkspaceTransferTimestamp(
          legacy.workspaceTransferLastExportedAt
        ),
        workspaceTransferLastImportedAt: normalizeWorkspaceTransferTimestamp(
          legacy.workspaceTransferLastImportedAt
        )
      };
    }
  } catch {
    return fallback;
  }

  return fallback;
};

const saveMachineSettings = (settings: MachineSettings): void => {
  writeLocalStorageItem(MACHINE_SETTINGS_KEY, JSON.stringify(settings), {
    label: "machine settings",
    suppressQuotaWarning: isTauri()
  });
};

export const migrateSettingsCacheToSyncedShape = (): void => {
  try {
    const raw = readLocalStorageItem(STORAGE_KEY);
    if (!raw) {
      return;
    }

    const parsed = JSON.parse(raw) as Partial<Settings>;
    if (!("exportFolder" in parsed)) {
      return;
    }

    if (typeof parsed.exportFolder === "string" && parsed.exportFolder.trim()) {
      saveMachineSettings({
        exportFolder: parsed.exportFolder,
        workspaceExportStartDate: normalizeWorkspaceExportStartDate(parsed.workspaceExportStartDate),
        workspaceExportEndDate: normalizeWorkspaceExportEndDate(parsed.workspaceExportEndDate),
        workspaceExportSelectedDates: normalizeWorkspaceExportSelectedDates(
          parsed.workspaceExportSelectedDates
        ),
        workspaceTransferLastExportedAt: normalizeWorkspaceTransferTimestamp(
          parsed.workspaceTransferLastExportedAt
        ),
        workspaceTransferLastImportedAt: normalizeWorkspaceTransferTimestamp(
          parsed.workspaceTransferLastImportedAt
        )
      });
    }

    writeLocalStorageItem(STORAGE_KEY, JSON.stringify(toSyncedSettings(normalizeSettings(parsed))), {
      label: "synced settings cache"
    });
  } catch {
    // Leave the cache alone if it cannot be parsed; normal loading will fall back safely.
  }
};

const normalizeSettings = (settings: Partial<Settings>): Settings => ({
  ...defaultSettings,
  ...settings,
  brlTickerList: settings.brlTickerList?.trim() ? settings.brlTickerList : DEFAULT_BRL_TICKER_LIST,
  currencySymbolList: normalizeCurrencySymbolList(settings.currencySymbolList),
  workspaceExportStartDate: normalizeWorkspaceExportStartDate(settings.workspaceExportStartDate),
  workspaceExportEndDate: normalizeWorkspaceExportEndDate(settings.workspaceExportEndDate),
  workspaceExportSelectedDates: normalizeWorkspaceExportSelectedDates(
    settings.workspaceExportSelectedDates
  ),
  workspaceTransferLastExportedAt: normalizeWorkspaceTransferTimestamp(
    settings.workspaceTransferLastExportedAt
  ),
  workspaceTransferLastImportedAt: normalizeWorkspaceTransferTimestamp(
    settings.workspaceTransferLastImportedAt
  ),
  dailyShutdownRiskUsd: Number(settings.dailyShutdownRiskUsd) || 0,
  currencyDailyShutdownRiskUsd: Number(settings.currencyDailyShutdownRiskUsd) || 0,
  mppLockInSteps: normalizeMppLockInSteps(settings.mppLockInSteps),
  desktopBackupIntervalMinutes: normalizeBackupIntervalMinutes(settings.desktopBackupIntervalMinutes),
  tradeTagVisibility: {
    ...defaultSettings.tradeTagVisibility,
    ...(settings.tradeTagVisibility ?? {})
  }
});

const loadSettingsFromLocalStorage = (): Settings => {
  return normalizeSettings(syncStores.settings.load<Partial<Settings>>(defaultSyncedSettings));
};

const loadSettingsFromDesktopBackup = async (): Promise<Settings | null> => {
  if (!isTauri()) {
    return null;
  }

  try {
    const settings = await invoke<Partial<Settings>>("load_app_settings");
    const normalized = normalizeSettings(settings);
    saveMachineSettings({
      exportFolder: normalized.exportFolder,
      workspaceExportStartDate: normalized.workspaceExportStartDate,
      workspaceExportEndDate: normalized.workspaceExportEndDate,
      workspaceExportSelectedDates: normalized.workspaceExportSelectedDates,
      workspaceTransferLastExportedAt: normalized.workspaceTransferLastExportedAt,
      workspaceTransferLastImportedAt: normalized.workspaceTransferLastImportedAt
    });
    writeLocalStorageItem(STORAGE_KEY, JSON.stringify(toSyncedSettings(normalized)), {
      label: "synced settings cache"
    });
    return normalized;
  } catch {
    return null;
  }
};

const hasMeaningfulLocalSettings = (settings: Settings, machineSettings: MachineSettings): boolean => {
  if (
    machineSettings.exportFolder.trim().length > 0 ||
    machineSettings.workspaceExportStartDate.trim().length > 0 ||
    machineSettings.workspaceExportEndDate.trim().length > 0 ||
    machineSettings.workspaceExportSelectedDates.length > 0 ||
    machineSettings.workspaceTransferLastExportedAt.trim().length > 0 ||
    machineSettings.workspaceTransferLastImportedAt.trim().length > 0
  ) {
    return true;
  }

  const localSynced = toSyncedSettings(settings);
  return JSON.stringify(localSynced) !== JSON.stringify(defaultSyncedSettings);
};

export const loadSettings = async (): Promise<Settings> => {
  const machineSettings = loadMachineSettings();
  const localSettings = loadSettingsFromLocalStorage();
  const localRaw = readLocalStorageItem(STORAGE_KEY);
  const activeUserId = syncStores.settings.getUserId();
  const allowLegacyDesktopBackup = canUseMachineLegacyData(activeUserId);

  if (!isTauri()) {
    return {
      ...localSettings,
      exportFolder: machineSettings.exportFolder,
      workspaceExportStartDate: machineSettings.workspaceExportStartDate,
      workspaceExportEndDate: machineSettings.workspaceExportEndDate,
      workspaceExportSelectedDates: machineSettings.workspaceExportSelectedDates,
      workspaceTransferLastExportedAt: machineSettings.workspaceTransferLastExportedAt,
      workspaceTransferLastImportedAt: machineSettings.workspaceTransferLastImportedAt
    };
  }

  if (localRaw && hasMeaningfulLocalSettings(localSettings, machineSettings)) {
    return {
      ...localSettings,
      exportFolder: machineSettings.exportFolder,
      workspaceExportStartDate: machineSettings.workspaceExportStartDate,
      workspaceExportEndDate: machineSettings.workspaceExportEndDate,
      workspaceExportSelectedDates: machineSettings.workspaceExportSelectedDates,
      workspaceTransferLastExportedAt: machineSettings.workspaceTransferLastExportedAt,
      workspaceTransferLastImportedAt: machineSettings.workspaceTransferLastImportedAt
    };
  }

  if (!allowLegacyDesktopBackup) {
    return {
      ...localSettings,
      exportFolder: machineSettings.exportFolder,
      workspaceExportStartDate: machineSettings.workspaceExportStartDate,
      workspaceExportEndDate: machineSettings.workspaceExportEndDate,
      workspaceExportSelectedDates: machineSettings.workspaceExportSelectedDates,
      workspaceTransferLastExportedAt: machineSettings.workspaceTransferLastExportedAt,
      workspaceTransferLastImportedAt: machineSettings.workspaceTransferLastImportedAt
    };
  }

  const desktopSettings = await loadSettingsFromDesktopBackup();
  if (desktopSettings) {
    return {
      ...desktopSettings,
      exportFolder: desktopSettings.exportFolder || machineSettings.exportFolder,
      workspaceExportStartDate: desktopSettings.workspaceExportStartDate || machineSettings.workspaceExportStartDate,
      workspaceExportEndDate: desktopSettings.workspaceExportEndDate || machineSettings.workspaceExportEndDate,
      workspaceExportSelectedDates:
        desktopSettings.workspaceExportSelectedDates.length > 0
          ? desktopSettings.workspaceExportSelectedDates
          : machineSettings.workspaceExportSelectedDates,
      workspaceTransferLastExportedAt:
        desktopSettings.workspaceTransferLastExportedAt || machineSettings.workspaceTransferLastExportedAt,
      workspaceTransferLastImportedAt:
        desktopSettings.workspaceTransferLastImportedAt || machineSettings.workspaceTransferLastImportedAt
    };
  }

  return {
    ...localSettings,
    exportFolder: machineSettings.exportFolder,
    workspaceExportStartDate: machineSettings.workspaceExportStartDate,
    workspaceExportEndDate: machineSettings.workspaceExportEndDate,
    workspaceExportSelectedDates: machineSettings.workspaceExportSelectedDates,
    workspaceTransferLastExportedAt: machineSettings.workspaceTransferLastExportedAt,
    workspaceTransferLastImportedAt: machineSettings.workspaceTransferLastImportedAt
  };
};

export const saveSettings = async (settings: Settings): Promise<void> => {
  saveMachineSettings({
    exportFolder: settings.exportFolder,
    workspaceExportStartDate: settings.workspaceExportStartDate,
    workspaceExportEndDate: settings.workspaceExportEndDate,
    workspaceExportSelectedDates: settings.workspaceExportSelectedDates,
    workspaceTransferLastExportedAt: settings.workspaceTransferLastExportedAt,
    workspaceTransferLastImportedAt: settings.workspaceTransferLastImportedAt
  });
  const syncPromise = syncStores.settings.save(toSyncedSettings(settings));

  if (isTauri()) {
    await invoke("save_app_settings", { settings });
  }

  await syncPromise;
};
