import type { GroupedTrade } from "../../types/trade";

export interface TradeSummary {
  totalTrades: number;
  totalSharesTraded: number;
  totalNetPnl: number;
  totalFees: number;
  winCount: number;
  lossCount: number;
  winRate: number;
  avgTrade: number;
  avgHoldMinutes: number;
  profitFactor: number;
}

export interface DatabaseStats {
  totalTrades: number;
  totalExecutions: number;
  totalSharesTraded: number;
  sessions: number;
  symbols: number;
}

export interface IntradayMetrics {
  totalTrades: number;
  winCount: number;
  lossCount: number;
  winRate: number;
  netPnl: number;
  avgPnl: number;
  avgHoldMinutes: number;
  bestTrade: number;
  worstTrade: number;
}

export interface PerformanceRow {
  label: string;
  trades: number;
  winRate: number;
  netPnl: number;
  avgPnl: number;
  totalFees?: number;
}

export interface TimeSeriesPoint {
  label: string;
  value: number;
}

const round = (value: number): number => Number(value.toFixed(2));

const toDate = (tradeDate: string): Date => new Date(`${tradeDate}T00:00:00`);

const formatDateKey = (value: Date): string => {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const getStartOfWeek = (value: Date): Date => {
  const result = new Date(value);
  const day = result.getDay();
  const delta = day === 0 ? -6 : 1 - day;
  result.setDate(result.getDate() + delta);
  result.setHours(0, 0, 0, 0);
  return result;
};

const getEndOfWeek = (value: Date): Date => {
  const result = getStartOfWeek(value);
  result.setDate(result.getDate() + 6);
  result.setHours(23, 59, 59, 999);
  return result;
};

const filterTradesBetween = (
  trades: GroupedTrade[],
  start: Date,
  end: Date
): GroupedTrade[] =>
  trades.filter((trade) => {
    const tradeDate = toDate(trade.tradeDate);
    return tradeDate >= start && tradeDate <= end;
  });

const getTotalSharesTraded = (trades: GroupedTrade[]): number =>
  trades.reduce(
    (sum, trade) =>
      sum +
      trade.openingExecutions.reduce((pieceSum, piece) => pieceSum + Math.abs(piece.quantity), 0) +
      trade.closingExecutions.reduce((pieceSum, piece) => pieceSum + Math.abs(piece.quantity), 0),
    0
  );

const summarizeGroup = (label: string, trades: GroupedTrade[]): PerformanceRow => {
  const tradeCount = trades.length;
  const winCount = trades.filter((trade) => trade.status === "Win").length;
  const netPnl = trades.reduce((sum, trade) => sum + trade.netPnlUsd, 0);
  const totalFees = trades.reduce((sum, trade) => sum + trade.feesUsd, 0);

  return {
    label,
    trades: tradeCount,
    winRate: tradeCount > 0 ? (winCount / tradeCount) * 100 : 0,
    netPnl: round(netPnl),
    avgPnl: tradeCount > 0 ? round(netPnl / tradeCount) : 0,
    totalFees: round(totalFees)
  };
};

export const getTradeSummary = (trades: GroupedTrade[]): TradeSummary => {
  const totalTrades = trades.length;
  const totalSharesTraded = getTotalSharesTraded(trades);
  const totalNetPnl = trades.reduce((sum, trade) => sum + trade.netPnlUsd, 0);
  const totalFees = trades.reduce((sum, trade) => sum + trade.feesUsd, 0);
  const winCount = trades.filter((trade) => trade.status === "Win").length;
  const lossCount = totalTrades - winCount;
  const grossWins = trades
    .filter((trade) => trade.netPnlUsd > 0)
    .reduce((sum, trade) => sum + trade.netPnlUsd, 0);
  const grossLosses = Math.abs(
    trades.filter((trade) => trade.netPnlUsd < 0).reduce((sum, trade) => sum + trade.netPnlUsd, 0)
  );
  const avgHoldMinutes =
    totalTrades > 0 ? trades.reduce((sum, trade) => sum + trade.holdSeconds, 0) / 60 / totalTrades : 0;

  return {
    totalTrades,
    totalSharesTraded,
    totalNetPnl: round(totalNetPnl),
    totalFees: round(totalFees),
    winCount,
    lossCount,
    winRate: totalTrades > 0 ? (winCount / totalTrades) * 100 : 0,
    avgTrade: totalTrades > 0 ? round(totalNetPnl / totalTrades) : 0,
    avgHoldMinutes: round(avgHoldMinutes),
    profitFactor: grossLosses > 0 ? round(grossWins / grossLosses) : grossWins > 0 ? 999 : 0
  };
};

export const getRecentSessionSummary = (trades: GroupedTrade[]): PerformanceRow | null => {
  const sessions = getRecentSessionBreakdown(trades);
  return sessions[0] ?? null;
};

export const getCurrentWeekSummary = (trades: GroupedTrade[], anchor = new Date()): PerformanceRow =>
  summarizeGroup("Current Week", filterTradesBetween(trades, getStartOfWeek(anchor), getEndOfWeek(anchor)));

export const getLastWeekSummary = (trades: GroupedTrade[], anchor = new Date()): PerformanceRow => {
  const currentWeekStart = getStartOfWeek(anchor);
  const lastWeekEnd = new Date(currentWeekStart);
  lastWeekEnd.setMilliseconds(-1);
  const lastWeekStart = getStartOfWeek(lastWeekEnd);
  return summarizeGroup("Last Week", filterTradesBetween(trades, lastWeekStart, lastWeekEnd));
};

export const getCurrentMonthSummary = (trades: GroupedTrade[], anchor = new Date()): PerformanceRow => {
  const start = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const end = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0, 23, 59, 59, 999);
  return summarizeGroup("Month", filterTradesBetween(trades, start, end));
};

