import { useEffect, useMemo, useState } from "react";
import { AnalyticsTable } from "../components/AnalyticsTable";
import { DateFilterPopover } from "../components/DateFilterPopover";
import { PageHero } from "../components/PageHero";
import { PlaceholderPanel } from "../components/PlaceholderPanel";
import { ReportLineChart } from "../components/ReportLineChart";
import { WorkspaceIcon } from "../components/WorkspaceIcon";
import {
  getCumulativeNetPnlByDate,
  getPerformanceByGame,
  getHourlyBreakdown,
  getIntradayMetrics,
  getPerformanceByGateway,
  getPerformanceByMistake,
  getPerformanceBySetup,
  getPerformanceBySymbol,
  getSizeByDate
} from "../lib/analytics/tradeAnalytics";
import type { GroupedTrade } from "../types/trade";

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
  const intradayMetrics = getIntradayMetrics(filteredTrades);
  const hourlyBreakdown = getHourlyBreakdown(filteredTrades);
  const maxHourlyMagnitude = Math.max(...hourlyBreakdown.map((row) => Math.abs(row.netPnl)), 1);
  const symbolRows = getPerformanceBySymbol(filteredTrades);
  const topSymbols = symbolRows.slice(0, 8);
  const gatewayRows = getPerformanceByGateway(filteredTrades).slice(0, 8);
  const setupRows = getPerformanceBySetup(filteredTrades).slice(0, 8);
  const mistakeRows = getPerformanceByMistake(filteredTrades).slice(0, 8);
  const gameRows = getPerformanceByGame(filteredTrades).slice(0, 8);
  const cumulativeNetPnlSeries = getCumulativeNetPnlByDate(filteredTrades);
  const sizeByDateSeries = getSizeByDate(filteredTrades);

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
            <strong>{formatSignedMoney(intradayMetrics.netPnl)}</strong>
          </div>
        </div>
      </PageHero>
      <section className="placeholder-panel trade-view-filter-panel">
        <div className="trade-view-filter-header">
          <div className="panel-header">
            <WorkspaceIcon icon="filter" alt="Report filters icon" className="panel-header-icon" />
            <h2>Report Filters</h2>
          </div>
          <span>Only matching trades are included in the report widgets below.</span>
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
          <button
            type="button"
            className="mini-action trade-filter-reset"
            onClick={() => {
              setSelectedTradeDateFilterStart("");
              setSelectedTradeDateFilterEnd("");
              setSelectedPlaybookFilter("all");
              setSelectedSymbolFilter("all");
              setSelectedStatusFilter("all");
              setSelectedGameFilter("all");
              setSelectedExecutionFilter("all");
            }}
          >
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
      <section className="metric-grid">
        <PlaceholderPanel title="Symbols" description={String(symbols)} detail="Unique symbols in the filtered trade set" icon="tags" />
        <PlaceholderPanel title="Gateways" description={String(new Set(filteredTrades.flatMap((trade) => trade.gateways)).size)} detail="Distinct routing venues in the filtered data" icon="execution" />
        <PlaceholderPanel title="Review Scope" description={filteredTrades.length ? "Filtered View" : "No Data"} detail={`${filteredTrades.length} trades included in the current report view`} icon="filter" />
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
              <span>Net P&amp;L</span>
              <strong>{formatSignedMoney(intradayMetrics.netPnl)}</strong>
            </div>
            <div className="intraday-metric-card">
              <span>Avg P&amp;L</span>
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
      <section className="analytics-grid analytics-grid-single">
        <article className="placeholder-panel analytics-panel">
          <ReportLineChart
            points={cumulativeNetPnlSeries}
            color="#89d8ab"
            title="Net P&L Over Time"
            yAxisLabel="Net PnL USD (Sum)"
            valueFormatter={(value) => value.toFixed(2)}
          />
        </article>
      </section>
      <section className="analytics-grid analytics-grid-single">
        <article className="placeholder-panel analytics-panel">
          <ReportLineChart
            points={sizeByDateSeries}
            color="#c694ff"
            title="Size By Date"
            yAxisLabel="Size (Sum)"
            valueFormatter={(value) => value.toFixed(0)}
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
            emptyMessage="Adjust the report filters to populate symbol leaders."
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
            <h2>Setup Breakdown</h2>
          </div>
          <AnalyticsTable
            rows={setupRows}
            emptyMessage="Load trades to compare setups."
            columns={[
              { key: "label", label: "Setup", render: (row) => row.label },
              { key: "trades", label: "Trades", render: (row) => row.trades, align: "right" },
              { key: "winRate", label: "Win Rate", render: (row) => `${row.winRate.toFixed(1)}%`, align: "right" },
              { key: "netPnl", label: "Net PnL", render: (row) => `$${row.netPnl.toFixed(2)}`, align: "right" }
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
              { key: "winRate", label: "Win Rate", render: (row) => `${row.winRate.toFixed(1)}%`, align: "right" },
              { key: "netPnl", label: "Net PnL", render: (row) => `$${row.netPnl.toFixed(2)}`, align: "right" }
            ]}
          />
        </article>
      </section>
      <section className="analytics-grid analytics-grid-single">
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
              { key: "winRate", label: "Win Rate", render: (row) => `${row.winRate.toFixed(1)}%`, align: "right" },
              { key: "netPnl", label: "Net PnL", render: (row) => `$${row.netPnl.toFixed(2)}`, align: "right" }
            ]}
          />
        </article>
      </section>
    </main>
  );
};
