import { invoke, isTauri } from "@tauri-apps/api/core";
import type { TradeTagOverrideRecord } from "../../types/tradeTags";

const STORAGE_KEY = "trade-engine-trade-tag-overrides";

const loadTradeTagOverridesFromLocalStorage = (): TradeTagOverrideRecord[] => {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as TradeTagOverrideRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const loadTradeTagOverrides = async (): Promise<TradeTagOverrideRecord[]> => {
  if (isTauri()) {
    try {
      const overrides = await invoke<TradeTagOverrideRecord[]>("load_trade_tag_overrides");
      return Array.isArray(overrides) ? overrides : [];
    } catch {
      return loadTradeTagOverridesFromLocalStorage();
    }
  }

  return loadTradeTagOverridesFromLocalStorage();
};

export const saveTradeTagOverrides = async (
  overrides: TradeTagOverrideRecord[]
): Promise<void> => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));

  if (isTauri()) {
    await invoke("save_trade_tag_overrides", { overrides });
  }
};
