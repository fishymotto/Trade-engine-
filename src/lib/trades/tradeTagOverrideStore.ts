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

export const loadTradeTagOverrides = async (): Promise<TradeTagOverrideRecord[]> => {
  const localRaw = localStorage.getItem(STORAGE_KEY);
  if (localRaw || !isTauri()) {
    return loadTradeTagOverridesFromLocalStorage();
  }

  try {
    const overrides = await invoke<TradeTagOverrideRecord[]>("load_trade_tag_overrides");
    const normalized = Array.isArray(overrides) ? overrides : [];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    return normalized;
  } catch {
    return loadTradeTagOverridesFromLocalStorage();
  }
};

export const saveTradeTagOverrides = async (
  overrides: TradeTagOverrideRecord[]
): Promise<void> => {
  await syncStores.tradeTagOverrides.save(overrides);

  if (isTauri()) {
    await invoke("save_trade_tag_overrides", { overrides });
  }
};