export const getDatabaseStats = (trades: GroupedTrade[]): DatabaseStats => ({
  totalTrades: trades.length,
  totalExecutions: trades.reduce(
    (sum, trade) => sum + trade.openingExecutions.length + trade.closingExecutions.length,
    0
  ),
  totalSharesTraded: getTotalSharesTraded(trades),
  sessions: new Set(trades.map((trade) => trade.tradeDate)).size,
  symbols: new Set(trades.map((trade) => trade.symbol)).size
});

export const getIntradayMetrics = (trades: GroupedTrade[]): IntradayMetrics => {
  const summary = getTradeSummary(trades);
  const sortedByPnl = [...trades].sort((left, right) => right.netPnlUsd - left.netPnlUsd);

  return {
    totalTrades: summary.totalTrades,
    winCount: summary.winCount,
    lossCount: summary.lossCount,
    winRate: summary.winRate,
    netPnl: summary.totalNetPnl,
    avgPnl: summary.avgTrade,
    avgHoldMinutes: summary.avgHoldMinutes,
    bestTrade: sortedByPnl[0]?.netPnlUsd ?? 0,
    worstTrade: sortedByPnl[sortedByPnl.length - 1]?.netPnlUsd ?? 0
  };
};

export const getHourlyBreakdown = (trades: GroupedTrade[]): PerformanceRow[] => {
  const grouped = new Map<string, GroupedTrade[]>();

  for (const trade of trades) {
    const hour = trade.openTime.split(":")[0] ?? "--";
    const key = `${hour}:00`;
    const current = grouped.get(key) ?? [];
    current.push(trade);
    grouped.set(key, current);
  }

  return Array.from(grouped.entries())
    .map(([label, group]) => summarizeGroup(label, group))
    .sort((left, right) => left.label.localeCompare(right.label));
};

export const getPerformanceBySymbol = (trades: GroupedTrade[]): PerformanceRow[] => {
  const grouped = new Map<string, GroupedTrade[]>();

  for (const trade of trades) {
    const current = grouped.get(trade.symbol) ?? [];
    current.push(trade);
    grouped.set(trade.symbol, current);
  }

  return Array.from(grouped.entries())
    .map(([label, group]) => summarizeGroup(label, group))
    .sort((left, right) => right.netPnl - left.netPnl || right.trades - left.trades);
};

export const getPerformanceByGateway = (trades: GroupedTrade[]): PerformanceRow[] => {
  const grouped = new Map<string, GroupedTrade[]>();

  for (const trade of trades) {
    const keys = trade.gateways.length > 0 ? trade.gateways : ["Unknown"];
    for (const gateway of keys) {
      const current = grouped.get(gateway) ?? [];
      current.push(trade);
      grouped.set(gateway, current);
    }
  }

  return Array.from(grouped.entries())
    .map(([label, group]) => summarizeGroup(label, group))
    .sort((left, right) => right.trades - left.trades || right.netPnl - left.netPnl);
};

