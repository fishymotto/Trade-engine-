import { invoke, isTauri } from "@tauri-apps/api/core";
import type { Settings } from "../../types/trade";
import { canUseMachineLegacyData, syncStores } from "../sync/syncStore";

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

export const defaultSettings: Settings = {
  notionToken: "",
  notionDatabaseUrl: "",
  exportFolder: "",
  twelveDataApiKey: "",
  brlToUsdRate: 0,
  brlTickerList: DEFAULT_BRL_TICKER_LIST,
  dailyShutdownRiskUsd: 0,
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

export type SyncedSettings = Omit<Settings, "exportFolder">;

interface MachineSettings {
  exportFolder: string;
}

const toSyncedSettings = (settings: Settings): SyncedSettings => {
  const { exportFolder: _exportFolder, ...syncedSettings } = settings;
  return syncedSettings;
};

export const defaultSyncedSettings: SyncedSettings = toSyncedSettings(defaultSettings);

const loadMachineSettings = (): MachineSettings => {
  const fallback: MachineSettings = { exportFolder: "" };

  try {
    const raw = localStorage.getItem(MACHINE_SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<MachineSettings>;
      return {
        exportFolder: typeof parsed.exportFolder === "string" ? parsed.exportFolder : ""
      };
    }

    const legacyRaw = localStorage.getItem(STORAGE_KEY);
    if (legacyRaw) {
      const legacy = JSON.parse(legacyRaw) as Partial<Settings>;
      return {
        exportFolder: typeof legacy.exportFolder === "string" ? legacy.exportFolder : ""
      };
    }
  } catch {
    return fallback;
  }

  return fallback;
};

const saveMachineSettings = (settings: MachineSettings): void => {
  localStorage.setItem(MACHINE_SETTINGS_KEY, JSON.stringify(settings));
};

export const migrateSettingsCacheToSyncedShape = (): void => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return;
    }

    const parsed = JSON.parse(raw) as Partial<Settings>;
    if (!("exportFolder" in parsed)) {
      return;
    }

    if (typeof parsed.exportFolder === "string" && parsed.exportFolder.trim()) {
      saveMachineSettings({ exportFolder: parsed.exportFolder });
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSyncedSettings(normalizeSettings(parsed))));
  } catch {
    // Leave the cache alone if it cannot be parsed; normal loading will fall back safely.
  }
};

const normalizeSettings = (settings: Partial<Settings>): Settings => ({
  ...defaultSettings,
  ...settings,
  brlTickerList: settings.brlTickerList?.trim() ? settings.brlTickerList : DEFAULT_BRL_TICKER_LIST,
  dailyShutdownRiskUsd: Number(settings.dailyShutdownRiskUsd) || 0,
  tradeTagVisibility: {
    ...defaultSettings.tradeTagVisibility,
    ...(settings.tradeTagVisibility ?? {})
  }
});

const loadSettingsFromLocalStorage = (): Settings => {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return defaultSettings;
  }

  try {
    return normalizeSettings(JSON.parse(raw) as Partial<Settings>);
  } catch {
    return defaultSettings;
  }
};

const loadSettingsFromDesktopBackup = async (): Promise<Settings | null> => {
  if (!isTauri()) {
    return null;
  }

  try {
    const settings = await invoke<Partial<Settings>>("load_app_settings");
    const normalized = normalizeSettings(settings);
    if (normalized.exportFolder) {
      saveMachineSettings({ exportFolder: normalized.exportFolder });
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSyncedSettings(normalized)));
    return normalized;
  } catch {
    return null;
  }
};

const hasMeaningfulLocalSettings = (settings: Settings, machineSettings: MachineSettings): boolean => {
  if (machineSettings.exportFolder.trim().length > 0) {
    return true;
  }

  const localSynced = toSyncedSettings(settings);
  return JSON.stringify(localSynced) !== JSON.stringify(defaultSyncedSettings);
};

export const loadSettings = async (): Promise<Settings> => {
  const machineSettings = loadMachineSettings();
  const localSettings = loadSettingsFromLocalStorage();
  const localRaw = localStorage.getItem(STORAGE_KEY);
  const activeUserId = syncStores.settings.getUserId();
  const allowLegacyDesktopBackup = canUseMachineLegacyData(activeUserId);

  if (!isTauri()) {
    return {
      ...localSettings,
      exportFolder: machineSettings.exportFolder
    };
  }

  if (localRaw && hasMeaningfulLocalSettings(localSettings, machineSettings)) {
    return {
      ...localSettings,
      exportFolder: machineSettings.exportFolder
    };
  }

  if (!allowLegacyDesktopBackup) {
    return {
      ...localSettings,
      exportFolder: machineSettings.exportFolder
    };
  }

  const desktopSettings = await loadSettingsFromDesktopBackup();
  if (desktopSettings) {
    return {
      ...desktopSettings,
      exportFolder: desktopSettings.exportFolder || machineSettings.exportFolder
    };
  }

  return {
    ...localSettings,
    exportFolder: machineSettings.exportFolder
  };
};

export const saveSettings = async (settings: Settings): Promise<void> => {
  saveMachineSettings({ exportFolder: settings.exportFolder });
  await syncStores.settings.save(toSyncedSettings(settings));

  if (isTauri()) {
    await invoke("save_app_settings", { settings });
  }
};
