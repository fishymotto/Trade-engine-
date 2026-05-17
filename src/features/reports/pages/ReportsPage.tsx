import { useEffect, useMemo, useState } from "react";
import { AnalyticsTable } from "../../../components/AnalyticsTable";
import { DateFilterPopover } from "../../../components/DateFilterPopover";
import { FilterSelect } from "../../../components/FilterSelect";
import { PageHero } from "../../../components/PageHero";
import { ReportBarChart } from "../../../components/ReportBarChart";
import { ReportLineChart } from "../../../components/ReportLineChart";
import { SymbolPills } from "../../../components/SymbolPills";
import { WorkspaceIcon } from "../../../components/WorkspaceIcon";
import {
  getCumulativeNetPnlByDate,
  getFeesByDate,
  getPerformanceByExecution,
  getPerformanceByGame,
  getHourlyBreakdown,
  getNetPnlByDate,
  getPerformanceByGateway,
  getPerformanceByMistake,
  getPerformanceBySetup,
  getPerformanceBySymbol,
  getSharesTradedByDate,
  getTradeSummary
} from "../../../lib/analytics/tradeAnalytics";
import { getTradePlaybookOptions, tradeHasPlaybook } from "../../../lib/trades/playbookFilters";
import type { GroupedTrade } from "../../../types/trade";

interface ReportsPageProps {
  trades: GroupedTrade[];
  externalTradeDateFilterStart?: string;
  externalTradeDateFilterEnd?: string;
  externalPlaybookFilter?: string;
  externalSymbolFilter?: string;
  externalStatusFilter?: string;
  externalGameFilter?: string;
  externalExecutionFilter?: string;
  onFiltersChange?: (filters: {
    startValue: string;
    endValue: string;
    playbook: string;
    symbol: string;
    status: string;
    game: string;
    execution: string;
  }) => void;
}

const formatSignedMoney = (value: number): string => `${value >= 0 ? "+" : "-"}$${Math.abs(value).toFixed(2)}`;

const getSignedValueClassName = (value: number): "positive-value" | "negative-value" =>
  value >= 0 ? "positive-value" : "negative-value";

const formatReportDate = (value: string): string => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  const [year, month, day] = value.split("-");
  return new Date(Number(year), Number(month) - 1, Number(day)).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
};

type ActiveReportFilterKey = "date" | "playbook" | "symbol" | "status" | "game" | "execution";
type ComparisonTone = "positive" | "negative" | "neutral";
type ReportSliceMode = "current" | "previous";

interface DateRangePreset {
  key: "all" | "last5" | "last20" | "last60";
  label: string;
  sessionCount?: number;
}

interface PeriodComparisonMetric {
  key: string;
  label: string;
  currentValue: string;
  previousValue: string;
  deltaValue: string;
  tone: ComparisonTone;
}

const DATE_RANGE_PRESETS: DateRangePreset[] = [
  { key: "all", label: "All Dates" },
  { key: "last5", label: "Last 5 Sessions", sessionCount: 5 },
  { key: "last20", label: "Last 20 Sessions", sessionCount: 20 },
  { key: "last60", label: "Last 60 Sessions", sessionCount: 60 }
];

const formatActiveDateRange = (startValue: string, endValue: string): string => {
  if (startValue && endValue) {
    if (startValue === endValue) {
      return formatReportDate(startValue);
    }

    return `${formatReportDate(startValue)} to ${formatReportDate(endValue)}`;
  }

  if (startValue) {
    return `From ${formatReportDate(startValue)}`;
  }

  if (endValue) {
    return `Through ${formatReportDate(endValue)}`;
  }

  return "All saved sessions";
};

const formatDateWindow = (datesAsc: string[]): string => {
  if (datesAsc.length === 0) {
    return "No sessions";
  }

  const startValue = datesAsc[0];
  const endValue = datesAsc[datesAsc.length - 1];
  if (startValue === endValue) {
    return formatReportDate(startValue);
  }

  return `${formatReportDate(startValue)} to ${formatReportDate(endValue)}`;
};

const formatSignedCount = (value: number): string => `${value >= 0 ? "+" : "-"}${Math.abs(value).toLocaleString()}`;

const getDeltaTone = (value: number): ComparisonTone => {
  if (value > 0) {
    return "positive";
  }

  if (value < 0) {
    return "negative";
  }

  return "neutral";
};

const formatRelativeDelta = (delta: number, previousValue: number): string => {
  if (previousValue === 0) {
    if (delta === 0) {
      return "0.0%";
    }

    return "new";
  }

  const relative = (delta / Math.abs(previousValue)) * 100;
  return `${relative >= 0 ? "+" : ""}${relative.toFixed(1)}%`;
};

const formatSignedNumber = (value: number, decimals = 2): string =>
  `${value >= 0 ? "+" : "-"}${Math.abs(value).toFixed(decimals)}`;

type ReportSummary = ReturnType<typeof getTradeSummary>;
type HourlyBreakdownRow = ReturnType<typeof getHourlyBreakdown>[number];
type PerformanceRow = ReturnType<typeof getPerformanceBySymbol>[number];
type TimeSeriesPoint = ReturnType<typeof getNetPnlByDate>[number];

interface HourlyComparisonRow {
  label: string;
  activeNetPnl: number;
  referenceNetPnl: number | null;
}

const buildHourlyComparisonRows = (
  activeRows: HourlyBreakdownRow[],
  referenceRows: HourlyBreakdownRow[],
  includeReference: boolean
): HourlyComparisonRow[] => {
  const activeByLabel = new Map(activeRows.map((row) => [row.label, row.netPnl]));
  const referenceByLabel = new Map(referenceRows.map((row) => [row.label, row.netPnl]));
  const labels = new Set<string>(activeByLabel.keys());
  if (includeReference) {
    for (const label of referenceByLabel.keys()) {
      labels.add(label);
    }
  }

  return Array.from(labels)
    .sort((left, right) => left.localeCompare(right))
    .map((label) => ({
      label,
      activeNetPnl: activeByLabel.get(label) ?? 0,
      referenceNetPnl: includeReference ? (referenceByLabel.get(label) ?? 0) : null
    }));
};

interface ReportSliceMetrics {
  symbols: number;
  reportSummary: ReportSummary;
  avgWinner: number;
  avgLoser: number;
  hourlyBreakdown: HourlyBreakdownRow[];
  symbolRows: PerformanceRow[];
  topSymbols: PerformanceRow[];
  gatewayRows: PerformanceRow[];
  setupPerformanceRows: PerformanceRow[];
  setupRows: PerformanceRow[];
  mistakePerformanceRows: PerformanceRow[];
  mistakeRows: PerformanceRow[];
  gameRows: PerformanceRow[];
  executionRows: PerformanceRow[];
  cumulativeNetPnlSeries: TimeSeriesPoint[];
  dailyNetPnlSeries: TimeSeriesPoint[];
  feesByDateSeries: TimeSeriesPoint[];
  sharesTradedByDateSeries: TimeSeriesPoint[];
  playbookNetPnlSeries: TimeSeriesPoint[];
  mistakeLossSeries: TimeSeriesPoint[];
  bestDailyNetPnl: TimeSeriesPoint | null;
  worstDailyNetPnl: TimeSeriesPoint | null;
  highestFeeDay: TimeSeriesPoint | null;
  mostActiveShareDay: TimeSeriesPoint | null;
  bestPlaybook: PerformanceRow | undefined;
  costliestMistake: PerformanceRow | undefined;
  topSymbolLabel: string;
}

