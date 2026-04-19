import { invoke, isTauri } from "@tauri-apps/api/core";
import type { EditableTradeTagField, TradeTagOptionsRecord } from "../../types/tradeTags";
import { syncStores } from "../sync/syncStore";

const STORAGE_KEY = "trade-engine-trade-tag-options";

const normalizeTradeTagOptions = (value: unknown): TradeTagOptionsRecord => {
  if (!value || typeof value !== "object") {
    return {};
  }

  const record = value as Partial<Record<EditableTradeTagField, unknown>>;
  const normalized: TradeTagOptionsRecord = {};

  (["status", "mistake", "playbook", "game", "outTag", "execution"] as EditableTradeTagField[]).forEach(
    (field) => {
      const fieldValue = record[field];
      if (!Array.isArray(fieldValue)) {
        return;
      }

      normalized[field] = fieldValue.filter(
        (option): option is string => typeof option === "string" && option.trim().length > 0
      );
    }
  );

  return normalized;
};

const loadTradeTagOptionsFromLocalStorage = (): TradeTagOptionsRecord => {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return {};
  }

  try {
    return normalizeTradeTagOptions(JSON.parse(raw));
  } catch {
    return {};
  }
};

export const loadTradeTagOptions = async (): Promise<TradeTagOptionsRecord> => {
  const localRaw = localStorage.getItem(STORAGE_KEY);
  if (localRaw || !isTauri()) {
    return loadTradeTagOptionsFromLocalStorage();
  }

  try {
    const options = await invoke<TradeTagOptionsRecord>("load_trade_tag_options");
    const normalized = normalizeTradeTagOptions(options);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    return normalized;
  } catch {
    return loadTradeTagOptionsFromLocalStorage();
  }
};

export const saveTradeTagOptions = async (options: TradeTagOptionsRecord): Promise<void> => {
  await syncStores.tradeTagOptions.save(options);

  if (isTauri()) {
    await invoke("save_trade_tag_options", { options });
  }
};
