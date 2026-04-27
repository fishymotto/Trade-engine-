export interface MPPDayRecord {
  tradeDate: string;
  netPnl: number;
  trades?: number;
}

export interface MPPFormulaBreakdown {
  windowSize: number;
  projectionDays: number;
  targetExcludedDays: number;
  excludedDaysRemoved: number;
  eligibleDayCount: number;
  includedDayCount: number;
  eligiblePnlTotal: number;
  includedPnlTotal: number;
  includedAverage: number;
}

export interface MPPWindowResult {
  currentMPP: number;
  eligibleDays: MPPDayRecord[];
  includedDays: MPPDayRecord[];
  excludedDays: MPPDayRecord[];
  isPartialWindow: boolean;
  formulaBreakdown: MPPFormulaBreakdown;
  anchorTradeDate: string;
}

export interface CalculateMPPWindowOptions {
  windowSize?: number;
  excludedWorstDays?: number;
  projectionDays?: number;
  anchorTradeDate?: string;
}

export const MPP_FORMULA_TOOLTIP =
  "MPP uses the last 14 eligible days, removes the 2 worst P&L days, averages the remaining 12, then projects over 20 days.";

const roundToCents = (value: number): number => Number(value.toFixed(2));
const roundToWhole = (value: number): number => Math.round(value);

const aggregateByTradeDate = (days: MPPDayRecord[]): MPPDayRecord[] => {
  const byTradeDate = new Map<string, MPPDayRecord>();

  for (const day of days) {
    const tradeDate = day.tradeDate.trim();
    if (!tradeDate) {
      continue;
    }

    const existing = byTradeDate.get(tradeDate);
    if (!existing) {
      byTradeDate.set(tradeDate, {
        tradeDate,
        netPnl: day.netPnl,
        trades: day.trades ?? 0
      });
      continue;
    }

    existing.netPnl += day.netPnl;
    existing.trades = (existing.trades ?? 0) + (day.trades ?? 0);
  }

  return Array.from(byTradeDate.values()).sort((left, right) => left.tradeDate.localeCompare(right.tradeDate));
};

export const calculateMPPWindow = (
  days: MPPDayRecord[],
  options: CalculateMPPWindowOptions = {}
): MPPWindowResult => {
  const windowSize = options.windowSize ?? 14;
  const targetExcludedDays = options.excludedWorstDays ?? 2;
  const projectionDays = options.projectionDays ?? 20;
  const normalizedDays = aggregateByTradeDate(days);
  const anchorTradeDate = options.anchorTradeDate?.trim() ?? "";
  const anchoredDays =
    anchorTradeDate.length > 0
      ? normalizedDays.filter((day) => day.tradeDate.localeCompare(anchorTradeDate) <= 0)
      : normalizedDays;
  const eligibleDays = anchoredDays.slice(-windowSize);
  const excludedDaysRemoved = Math.min(targetExcludedDays, Math.max(0, eligibleDays.length - 1));
  const excludedDays = [...eligibleDays]
    .sort(
      (left, right) =>
        left.netPnl - right.netPnl || left.tradeDate.localeCompare(right.tradeDate)
    )
    .slice(0, excludedDaysRemoved);
  const excludedDateSet = new Set(excludedDays.map((day) => day.tradeDate));
  const includedDays = eligibleDays.filter((day) => !excludedDateSet.has(day.tradeDate));
  const eligiblePnlTotal = eligibleDays.reduce((sum, day) => sum + day.netPnl, 0);
  const includedPnlTotal = includedDays.reduce((sum, day) => sum + day.netPnl, 0);
  const includedAverage = includedDays.length > 0 ? includedPnlTotal / includedDays.length : 0;

  // MPP formula:
  // 1) Look at the most recent 14 eligible days.
  // 2) Remove the 2 worst P&L days.
  // 3) Average the remaining days.
  // 4) Project that average across 20 trading days.
  // For partial windows, the same logic runs against available days.
  const currentMPP = includedAverage * projectionDays;

  return {
    currentMPP: roundToWhole(currentMPP),
    eligibleDays,
    includedDays,
    excludedDays,
    isPartialWindow: eligibleDays.length < windowSize,
    formulaBreakdown: {
      windowSize,
      projectionDays,
      targetExcludedDays,
      excludedDaysRemoved,
      eligibleDayCount: eligibleDays.length,
      includedDayCount: includedDays.length,
      eligiblePnlTotal: roundToCents(eligiblePnlTotal),
      includedPnlTotal: roundToCents(includedPnlTotal),
      includedAverage: roundToCents(includedAverage)
    },
    anchorTradeDate: anchorTradeDate || eligibleDays[eligibleDays.length - 1]?.tradeDate || ""
  };
};

export const getMPPIncludedDays = (result: MPPWindowResult): MPPDayRecord[] => result.includedDays;

export const getMPPExcludedDays = (result: MPPWindowResult): MPPDayRecord[] => result.excludedDays;