const buildReportSliceMetrics = (sliceTrades: GroupedTrade[]): ReportSliceMetrics => {
  const symbols = new Set(sliceTrades.map((trade) => trade.symbol)).size;
  const reportSummary = getTradeSummary(sliceTrades);
  const winningTrades = sliceTrades.filter((trade) => trade.netPnlUsd > 0);
  const losingTrades = sliceTrades.filter((trade) => trade.netPnlUsd < 0);
  const avgWinner =
    winningTrades.length > 0
      ? winningTrades.reduce((sum, trade) => sum + trade.netPnlUsd, 0) / winningTrades.length
      : 0;
  const avgLoser =
    losingTrades.length > 0
      ? losingTrades.reduce((sum, trade) => sum + trade.netPnlUsd, 0) / losingTrades.length
      : 0;
  const hourlyBreakdown = getHourlyBreakdown(sliceTrades);
  const symbolRows = getPerformanceBySymbol(sliceTrades);
  const topSymbols = symbolRows.slice(0, 8);
  const gatewayRows = getPerformanceByGateway(sliceTrades).slice(0, 8);
  const setupPerformanceRows = getPerformanceBySetup(sliceTrades);
  const setupRows = setupPerformanceRows.slice(0, 8);
  const mistakePerformanceRows = getPerformanceByMistake(sliceTrades);
  const mistakeRows = mistakePerformanceRows.slice(0, 8);
  const gameRows = getPerformanceByGame(sliceTrades).slice(0, 8);
  const executionRows = getPerformanceByExecution(sliceTrades).slice(0, 8);
  const cumulativeNetPnlSeries = getCumulativeNetPnlByDate(sliceTrades);
  const dailyNetPnlSeries = getNetPnlByDate(sliceTrades);
  const feesByDateSeries = getFeesByDate(sliceTrades);
  const sharesTradedByDateSeries = getSharesTradedByDate(sliceTrades);
  const playbookNetPnlSeries = [...setupPerformanceRows]
    .filter((row) => row.label !== "No Setup")
    .sort((left, right) => Math.abs(right.netPnl) - Math.abs(left.netPnl) || right.trades - left.trades)
    .slice(0, 10)
    .map((row) => ({
      label: row.label,
      value: row.netPnl
    }));
  const mistakeLossSeries = [...mistakePerformanceRows]
    .filter((row) => row.label !== "No Mistakes" && row.netPnl < 0)
    .sort((left, right) => left.netPnl - right.netPnl || right.trades - left.trades)
    .slice(0, 10)
    .map((row) => ({
      label: row.label,
      value: row.netPnl
    }));
  const bestDailyNetPnl = dailyNetPnlSeries.reduce<TimeSeriesPoint | null>(
    (best, point) => (!best || point.value > best.value ? point : best),
    null
  );
  const worstDailyNetPnl = dailyNetPnlSeries.reduce<TimeSeriesPoint | null>(
    (worst, point) => (!worst || point.value < worst.value ? point : worst),
    null
  );
  const highestFeeDay = feesByDateSeries.reduce<TimeSeriesPoint | null>(
    (highest, point) => (!highest || point.value > highest.value ? point : highest),
    null
  );
  const mostActiveShareDay = sharesTradedByDateSeries.reduce<TimeSeriesPoint | null>(
    (highest, point) => (!highest || point.value > highest.value ? point : highest),
    null
  );
  const bestPlaybook = [...setupPerformanceRows]
    .filter((row) => row.label !== "No Setup")
    .sort((left, right) => right.netPnl - left.netPnl || right.trades - left.trades)[0];
  const costliestMistake = [...mistakePerformanceRows]
    .filter((row) => row.label !== "No Mistakes" && row.netPnl < 0)
    .sort((left, right) => left.netPnl - right.netPnl || right.trades - left.trades)[0];
  const topSymbolLabel = symbolRows[0]?.label ?? "--";

  return {
    symbols,
    reportSummary,
    avgWinner,
    avgLoser,
    hourlyBreakdown,
    symbolRows,
    topSymbols,
    gatewayRows,
    setupPerformanceRows,
    setupRows,
    mistakePerformanceRows,
    mistakeRows,
    gameRows,
    executionRows,
    cumulativeNetPnlSeries,
    dailyNetPnlSeries,
    feesByDateSeries,
    sharesTradedByDateSeries,
    playbookNetPnlSeries,
    mistakeLossSeries,
    bestDailyNetPnl,
    worstDailyNetPnl,
    highestFeeDay,
    mostActiveShareDay,
    bestPlaybook,
    costliestMistake,
    topSymbolLabel
  };
};

