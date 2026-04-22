import { invoke, isTauri } from "@tauri-apps/api/core";
import type { TradeTagOverrideRecord } from "../../types/tradeTags";
import { syncStores } from "../sync/syncStore";

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

const loadTradeTagOverridesFromDesktopBackup = async (): Promise<TradeTagOverrideRecord[] | null> => {
  if (!isTauri()) {
    return null;
  }

  try {
    const overrides = await invoke<TradeTagOverrideRecord[]>("load_trade_tag_overrides");
    const normalized = Array.isArray(overrides) ? overrides : [];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    return normalized;
  } catch {
    return null;
  }
};

export const loadTradeTagOverrides = async (): Promise<TradeTagOverrideRecord[]> => {
  const localOverrides = loadTradeTagOverridesFromLocalStorage();
  if (!isTauri()) {
    return localOverrides;
  }

  const localRaw = localStorage.getItem(STORAGE_KEY);
  if (!localRaw || localOverrides.length === 0) {
    const desktopOverrides = await loadTradeTagOverridesFromDesktopBackup();
    if (desktopOverrides && desktopOverrides.length > 0) {
      return desktopOverrides;
    }
  }

  return localOverrides;
};

export const saveTradeTagOverrides = async (
  overrides: TradeTagOverrideRecord[]
): Promise<void> => {
  await syncStores.tradeTagOverrides.save(overrides);

  if (isTauri()) {
    await invoke("save_trade_tag_overrides", { overrides });
  }
};
