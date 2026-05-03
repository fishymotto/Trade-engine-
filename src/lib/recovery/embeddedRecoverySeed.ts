import journalPagesSeed from "../../recovery/journal-pages.recovered.json";
import tradeSessionsSeed from "../../recovery/trade-sessions.recovered.json";
import tradeTagOverridesSeed from "../../recovery/trade-tag-overrides.recovered.json";
import type { JournalPageRecord } from "../../types/journal";
import type { TradeSessionRecord } from "../../types/session";
import type { TradeTagOverrideRecord } from "../../types/tradeTags";

const normalizeArray = <T>(value: unknown): T[] => {
  if (Array.isArray(value)) {
    return value as T[];
  }

  if (
    value &&
    typeof value === "object" &&
    "value" in value &&
    Array.isArray((value as { value?: unknown }).value)
  ) {
    return (value as { value: T[] }).value;
  }

  return [];
};

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export const loadEmbeddedJournalPagesSeed = (): JournalPageRecord[] =>
  clone(normalizeArray<JournalPageRecord>(journalPagesSeed));

export const loadEmbeddedTradeSessionsSeed = (): TradeSessionRecord[] =>
  clone(normalizeArray<TradeSessionRecord>(tradeSessionsSeed));

export const loadEmbeddedTradeTagOverridesSeed = (): TradeTagOverrideRecord[] =>
  clone(normalizeArray<TradeTagOverrideRecord>(tradeTagOverridesSeed));