export const ReportsPage = ({
  trades,
  externalTradeDateFilterStart = "",
  externalTradeDateFilterEnd = "",
  externalPlaybookFilter = "all",
  externalSymbolFilter = "all",
  externalStatusFilter = "all",
  externalGameFilter = "all",
  externalExecutionFilter = "all",
  onFiltersChange
}: ReportsPageProps) => {
  const [selectedTradeDateFilterStart, setSelectedTradeDateFilterStart] = useState(externalTradeDateFilterStart);
  const [selectedTradeDateFilterEnd, setSelectedTradeDateFilterEnd] = useState(externalTradeDateFilterEnd);
  const [selectedPlaybookFilter, setSelectedPlaybookFilter] = useState(externalPlaybookFilter);
  const [selectedSymbolFilter, setSelectedSymbolFilter] = useState(externalSymbolFilter);
  const [selectedStatusFilter, setSelectedStatusFilter] = useState(externalStatusFilter);
  const [selectedGameFilter, setSelectedGameFilter] = useState(externalGameFilter);
  const [selectedExecutionFilter, setSelectedExecutionFilter] = useState(externalExecutionFilter);
  const [reportSliceMode, setReportSliceMode] = useState<ReportSliceMode>("current");

  useEffect(() => {
    setSelectedTradeDateFilterStart(externalTradeDateFilterStart);
  }, [externalTradeDateFilterStart]);

  useEffect(() => {
    setSelectedTradeDateFilterEnd(externalTradeDateFilterEnd);
  }, [externalTradeDateFilterEnd]);

  useEffect(() => {
    setSelectedPlaybookFilter(externalPlaybookFilter);
  }, [externalPlaybookFilter]);

  useEffect(() => {
    setSelectedSymbolFilter(externalSymbolFilter);
  }, [externalSymbolFilter]);

  useEffect(() => {
    setSelectedStatusFilter(externalStatusFilter);
  }, [externalStatusFilter]);

  useEffect(() => {
    setSelectedGameFilter(externalGameFilter);
  }, [externalGameFilter]);

  useEffect(() => {
    setSelectedExecutionFilter(externalExecutionFilter);
  }, [externalExecutionFilter]);

  useEffect(() => {
    onFiltersChange?.({
      startValue: selectedTradeDateFilterStart,
      endValue: selectedTradeDateFilterEnd,
      playbook: selectedPlaybookFilter,
      symbol: selectedSymbolFilter,
      status: selectedStatusFilter,
      game: selectedGameFilter,
      execution: selectedExecutionFilter
    });
  }, [
    onFiltersChange,
    selectedExecutionFilter,
    selectedGameFilter,
    selectedPlaybookFilter,
    selectedStatusFilter,
    selectedSymbolFilter,
    selectedTradeDateFilterEnd,
    selectedTradeDateFilterStart
  ]);

  const tradeDateOptions = useMemo(
    () => Array.from(new Set(trades.map((trade) => trade.tradeDate))).sort((left, right) => right.localeCompare(left)),
    [trades]
  );
  const resolveRecentSessionRange = (sessionCount: number): { startValue: string; endValue: string } | null => {
    const selectedDates = tradeDateOptions.slice(0, sessionCount);
    if (selectedDates.length === 0) {
      return null;
    }

    return {
      startValue: selectedDates[selectedDates.length - 1],
      endValue: selectedDates[0]
    };
  };
  const applyDatePreset = (preset: DateRangePreset) => {
    if (!preset.sessionCount) {
      setSelectedTradeDateFilterStart("");
      setSelectedTradeDateFilterEnd("");
      return;
    }

    const range = resolveRecentSessionRange(preset.sessionCount);
    if (!range) {
      setSelectedTradeDateFilterStart("");
      setSelectedTradeDateFilterEnd("");
      return;
    }

    setSelectedTradeDateFilterStart(range.startValue);
    setSelectedTradeDateFilterEnd(range.endValue);
  };
  const isDatePresetActive = (preset: DateRangePreset): boolean => {
    if (!preset.sessionCount) {
      return !selectedTradeDateFilterStart && !selectedTradeDateFilterEnd;
    }

    const range = resolveRecentSessionRange(preset.sessionCount);
    if (!range) {
      return false;
    }

    return selectedTradeDateFilterStart === range.startValue && selectedTradeDateFilterEnd === range.endValue;
  };

  const playbookOptions = useMemo(
    () => getTradePlaybookOptions(trades),
    [trades]
  );
  const playbookFilterOptions = useMemo(
    () => {
      const merged = new Set(playbookOptions);
      const trimmedSelectedPlaybook = selectedPlaybookFilter.trim();
      if (trimmedSelectedPlaybook && trimmedSelectedPlaybook !== "all") {
        merged.add(trimmedSelectedPlaybook);
      }

      return [
        { label: "All Playbooks", value: "all" },
        ...Array.from(merged)
          .sort((left, right) => left.localeCompare(right))
          .map((playbook) => ({ label: playbook, value: playbook }))
      ];
    },
    [playbookOptions, selectedPlaybookFilter]
  );

  const symbolOptions = useMemo(
    () => Array.from(new Set(trades.map((trade) => trade.symbol))).sort((left, right) => left.localeCompare(right)),
    [trades]
  );

  const statusOptions = useMemo(
    () => Array.from(new Set(trades.map((trade) => trade.status))).sort((left, right) => left.localeCompare(right)),
    [trades]
  );

  const gameOptions = useMemo(
    () =>
      Array.from(
        new Set(trades.map((trade) => trade.game).filter((value) => value.trim().length > 0))
      ).sort((left, right) => left.localeCompare(right)),
    [trades]
  );

  const executionOptions = useMemo(
    () =>
      Array.from(
        new Set(
          trades
            .flatMap((trade) => trade.execution)
            .filter((value) => value.trim().length > 0)
        )
      ).sort((left, right) => left.localeCompare(right)),
    [trades]
  );

  const attributeFilteredTrades = useMemo(
    () =>
      trades.filter((trade) => {
        if (selectedPlaybookFilter !== "all" && !tradeHasPlaybook(trade, selectedPlaybookFilter)) {
          return false;
        }

        if (selectedSymbolFilter !== "all" && trade.symbol !== selectedSymbolFilter) {
          return false;
        }

        if (selectedStatusFilter !== "all" && trade.status !== selectedStatusFilter) {
          return false;
        }

        if (selectedGameFilter !== "all" && trade.game !== selectedGameFilter) {
          return false;
        }

        if (
          selectedExecutionFilter !== "all" &&
          !trade.execution.includes(selectedExecutionFilter)
        ) {
          return false;
        }

        return true;
      }),
    [
      trades,
      selectedExecutionFilter,
      selectedGameFilter,
      selectedPlaybookFilter,
      selectedStatusFilter,
      selectedSymbolFilter
    ]
  );

  const filteredTrades = useMemo(
    () =>
      attributeFilteredTrades.filter((trade) => {
        if (selectedTradeDateFilterStart && trade.tradeDate < selectedTradeDateFilterStart) {
          return false;
        }

        if (selectedTradeDateFilterEnd && trade.tradeDate > selectedTradeDateFilterEnd) {
          return false;
        }

        return true;
      }),
    [
      attributeFilteredTrades,
      selectedTradeDateFilterEnd,
      selectedTradeDateFilterStart
    ]
  );

  const comparisonWindow = useMemo(() => {
    const currentDatesDesc = Array.from(new Set(filteredTrades.map((trade) => trade.tradeDate))).sort((left, right) =>
      right.localeCompare(left)
    );
    const allFilteredDatesDesc = Array.from(new Set(attributeFilteredTrades.map((trade) => trade.tradeDate))).sort((left, right) =>
      right.localeCompare(left)
    );
    const currentDatesAsc = [...currentDatesDesc].reverse();

    if (currentDatesDesc.length === 0 || allFilteredDatesDesc.length === 0) {
      return {
        currentDatesAsc,
        currentSessionCount: currentDatesDesc.length,
        previousDatesAsc: [] as string[],
        previousSessionCount: 0,
        previousTrades: [] as GroupedTrade[]
      };
    }

    const earliestCurrentDate = currentDatesDesc[currentDatesDesc.length - 1];
    const earliestCurrentDateIndex = allFilteredDatesDesc.indexOf(earliestCurrentDate);
    const previousDatesDesc =
      earliestCurrentDateIndex >= 0
        ? allFilteredDatesDesc.slice(
            earliestCurrentDateIndex + 1,
            earliestCurrentDateIndex + 1 + currentDatesDesc.length
          )
        : [];
    const previousDateSet = new Set(previousDatesDesc);
    const previousTrades =
      previousDateSet.size > 0 ? attributeFilteredTrades.filter((trade) => previousDateSet.has(trade.tradeDate)) : [];

    return {
      currentDatesAsc,
      currentSessionCount: currentDatesDesc.length,
      previousDatesAsc: [...previousDatesDesc].reverse(),
      previousSessionCount: previousDatesDesc.length,
      previousTrades
    };
  }, [attributeFilteredTrades, filteredTrades]);
  const hasPreviousSlice = comparisonWindow.previousSessionCount > 0 && comparisonWindow.previousTrades.length > 0;
  const currentSliceMetrics = useMemo(() => buildReportSliceMetrics(filteredTrades), [filteredTrades]);
  const previousSliceMetrics = useMemo(
    () => buildReportSliceMetrics(comparisonWindow.previousTrades),
    [comparisonWindow.previousTrades]
  );
  const effectiveSliceMode: ReportSliceMode = reportSliceMode === "previous" && hasPreviousSlice ? "previous" : "current";
  const activeSliceMetrics = effectiveSliceMode === "previous" ? previousSliceMetrics : currentSliceMetrics;
  const {
    symbols,
    reportSummary,
    avgWinner,
    avgLoser,
    hourlyBreakdown,
    symbolRows,
    topSymbols,
    gatewayRows,
    setupRows,
    mistakeRows,
    gameRows,
    executionRows,
    cumulativeNetPnlSeries,
    dailyNetPnlSeries,
    feesByDateSeries,
    sharesTradedByDateSeries,
    playbookNetPnlSeries,
    mistakeLossSeries,
    bestDailyNetPnl,
    worstDailyNetPnl,
    highestFeeDay,
    mostActiveShareDay,
    bestPlaybook,
    costliestMistake,
    topSymbolLabel
  } = activeSliceMetrics;
  const currentSliceWindowLabel = formatDateWindow(comparisonWindow.currentDatesAsc);
  const previousSliceWindowLabel = formatDateWindow(comparisonWindow.previousDatesAsc);
  const activeSliceWindowLabel = effectiveSliceMode === "previous" ? previousSliceWindowLabel : currentSliceWindowLabel;
  const activeSliceSessionCount =
    effectiveSliceMode === "previous" ? comparisonWindow.previousSessionCount : comparisonWindow.currentSessionCount;
  const comparisonReferenceMetrics = effectiveSliceMode === "previous" ? currentSliceMetrics : previousSliceMetrics;
  const comparisonReferenceSummary = comparisonReferenceMetrics.reportSummary;
  const comparisonReferenceLabel = effectiveSliceMode === "previous" ? "Current" : "Prev";
  const activeSliceLabel = effectiveSliceMode === "previous" ? "Previous" : "Current";
  const comparisonSliceLabel = effectiveSliceMode === "previous" ? "Current" : "Previous";
  const hourlyComparisonRows = useMemo(
    () =>
      buildHourlyComparisonRows(
        hourlyBreakdown,
        comparisonReferenceMetrics.hourlyBreakdown,
        hasPreviousSlice
      ),
    [comparisonReferenceMetrics.hourlyBreakdown, hasPreviousSlice, hourlyBreakdown]
  );
  const maxHourlyComparisonMagnitude = useMemo(
    () =>
      Math.max(
        ...hourlyComparisonRows.flatMap((row) =>
          row.referenceNetPnl === null
            ? [Math.abs(row.activeNetPnl)]
            : [Math.abs(row.activeNetPnl), Math.abs(row.referenceNetPnl)]
        ),
        1
      ),
    [hourlyComparisonRows]
  );
  const comparisonCoverageNote =
    hasPreviousSlice && comparisonWindow.previousSessionCount < comparisonWindow.currentSessionCount
      ? `Previous slice only has ${comparisonWindow.previousSessionCount} of ${comparisonWindow.currentSessionCount} sessions available.`
      : "";
  useEffect(() => {
    if (!hasPreviousSlice && reportSliceMode === "previous") {
      setReportSliceMode("current");
    }
  }, [hasPreviousSlice, reportSliceMode]);
  const periodComparisonMetrics = useMemo<PeriodComparisonMetric[]>(() => {
    if (!hasPreviousSlice) {
      return [];
    }

    const currentSummary = currentSliceMetrics.reportSummary;
    const previousSummary = previousSliceMetrics.reportSummary;
    const netDelta = currentSummary.totalNetPnl - previousSummary.totalNetPnl;
    const winRateDelta = currentSummary.winRate - previousSummary.winRate;
    const tradeDelta = currentSummary.totalTrades - previousSummary.totalTrades;
    const avgTradeDelta = currentSummary.avgTrade - previousSummary.avgTrade;

    return [
      {
        key: "net",
        label: "Net P&L",
        currentValue: formatSignedMoney(currentSummary.totalNetPnl),
        previousValue: formatSignedMoney(previousSummary.totalNetPnl),
        deltaValue: `${formatSignedMoney(netDelta)} (${formatRelativeDelta(netDelta, previousSummary.totalNetPnl)})`,
        tone: getDeltaTone(netDelta)
      },
      {
        key: "winRate",
        label: "Win Rate",
        currentValue: `${currentSummary.winRate.toFixed(1)}%`,
        previousValue: `${previousSummary.winRate.toFixed(1)}%`,
        deltaValue: `${winRateDelta >= 0 ? "+" : ""}${winRateDelta.toFixed(1)} pts`,
        tone: getDeltaTone(winRateDelta)
      },
      {
        key: "trades",
        label: "Trades",
        currentValue: currentSummary.totalTrades.toLocaleString(),
        previousValue: previousSummary.totalTrades.toLocaleString(),
        deltaValue: `${formatSignedCount(tradeDelta)} (${formatRelativeDelta(tradeDelta, previousSummary.totalTrades)})`,
        tone: getDeltaTone(tradeDelta)
      },
      {
        key: "avgTrade",
        label: "Avg Trade",
        currentValue: formatSignedMoney(currentSummary.avgTrade),
        previousValue: formatSignedMoney(previousSummary.avgTrade),
        deltaValue: `${formatSignedMoney(avgTradeDelta)} (${formatRelativeDelta(avgTradeDelta, previousSummary.avgTrade)})`,
        tone: getDeltaTone(avgTradeDelta)
      }
    ];
  }, [currentSliceMetrics, hasPreviousSlice, previousSliceMetrics]);
  const activeFilters = [
    selectedTradeDateFilterStart || selectedTradeDateFilterEnd
      ? {
          key: "date" as const,
          label: "Date",
          value: formatActiveDateRange(selectedTradeDateFilterStart, selectedTradeDateFilterEnd)
        }
      : null,
    selectedPlaybookFilter !== "all"
      ? { key: "playbook" as const, label: "Playbook", value: selectedPlaybookFilter }
      : null,
    selectedSymbolFilter !== "all"
      ? { key: "symbol" as const, label: "Symbol", value: selectedSymbolFilter }
      : null,
    selectedStatusFilter !== "all"
      ? { key: "status" as const, label: "Status", value: selectedStatusFilter }
      : null,
    selectedGameFilter !== "all"
      ? { key: "game" as const, label: "Game", value: selectedGameFilter }
      : null,
    selectedExecutionFilter !== "all"
      ? { key: "execution" as const, label: "Execution", value: selectedExecutionFilter }
      : null
  ].filter((value): value is { key: ActiveReportFilterKey; label: string; value: string } => value !== null);

  const clearFilters = () => {
    setSelectedTradeDateFilterStart("");
    setSelectedTradeDateFilterEnd("");
    setSelectedPlaybookFilter("all");
    setSelectedSymbolFilter("all");
    setSelectedStatusFilter("all");
    setSelectedGameFilter("all");
    setSelectedExecutionFilter("all");
  };
  const clearFilter = (filterKey: ActiveReportFilterKey) => {
    switch (filterKey) {
      case "date":
        setSelectedTradeDateFilterStart("");
        setSelectedTradeDateFilterEnd("");
        break;
      case "playbook":
        setSelectedPlaybookFilter("all");
        break;
      case "symbol":
        setSelectedSymbolFilter("all");
        break;
      case "status":
        setSelectedStatusFilter("all");
        break;
      case "game":
        setSelectedGameFilter("all");
        break;
      case "execution":
        setSelectedExecutionFilter("all");
        break;
      default:
        break;
    }
  };

  return (
    <main className="page-shell">
      <PageHero
        eyebrow="Reports"
        title="Reports"
        className="page-hero-reports"
        content={
          <section className="trade-view-filter-panel page-hero-review-slice-embedded">
            <div className="trade-view-filter-header">
              <div className="panel-header">
                <WorkspaceIcon icon="review-slice" alt="Review slice icon" className="panel-header-icon" />
                <h2>Review Slice</h2>
              </div>
              <button type="button" className="mini-action" onClick={clearFilters}>
                Clear All
              </button>
            </div>
            <div className="trade-view-filter-grid trade-view-filter-grid-reports">
              <label className="trade-filter-field">
                <span>Date</span>
                <DateFilterPopover
                  mode="range"
                  startValue={selectedTradeDateFilterStart}
                  endValue={selectedTradeDateFilterEnd}
                  onRangeChange={(startValue, endValue) => {
                    setSelectedTradeDateFilterStart(startValue);
                    setSelectedTradeDateFilterEnd(endValue);
                  }}
                  availableDates={tradeDateOptions}
                  allLabel="All Dates"
                />
              </label>
              <label className="trade-filter-field">
                <span>Playbook</span>
                <FilterSelect
                  ariaLabel="Report playbook filter"
                  value={selectedPlaybookFilter}
                  onChange={setSelectedPlaybookFilter}
                  options={playbookFilterOptions}
                />
              </label>
              <label className="trade-filter-field">
                <span>Symbol</span>
                <FilterSelect
                  ariaLabel="Report symbol filter"
                  value={selectedSymbolFilter}
                  onChange={setSelectedSymbolFilter}
                  options={[
                    { label: "All Symbols", value: "all" },
                    ...symbolOptions.map((symbol) => ({ label: symbol, value: symbol }))
                  ]}
                />
              </label>
              <label className="trade-filter-field">
                <span>Status</span>
                <FilterSelect
                  ariaLabel="Report status filter"
                  value={selectedStatusFilter}
                  onChange={setSelectedStatusFilter}
                  options={[
                    { label: "All Status", value: "all" },
                    ...statusOptions.map((status) => ({ label: status, value: status }))
                  ]}
                />
              </label>
              <label className="trade-filter-field">
                <span>Game</span>
                <FilterSelect
                  ariaLabel="Report game filter"
                  value={selectedGameFilter}
                  onChange={setSelectedGameFilter}
                  options={[
                    { label: "All Games", value: "all" },
                    ...gameOptions.map((game) => ({ label: game, value: game }))
                  ]}
                />
              </label>
              <label className="trade-filter-field">
                <span>Execution</span>
                <FilterSelect
                  ariaLabel="Report execution filter"
                  value={selectedExecutionFilter}
                  onChange={setSelectedExecutionFilter}
                  options={[
                    { label: "All Execution", value: "all" },
                    ...executionOptions.map((execution) => ({ label: execution, value: execution }))
                  ]}
                />
              </label>
            </div>
            <div className="report-date-preset-row">
              <span>Quick Ranges</span>
              <div className="report-date-preset-actions">
                {DATE_RANGE_PRESETS.map((preset) => (
                  <button
                    key={preset.key}
                    type="button"
                    className={`mini-action report-date-preset-action ${isDatePresetActive(preset) ? "report-date-preset-action-active" : ""}`}
                    onClick={() => applyDatePreset(preset)}
                    disabled={Boolean(preset.sessionCount && tradeDateOptions.length === 0)}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="active-filter-chip-row dashboard-review-chip-row" aria-label="Active report slice">
              {activeFilters.length > 0 ? (
                activeFilters.map((filter) => (
                  <span key={filter.key} className="active-filter-chip">
                    <strong>{filter.label}</strong>
                    <span>{filter.value}</span>
                    <button
                      type="button"
                      className="active-filter-chip-remove"
                      aria-label={`Clear ${filter.label} filter`}
                      onClick={() => clearFilter(filter.key)}
                    >
                      x
                    </button>
                  </span>
                ))
              ) : (
                <span className="active-filter-chip active-filter-chip-muted">
                  <strong>Slice</strong>
                  <span>All saved sessions</span>
                </span>
              )}
            </div>
          </section>
        }
      >
        <div className="page-hero-stat-grid">
          <div className="page-hero-stat-card report-hero-stat-card">
            <span>Range</span>
            <strong>{activeSliceWindowLabel}</strong>
            <small>{`${activeSliceSessionCount} sessions (${effectiveSliceMode === "previous" ? "previous" : "current"} slice)`}</small>
          </div>
          <div className="page-hero-stat-card report-hero-stat-card">
            <span>Trades</span>
            <strong>{reportSummary.totalTrades.toLocaleString()}</strong>
            <small>{reportSummary.winCount} wins / {reportSummary.lossCount} losses</small>
          </div>
          <div className="page-hero-stat-card report-hero-stat-card">
            <span>Symbols</span>
            <strong>{symbols}</strong>
            <small>Top: {topSymbolLabel}</small>
          </div>
          <div
            className={`page-hero-stat-card report-hero-stat-card ${
              reportSummary.totalNetPnl >= 0 ? "report-hero-stat-card-positive" : "report-hero-stat-card-negative"
            }`}
          >
            <span>Net P&amp;L</span>
            <strong className={getSignedValueClassName(reportSummary.totalNetPnl)}>{formatSignedMoney(reportSummary.totalNetPnl)}</strong>
            <small>
              {hasPreviousSlice
                ? `${comparisonReferenceLabel} ${formatSignedMoney(comparisonReferenceSummary.totalNetPnl)}`
                : "Pick a quick range to compare periods"}
            </small>
          </div>
        </div>
      </PageHero>
      <section className="placeholder-panel report-period-compare-panel">
        <div className="report-period-compare-header">
          <div className="panel-header">
            <WorkspaceIcon icon="dashboard" alt="Period comparison icon" className="panel-header-icon" />
            <h2>Period Comparison</h2>
          </div>
          {hasPreviousSlice ? (
            <div className="report-period-compare-actions">
              <span className="report-period-compare-badge">Current vs Previous Slice</span>
              <div className="report-slice-mode-toggle" role="tablist" aria-label="Report slice mode">
                <button
                  type="button"
                  className={`mini-action report-slice-mode-button ${effectiveSliceMode === "current" ? "report-slice-mode-button-active" : ""}`}
                  onClick={() => setReportSliceMode("current")}
                  aria-pressed={effectiveSliceMode === "current"}
                >
                  View Current
                </button>
                <button
                  type="button"
                  className={`mini-action report-slice-mode-button ${effectiveSliceMode === "previous" ? "report-slice-mode-button-active" : ""}`}
                  onClick={() => setReportSliceMode("previous")}
                  aria-pressed={effectiveSliceMode === "previous"}
                >
                  View Previous
                </button>
              </div>
            </div>
          ) : (
            <span className="report-period-compare-badge">Current vs Previous Slice</span>
          )}
        </div>
        {hasPreviousSlice ? (
          <>
            <div className="report-period-window-grid">
              <div className="report-period-window-card report-period-window-card-current">
                <span>Current Slice</span>
                <strong>{currentSliceWindowLabel}</strong>
                <small>{comparisonWindow.currentSessionCount} sessions</small>
              </div>
              <div className="report-period-window-card report-period-window-card-previous">
                <span>Previous Slice</span>
                <strong>{previousSliceWindowLabel}</strong>
                <small>{comparisonWindow.previousSessionCount} sessions</small>
              </div>
            </div>
            {comparisonCoverageNote ? <div className="report-period-compare-note">{comparisonCoverageNote}</div> : null}
            <div className="report-period-metric-grid">
              {periodComparisonMetrics.map((metric) => (
                <div
                  key={metric.key}
                  className={`report-period-metric-card report-period-metric-card-${metric.tone}`}
                >
                  <span>{metric.label}</span>
                  <strong>{metric.currentValue}</strong>
                  <small>Prev {metric.previousValue}</small>
                  <em className={`report-period-delta report-period-delta-${metric.tone}`}>{metric.deltaValue}</em>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="empty-state report-period-compare-empty">
            Narrow the date range (Quick Ranges works well) to compare the current slice against a previous one.
          </div>
        )}
      </section>
      <div className="report-slice-context-note">
        Showing <strong>{effectiveSliceMode === "previous" ? "Previous Slice" : "Current Slice"}</strong> across all report panels.
      </div>
      <section className="analytics-grid">
        <article className="placeholder-panel analytics-panel analytics-grid-full">
          <div className="panel-header">
            <WorkspaceIcon icon="dashboard" alt="Filtered slice summary icon" className="panel-header-icon" />
            <h2>Filtered Slice Summary</h2>
          </div>
          <div className="intraday-metrics-grid">
            <div className="intraday-metric-card">
              <span>Net P&amp;L</span>
              <strong>{formatSignedMoney(reportSummary.totalNetPnl)}</strong>
              {hasPreviousSlice ? (
                <>
                  <small>{comparisonReferenceLabel} {formatSignedMoney(comparisonReferenceSummary.totalNetPnl)}</small>
                  <em className={`report-period-delta report-period-delta-${getDeltaTone(reportSummary.totalNetPnl - comparisonReferenceSummary.totalNetPnl)}`}>
                    {formatSignedMoney(reportSummary.totalNetPnl - comparisonReferenceSummary.totalNetPnl)} (
                    {formatRelativeDelta(reportSummary.totalNetPnl - comparisonReferenceSummary.totalNetPnl, comparisonReferenceSummary.totalNetPnl)})
                  </em>
                </>
              ) : null}
            </div>
            <div className="intraday-metric-card">
              <span>Gross P&amp;L</span>
              <strong>{formatSignedMoney(reportSummary.totalGrossPnl)}</strong>
              {hasPreviousSlice ? (
                <>
                  <small>{comparisonReferenceLabel} {formatSignedMoney(comparisonReferenceSummary.totalGrossPnl)}</small>
                  <em className={`report-period-delta report-period-delta-${getDeltaTone(reportSummary.totalGrossPnl - comparisonReferenceSummary.totalGrossPnl)}`}>
                    {formatSignedMoney(reportSummary.totalGrossPnl - comparisonReferenceSummary.totalGrossPnl)} (
                    {formatRelativeDelta(reportSummary.totalGrossPnl - comparisonReferenceSummary.totalGrossPnl, comparisonReferenceSummary.totalGrossPnl)})
                  </em>
                </>
              ) : null}
            </div>
            <div className="intraday-metric-card">
              <span>Fees</span>
              <strong>${reportSummary.totalFees.toFixed(2)}</strong>
              {hasPreviousSlice ? (
                <>
                  <small>{comparisonReferenceLabel} ${comparisonReferenceSummary.totalFees.toFixed(2)}</small>
                  <em className={`report-period-delta report-period-delta-${getDeltaTone(reportSummary.totalFees - comparisonReferenceSummary.totalFees)}`}>
                    {formatSignedMoney(reportSummary.totalFees - comparisonReferenceSummary.totalFees)} (
                    {formatRelativeDelta(reportSummary.totalFees - comparisonReferenceSummary.totalFees, comparisonReferenceSummary.totalFees)})
                  </em>
                </>
              ) : null}
            </div>
            <div className="intraday-metric-card">
              <span>Trades</span>
              <strong>{reportSummary.totalTrades}</strong>
              {hasPreviousSlice ? (
                <>
                  <small>{comparisonReferenceLabel} {comparisonReferenceSummary.totalTrades}</small>
                  <em className={`report-period-delta report-period-delta-${getDeltaTone(reportSummary.totalTrades - comparisonReferenceSummary.totalTrades)}`}>
                    {formatSignedCount(reportSummary.totalTrades - comparisonReferenceSummary.totalTrades)} (
                    {formatRelativeDelta(reportSummary.totalTrades - comparisonReferenceSummary.totalTrades, comparisonReferenceSummary.totalTrades)})
                  </em>
                </>
              ) : null}
            </div>
            <div className="intraday-metric-card">
              <span>Shares</span>
              <strong>{reportSummary.totalSharesTraded.toLocaleString()}</strong>
              {hasPreviousSlice ? (
                <>
                  <small>{comparisonReferenceLabel} {comparisonReferenceSummary.totalSharesTraded.toLocaleString()}</small>
                  <em className={`report-period-delta report-period-delta-${getDeltaTone(reportSummary.totalSharesTraded - comparisonReferenceSummary.totalSharesTraded)}`}>
                    {formatSignedCount(reportSummary.totalSharesTraded - comparisonReferenceSummary.totalSharesTraded)} (
                    {formatRelativeDelta(reportSummary.totalSharesTraded - comparisonReferenceSummary.totalSharesTraded, comparisonReferenceSummary.totalSharesTraded)})
                  </em>
                </>
              ) : null}
            </div>
            <div className="intraday-metric-card">
              <span>Win Rate</span>
              <strong>{reportSummary.winRate.toFixed(1)}%</strong>
              {hasPreviousSlice ? (
                <>
                  <small>{comparisonReferenceLabel} {comparisonReferenceSummary.winRate.toFixed(1)}%</small>
                  <em className={`report-period-delta report-period-delta-${getDeltaTone(reportSummary.winRate - comparisonReferenceSummary.winRate)}`}>
                    {formatSignedNumber(reportSummary.winRate - comparisonReferenceSummary.winRate, 1)} pts
                  </em>
                </>
              ) : null}
            </div>
            <div className="intraday-metric-card">
              <span>Profit Factor</span>
              <strong>{reportSummary.profitFactor === 999 ? "Open" : reportSummary.profitFactor.toFixed(2)}</strong>
              {hasPreviousSlice ? (
                <>
                  <small>
                    {comparisonReferenceLabel} {comparisonReferenceSummary.profitFactor === 999 ? "Open" : comparisonReferenceSummary.profitFactor.toFixed(2)}
                  </small>
                  {reportSummary.profitFactor !== 999 && comparisonReferenceSummary.profitFactor !== 999 ? (
                    <em className={`report-period-delta report-period-delta-${getDeltaTone(reportSummary.profitFactor - comparisonReferenceSummary.profitFactor)}`}>
                      {formatSignedNumber(reportSummary.profitFactor - comparisonReferenceSummary.profitFactor, 2)}
                    </em>
                  ) : null}
                </>
              ) : null}
            </div>
            <div className="intraday-metric-card">
              <span>Avg Winner / Loser</span>
              <strong>{formatSignedMoney(avgWinner)} / {formatSignedMoney(avgLoser)}</strong>
              {hasPreviousSlice ? (
                <>
                  <small>
                    {comparisonReferenceLabel} {formatSignedMoney(comparisonReferenceMetrics.avgWinner)} / {formatSignedMoney(comparisonReferenceMetrics.avgLoser)}
                  </small>
                  <em className={`report-period-delta report-period-delta-${getDeltaTone(reportSummary.avgTrade - comparisonReferenceSummary.avgTrade)}`}>
                    Avg Trade {formatSignedMoney(reportSummary.avgTrade - comparisonReferenceSummary.avgTrade)}
                  </em>
                </>
              ) : null}
            </div>
          </div>
        </article>
      </section>
      <section className="placeholder-panel report-insights-panel">
        <div className="panel-header">
          <WorkspaceIcon icon="reports" alt="Report insights icon" className="panel-header-icon" />
          <h2>Quick Read</h2>
        </div>
        <div className="report-insight-grid">
          <div className="report-insight-card">
            <span>Best Day</span>
            <strong>{bestDailyNetPnl ? formatReportDate(bestDailyNetPnl.label) : "No data"}</strong>
            <em className={bestDailyNetPnl && bestDailyNetPnl.value >= 0 ? "positive-value" : "negative-value"}>
              {bestDailyNetPnl ? formatSignedMoney(bestDailyNetPnl.value) : "$0.00"}
            </em>
            {hasPreviousSlice ? (
              <small>
                {comparisonReferenceLabel}{" "}
                {comparisonReferenceMetrics.bestDailyNetPnl
                  ? `${formatReportDate(comparisonReferenceMetrics.bestDailyNetPnl.label)} (${formatSignedMoney(comparisonReferenceMetrics.bestDailyNetPnl.value)})`
                  : "No data"}
              </small>
            ) : null}
          </div>
          <div className="report-insight-card">
            <span>Worst Day</span>
            <strong>{worstDailyNetPnl ? formatReportDate(worstDailyNetPnl.label) : "No data"}</strong>
            <em className={worstDailyNetPnl && worstDailyNetPnl.value >= 0 ? "positive-value" : "negative-value"}>
              {worstDailyNetPnl ? formatSignedMoney(worstDailyNetPnl.value) : "$0.00"}
            </em>
            {hasPreviousSlice ? (
              <small>
                {comparisonReferenceLabel}{" "}
                {comparisonReferenceMetrics.worstDailyNetPnl
                  ? `${formatReportDate(comparisonReferenceMetrics.worstDailyNetPnl.label)} (${formatSignedMoney(comparisonReferenceMetrics.worstDailyNetPnl.value)})`
                  : "No data"}
              </small>
            ) : null}
          </div>
          <div className="report-insight-card">
            <span>Most Fees</span>
            <strong>{highestFeeDay ? formatReportDate(highestFeeDay.label) : "No data"}</strong>
            <em>{highestFeeDay ? `$${highestFeeDay.value.toFixed(2)}` : "$0.00"}</em>
            {hasPreviousSlice ? (
              <small>
                {comparisonReferenceLabel}{" "}
                {comparisonReferenceMetrics.highestFeeDay
                  ? `${formatReportDate(comparisonReferenceMetrics.highestFeeDay.label)} ($${comparisonReferenceMetrics.highestFeeDay.value.toFixed(2)})`
                  : "No data"}
              </small>
            ) : null}
          </div>
          <div className="report-insight-card">
            <span>Most Active</span>
            <strong>{mostActiveShareDay ? formatReportDate(mostActiveShareDay.label) : "No data"}</strong>
            <em>{mostActiveShareDay ? `${mostActiveShareDay.value.toLocaleString()} shares` : "0 shares"}</em>
            {hasPreviousSlice ? (
              <small>
                {comparisonReferenceLabel}{" "}
                {comparisonReferenceMetrics.mostActiveShareDay
                  ? `${formatReportDate(comparisonReferenceMetrics.mostActiveShareDay.label)} (${comparisonReferenceMetrics.mostActiveShareDay.value.toLocaleString()} shares)`
                  : "No data"}
              </small>
            ) : null}
          </div>
          <div className="report-insight-card">
            <span>Best Playbook</span>
            <strong>{bestPlaybook?.label ?? "No tagged playbook"}</strong>
            <em className={bestPlaybook && bestPlaybook.netPnl >= 0 ? "positive-value" : "negative-value"}>
              {bestPlaybook ? `${formatSignedMoney(bestPlaybook.netPnl)} across ${bestPlaybook.trades} trades` : "$0.00"}
            </em>
            {hasPreviousSlice ? (
              <small>
                {comparisonReferenceLabel}{" "}
                {comparisonReferenceMetrics.bestPlaybook
                  ? `${comparisonReferenceMetrics.bestPlaybook.label} (${formatSignedMoney(comparisonReferenceMetrics.bestPlaybook.netPnl)})`
                  : "No tagged playbook"}
              </small>
            ) : null}
          </div>
          <div className="report-insight-card">
            <span>Costliest Mistake</span>
            <strong>{costliestMistake?.label ?? "No losing mistake tag"}</strong>
            <em className="negative-value">
              {costliestMistake ? `${formatSignedMoney(costliestMistake.netPnl)} across ${costliestMistake.trades} trades` : "$0.00"}
            </em>
            {hasPreviousSlice ? (
              <small>
                {comparisonReferenceLabel}{" "}
                {comparisonReferenceMetrics.costliestMistake
                  ? `${comparisonReferenceMetrics.costliestMistake.label} (${formatSignedMoney(comparisonReferenceMetrics.costliestMistake.netPnl)})`
                  : "No losing mistake tag"}
              </small>
            ) : null}
          </div>
        </div>
      </section>
      <section className="analytics-grid analytics-grid-single">
        <article className="placeholder-panel analytics-panel">
          <ReportLineChart
            points={cumulativeNetPnlSeries}
            comparePoints={hasPreviousSlice ? comparisonReferenceMetrics.cumulativeNetPnlSeries : []}
            color="#89d8ab"
            title="Cumulative Net P&L"
            yAxisLabel="Net PnL USD (Running)"
            valueFormatter={(value) => formatSignedMoney(value)}
            primarySeriesLabel={activeSliceLabel}
            compareSeriesLabel={comparisonSliceLabel}
          />
        </article>
      </section>
      <section className="analytics-grid">
        <article className="placeholder-panel analytics-panel">
          <ReportBarChart
            points={dailyNetPnlSeries}
            comparePoints={hasPreviousSlice ? comparisonReferenceMetrics.dailyNetPnlSeries : []}
            title="Daily Net P&L"
            yAxisLabel="Net PnL USD"
            positiveColor="#2ee6d6"
            negativeColor="#b42eff"
            valueFormatter={(value) => formatSignedMoney(value)}
            primarySeriesLabel={activeSliceLabel}
            compareSeriesLabel={comparisonSliceLabel}
          />
        </article>
        <article className="placeholder-panel analytics-panel">
          <ReportBarChart
            points={feesByDateSeries}
            comparePoints={hasPreviousSlice ? comparisonReferenceMetrics.feesByDateSeries : []}
            title="Fees Over Time"
            yAxisLabel="Fees USD"
            color="#ffd66b"
            positiveColor="#ffd66b"
            negativeColor="#ffd66b"
            valueFormatter={(value) => `$${value.toFixed(2)}`}
            primarySeriesLabel={activeSliceLabel}
            compareSeriesLabel={comparisonSliceLabel}
          />
        </article>
      </section>
      <section className="analytics-grid">
        <article className="placeholder-panel analytics-panel">
          <ReportBarChart
            points={sharesTradedByDateSeries}
            comparePoints={hasPreviousSlice ? comparisonReferenceMetrics.sharesTradedByDateSeries : []}
            title="Shares Traded Over Time"
            yAxisLabel="Shares Traded"
            color="#5da8ff"
            positiveColor="#5da8ff"
            valueFormatter={(value) => value.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            primarySeriesLabel={activeSliceLabel}
            compareSeriesLabel={comparisonSliceLabel}
          />
        </article>
        <article className="placeholder-panel analytics-panel">
          <ReportBarChart
            points={playbookNetPnlSeries}
            comparePoints={hasPreviousSlice ? comparisonReferenceMetrics.playbookNetPnlSeries : []}
            title="Best / Worst Playbooks"
            yAxisLabel="Net PnL USD"
            color="#5da8ff"
            positiveColor="#2ee6d6"
            negativeColor="#b42eff"
            valueFormatter={(value) => formatSignedMoney(value)}
            primarySeriesLabel={activeSliceLabel}
            compareSeriesLabel={comparisonSliceLabel}
          />
        </article>
      </section>
      <section className="analytics-grid analytics-grid-single">
        <article className="placeholder-panel analytics-panel">
          <ReportBarChart
            points={mistakeLossSeries}
            comparePoints={hasPreviousSlice ? comparisonReferenceMetrics.mistakeLossSeries : []}
            title="Mistakes By Total Loss"
            yAxisLabel="Net PnL USD"
            color="#ff6f91"
            positiveColor="#2ee6d6"
            negativeColor="#ff6f91"
            valueFormatter={(value) => formatSignedMoney(value)}
            primarySeriesLabel={activeSliceLabel}
            compareSeriesLabel={comparisonSliceLabel}
          />
        </article>
      </section>
      <section className="analytics-grid">
        <article className="placeholder-panel analytics-panel">
          <div className="panel-header">
            <WorkspaceIcon icon="dashboard" alt="Session breakdown icon" className="panel-header-icon" />
            <h2>Breakdown: Session</h2>
          </div>
          <AnalyticsTable
            rows={hourlyBreakdown}
            emptyMessage="Adjust the report filters to populate session breakdowns."
            columns={[
              { key: "label", label: "30 Min", render: (row) => row.label },
              { key: "trades", label: "Trades", render: (row) => row.trades, align: "right" },
              {
                key: "totalSharesTraded",
                label: "Shares",
                render: (row) => (row.totalSharesTraded ?? 0).toLocaleString(),
                align: "right"
              },
              { key: "winRate", label: "Win Rate", render: (row) => `${row.winRate.toFixed(1)}%`, align: "right" },
              {
                key: "netPnl",
                label: "Total P&L",
                render: (row) => formatSignedMoney(row.netPnl),
                align: "right",
                className: (row) => getSignedValueClassName(row.netPnl)
              },
              {
                key: "avgPnl",
                label: "Avg P&L",
                render: (row) => formatSignedMoney(row.avgPnl),
                align: "right",
                className: (row) => getSignedValueClassName(row.avgPnl)
              },
              { key: "totalFees", label: "Fees", render: (row) => `$${(row.totalFees ?? 0).toFixed(2)}`, align: "right" }
            ]}
          />
        </article>
        <article className="placeholder-panel analytics-panel">
          <div className="panel-header">
            <WorkspaceIcon icon="tags" alt="Top symbols icon" className="panel-header-icon" />
            <h2>Top Symbols</h2>
          </div>
          <AnalyticsTable
            rows={topSymbols}
            emptyMessage="Adjust the report filters to populate symbol leaders."
            columns={[
              {
                key: "label",
                label: "Symbol",
                render: (row) => <SymbolPills symbols={[row.label]} />,
                className: "analytics-symbol-cell"
              },
              { key: "trades", label: "Trades", render: (row) => row.trades, align: "right" },
              {
                key: "totalSharesTraded",
                label: "Shares",
                render: (row) => (row.totalSharesTraded ?? 0).toLocaleString(),
                align: "right"
              },
              { key: "winRate", label: "Win Rate", render: (row) => `${row.winRate.toFixed(1)}%`, align: "right" },
              {
                key: "netPnl",
                label: "Net P&L",
                render: (row) => formatSignedMoney(row.netPnl),
                align: "right",
                className: (row) => getSignedValueClassName(row.netPnl)
              },
              { key: "totalFees", label: "Fees", render: (row) => `$${(row.totalFees ?? 0).toFixed(2)}`, align: "right" }
            ]}
          />
        </article>
      </section>
      <section className="analytics-grid analytics-grid-single">
        <article className="placeholder-panel analytics-panel">
          <div className="panel-header">
            <WorkspaceIcon icon="money" alt="Hourly pnl icon" className="panel-header-icon" />
            <h2>30-Min P&amp;L</h2>
            {hasPreviousSlice ? (
              <span className="report-line-chart-readout">
                {activeSliceLabel} (solid) vs {comparisonSliceLabel} (shadow)
              </span>
            ) : null}
          </div>
          {hourlyComparisonRows.length > 0 ? (
            <div className="hourly-pnl-chart">
              {hourlyComparisonRows.map((row) => (
                <div key={row.label} className="hourly-pnl-row">
                  <span className="hourly-pnl-label">{row.label}</span>
                  <div className="hourly-pnl-track">
                    {row.referenceNetPnl !== null ? (
                      <div
                        className={`hourly-pnl-bar hourly-pnl-bar-compare ${
                          row.referenceNetPnl >= 0 ? "hourly-pnl-bar-positive" : "hourly-pnl-bar-negative"
                        }`}
                        style={{
                          width: `${(Math.abs(row.referenceNetPnl) / maxHourlyComparisonMagnitude) * 100}%`
                        }}
                      />
                    ) : null}
                    <div
                      className={`hourly-pnl-bar hourly-pnl-bar-primary ${
                        row.activeNetPnl >= 0 ? "hourly-pnl-bar-positive" : "hourly-pnl-bar-negative"
                      }`}
                      style={{ width: `${(Math.abs(row.activeNetPnl) / maxHourlyComparisonMagnitude) * 100}%` }}
                    />
                  </div>
                  <span className="hourly-pnl-value">
                    {formatSignedMoney(row.activeNetPnl)}
                    {row.referenceNetPnl !== null ? (
                      <small>
                        {comparisonSliceLabel}: {formatSignedMoney(row.referenceNetPnl)}
                      </small>
                    ) : null}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state">Adjust the report filters to populate 30-minute P&amp;L bars.</div>
          )}
        </article>
      </section>
      <section className="analytics-grid">
        <article className="placeholder-panel analytics-panel">
          <div className="panel-header">
            <WorkspaceIcon icon="reports" alt="Symbol performance icon" className="panel-header-icon" />
            <h2>Symbol Performance</h2>
          </div>
          <AnalyticsTable
            rows={symbolRows}
            emptyMessage="Load trades to see symbol performance."
            columns={[
              {
                key: "label",
                label: "Symbol",
                render: (row) => <SymbolPills symbols={[row.label]} />,
                className: "analytics-symbol-cell"
              },
              { key: "trades", label: "Trades", render: (row) => row.trades, align: "right" },
              {
                key: "totalSharesTraded",
                label: "Shares",
                render: (row) => (row.totalSharesTraded ?? 0).toLocaleString(),
                align: "right"
              },
              { key: "winRate", label: "Win Rate", render: (row) => `${row.winRate.toFixed(1)}%`, align: "right" },
              {
                key: "avgPnl",
                label: "Avg Trade",
                render: (row) => formatSignedMoney(row.avgPnl),
                align: "right",
                className: (row) => getSignedValueClassName(row.avgPnl)
              },
              {
                key: "netPnl",
                label: "Net PnL",
                render: (row) => formatSignedMoney(row.netPnl),
                align: "right",
                className: (row) => getSignedValueClassName(row.netPnl)
              },
              { key: "totalFees", label: "Fees", render: (row) => `$${(row.totalFees ?? 0).toFixed(2)}`, align: "right" }
            ]}
          />
        </article>
        <article className="placeholder-panel analytics-panel">
          <div className="panel-header">
            <WorkspaceIcon icon="journal" alt="Setup breakdown icon" className="panel-header-icon" />
            <h2>Playbook Performance</h2>
          </div>
          <AnalyticsTable
            rows={setupRows}
            emptyMessage="Load trades to compare playbooks."
            columns={[
              { key: "label", label: "Playbook", render: (row) => row.label },
              { key: "trades", label: "Trades", render: (row) => row.trades, align: "right" },
              {
                key: "totalSharesTraded",
                label: "Shares",
                render: (row) => (row.totalSharesTraded ?? 0).toLocaleString(),
                align: "right"
              },
              { key: "winRate", label: "Win Rate", render: (row) => `${row.winRate.toFixed(1)}%`, align: "right" },
              {
                key: "avgPnl",
                label: "Avg Trade",
                render: (row) => formatSignedMoney(row.avgPnl),
                align: "right",
                className: (row) => getSignedValueClassName(row.avgPnl)
              },
              {
                key: "netPnl",
                label: "Net PnL",
                render: (row) => formatSignedMoney(row.netPnl),
                align: "right",
                className: (row) => getSignedValueClassName(row.netPnl)
              },
              { key: "totalFees", label: "Fees", render: (row) => `$${(row.totalFees ?? 0).toFixed(2)}`, align: "right" }
            ]}
          />
        </article>
      </section>
      <section className="analytics-grid">
        <article className="placeholder-panel analytics-panel">
          <div className="panel-header">
            <WorkspaceIcon icon="execution" alt="Gateway breakdown icon" className="panel-header-icon" />
            <h2>Gateway Breakdown</h2>
          </div>
          <AnalyticsTable
            rows={gatewayRows}
            emptyMessage="Load trades to see gateway usage."
            columns={[
              { key: "label", label: "Gateway", render: (row) => row.label },
              { key: "trades", label: "Trades", render: (row) => row.trades, align: "right" },
              {
                key: "totalSharesTraded",
                label: "Shares",
                render: (row) => (row.totalSharesTraded ?? 0).toLocaleString(),
                align: "right"
              },
              { key: "totalFees", label: "Fees", render: (row) => `$${(row.totalFees ?? 0).toFixed(2)}`, align: "right" }
            ]}
          />
        </article>
        <article className="placeholder-panel analytics-panel">
          <div className="panel-header">
            <WorkspaceIcon icon="win" alt="Game breakdown icon" className="panel-header-icon" />
            <h2>Game Breakdown</h2>
          </div>
          <AnalyticsTable
            rows={gameRows}
            emptyMessage="Load trades to compare game quality."
            columns={[
              { key: "label", label: "Game", render: (row) => row.label },
              { key: "trades", label: "Trades", render: (row) => row.trades, align: "right" },
              {
                key: "totalSharesTraded",
                label: "Shares",
                render: (row) => (row.totalSharesTraded ?? 0).toLocaleString(),
                align: "right"
              },
              { key: "winRate", label: "Win Rate", render: (row) => `${row.winRate.toFixed(1)}%`, align: "right" },
              {
                key: "avgPnl",
                label: "Avg Trade",
                render: (row) => formatSignedMoney(row.avgPnl),
                align: "right",
                className: (row) => getSignedValueClassName(row.avgPnl)
              },
              {
                key: "netPnl",
                label: "Net PnL",
                render: (row) => formatSignedMoney(row.netPnl),
                align: "right",
                className: (row) => getSignedValueClassName(row.netPnl)
              },
              { key: "totalFees", label: "Fees", render: (row) => `$${(row.totalFees ?? 0).toFixed(2)}`, align: "right" }
            ]}
          />
        </article>
      </section>
      <section className="analytics-grid">
        <article className="placeholder-panel analytics-panel">
          <div className="panel-header">
            <WorkspaceIcon icon="checklist" alt="Mistake breakdown icon" className="panel-header-icon" />
            <h2>Mistake Breakdown</h2>
          </div>
          <AnalyticsTable
            rows={mistakeRows}
            emptyMessage="Load trades to compare mistakes."
            columns={[
              { key: "label", label: "Mistake", render: (row) => row.label },
              { key: "trades", label: "Trades", render: (row) => row.trades, align: "right" },
              {
                key: "totalSharesTraded",
                label: "Shares",
                render: (row) => (row.totalSharesTraded ?? 0).toLocaleString(),
                align: "right"
              },
              { key: "winRate", label: "Win Rate", render: (row) => `${row.winRate.toFixed(1)}%`, align: "right" },
              {
                key: "avgPnl",
                label: "Avg Trade",
                render: (row) => formatSignedMoney(row.avgPnl),
                align: "right",
                className: (row) => getSignedValueClassName(row.avgPnl)
              },
              {
                key: "netPnl",
                label: "Net PnL",
                render: (row) => formatSignedMoney(row.netPnl),
                align: "right",
                className: (row) => getSignedValueClassName(row.netPnl)
              },
              { key: "totalFees", label: "Fees", render: (row) => `$${(row.totalFees ?? 0).toFixed(2)}`, align: "right" }
            ]}
          />
        </article>
        <article className="placeholder-panel analytics-panel">
          <div className="panel-header">
            <WorkspaceIcon icon="execution" alt="Execution breakdown icon" className="panel-header-icon" />
            <h2>Execution Performance</h2>
          </div>
          <AnalyticsTable
            rows={executionRows}
            emptyMessage="Load trades to compare execution styles."
            columns={[
              { key: "label", label: "Execution", render: (row) => row.label },
              { key: "trades", label: "Trades", render: (row) => row.trades, align: "right" },
              {
                key: "totalSharesTraded",
                label: "Shares",
                render: (row) => (row.totalSharesTraded ?? 0).toLocaleString(),
                align: "right"
              },
              { key: "winRate", label: "Win Rate", render: (row) => `${row.winRate.toFixed(1)}%`, align: "right" },
              {
                key: "avgPnl",
                label: "Avg Trade",
                render: (row) => formatSignedMoney(row.avgPnl),
                align: "right",
                className: (row) => getSignedValueClassName(row.avgPnl)
              },
              {
                key: "netPnl",
                label: "Net PnL",
                render: (row) => formatSignedMoney(row.netPnl),
                align: "right",
                className: (row) => getSignedValueClassName(row.netPnl)
              },
              { key: "totalFees", label: "Fees", render: (row) => `$${(row.totalFees ?? 0).toFixed(2)}`, align: "right" }
            ]}
          />
        </article>
      </section>
    </main>
  );
};
