import { invoke, isTauri } from "@tauri-apps/api/core";
import type { Settings } from "../../types/trade";
import { syncStores } from "../sync/syncStore";

const STORAGE_KEY = "trade-engine-settings";

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

export const loadSettings = async (): Promise<Settings> => {
  const localRaw = localStorage.getItem(STORAGE_KEY);
  if (localRaw) {
    return loadSettingsFromLocalStorage();
  }

  if (!isTauri()) {
    return loadSettingsFromLocalStorage();
  }

  try {
    const settings = await invoke<Partial<Settings>>("load_app_settings");
    const normalized = normalizeSettings(settings);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    return normalized;
  } catch {
    return loadSettingsFromLocalStorage();
  }
};

export const saveSettings = async (settings: Settings): Promise<void> => {
  await syncStores.settings.save(settings);

  if (isTauri()) {
    await invoke("save_app_settings", { settings });
  }
};
