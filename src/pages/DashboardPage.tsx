import { useEffect, useMemo, useState } from "react";
import { AnalyticsTable } from "../components/AnalyticsTable";
import { DateFilterPopover } from "../components/DateFilterPopover";
import { PageHero } from "../components/PageHero";
import { WorkspaceIcon } from "../components/WorkspaceIcon";
import {
  type CalendarDaySummary,
  getCalendarSummary,
  getDatabaseStats,
  getHourlyBreakdown,
  getIntradayMetrics,
  getMonthSessionSummary,
  getPerformanceBySymbol,
  getTradeSummary,
  getVisibleMonthNavigation
} from "../lib/analytics/tradeAnalytics";
import type { GroupedTrade } from "../types/trade";

interface DashboardPageProps {
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
  onSelectTrade?: (tradeId: string, tradeDate: string) => void;
}

const formatMonthLabel = (monthKey: string): string => {
  const [year, month] = monthKey.split("-");
  return new Date(Number(year), Number(month) - 1, 1).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric"
  });
};

const shiftMonthKey = (monthKey: string, delta: number): string => {
  const [year, month] = monthKey.split("-");
  const shifted = new Date(Number(year), Number(month) - 1 + delta, 1);
  return `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, "0")}`;
};

const getTodayMonthKey = (): string => {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
};

const formatDateKey = (value: Date): string =>
  `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(
    value.getDate()
  ).padStart(2, "0")}`;

const buildMonthGrid = (
  visibleMonth: Date,
  sessions: CalendarDaySummary[]
): Array<{
  tradeDate: string;
  day: number;
  isCurrentMonth: boolean;
  session: CalendarDaySummary | null;
}> => {
  const sessionsByDate = new Map(sessions.map((session) => [session.tradeDate, session]));
  const firstVisibleDay = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), 1);
  firstVisibleDay.setDate(firstVisibleDay.getDate() - firstVisibleDay.getDay());

  return Array.from({ length: 42 }, (_, index) => {
    const cellDate = new Date(firstVisibleDay);
    cellDate.setDate(firstVisibleDay.getDate() + index);
    const tradeDate = formatDateKey(cellDate);
    return {
      tradeDate,
      day: cellDate.getDate(),
      isCurrentMonth: cellDate.getMonth() === visibleMonth.getMonth(),
      session: sessionsByDate.get(tradeDate) ?? null
    };
  });
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

const filterTradesBetween = (trades: GroupedTrade[], start: Date, end: Date): GroupedTrade[] =>
  trades.filter((trade) => {
    const tradeDate = new Date(`${trade.tradeDate}T00:00:00`);
    return tradeDate >= start && tradeDate <= end;
  });

const DashboardSummaryCard = ({
  title,
  badge,
  summary,
  onClick
}: {
  title: string;
  badge: string;
  summary: ReturnType<typeof getTradeSummary>;
  onClick?: () => void;
}) => (
  <article
    className={`placeholder-panel analytics-panel dashboard-summary-card${onClick ? " dashboard-summary-card-clickable" : ""}`}
    onClick={onClick}
    role={onClick ? "button" : undefined}
    tabIndex={onClick ? 0 : undefined}
    onKeyDown={
      onClick
        ? (event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onClick();
            }
          }
        : undefined
    }
  >
    <div className="dashboard-summary-header">
      <h2>{title}</h2>
      <span className="dashboard-summary-badge">{badge}</span>
    </div>
    <div className="dashboard-summary-metrics">
      <div>
        <span>Net P&L</span>
        <strong>${summary.totalNetPnl.toFixed(2)}</strong>
      </div>
      <div>
        <span>Win Rate</span>
        <strong>{summary.winRate.toFixed(1)}%</strong>
      </div>
      <div>
        <span>Trades</span>
        <strong>{summary.totalTrades}</strong>
        <small>{summary.winCount}W - {summary.lossCount}L</small>
      </div>
      <div>
        <span>Shares Traded</span>
        <strong>{summary.totalSharesTraded.toLocaleString()}</strong>
      </div>
      <div>
        <span>Avg Trade</span>
        <strong>${summary.avgTrade.toFixed(2)}</strong>
      </div>
      <div>
        <span>Profit Factor</span>
        <strong>{summary.profitFactor.toFixed(2)}</strong>
      </div>
    </div>
  </article>
);

