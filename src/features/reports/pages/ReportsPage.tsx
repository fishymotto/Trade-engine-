import { useEffect, useMemo, useState } from "react";
import { AnalyticsTable } from "../../../components/AnalyticsTable";
import { DateFilterPopover } from "../../../components/DateFilterPopover";
import { FilterSelect } from "../../../components/FilterSelect";
import { PageHero } from "../../../components/PageHero";
import { ReportBarChart } from "../../../components/ReportBarChart";
import { ReportLineChart } from "../../../components/ReportLineChart";
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

const formatActiveDateRange = (startValue: string, endValue: string): string => {
  if (startValue && endValue) {
    if (startValue === endValue) {
      return startValue;
    }

    return `${startValue} to ${endValue}`;
  }

  return "All saved sessions";
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
      trades,
      selectedExecutionFilter,
      selectedGameFilter,
      selectedPlaybookFilter,
      selectedStatusFilter,
      selectedSymbolFilter,
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

  const clearFilters = () => {
    setSelectedTradeDateFilterStart("");
    setSelectedTradeDateFilterEnd("");
    setSelectedPlaybookFilter("all");
    setSelectedSymbolFilter("all");
    setSelectedStatusFilter("all");
    setSelectedGameFilter("all");
    setSelectedExecutionFilter("all");
  };

  return (
    <main className="page-shell">
      <PageHero
        eyebrow="Reports"
        title="Performance Reports"
        description="Compare the current review slice across symbols, setups, gateways, and time."
      >
        <div className="page-hero-stat-grid">
          <div className="page-hero-stat-card">
            <span>Range</span>
            <strong>{formatActiveDateRange(selectedTradeDateFilterStart, selectedTradeDateFilterEnd)}</strong>
          </div>
          <div className="page-hero-stat-card">
            <span>Trades</span>
            <strong>{filteredTrades.length}</strong>
          </div>
          <div className="page-hero-stat-card">
            <span>Symbols</span>
            <strong>{symbols}</strong>
          </div>
          <div className="page-hero-stat-card">
            <span>Net P&amp;L</span>
            <strong>{formatSignedMoney(reportSummary.totalNetPnl)}</strong>
          </div>
        </div>
      </PageHero>
      <section className="placeholder-panel trade-view-filter-panel">
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
              options={[
                { label: "All Playbooks", value: "all" },
                ...playbookOptions.map((playbook) => ({ label: playbook, value: playbook }))
              ]}
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
        <div className="active-filter-chip-row dashboard-review-chip-row" aria-label="Active report slice">
          {activeFilters.length > 0 ? (
            activeFilters.map((filter) => (
              <span key={filter.key} className="active-filter-chip">
                <strong>{filter.label}</strong>
                <span>{filter.value}</span>
              </span>
            ))
          ) : (
            <span className="active-filter-chip active-filter-chip-muted">
              <strong>Slice</strong>
              <span>All saved trades</span>
            </span>
          )}
        </div>
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
              { key: "netPnl", label: "Total P&L", render: (row) => `$${row.netPnl.toFixed(2)}`, align: "right" },
              { key: "avgPnl", label: "Avg P&L", render: (row) => `$${row.avgPnl.toFixed(2)}`, align: "right" },
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
              { key: "label", label: "Symbol", render: (row) => row.label },
              { key: "trades", label: "Trades", render: (row) => row.trades, align: "right" },
              {
                key: "totalSharesTraded",
                label: "Shares",
                render: (row) => (row.totalSharesTraded ?? 0).toLocaleString(),
                align: "right"
              },
              { key: "winRate", label: "Win Rate", render: (row) => `${row.winRate.toFixed(1)}%`, align: "right" },
              { key: "netPnl", label: "Net P&L", render: (row) => `$${row.netPnl.toFixed(2)}`, align: "right" },
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
              { key: "label", label: "Symbol", render: (row) => row.label },
              { key: "trades", label: "Trades", render: (row) => row.trades, align: "right" },
              {
                key: "totalSharesTraded",
                label: "Shares",
                render: (row) => (row.totalSharesTraded ?? 0).toLocaleString(),
                align: "right"
              },
              { key: "winRate", label: "Win Rate", render: (row) => `${row.winRate.toFixed(1)}%`, align: "right" },
              { key: "avgPnl", label: "Avg Trade", render: (row) => `$${row.avgPnl.toFixed(2)}`, align: "right" },
              { key: "netPnl", label: "Net PnL", render: (row) => `$${row.netPnl.toFixed(2)}`, align: "right" },
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
              { key: "avgPnl", label: "Avg Trade", render: (row) => `$${row.avgPnl.toFixed(2)}`, align: "right" },
              { key: "netPnl", label: "Net PnL", render: (row) => `$${row.netPnl.toFixed(2)}`, align: "right" },
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
              { key: "winRate", label: "Win Rate", render: (row) => `${row.winRate.toFixed(1)}%`, align: "right" },
              { key: "netPnl", label: "Net PnL", render: (row) => `$${row.netPnl.toFixed(2)}`, align: "right" },
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
              { key: "avgPnl", label: "Avg Trade", render: (row) => `$${row.avgPnl.toFixed(2)}`, align: "right" },
              { key: "netPnl", label: "Net PnL", render: (row) => `$${row.netPnl.toFixed(2)}`, align: "right" },
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
              { key: "avgPnl", label: "Avg Trade", render: (row) => `$${row.avgPnl.toFixed(2)}`, align: "right" },
              { key: "netPnl", label: "Net PnL", render: (row) => `$${row.netPnl.toFixed(2)}`, align: "right" },
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
              { key: "avgPnl", label: "Avg Trade", render: (row) => `$${row.avgPnl.toFixed(2)}`, align: "right" },
              { key: "netPnl", label: "Net PnL", render: (row) => `$${row.netPnl.toFixed(2)}`, align: "right" },
              { key: "totalFees", label: "Fees", render: (row) => `$${(row.totalFees ?? 0).toFixed(2)}`, align: "right" }
            ]}
          />
        </article>
      </section>
    </main>
  );
};
