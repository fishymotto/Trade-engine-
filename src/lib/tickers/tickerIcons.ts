import airlinesTravelIcon from "../../assets/tickers/sector-airlines-travel.png";
import cryptoMinersIcon from "../../assets/tickers/sector-crypto-miners.png";
import energyIcon from "../../assets/tickers/sector-energy.png";
import financialsIcon from "../../assets/tickers/sector-financials.png";
import healthcareIcon from "../../assets/tickers/sector-healthcare.png";
import materialsMiningIcon from "../../assets/tickers/sector-materials-mining.png";
import socialConsumerAppsIcon from "../../assets/tickers/sector-social-consumer-apps.png";
import technologyIcon from "../../assets/tickers/sector-technology.png";
import type { LibraryPageRecord } from "../../types/library";
import { loadLibraryPages } from "../library/libraryStore";

export type TickerSector = string;

export type TickerGroupIconPresetKey =
  | "sector-airlines-travel"
  | "sector-crypto-miners"
  | "sector-energy"
  | "sector-financials"
  | "sector-healthcare"
  | "sector-materials-mining"
  | "sector-social-consumer-apps"
  | "sector-technology";

export const tickerGroupIconPresets: Record<TickerGroupIconPresetKey, string> = {
  "sector-airlines-travel": airlinesTravelIcon,
  "sector-crypto-miners": cryptoMinersIcon,
  "sector-energy": energyIcon,
  "sector-financials": financialsIcon,
  "sector-healthcare": healthcareIcon,
  "sector-materials-mining": materialsMiningIcon,
  "sector-social-consumer-apps": socialConsumerAppsIcon,
  "sector-technology": technologyIcon
};

export const tickerGroupIconPresetOptions: Array<{
  key: TickerGroupIconPresetKey;
  label: string;
}> = [
  { key: "sector-airlines-travel", label: "Air Travel" },
  { key: "sector-energy", label: "Gas / Oil" },
  { key: "sector-materials-mining", label: "Metals" },
  { key: "sector-financials", label: "Finance" },
  { key: "sector-healthcare", label: "Pharma" },
  { key: "sector-social-consumer-apps", label: "Social Media" },
  { key: "sector-technology", label: "Technology" },
  { key: "sector-crypto-miners", label: "Crypto Miners" }
];

const PRESET_PREFIX = "preset:";
const TICKER_GROUP_COLLECTION_ID = "ticker-groups";

export const resolveTickerGroupIcon = (iconValue: string | undefined): string | undefined => {
  if (!iconValue) {
    return undefined;
  }

  const trimmed = iconValue.trim();
  if (!trimmed) {
    return undefined;
  }

  if (trimmed.startsWith("data:")) {
    return trimmed;
  }

  if (trimmed.startsWith(PRESET_PREFIX)) {
    const presetKey = trimmed.slice(PRESET_PREFIX.length) as TickerGroupIconPresetKey;
    return tickerGroupIconPresets[presetKey];
  }

  return undefined;
};

type TickerGroupResolved = {
  groupId: string;
  groupName: string;
  iconUrl?: string;
  updatedAt: string;
};

const normalizeTicker = (ticker: string) => ticker.trim().replace(/^\$/, "").toUpperCase();

const tickerIconOverrides: Record<string, string> = {};
const tickerSectorOverrides: Record<string, string> = {};

let cacheBuiltAt = 0;

const resetRecord = (target: Record<string, string>, next: Record<string, string>) => {
  for (const key of Object.keys(target)) {
    delete target[key];
  }

  Object.assign(target, next);
};

const buildOverridesFromPages = (pages: LibraryPageRecord[]): {
  iconOverrides: Record<string, string>;
  sectorOverrides: Record<string, string>;
} => {
  const resolvedByTicker = new Map<string, TickerGroupResolved>();

  for (const page of pages) {
    if (page.collectionId !== TICKER_GROUP_COLLECTION_ID) {
      continue;
    }

    const iconValue = typeof page.properties?.Icon === "string" ? page.properties.Icon : "";
    const iconUrl = resolveTickerGroupIcon(iconValue);
    const tickersValue = page.properties?.Tickers;
    const tickers = Array.isArray(tickersValue) ? tickersValue : [];

    for (const rawTicker of tickers) {
      if (typeof rawTicker !== "string") {
        continue;
      }

      const normalized = normalizeTicker(rawTicker);
      if (!normalized) {
        continue;
      }

      const existing = resolvedByTicker.get(normalized);
      if (existing && existing.updatedAt >= page.updatedAt) {
        continue;
      }

      resolvedByTicker.set(normalized, {
        groupId: page.id,
        groupName: page.title,
        iconUrl,
        updatedAt: page.updatedAt
      });
    }
  }

  const iconOverrides: Record<string, string> = {};
  const sectorOverrides: Record<string, string> = {};

  for (const [ticker, resolved] of resolvedByTicker.entries()) {
    sectorOverrides[ticker] = resolved.groupName;
    if (resolved.iconUrl) {
      iconOverrides[ticker] = resolved.iconUrl;
    }
  }

  return { iconOverrides, sectorOverrides };
};

export const rebuildTickerGroupIconCache = (pages?: LibraryPageRecord[]) => {
  try {
    const nextPages = pages ?? loadLibraryPages();
    const { iconOverrides, sectorOverrides } = buildOverridesFromPages(nextPages);
    resetRecord(tickerIconOverrides, iconOverrides);
    resetRecord(tickerSectorOverrides, sectorOverrides);
    cacheBuiltAt = Date.now();
  } catch (err) {
    console.warn("Failed to rebuild ticker group cache:", err);
  }
};

const ensureCache = () => {
  const ageMs = Date.now() - cacheBuiltAt;
  if (ageMs < 1000) {
    return;
  }

  rebuildTickerGroupIconCache();
};

if (typeof window !== "undefined") {
  window.addEventListener("trade-engine-library-pages-updated", (event: Event) => {
    const custom = event as CustomEvent<{ pages?: LibraryPageRecord[] }>;
    rebuildTickerGroupIconCache(custom.detail?.pages);
  });
}

rebuildTickerGroupIconCache();

export const getTickerIcon = (ticker: string) => {
  ensureCache();
  return tickerIconOverrides[normalizeTicker(ticker)];
};

export const getTickerSector = (ticker: string) => {
  ensureCache();
  return tickerSectorOverrides[normalizeTicker(ticker)];
};

export const tickerIcons: Record<string, string> = tickerIconOverrides;