const DashboardWidgetCard = ({
  title,
  value,
  detail,
  tone = "neutral",
  onClick
}: {
  title: string;
  value: string;
  detail: string;
  tone?: "positive" | "negative" | "neutral";
  onClick?: () => void;
}) => (
  <article
    className={`placeholder-panel analytics-panel dashboard-widget-card dashboard-widget-card-${tone}${
      onClick ? " dashboard-widget-card-clickable" : ""
    }`}
    onClick={onClick}
    role={onClick ? "button" : undefined}
    tabIndex={onClick ? 0 : undefined}
    onKeyDown={
      onClick
        ? (event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onClick();
            }
          }
        : undefined
    }
  >
    <span>{title}</span>
    <strong>{value}</strong>
    <small>{detail}</small>
  </article>
);

const formatSignedMoney = (value: number): string => `${value >= 0 ? "+" : "-"}$${Math.abs(value).toFixed(2)}`;

const formatActiveDateRange = (startValue: string, endValue: string): string => {
  if (startValue && endValue) {
    if (startValue === endValue) {
      return startValue;
    }

    return `${startValue} to ${endValue}`;
  }

  return startValue || endValue;
};

const getDashboardRangeLabel = (startValue: string, endValue: string): string => {
  if (startValue && endValue) {
    if (startValue === endValue) {
      return startValue;
    }

    return `${startValue} to ${endValue}`;
  }

  return "All saved sessions";
};

const getOverallPerformanceBadge = (startValue: string, endValue: string): string => {
  if (startValue && endValue) {
    if (startValue === endValue) {
      return startValue;
    }

    return `${startValue} to ${endValue}`;
  }

  if (startValue || endValue) {
    return startValue || endValue;
  }

  return "All Time";
};

