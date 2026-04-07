import type { ExportRow, GroupedTrade } from "../../types/trade";

const formatMoney = (value: number): string => value.toFixed(4);
const formatPrice = (value: number): string => value.toFixed(4);

const escapeCsvCell = (value: string | number): string => {
  const stringValue = String(value);
  if (/[",\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, "\"\"")}"`;
  }
  return stringValue;
};

export const toExportRows = (trades: GroupedTrade[], allowedSymbols: string[]): ExportRow[] =>
  trades.map((trade) => ({
    Name: trade.name,
    "Trade Date": trade.tradeDate,
    "Open Time": trade.openTime,
    "Close Time": trade.closeTime,
    "Hold Time": trade.holdTime,
    Symbol: trade.symbol,
    "Symbol (Select)": allowedSymbols.length === 0 || allowedSymbols.includes(trade.symbol) ? trade.symbol : "",
    Market: "US",
    Currency: "USD",
    Side: trade.side,
    Status: trade.status,
    Size: trade.size,
    "Entry Price": formatPrice(trade.entryPrice),
    "Exit Price": formatPrice(trade.exitPrice),
    "Gross PnL USD": formatMoney(trade.grossPnlUsd),
    "Net PnL USD": formatMoney(trade.netPnlUsd),
    "Fees USD": formatMoney(trade.feesUsd),
    "Net Return": formatMoney(trade.netReturn),
    "Return / Share": formatMoney(trade.returnPerShare),
    Mistakes: trade.mistakes.join(", "),
    Setups: trade.setups.join(", "),
    Game: trade.game,
    "Out Tag": trade.outTag.join(", "),
    Gateways: trade.gateways.join(", "),
    Execution: trade.execution.join(", "),
    Notes: "",
    Catalyst: "",
    Chart: "",
    Executions: "",
    Place: "",
    "Would a MOC Hit": ""
  }));

export const buildCsvContent = (rows: ExportRow[]): string => {
  if (rows.length === 0) {
    throw new Error("There are no grouped trades to export.");
  }

  const headers = Object.keys(rows[0]) as (keyof ExportRow)[];
  const csvRows = [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => escapeCsvCell(row[header])).join(","))
  ];

  return csvRows.join("\n");
};