export const getPerformanceBySetup = (trades: GroupedTrade[]): PerformanceRow[] => {
  const grouped = new Map<string, GroupedTrade[]>();

  for (const trade of trades) {
    const keys = trade.setups.length > 0 ? trade.setups : ["No Setup"];
    for (const setup of keys) {
      const current = grouped.get(setup) ?? [];
      current.push(trade);
      grouped.set(setup, current);
    }
  }

  return Array.from(grouped.entries())
    .map(([label, group]) => summarizeGroup(label, group))
    .sort((left, right) => right.netPnl - left.netPnl || right.trades - left.trades);
};

export const getPerformanceByMistake = (trades: GroupedTrade[]): PerformanceRow[] => {
  const grouped = new Map<string, GroupedTrade[]>();

  for (const trade of trades) {
    const keys = trade.mistakes.length > 0 ? trade.mistakes : ["No Mistakes"];
    for (const mistake of keys) {
      const current = grouped.get(mistake) ?? [];
      current.push(trade);
      grouped.set(mistake, current);
    }
  }

  return Array.from(grouped.entries())
    .map(([label, group]) => summarizeGroup(label, group))
    .sort((left, right) => right.netPnl - left.netPnl || right.trades - left.trades);
};

export const getPerformanceByGame = (trades: GroupedTrade[]): PerformanceRow[] => {
  const grouped = new Map<string, GroupedTrade[]>();

  for (const trade of trades) {
    const key = trade.game.trim().length > 0 ? trade.game : "No Game";
    const current = grouped.get(key) ?? [];
    current.push(trade);
    grouped.set(key, current);
  }

  return Array.from(grouped.entries())
    .map(([label, group]) => summarizeGroup(label, group))
    .sort((left, right) => right.netPnl - left.netPnl || right.trades - left.trades);
};

export const getCumulativeNetPnlByDate = (trades: GroupedTrade[]): TimeSeriesPoint[] => {
  const dailyTotals = new Map<string, number>();

  for (const trade of trades) {
    dailyTotals.set(trade.tradeDate, (dailyTotals.get(trade.tradeDate) ?? 0) + trade.netPnlUsd);
  }

  let runningTotal = 0;

  return Array.from(dailyTotals.entries())
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([label, value]) => {
      runningTotal += value;
      return {
        label,
        value: round(runningTotal)
      };
    });
};

export const getSizeByDate = (trades: GroupedTrade[]): TimeSeriesPoint[] => {
  const dailyTotals = new Map<string, number>();

  for (const trade of trades) {
    dailyTotals.set(trade.tradeDate, (dailyTotals.get(trade.tradeDate) ?? 0) + trade.size);
  }

  return Array.from(dailyTotals.entries())
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([label, value]) => ({
      label,
      value: round(value)
    }));
};

export const getRecentSessionBreakdown = (trades: GroupedTrade[]): PerformanceRow[] => {
  const grouped = new Map<string, GroupedTrade[]>();

  for (const trade of trades) {
    const current = grouped.get(trade.tradeDate) ?? [];
    current.push(trade);
    grouped.set(trade.tradeDate, current);
  }

  return Array.from(grouped.entries())
    .map(([label, group]) => summarizeGroup(label, group))
    .sort((left, right) => right.label.localeCompare(left.label));
};

export interface CalendarDaySummary {
  tradeDate: string;
  day: number;
  netPnl: number;
  trades: number;
  winRate: number;
}

export const getCalendarSummary = (trades: GroupedTrade[]): CalendarDaySummary[] => {
  return getRecentSessionBreakdown(trades)
    .map((row) => ({
      tradeDate: row.label,
      day: Number(row.label.split("-")[2] ?? "0"),
      netPnl: row.netPnl,
      trades: row.trades,
      winRate: row.winRate
    }))
    .sort((left, right) => left.tradeDate.localeCompare(right.tradeDate));
};

export const getMonthSessionSummary = (trades: GroupedTrade[], visibleMonth: Date): CalendarDaySummary[] => {
  const monthKey = `${visibleMonth.getFullYear()}-${String(visibleMonth.getMonth() + 1).padStart(2, "0")}`;
  return getCalendarSummary(trades).filter((day) => day.tradeDate.startsWith(monthKey));
};

export const getVisibleMonthNavigation = (trades: GroupedTrade[]): string[] => {
  const keys = Array.from(new Set(trades.map((trade) => trade.tradeDate.slice(0, 7)))).sort();
  return keys.length > 0 ? keys : [formatDateKey(new Date()).slice(0, 7)];
};
