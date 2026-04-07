import { invoke, isTauri } from "@tauri-apps/api/core";
import type { HistoricalBar } from "../../types/chart";
import type { Settings, GroupedTrade } from "../../types/trade";

interface TwelveDataValueRow {
  datetime?: string;
  open?: string;
  high?: string;
  low?: string;
  close?: string;
  volume?: string;
}

interface TwelveDataResponse {
  status?: string;
  message?: string;
  code?: number;
  values?: TwelveDataValueRow[];
}

const parseNumber = (value: string | undefined): number | null => {
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const parseTimestamp = (value: string | undefined): number | null => {
  if (!value) {
    return null;
  }

  const parsed = new Date(value.replace(" ", "T"));
  return Number.isNaN(parsed.getTime()) ? null : Math.floor(parsed.getTime() / 1000);
};

const buildExchangeHint = (symbol: string): { symbol: string; exchange?: string } => {
  const [baseSymbol, suffix] = symbol.split(".");
  const normalizedSuffix = suffix?.toUpperCase();
  const exchangeMap: Record<string, string> = {
    NY: "NYSE",
    NQ: "NASDAQ",
    AM: "AMEX",
    AR: "NYSE ARCA"
  };

  return {
    symbol: baseSymbol,
    exchange: normalizedSuffix ? exchangeMap[normalizedSuffix] : undefined
  };
};

const requestTwelveData = async (
  settings: Settings,
  trade: GroupedTrade,
  interval: string,
  startDate?: string,
  endDate?: string,
  outputSize?: number
): Promise<TwelveDataResponse> => {
  const { symbol, exchange } = buildExchangeHint(trade.symbol);

  if (isTauri()) {
    return invoke<TwelveDataResponse>("fetch_twelve_data_time_series", {
      apiKey: settings.twelveDataApiKey,
      symbol,
      exchange,
      interval,
      startDate,
      endDate,
      outputSize
    });
  }

  const params = new URLSearchParams({
    symbol,
    interval,
    format: "JSON",
    apikey: settings.twelveDataApiKey
  });

  if (startDate) {
    params.set("start_date", startDate);
  }

  if (endDate) {
    params.set("end_date", endDate);
  }

  if (typeof outputSize === "number" && Number.isFinite(outputSize)) {
    params.set("outputsize", String(outputSize));
  }

  if (exchange) {
    params.set("exchange", exchange);
  }

  const response = await fetch(`https://api.twelvedata.com/time_series?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`Twelve Data returned ${response.status}.`);
  }

  return response.json() as Promise<TwelveDataResponse>;
};

const parseResponseBars = (response: TwelveDataResponse, symbol: string, tradeDate: string): HistoricalBar[] => {
  if (response.status === "error") {
    throw new Error(response.message || "Twelve Data returned an error.");
  }

  const bars: HistoricalBar[] = [];

  for (const row of response.values ?? []) {
    const time = parseTimestamp(row.datetime);
    const open = parseNumber(row.open);
    const high = parseNumber(row.high);
    const low = parseNumber(row.low);
    const close = parseNumber(row.close);
    const volume = parseNumber(row.volume ?? undefined) ?? undefined;

    if (time === null || open === null || high === null || low === null || close === null) {
      continue;
    }

    bars.push({
      time,
      open,
      high,
      low,
      close,
      volume
    });
  }

  bars.sort((left, right) => left.time - right.time);

  if (bars.length === 0) {
    throw new Error(`Twelve Data did not return usable bars for ${symbol} on ${tradeDate}.`);
  }

  return bars;
};

export const fetchHistoricalBarsFromTwelveData = async (
  settings: Settings,
  trade: GroupedTrade
): Promise<HistoricalBar[]> => {
  if (!settings.twelveDataApiKey.trim()) {
    throw new Error("Add your Twelve Data API key in Settings first.");
  }

  const response = await requestTwelveData(
    settings,
    trade,
    "1min",
    `${trade.tradeDate} 00:00:00`,
    `${trade.tradeDate} 23:59:59`
  );

  return parseResponseBars(response, trade.symbol, trade.tradeDate);
};

export const fetchDailyHistoricalBarsFromTwelveData = async (
  settings: Settings,
  trade: GroupedTrade,
  lookbackDays = 90
): Promise<HistoricalBar[]> => {
  if (!settings.twelveDataApiKey.trim()) {
    throw new Error("Add your Twelve Data API key in Settings first.");
  }

  const response = await requestTwelveData(
    settings,
    trade,
    "1day",
    undefined,
    trade.tradeDate,
    lookbackDays
  );

  return parseResponseBars(response, trade.symbol, trade.tradeDate);
};
