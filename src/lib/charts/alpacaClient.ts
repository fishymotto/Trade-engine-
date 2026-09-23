import { invoke, isTauri } from "@tauri-apps/api/core";
import type { HistoricalBar } from "../../types/chart";
import type { GroupedTrade, Settings } from "../../types/trade";

interface AlpacaTradeRow {
  t?: string;
  p?: number;
  s?: number;
}

interface AlpacaTradesResponse {
  symbol?: string;
  trades?: AlpacaTradeRow[];
  next_page_token?: string;
  code?: number;
  message?: string;
}

interface AlpacaTradeRange {
  startIso: string;
  endIso: string;
}

export interface AlpacaTenSecondBarsResult {
  bars: HistoricalBar[];
  sourceFileName: string;
}

const ALPACA_TRADE_PAGE_LIMIT = 10_000;
const ALPACA_MAX_TRADE_PAGES = 30;
const TEN_SECOND_BUCKET_SECONDS = 10;
const TRADE_WINDOW_PADDING_MINUTES = 30;
const MARKET_DAY_START = "04:00:00";
const MARKET_DAY_END = "20:00:00";

const parseAlpacaTimestamp = (value: string | undefined): number | null => {
  if (!value) {
    return null;
  }

  const jsCompatibleValue = value.replace(/(\.\d{3})\d+(Z|[+-]\d{2}:\d{2})$/, "$1$2");
  const parsed = new Date(jsCompatibleValue);
  return Number.isNaN(parsed.getTime()) ? null : Math.floor(parsed.getTime() / 1000);
};

const parseLocalTradeTimestamp = (tradeDate: string, time: string): number | null => {
  const parsed = new Date(`${tradeDate}T${time}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
};

const buildAlpacaTradeRange = (trade: GroupedTrade): AlpacaTradeRange => {
  const marketStart = parseLocalTradeTimestamp(trade.tradeDate, MARKET_DAY_START);
  const marketEnd = parseLocalTradeTimestamp(trade.tradeDate, MARKET_DAY_END);
  const open = parseLocalTradeTimestamp(trade.tradeDate, trade.openTime);
  const close = parseLocalTradeTimestamp(trade.tradeDate, trade.closeTime);
  const fallbackStart = parseLocalTradeTimestamp(trade.tradeDate, "09:30:00");
  const fallbackEnd = parseLocalTradeTimestamp(trade.tradeDate, "16:00:00");
  const paddingMs = TRADE_WINDOW_PADDING_MINUTES * 60 * 1000;
  const rawStart = (open ?? fallbackStart ?? marketStart ?? Date.now()) - paddingMs;
  const rawEnd = (close ?? open ?? fallbackEnd ?? marketEnd ?? Date.now()) + paddingMs;
  const boundedStart = Math.max(marketStart ?? rawStart, rawStart);
  const boundedEnd = Math.min(marketEnd ?? rawEnd, Math.max(rawEnd, boundedStart + TEN_SECOND_BUCKET_SECONDS * 1000));

  return {
    startIso: new Date(boundedStart).toISOString(),
    endIso: new Date(boundedEnd).toISOString()
  };
};

const normalizeAlpacaSymbol = (symbol: string): string => {
  const trimmed = symbol.trim().toUpperCase();
  const [baseSymbol, suffix] = trimmed.split(".");
  const tradeImportSuffixes = new Set(["NY", "NQ", "AM", "AR"]);
  return suffix && tradeImportSuffixes.has(suffix) ? baseSymbol : trimmed;
};

const requestAlpacaTradesPage = async (
  settings: Settings,
  symbol: string,
  range: AlpacaTradeRange,
  pageToken?: string
): Promise<AlpacaTradesResponse> => {
  const apiKey = settings.alpacaApiKey.trim();
  const secretKey = settings.alpacaSecretKey.trim();

  if (!apiKey || !secretKey) {
    throw new Error("Add your Alpaca API key and secret in Settings first.");
  }

  if (isTauri()) {
    return invoke<AlpacaTradesResponse>("fetch_alpaca_stock_trades", {
      apiKey,
      secretKey,
      symbol,
      feed: settings.alpacaDataFeed,
      start: range.startIso,
      end: range.endIso,
      limit: ALPACA_TRADE_PAGE_LIMIT,
      pageToken
    });
  }

  const params = new URLSearchParams({
    start: range.startIso,
    end: range.endIso,
    limit: String(ALPACA_TRADE_PAGE_LIMIT),
    feed: settings.alpacaDataFeed,
    sort: "asc"
  });

  if (pageToken) {
    params.set("page_token", pageToken);
  }

  const response = await fetch(`https://data.alpaca.markets/v2/stocks/${encodeURIComponent(symbol)}/trades?${params.toString()}`, {
    headers: {
      "APCA-API-KEY-ID": apiKey,
      "APCA-API-SECRET-KEY": secretKey
    }
  });

  const body = (await response.json()) as AlpacaTradesResponse;
  if (!response.ok) {
    throw new Error(body.message || `Alpaca Market Data returned ${response.status}.`);
  }

  return body;
};

const aggregateTradesIntoTenSecondBars = (trades: AlpacaTradeRow[]): HistoricalBar[] => {
  const bars: HistoricalBar[] = [];

  for (const trade of trades) {
    const timestamp = parseAlpacaTimestamp(trade.t);
    const price = Number(trade.p);
    const size = Number(trade.s);

    if (timestamp === null || !Number.isFinite(price) || price <= 0) {
      continue;
    }

    const bucketTime = Math.floor(timestamp / TEN_SECOND_BUCKET_SECONDS) * TEN_SECOND_BUCKET_SECONDS;
    const previous = bars[bars.length - 1];

    if (!previous || previous.time !== bucketTime) {
      bars.push({
        time: bucketTime,
        open: price,
        high: price,
        low: price,
        close: price,
        volume: Number.isFinite(size) && size > 0 ? size : undefined
      });
      continue;
    }

    previous.high = Math.max(previous.high, price);
    previous.low = Math.min(previous.low, price);
    previous.close = price;
    previous.volume = (previous.volume ?? 0) + (Number.isFinite(size) && size > 0 ? size : 0);
  }

  return bars;
};

export const fetchTenSecondBarsFromAlpaca = async (
  settings: Settings,
  trade: GroupedTrade
): Promise<AlpacaTenSecondBarsResult> => {
  const symbol = normalizeAlpacaSymbol(trade.symbol);
  const range = buildAlpacaTradeRange(trade);
  const trades: AlpacaTradeRow[] = [];
  let pageToken: string | undefined;
  let pageCount = 0;

  do {
    pageCount += 1;
    const response = await requestAlpacaTradesPage(settings, symbol, range, pageToken);
    if (response.message && response.code) {
      throw new Error(response.message);
    }

    trades.push(...(response.trades ?? []));
    pageToken = response.next_page_token?.trim() || undefined;

    if (pageToken && pageCount >= ALPACA_MAX_TRADE_PAGES) {
      throw new Error(
        `Alpaca returned more than ${ALPACA_MAX_TRADE_PAGES * ALPACA_TRADE_PAGE_LIMIT} trades for this window. Narrow the trade window or switch the feed to IEX.`
      );
    }
  } while (pageToken);

  const bars = aggregateTradesIntoTenSecondBars(trades);
  if (bars.length === 0) {
    throw new Error(`Alpaca did not return usable 10-second bars for ${symbol} on ${trade.tradeDate}.`);
  }

  return {
    bars,
    sourceFileName: `Alpaca - 10s - ${settings.alpacaDataFeed.toUpperCase()}`
  };
};
