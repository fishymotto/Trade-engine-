import type { ExecutionPiece, ExportRow, GroupedTrade } from "../../../types/trade";

const formatMoney = (value: number): string => value.toFixed(4);
const formatPrice = (value: number): string => value.toFixed(4);

const escapeCsvCell = (value: string | number): string => {
  const stringValue = String(value);
  if (/[",\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, "\"\"")}"`;
  }
  return stringValue;
};

const formatExecutionLine = (
  label: string,
  execution: ExecutionPiece,
  qualifier?: string
): string => {
  const parts = [
    label,
    qualifier ? `[${qualifier}]` : "",
    execution.time,
    formatPrice(execution.price),
    `x${execution.quantity}`
  ].filter(Boolean);

  if (execution.gatewayName) {
    parts.push(`(${execution.gatewayName})`);
  }

  return parts.join(" ");
};

const buildExecutionsCell = (trade: GroupedTrade): string => {
  const lines: string[] = [];

  const [entryExecution, ...addExecutions] = trade.openingExecutions;
  if (entryExecution) {
    lines.push(formatExecutionLine("ENTRY", entryExecution));
  }

  addExecutions.forEach((execution, index) => {
    const signal = trade.addSignals[index];
    const qualifier = signal?.averagedDown ? "Avg down" : signal?.addedToWinner ? "To winner" : undefined;
    lines.push(formatExecutionLine("ADD", execution, qualifier));
  });

  trade.closingExecutions.forEach((execution, index) => {
    const qualifier =
      trade.closingExecutions.length > 1 && index < trade.closingExecutions.length - 1 ? "Partial" : undefined;
    lines.push(formatExecutionLine("EXIT", execution, qualifier));
  });

  return lines.join("\n");
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
    Catalyst: (trade.catalyst ?? []).join(", "),
    Chart: "",
    Executions: buildExecutionsCell(trade),
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
