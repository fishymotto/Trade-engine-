import type { GroupedTrade } from "../../types/trade";

export type TradeAssetClass = "stock" | "currency";

export const DEFAULT_CURRENCY_SYMBOL_LIST = "ETH";

const QUOTE_CURRENCY_SUFFIXES = ["USD", "USDT", "USDC", "CAD"] as const;

const normalizeSymbolToken = (value: string): string =>
  value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "");

const splitSymbolParts = (value: string): string[] =>
  value
    .trim()
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .map(normalizeSymbolToken)
    .filter(Boolean);

const parseSymbolList = (value: string | undefined): string[] => {
  const seen = new Set<string>();
  const symbols: string[] = [];

  for (const entry of (value ?? "").split(/[\s,;]+/)) {
    const normalized = normalizeSymbolToken(entry);
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    symbols.push(normalized);
  }

  return symbols;
};

export const normalizeCurrencySymbolList = (value: unknown): string => {
  const symbols = typeof value === "string" ? parseSymbolList(value) : [];
  return (symbols.length > 0 ? symbols : parseSymbolList(DEFAULT_CURRENCY_SYMBOL_LIST)).join(", ");
};

export const isCurrencySymbol = (symbol: string, currencySymbolList: string): boolean => {
  const normalizedSymbol = normalizeSymbolToken(symbol);
  if (!normalizedSymbol) {
    return false;
  }

  const configuredSymbols = parseSymbolList(currencySymbolList || DEFAULT_CURRENCY_SYMBOL_LIST);
  const symbolParts = splitSymbolParts(symbol);

  return configuredSymbols.some((configuredSymbol) => {
    if (normalizedSymbol === configuredSymbol || symbolParts.includes(configuredSymbol)) {
      return true;
    }

    return QUOTE_CURRENCY_SUFFIXES.some(
      (suffix) => normalizedSymbol === `${configuredSymbol}${suffix}`
    );
  });
};

export const getTradeAssetClass = (
  trade: Pick<GroupedTrade, "symbol">,
  currencySymbolList: string
): TradeAssetClass => (isCurrencySymbol(trade.symbol, currencySymbolList) ? "currency" : "stock");

export const filterTradesByAssetClass = <TTrade extends Pick<GroupedTrade, "symbol">>(
  trades: TTrade[],
  assetClass: TradeAssetClass,
  currencySymbolList: string
): TTrade[] =>
  trades.filter((trade) => getTradeAssetClass(trade, currencySymbolList) === assetClass);
