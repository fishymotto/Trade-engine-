import { invoke, isTauri } from "@tauri-apps/api/core";
import type { Settings } from "../../types/trade";

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
  tradeTagVisibility: {
    status: true,
    mistake: true,
    playbook: true,
    game: true,
    outTag: true,
    execution: true
  }
};

const normalizeSettings = (settings: Partial<Settings>): Settings => ({
  ...defaultSettings,
  ...settings,
  brlTickerList: settings.brlTickerList?.trim() ? settings.brlTickerList : DEFAULT_BRL_TICKER_LIST,
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
  if (isTauri()) {
    try {
      const settings = await invoke<Partial<Settings>>("load_app_settings");
      return normalizeSettings(settings);
    } catch {
      return loadSettingsFromLocalStorage();
    }
  }

  return loadSettingsFromLocalStorage();
};

export const saveSettings = async (settings: Settings): Promise<void> => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));

  if (isTauri()) {
    await invoke("save_app_settings", { settings });
  }
};
