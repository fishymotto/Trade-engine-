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
    () =>
      Array.from(
        new Set(
          trades
            .map((trade) => trade.setups[0] ?? "")
            .filter((value) => value.trim().length > 0)
        )
      ).sort((left, right) => left.localeCompare(right)),
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
        if (selectedPlaybookFilter !== "all" && (trade.setups[0] ?? "") !== selectedPlaybookFilter) {
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

  const symbols = new Set(filteredTrades.map((trade) => trade.symbol)).size;
  const reportSummary = getTradeSummary(filteredTrades);
  const winningTrades = filteredTrades.filter((trade) => trade.netPnlUsd > 0);
  const losingTrades = filteredTrades.filter((trade) => trade.netPnlUsd < 0);
  const avgWinner =
    winningTrades.length > 0
      ? winningTrades.reduce((sum, trade) => sum + trade.netPnlUsd, 0) / winningTrades.length
      : 0;
  const avgLoser =
    losingTrades.length > 0
      ? losingTrades.reduce((sum, trade) => sum + trade.netPnlUsd, 0) / losingTrades.length
      : 0;
  const hourlyBreakdown = getHourlyBreakdown(filteredTrades);
  const maxHourlyMagnitude = Math.max(...hourlyBreakdown.map((row) => Math.abs(row.netPnl)), 1);
  const symbolRows = getPerformanceBySymbol(filteredTrades);
  const topSymbols = symbolRows.slice(0, 8);
  const gatewayRows = getPerformanceByGateway(filteredTrades).slice(0, 8);
  const setupPerformanceRows = getPerformanceBySetup(filteredTrades);
  const setupRows = setupPerformanceRows.slice(0, 8);
  const mistakePerformanceRows = getPerformanceByMistake(filteredTrades);
  const mistakeRows = mistakePerformanceRows.slice(0, 8);
  const gameRows = getPerformanceByGame(filteredTrades).slice(0, 8);
  const executionRows = getPerformanceByExecution(filteredTrades).slice(0, 8);
  const cumulativeNetPnlSeries = getCumulativeNetPnlByDate(filteredTrades);
  const dailyNetPnlSeries = getNetPnlByDate(filteredTrades);
  const feesByDateSeries = getFeesByDate(filteredTrades);
  const sharesTradedByDateSeries = getSharesTradedByDate(filteredTrades);
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
  const bestDailyNetPnl = dailyNetPnlSeries.reduce<(typeof dailyNetPnlSeries)[number] | null>(
    (best, point) => (!best || point.value > best.value ? point : best),
    null
  );
  const worstDailyNetPnl = dailyNetPnlSeries.reduce<(typeof dailyNetPnlSeries)[number] | null>(
    (worst, point) => (!worst || point.value < worst.value ? point : worst),
    null
  );
  const highestFeeDay = feesByDateSeries.reduce<(typeof feesByDateSeries)[number] | null>(
    (highest, point) => (!highest || point.value > highest.value ? point : highest),
    null
  );
  const mostActiveShareDay = sharesTradedByDateSeries.reduce<(typeof sharesTradedByDateSeries)[number] | null>(
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
  const previousSliceSummary = useMemo(() => getTradeSummary(comparisonWindow.previousTrades), [comparisonWindow.previousTrades]);
  const currentSliceWindowLabel = formatDateWindow(comparisonWindow.currentDatesAsc);
  const previousSliceWindowLabel = formatDateWindow(comparisonWindow.previousDatesAsc);
  const comparisonCoverageNote =
    hasPreviousSlice && comparisonWindow.previousSessionCount < comparisonWindow.currentSessionCount
      ? `Previous slice only has ${comparisonWindow.previousSessionCount} of ${comparisonWindow.currentSessionCount} sessions available.`
      : "";
  const periodComparisonMetrics = useMemo<PeriodComparisonMetric[]>(() => {
    if (!hasPreviousSlice) {
      return [];
    }

    const netDelta = reportSummary.totalNetPnl - previousSliceSummary.totalNetPnl;
    const winRateDelta = reportSummary.winRate - previousSliceSummary.winRate;
    const tradeDelta = reportSummary.totalTrades - previousSliceSummary.totalTrades;
    const avgTradeDelta = reportSummary.avgTrade - previousSliceSummary.avgTrade;

    return [
      {
        key: "net",
        label: "Net P&L",
        currentValue: formatSignedMoney(reportSummary.totalNetPnl),
        previousValue: formatSignedMoney(previousSliceSummary.totalNetPnl),
        deltaValue: `${formatSignedMoney(netDelta)} (${formatRelativeDelta(netDelta, previousSliceSummary.totalNetPnl)})`,
        tone: getDeltaTone(netDelta)
      },
      {
        key: "winRate",
        label: "Win Rate",
        currentValue: `${reportSummary.winRate.toFixed(1)}%`,
        previousValue: `${previousSliceSummary.winRate.toFixed(1)}%`,
        deltaValue: `${winRateDelta >= 0 ? "+" : ""}${winRateDelta.toFixed(1)} pts`,
        tone: getDeltaTone(winRateDelta)
      },
      {
        key: "trades",
        label: "Trades",
        currentValue: reportSummary.totalTrades.toLocaleString(),
        previousValue: previousSliceSummary.totalTrades.toLocaleString(),
        deltaValue: `${formatSignedCount(tradeDelta)} (${formatRelativeDelta(tradeDelta, previousSliceSummary.totalTrades)})`,
        tone: getDeltaTone(tradeDelta)
      },
      {
        key: "avgTrade",
        label: "Avg Trade",
        currentValue: formatSignedMoney(reportSummary.avgTrade),
        previousValue: formatSignedMoney(previousSliceSummary.avgTrade),
        deltaValue: `${formatSignedMoney(avgTradeDelta)} (${formatRelativeDelta(avgTradeDelta, previousSliceSummary.avgTrade)})`,
        tone: getDeltaTone(avgTradeDelta)
      }
    ];
  }, [hasPreviousSlice, previousSliceSummary, reportSummary]);
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
                <WorkspaceIcon icon="filter" alt="Report filters icon" className="panel-header-icon" />
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
            <strong>{formatActiveDateRange(selectedTradeDateFilterStart, selectedTradeDateFilterEnd)}</strong>
            <small>{activeFilters.length > 0 ? `${activeFilters.length} filters active` : "Full report universe"}</small>
          </div>
          <div className="page-hero-stat-card report-hero-stat-card">
            <span>Trades</span>
            <strong>{filteredTrades.length.toLocaleString()}</strong>
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
                ? `Prev ${formatSignedMoney(previousSliceSummary.totalNetPnl)}`
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
          <span className="report-period-compare-badge">Current vs Previous Slice</span>
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
            </div>
            <div className="intraday-metric-card">
              <span>Gross P&amp;L</span>
              <strong>{formatSignedMoney(reportSummary.totalGrossPnl)}</strong>
            </div>
            <div className="intraday-metric-card">
              <span>Fees</span>
              <strong>${reportSummary.totalFees.toFixed(2)}</strong>
            </div>
            <div className="intraday-metric-card">
              <span>Trades</span>
              <strong>{reportSummary.totalTrades}</strong>
            </div>
            <div className="intraday-metric-card">
              <span>Shares</span>
              <strong>{reportSummary.totalSharesTraded.toLocaleString()}</strong>
            </div>
            <div className="intraday-metric-card">
              <span>Win Rate</span>
              <strong>{reportSummary.winRate.toFixed(1)}%</strong>
            </div>
            <div className="intraday-metric-card">
              <span>Profit Factor</span>
              <strong>{reportSummary.profitFactor === 999 ? "Open" : reportSummary.profitFactor.toFixed(2)}</strong>
            </div>
            <div className="intraday-metric-card">
              <span>Avg Winner / Loser</span>
              <strong>{formatSignedMoney(avgWinner)} / {formatSignedMoney(avgLoser)}</strong>
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
          </div>
          <div className="report-insight-card">
            <span>Worst Day</span>
            <strong>{worstDailyNetPnl ? formatReportDate(worstDailyNetPnl.label) : "No data"}</strong>
            <em className={worstDailyNetPnl && worstDailyNetPnl.value >= 0 ? "positive-value" : "negative-value"}>
              {worstDailyNetPnl ? formatSignedMoney(worstDailyNetPnl.value) : "$0.00"}
            </em>
          </div>
          <div className="report-insight-card">
            <span>Most Fees</span>
            <strong>{highestFeeDay ? formatReportDate(highestFeeDay.label) : "No data"}</strong>
            <em>{highestFeeDay ? `$${highestFeeDay.value.toFixed(2)}` : "$0.00"}</em>
          </div>
          <div className="report-insight-card">
            <span>Most Active</span>
            <strong>{mostActiveShareDay ? formatReportDate(mostActiveShareDay.label) : "No data"}</strong>
            <em>{mostActiveShareDay ? `${mostActiveShareDay.value.toLocaleString()} shares` : "0 shares"}</em>
          </div>
          <div className="report-insight-card">
            <span>Best Playbook</span>
            <strong>{bestPlaybook?.label ?? "No tagged playbook"}</strong>
            <em className={bestPlaybook && bestPlaybook.netPnl >= 0 ? "positive-value" : "negative-value"}>
              {bestPlaybook ? `${formatSignedMoney(bestPlaybook.netPnl)} across ${bestPlaybook.trades} trades` : "$0.00"}
            </em>
          </div>
          <div className="report-insight-card">
            <span>Costliest Mistake</span>
            <strong>{costliestMistake?.label ?? "No losing mistake tag"}</strong>
            <em className="negative-value">
              {costliestMistake ? `${formatSignedMoney(costliestMistake.netPnl)} across ${costliestMistake.trades} trades` : "$0.00"}
            </em>
          </div>
        </div>
      </section>
      <section className="analytics-grid analytics-grid-single">
        <article className="placeholder-panel analytics-panel">
          <ReportLineChart
            points={cumulativeNetPnlSeries}
            color="#89d8ab"
            title="Cumulative Net P&L"
            yAxisLabel="Net PnL USD (Running)"
            valueFormatter={(value) => formatSignedMoney(value)}
          />
        </article>
      </section>
      <section className="analytics-grid">
        <article className="placeholder-panel analytics-panel">
          <ReportBarChart
            points={dailyNetPnlSeries}
            title="Daily Net P&L"
            yAxisLabel="Net PnL USD"
            positiveColor="#2ee6d6"
            negativeColor="#b42eff"
            valueFormatter={(value) => formatSignedMoney(value)}
          />
        </article>
        <article className="placeholder-panel analytics-panel">
          <ReportBarChart
            points={feesByDateSeries}
            title="Fees Over Time"
            yAxisLabel="Fees USD"
            color="#ffd66b"
            positiveColor="#ffd66b"
            negativeColor="#ffd66b"
            valueFormatter={(value) => `$${value.toFixed(2)}`}
          />
        </article>
      </section>
      <section className="analytics-grid">
        <article className="placeholder-panel analytics-panel">
          <ReportBarChart
            points={sharesTradedByDateSeries}
            title="Shares Traded Over Time"
            yAxisLabel="Shares Traded"
            color="#5da8ff"
            positiveColor="#5da8ff"
            valueFormatter={(value) => value.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          />
        </article>
        <article className="placeholder-panel analytics-panel">
          <ReportBarChart
            points={playbookNetPnlSeries}
            title="Best / Worst Playbooks"
            yAxisLabel="Net PnL USD"
            color="#5da8ff"
            positiveColor="#2ee6d6"
            negativeColor="#b42eff"
            valueFormatter={(value) => formatSignedMoney(value)}
          />
        </article>
      </section>
      <section className="analytics-grid analytics-grid-single">
        <article className="placeholder-panel analytics-panel">
          <ReportBarChart
            points={mistakeLossSeries}
            title="Mistakes By Total Loss"
            yAxisLabel="Net PnL USD"
            color="#ff6f91"
            positiveColor="#2ee6d6"
            negativeColor="#ff6f91"
            valueFormatter={(value) => formatSignedMoney(value)}
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
              { key: "label", label: "Hour", render: (row) => row.label },
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
            <h2>Hourly P&amp;L</h2>
          </div>
          {hourlyBreakdown.length > 0 ? (
            <div className="hourly-pnl-chart">
              {hourlyBreakdown.map((row) => (
                <div key={row.label} className="hourly-pnl-row">
                  <span className="hourly-pnl-label">{row.label}</span>
                  <div className="hourly-pnl-track">
                    <div
                      className={`hourly-pnl-bar ${row.netPnl >= 0 ? "hourly-pnl-bar-positive" : "hourly-pnl-bar-negative"}`}
                      style={{ width: `${(Math.abs(row.netPnl) / maxHourlyMagnitude) * 100}%` }}
                    />
                  </div>
                  <span className="hourly-pnl-value">{formatSignedMoney(row.netPnl)}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state">Adjust the report filters to populate hourly P&amp;L bars.</div>
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
