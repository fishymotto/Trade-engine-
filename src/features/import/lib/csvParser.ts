import Papa from "papaparse";
import type { ParsedCsvResult } from "../../../types/csv";
import type { RawExecutionRow } from "../../../types/trade";

interface CurrencyConversionOptions {
  brlToUsdRate?: number;
  brlSymbols?: string[];
}

const REQUIRED_COLUMNS = [
  "DATE",
  "TIME",
  "SYMBOL",
  "ORDER_SIDE",
  "QTY",
  "PRICE"
] as const;

const COLUMN_ALIASES: Record<string, string[]> = {
  // TODO: Replace aliases with the exact sample-file header names once a real PPro8 export is confirmed.
  DATE: ["DATE", "Trade Date", "TRADE_DATE"],
  TIME: ["TIME", "Trade Time", "TRADE_TIME"],
  SYMBOL: ["SYMBOL", "Ticker", "SYMBOL_NAME"],
  ORDER_SIDE: ["ORDER_SIDE", "SIDE"],
  QTY: ["QTY", "Qty", "SHARES", "Shares", "FILL_AMOUNT"],
  PRICE: ["PRICE", "Price", "SHARE_PRICE"],
  GROSS_PNL: ["GROSS_PNL", "Gross PnL", "GROSS", "REALIZED"],
  NET_PNL: ["NET_PNL", "Net PnL", "NET", "TRADING_TOTAL"],
  ECN_FEE: ["ECN_FEE", "Gateway Fee", "ROUTE_FEE", "GATEWAY_FEE"],
  COMMISSION: ["COMMISSION", "Commission"],
  SEC: ["SEC", "SEC_FEE"],
  TAF: ["TAF", "TAF_FEE", "ACTIVITY_FEE"],
  NSCC: ["NSCC", "NSCC_FEE", "CLEARING_FEE"]
};

const normalizeHeader = (header: string): string => header.trim().replace(/\uFEFF/g, "");

const parseNumber = (value: string | undefined): number => {
  if (!value) {
    return 0;
  }

  const normalized = value.replace(/[$,]/g, "").trim();
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeTickerToken = (symbol: string): string => symbol.trim().toUpperCase();

const symbolTokens = (symbol: string): string[] => {
  const normalized = normalizeTickerToken(symbol);
  const parts = normalized.split(/[^A-Z0-9]+/).filter(Boolean);
  return [normalized, ...parts];
};

const normalizeTime = (value: string | undefined): string => {
  if (!value) {
    return "";
  }

  const trimmed = value.trim();
  const match = trimmed.match(/^(\d{2}:\d{2}:\d{2})/);
  return match ? match[1] : trimmed;
};

const getFirstMatchingColumn = (headers: string[], names: string[]): string | undefined =>
  headers.find((header) => names.includes(header));

const requireColumns = (headers: string[]) => {
  const missing = REQUIRED_COLUMNS.filter((required) =>
    !getFirstMatchingColumn(headers, COLUMN_ALIASES[required] ?? [required])
  );

  if (missing.length > 0) {
    throw new Error(
      `This file is missing required PPro columns: ${missing.join(", ")}. Use a PPro8 Trade Detail CSV export.`
    );
  }
};

export const parseTradeDetailCsv = async (file: File): Promise<ParsedCsvResult<RawExecutionRow>> => {
  return parseTradeDetailCsvWithOptions(file, {});
};

const normalizeBrlSymbols = (symbols: string[] | undefined): Set<string> =>
  new Set(
    (symbols ?? [])
      .flatMap((symbol) => symbol.split(/[\s,;]+/))
      .map(normalizeTickerToken)
      .filter(Boolean)
  );

export const parseTradeDetailCsvWithOptions = async (
  file: File,
  options: CurrencyConversionOptions
): Promise<ParsedCsvResult<RawExecutionRow>> => {
  const text = await file.text();
  const brlSymbols = normalizeBrlSymbols(options.brlSymbols);
  const brlToUsdRate = options.brlToUsdRate && options.brlToUsdRate > 0 ? options.brlToUsdRate : 0;

  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(text, {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: normalizeHeader,
      complete: (results) => {
        try {
          const headers = (results.meta.fields ?? []).map(normalizeHeader);
          requireColumns(headers);
          const matchedBrlSymbols = new Set<string>();
          let convertedBrlRows = 0;
          let skippedBrlRowsWithoutRate = 0;

          const rows = results.data
            .map((row, index) => {
              const read = (key: keyof typeof COLUMN_ALIASES): string | undefined => {
                const column = getFirstMatchingColumn(headers, COLUMN_ALIASES[key]);
                return column ? row[column] : undefined;
              };

              const gatewayFee = parseNumber(read("ECN_FEE"));
              const secFee = parseNumber(read("SEC"));
              const activityFee = parseNumber(read("TAF"));
              const clearingFee = parseNumber(read("NSCC"));
              const rawFees = gatewayFee + secFee + activityFee + clearingFee;
              const symbol = normalizeTickerToken(read("SYMBOL") ?? "");
              const matchedBrlSymbol = symbolTokens(symbol).some((token) => brlSymbols.has(token));
              const shouldConvertFromBrl = brlToUsdRate > 0 && matchedBrlSymbol;
              if (matchedBrlSymbol) {
                matchedBrlSymbols.add(symbol);
                if (shouldConvertFromBrl) {
                  convertedBrlRows += 1;
                } else {
                  skippedBrlRowsWithoutRate += 1;
                }
              }
              const toUsd = (value: number) =>
                shouldConvertFromBrl ? Number((value * brlToUsdRate).toFixed(4)) : value;
              const feesUsd = toUsd(rawFees);

              return {
                originalIndex: index,
                tradeDate: (read("DATE") ?? "").trim(),
                time: normalizeTime(read("TIME")),
                symbol,
                gatewayName: (row.GATEWAY_NAME ?? "").trim().toUpperCase(),
                orderSide: (read("ORDER_SIDE") ?? "").trim().toUpperCase(),
                quantity: Math.abs(parseNumber(read("QTY"))),
                price: parseNumber(read("PRICE")),
                grossPnlUsd: toUsd(parseNumber(read("GROSS_PNL"))),
                netPnlUsd: toUsd(parseNumber(read("NET_PNL"))),
                feesUsd,
                gatewayFee: toUsd(gatewayFee),
                sourceRow: row
              } satisfies RawExecutionRow;
            })
            .filter((row) => row.tradeDate && row.time && row.symbol && row.quantity > 0 && row.price > 0);

          resolve({
            rows,
            warnings: [
              ...(rows.length === 0 ? ["No trade rows were found in this file."] : []),
              ...(skippedBrlRowsWithoutRate > 0
                ? [
                    `Found ${skippedBrlRowsWithoutRate} Bovespa execution rows (${Array.from(matchedBrlSymbols).join(
                      ", "
                    )}), but BRL to USD Rate is blank. Set the fixed rate in Settings before importing.`
                  ]
                : []),
              ...(convertedBrlRows > 0
                ? [
                    `Converted ${convertedBrlRows} Bovespa execution rows (${Array.from(matchedBrlSymbols).join(
                      ", "
                    )}) from BRL to USD.`
                  ]
                : [])
            ]
          });
        } catch (error) {
          reject(error);
        }
      },
      error: (error: Error) => reject(new Error(`The CSV file could not be read: ${error.message}`))
    });
  });
};