export const DashboardPage = ({
  trades,
  externalTradeDateFilterStart = "",
  externalTradeDateFilterEnd = "",
  externalPlaybookFilter = "all",
  externalSymbolFilter = "all",
  externalStatusFilter = "all",
  externalGameFilter = "all",
  externalExecutionFilter = "all",
  onFiltersChange,
  onSelectTrade
}: DashboardPageProps) => {
  const today = new Date();
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
      Array.from(new Set(trades.map((trade) => trade.game).filter((value) => value.trim().length > 0))).sort(
        (left, right) => left.localeCompare(right)
      ),
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

  const filteredTrades = useMemo(
    () =>
      trades.filter((trade) => {
        if (selectedTradeDateFilterStart && trade.tradeDate < selectedTradeDateFilterStart) {
          return false;
        }

        if (selectedTradeDateFilterEnd && trade.tradeDate > selectedTradeDateFilterEnd) {
          return false;
        }

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
      selectedExecutionFilter,
      selectedGameFilter,
      selectedPlaybookFilter,
      selectedStatusFilter,
      selectedSymbolFilter,
      selectedTradeDateFilterEnd,
      selectedTradeDateFilterStart,
      trades
    ]
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
      selectedExecutionFilter,
      selectedGameFilter,
      selectedPlaybookFilter,
      selectedStatusFilter,
      selectedSymbolFilter,
      trades
    ]
  );

  const overallSummary = getTradeSummary(filteredTrades);
  const databaseStats = getDatabaseStats(filteredTrades);
  const intradayMetrics = getIntradayMetrics(filteredTrades);
  const hourlyBreakdown = getHourlyBreakdown(filteredTrades);
  const topSymbols = getPerformanceBySymbol(filteredTrades).slice(0, 8);
  const calendarSummary = getCalendarSummary(filteredTrades);
  const maxHourlyMagnitude = Math.max(...hourlyBreakdown.map((row) => Math.abs(row.netPnl)), 1);

  const sortedTradeDates = Array.from(new Set(attributeFilteredTrades.map((trade) => trade.tradeDate))).sort();
  const recentTradeDate = sortedTradeDates[sortedTradeDates.length - 1] ?? "";
  const recentSessionTrades = recentTradeDate
    ? attributeFilteredTrades.filter((trade) => trade.tradeDate === recentTradeDate)
    : [];

  const currentWeekTrades = filterTradesBetween(attributeFilteredTrades, getStartOfWeek(today), getEndOfWeek(today));
  const lastWeekEnd = new Date(getStartOfWeek(today));
  lastWeekEnd.setMilliseconds(-1);
  const lastWeekTrades = filterTradesBetween(attributeFilteredTrades, getStartOfWeek(lastWeekEnd), getEndOfWeek(lastWeekEnd));
  const currentMonthTrades = attributeFilteredTrades.filter((trade) => trade.tradeDate.startsWith(getTodayMonthKey()));

  const recentSessionSummary = getTradeSummary(recentSessionTrades);
  const currentWeekSummary = getTradeSummary(currentWeekTrades);
  const lastWeekSummary = getTradeSummary(lastWeekTrades);
  const currentMonthSummary = getTradeSummary(currentMonthTrades);
  const bestDay = [...calendarSummary].sort((left, right) => right.netPnl - left.netPnl)[0] ?? null;
  const worstDay = [...calendarSummary].sort((left, right) => left.netPnl - right.netPnl)[0] ?? null;
  const topSymbol = topSymbols[0] ?? null;
  const averageFeesPerTrade =
    overallSummary.totalTrades > 0 ? overallSummary.totalFees / overallSummary.totalTrades : 0;
  const averageSize =
    filteredTrades.length > 0
      ? filteredTrades.reduce((sum, trade) => sum + trade.size, 0) / filteredTrades.length
      : 0;

  const availableMonthKeys = useMemo(() => getVisibleMonthNavigation(filteredTrades), [filteredTrades]);
  const latestMonthKey = availableMonthKeys[availableMonthKeys.length - 1] ?? getTodayMonthKey();
  const [visibleMonthKey, setVisibleMonthKey] = useState(latestMonthKey);

  useEffect(() => {
    if (availableMonthKeys.length === 0) {
      setVisibleMonthKey(getTodayMonthKey());
      return;
    }

    if (!availableMonthKeys.includes(visibleMonthKey)) {
      setVisibleMonthKey(latestMonthKey);
    }
  }, [availableMonthKeys, latestMonthKey, visibleMonthKey]);

  const visibleMonth = useMemo(() => {
    const [year, month] = visibleMonthKey.split("-");
    return new Date(Number(year), Number(month) - 1, 1);
  }, [visibleMonthKey]);

  const monthSessions = useMemo(() => getMonthSessionSummary(filteredTrades, visibleMonth), [filteredTrades, visibleMonth]);
  const monthGrid = useMemo(() => buildMonthGrid(visibleMonth, monthSessions), [monthSessions, visibleMonth]);
  const [selectedTradeDate, setSelectedTradeDate] = useState("");

  useEffect(() => {
    const defaultTradeDate = `${visibleMonthKey}-01`;
    if (monthSessions.length === 0) {
      setSelectedTradeDate((current) =>
        current.startsWith(visibleMonthKey) ? current : defaultTradeDate
      );
      return;
    }

    setSelectedTradeDate((current) => {
      if (
        current.startsWith(visibleMonthKey) &&
        monthSessions.some((session) => session.tradeDate === current)
      ) {
        return current;
      }

      return monthSessions[monthSessions.length - 1]?.tradeDate ?? defaultTradeDate;
    });
  }, [monthSessions, visibleMonthKey]);

  const selectedDaySummary = monthSessions.find((session) => session.tradeDate === selectedTradeDate) ?? null;
  const selectedDayTrades = selectedTradeDate
    ? filteredTrades
        .filter((trade) => trade.tradeDate === selectedTradeDate)
        .sort((left, right) => left.openTime.localeCompare(right.openTime))
    : [];
  const selectedDayTradeSummary = getTradeSummary(selectedDayTrades);

  const applyDashboardRange = (start: Date, end: Date) => {
    const startKey = formatDateKey(start);
    const endKey = formatDateKey(end);
    setSelectedTradeDateFilterStart(startKey);
    setSelectedTradeDateFilterEnd(endKey);
    setVisibleMonthKey(endKey.slice(0, 7));
    setSelectedTradeDate(endKey);
  };

  const clearFilters = () => {
    setSelectedTradeDateFilterStart("");
    setSelectedTradeDateFilterEnd("");
    setSelectedPlaybookFilter("all");
    setSelectedSymbolFilter("all");
    setSelectedStatusFilter("all");
    setSelectedGameFilter("all");
    setSelectedExecutionFilter("all");
  };

  const focusTradeDate = (tradeDate: string) => {
    setSelectedTradeDateFilterStart(tradeDate);
    setSelectedTradeDateFilterEnd(tradeDate);
    setVisibleMonthKey(tradeDate.slice(0, 7));
    setSelectedTradeDate(tradeDate);
  };

  const activeFilters = [
    selectedTradeDateFilterStart || selectedTradeDateFilterEnd
      ? {
          key: "date",
          label: "Date",
          value: formatActiveDateRange(selectedTradeDateFilterStart, selectedTradeDateFilterEnd)
        }
      : null,
    selectedPlaybookFilter !== "all"
      ? { key: "playbook", label: "Playbook", value: selectedPlaybookFilter }
      : null,
    selectedSymbolFilter !== "all"
      ? { key: "symbol", label: "Symbol", value: selectedSymbolFilter }
      : null,
    selectedStatusFilter !== "all"
      ? { key: "status", label: "Status", value: selectedStatusFilter }
      : null,
    selectedGameFilter !== "all"
      ? { key: "game", label: "Game", value: selectedGameFilter }
      : null,
    selectedExecutionFilter !== "all"
      ? { key: "execution", label: "Execution", value: selectedExecutionFilter }
      : null
  ].filter((value): value is { key: string; label: string; value: string } => value !== null);

  return (
    <main className="page-shell">
      <PageHero
        eyebrow="Dashboard"
        title="Trading Workspace Overview"
        description="End-of-day review across saved sessions."
      >
        <div className="page-hero-stat-grid">
          <div className="page-hero-stat-card">
            <span>Range</span>
            <strong>{getDashboardRangeLabel(selectedTradeDateFilterStart, selectedTradeDateFilterEnd)}</strong>
          </div>
          <div className="page-hero-stat-card">
            <span>Trades</span>
            <strong>{overallSummary.totalTrades}</strong>
          </div>
          <div className="page-hero-stat-card">
            <span>Net P&L</span>
            <strong>{formatSignedMoney(overallSummary.totalNetPnl)}</strong>
          </div>
          <div className="page-hero-stat-card">
            <span>Win Rate</span>
            <strong>{overallSummary.winRate.toFixed(1)}%</strong>
          </div>
        </div>
      </PageHero>
      <section className="placeholder-panel trade-view-filter-panel">
        <div className="trade-view-filter-header">
          <div className="panel-header">
            <WorkspaceIcon icon="filter" alt="Dashboard filters icon" className="panel-header-icon" />
            <h2>Dashboard Filters</h2>
          </div>
          <span>Only matching trades are included in the widgets, calendar, and review tables below.</span>
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
            <select
              className="calendar-date-select"
              value={selectedPlaybookFilter}
              onChange={(event) => setSelectedPlaybookFilter(event.target.value)}
            >
              <option value="all">All Playbooks</option>
              {playbookOptions.map((playbook) => (
                <option key={playbook} value={playbook}>
                  {playbook}
                </option>
              ))}
            </select>
          </label>
          <label className="trade-filter-field">
            <span>Symbol</span>
            <select
              className="calendar-date-select"
              value={selectedSymbolFilter}
              onChange={(event) => setSelectedSymbolFilter(event.target.value)}
            >
              <option value="all">All Symbols</option>
              {symbolOptions.map((symbol) => (
                <option key={symbol} value={symbol}>
                  {symbol}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="mini-action trade-filter-reset" onClick={clearFilters}>
            Clear Filters
          </button>
          <label className="trade-filter-field">
            <span>Status</span>
            <select
              className="calendar-date-select"
              value={selectedStatusFilter}
              onChange={(event) => setSelectedStatusFilter(event.target.value)}
            >
              <option value="all">All Status</option>
              {statusOptions.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>
          <label className="trade-filter-field">
            <span>Game</span>
            <select
              className="calendar-date-select"
              value={selectedGameFilter}
              onChange={(event) => setSelectedGameFilter(event.target.value)}
            >
              <option value="all">All Games</option>
              {gameOptions.map((game) => (
                <option key={game} value={game}>
                  {game}
                </option>
              ))}
            </select>
          </label>
          <label className="trade-filter-field">
            <span>Execution</span>
            <select
              className="calendar-date-select"
              value={selectedExecutionFilter}
              onChange={(event) => setSelectedExecutionFilter(event.target.value)}
            >
              <option value="all">All Execution</option>
              {executionOptions.map((execution) => (
                <option key={execution} value={execution}>
                  {execution}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>
      {activeFilters.length > 0 ? (
        <section className="placeholder-panel active-filter-strip">
          <div className="active-filter-strip-header">
            <div className="panel-header">
              <WorkspaceIcon icon="filter" alt="Active filters icon" className="panel-header-icon" />
              <h2>Active Review Slice</h2>
            </div>
            <button type="button" className="mini-action" onClick={clearFilters}>
              Clear All
            </button>
          </div>
          <div className="active-filter-chip-row">
            {activeFilters.map((filter) => (
              <span key={filter.key} className="active-filter-chip">
                <strong>{filter.label}</strong>
                <span>{filter.value}</span>
              </span>
            ))}
          </div>
        </section>
      ) : null}
      <section className="dashboard-summary-grid">
        <DashboardSummaryCard
          title="Recent Session"
          badge={recentTradeDate || "No Session"}
          summary={recentSessionSummary}
          onClick={recentTradeDate ? () => focusTradeDate(recentTradeDate) : undefined}
        />
        <DashboardSummaryCard
          title="Current Week"
          badge="Current Week"
          summary={currentWeekSummary}
          onClick={() => applyDashboardRange(getStartOfWeek(today), getEndOfWeek(today))}
        />
        <DashboardSummaryCard
          title="Last Week"
          badge="Last Week"
          summary={lastWeekSummary}
          onClick={() => applyDashboardRange(getStartOfWeek(lastWeekEnd), getEndOfWeek(lastWeekEnd))}
        />
        <DashboardSummaryCard
          title="Month"
          badge="Current Month"
          summary={currentMonthSummary}
          onClick={() =>
            applyDashboardRange(
              new Date(today.getFullYear(), today.getMonth(), 1),
              new Date(today.getFullYear(), today.getMonth() + 1, 0)
            )
          }
        />
      </section>
      <section className="dashboard-widget-strip">
        <DashboardWidgetCard
          title="Active Days"
          value={String(databaseStats.sessions)}
          detail={`${databaseStats.symbols} symbols tracked`}
          onClick={clearFilters}
        />
        <DashboardWidgetCard
          title="Best Day"
          value={bestDay ? formatSignedMoney(bestDay.netPnl) : "$0.00"}
          detail={bestDay ? bestDay.tradeDate : "No saved sessions yet"}
          tone={bestDay && bestDay.netPnl > 0 ? "positive" : "neutral"}
          onClick={bestDay ? () => focusTradeDate(bestDay.tradeDate) : undefined}
        />
        <DashboardWidgetCard
          title="Worst Day"
          value={worstDay ? formatSignedMoney(worstDay.netPnl) : "$0.00"}
          detail={worstDay ? worstDay.tradeDate : "No saved sessions yet"}
          tone={worstDay && worstDay.netPnl < 0 ? "negative" : "neutral"}
          onClick={worstDay ? () => focusTradeDate(worstDay.tradeDate) : undefined}
        />
        <DashboardWidgetCard
          title="Top Symbol"
          value={topSymbol?.label ?? "--"}
          detail={
            topSymbol
              ? `${formatSignedMoney(topSymbol.netPnl)} across ${topSymbol.trades} trades`
              : "Load more trades to rank symbols"
          }
          tone={topSymbol && topSymbol.netPnl > 0 ? "positive" : topSymbol && topSymbol.netPnl < 0 ? "negative" : "neutral"}
          onClick={topSymbol ? () => setSelectedSymbolFilter(topSymbol.label) : undefined}
        />
        <DashboardWidgetCard
          title="Avg Fees / Trade"
          value={`$${averageFeesPerTrade.toFixed(2)}`}
          detail={`Avg size ${averageSize.toFixed(0)} shares`}
        />
      </section>
      <section className="dashboard-calendar-layout dashboard-calendar-layout-advanced">
        <div className="dashboard-overview-column">
          <article className="placeholder-panel analytics-panel dashboard-stat-panel">
            <div className="dashboard-summary-header">
              <h2>Overall Performance</h2>
              <span className="dashboard-summary-badge">
                {getOverallPerformanceBadge(selectedTradeDateFilterStart, selectedTradeDateFilterEnd)}
              </span>
            </div>
            <div className="dashboard-line-stat-list">
              <div><span>Net P&L</span><strong>${overallSummary.totalNetPnl.toFixed(2)}</strong></div>
              <div><span>Win Rate</span><strong>{overallSummary.winRate.toFixed(1)}%</strong></div>
              <div><span>Trades</span><strong>{overallSummary.totalTrades}</strong></div>
              <div><span>Avg Trade</span><strong>${overallSummary.avgTrade.toFixed(2)}</strong></div>
              <div><span>Profit Factor</span><strong>{overallSummary.profitFactor.toFixed(2)}</strong></div>
            </div>
          </article>
          <article className="placeholder-panel analytics-panel dashboard-stat-panel">
            <div className="dashboard-summary-header">
              <h2>Database Stats</h2>
            </div>
            <div className="dashboard-line-stat-list">
              <div><span>Total Trades</span><strong>{databaseStats.totalTrades}</strong></div>
              <div><span>Executions</span><strong>{databaseStats.totalExecutions}</strong></div>
              <div><span>Shares Traded</span><strong>{databaseStats.totalSharesTraded.toLocaleString()}</strong></div>
              <div><span>Sessions</span><strong>{databaseStats.sessions}</strong></div>
              <div><span>Symbols</span><strong>{databaseStats.symbols}</strong></div>
            </div>
          </article>
        </div>
        <article className="placeholder-panel analytics-panel month-browser-panel">
          <div className="calendar-toolbar">
            <div className="panel-header">
              <WorkspaceIcon icon="dashboard" alt="Month browser icon" className="panel-header-icon" />
              <h2>{formatMonthLabel(visibleMonthKey)}</h2>
            </div>
            <div className="calendar-toolbar-actions">
              <label className="calendar-date-picker">
                <span>Jump To Date</span>
                <DateFilterPopover
                  value={sortedTradeDates.includes(selectedTradeDate) ? selectedTradeDate : ""}
                  onChange={(tradeDate) => {
                    if (!tradeDate) {
                      setSelectedTradeDate("");
                      return;
                    }

                    focusTradeDate(tradeDate);
                  }}
                  availableDates={[...sortedTradeDates].sort((left, right) => right.localeCompare(left))}
                  allValue=""
                  allLabel="Saved dates"
                  emptyLabel="Saved dates"
                />
              </label>
              <button
                type="button"
                className="mini-action"
                onClick={() => setVisibleMonthKey((current) => shiftMonthKey(current, -1))}
              >
                Prev
              </button>
              <button
                type="button"
                className="mini-action"
                onClick={() => setVisibleMonthKey(getTodayMonthKey())}
              >
                Today
              </button>
              <button
                type="button"
                className="mini-action"
                onClick={() => setVisibleMonthKey((current) => shiftMonthKey(current, 1))}
              >
                Next
              </button>
            </div>
          </div>
          <div className="session-month-grid">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((weekday) => (
              <div key={weekday} className="session-weekday">
                {weekday}
              </div>
            ))}
            {monthGrid.map((day) => (
              <button
                key={day.tradeDate}
                type="button"
                className={`session-month-cell ${
                  !day.isCurrentMonth ? "session-month-cell-muted" : ""
                } ${day.tradeDate === selectedTradeDate ? "session-month-cell-selected" : ""} ${
                  day.session && day.session.netPnl > 0 ? "session-month-cell-positive" : ""
                } ${day.session && day.session.netPnl < 0 ? "session-month-cell-negative" : ""}`}
                onClick={() => focusTradeDate(day.tradeDate)}
              >
                <strong>{day.day}</strong>
                {day.session ? (
                  <>
                    <span>{day.session.trades} trades</span>
                    <span>{day.session.netPnl >= 0 ? "+" : ""}${day.session.netPnl.toFixed(2)}</span>
                    <span>{day.session.winRate.toFixed(0)}% WR</span>
                  </>
                ) : (
                  <span>{day.isCurrentMonth ? "No trades" : ""}</span>
                )}
              </button>
            ))}
          </div>
        </article>
        <aside className="placeholder-panel analytics-panel session-detail-panel">
          <div className="panel-header">
            <WorkspaceIcon icon="journal" alt="Selected session icon" className="panel-header-icon" />
            <h2>{selectedTradeDate || "No Session Selected"}</h2>
          </div>
          {selectedDaySummary ? (
            <>
              <div className="selected-session-list">
                {selectedDayTrades.map((trade) => (
                  <button
                    key={trade.id}
                    type="button"
                    className={`selected-session-item selected-session-item-button ${
                      trade.status === "Win"
                        ? "selected-session-item-positive"
                        : "selected-session-item-negative"
                    }`}
                    onClick={() => onSelectTrade?.(trade.id, trade.tradeDate)}
                  >
                    <strong>{trade.name}</strong>
                    <span>{trade.symbol} · {trade.openTime} to {trade.closeTime}</span>
                    <span
                      className={`selected-session-pnl ${
                        trade.status === "Win" ? "selected-session-pnl-positive" : "selected-session-pnl-negative"
                      }`}
                    >
                      {trade.netPnlUsd >= 0 ? "+" : ""}${trade.netPnlUsd.toFixed(2)}
                    </span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div className="empty-state">
              {selectedTradeDate
                ? `No saved trades for ${selectedTradeDate} yet.`
                : "Pick a saved session day to inspect it."}
            </div>
          )}
        </aside>
      </section>
      <section className="analytics-grid">
        <article className="placeholder-panel analytics-panel analytics-grid-full">
          <div className="panel-header">
            <WorkspaceIcon icon="dashboard" alt="Intraday metrics icon" className="panel-header-icon" />
            <h2>Intraday Metrics</h2>
          </div>
          <div className="intraday-metrics-grid">
            <div className="intraday-metric-card">
              <span>Trades</span>
              <strong>{intradayMetrics.totalTrades}</strong>
            </div>
            <div className="intraday-metric-card">
              <span>Wins / Losses</span>
              <strong>{intradayMetrics.winCount} / {intradayMetrics.lossCount}</strong>
            </div>
            <div className="intraday-metric-card">
              <span>Win Rate</span>
              <strong>{intradayMetrics.winRate.toFixed(1)}%</strong>
            </div>
            <div className="intraday-metric-card">
              <span>Net P&L</span>
              <strong>{formatSignedMoney(intradayMetrics.netPnl)}</strong>
            </div>
            <div className="intraday-metric-card">
              <span>Avg P&L</span>
              <strong>{formatSignedMoney(intradayMetrics.avgPnl)}</strong>
            </div>
            <div className="intraday-metric-card">
              <span>Avg Hold</span>
              <strong>{intradayMetrics.avgHoldMinutes.toFixed(1)}m</strong>
            </div>
            <div className="intraday-metric-card">
              <span>Best Trade</span>
              <strong>{formatSignedMoney(intradayMetrics.bestTrade)}</strong>
            </div>
            <div className="intraday-metric-card">
              <span>Worst Trade</span>
              <strong>{formatSignedMoney(intradayMetrics.worstTrade)}</strong>
            </div>
          </div>
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
            emptyMessage="Save sessions to see entry-hour performance."
            columns={[
              { key: "label", label: "Hour", render: (row) => row.label },
              { key: "trades", label: "Trades", render: (row) => row.trades, align: "right" },
              { key: "winRate", label: "Win Rate", render: (row) => `${row.winRate.toFixed(1)}%`, align: "right" },
              { key: "netPnl", label: "Total P&L", render: (row) => `$${row.netPnl.toFixed(2)}`, align: "right" },
              { key: "avgPnl", label: "Avg P&L", render: (row) => `$${row.avgPnl.toFixed(2)}`, align: "right" }
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
            emptyMessage="Save sessions to see symbol leaders."
            columns={[
              { key: "label", label: "Symbol", render: (row) => row.label },
              { key: "trades", label: "Trades", render: (row) => row.trades, align: "right" },
              { key: "winRate", label: "Win Rate", render: (row) => `${row.winRate.toFixed(1)}%`, align: "right" },
              { key: "netPnl", label: "Net P&L", render: (row) => `$${row.netPnl.toFixed(2)}`, align: "right" }
            ]}
          />
        </article>
      </section>
      <section className="analytics-grid analytics-grid-single">
        <article className="placeholder-panel analytics-panel">
          <div className="panel-header">
            <WorkspaceIcon icon="money" alt="Hourly pnl icon" className="panel-header-icon" />
            <h2>Hourly P&L</h2>
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
            <div className="empty-state">Save sessions to see entry-hour P&L bars.</div>
          )}
        </article>
      </section>
    </main>
  );
};
