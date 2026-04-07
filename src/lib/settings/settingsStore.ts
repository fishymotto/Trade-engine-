import { invoke, isTauri } from "@tauri-apps/api/core";
import type { Settings } from "../../types/trade";

const STORAGE_KEY = "trade-engine-settings";

export const defaultSettings: Settings = {
  notionToken: "",
  notionDatabaseUrl: "",
  exportFolder: "",
  twelveDataApiKey: ""
};

const loadSettingsFromLocalStorage = (): Settings => {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return defaultSettings;
  }

  try {
    return {
      ...defaultSettings,
      ...(JSON.parse(raw) as Partial<Settings>)
    };
  } catch {
    return defaultSettings;
  }
};

export const loadSettings = async (): Promise<Settings> => {
  if (isTauri()) {
    try {
      const settings = await invoke<Partial<Settings>>("load_app_settings");
      return {
        ...defaultSettings,
        ...settings
      };
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
