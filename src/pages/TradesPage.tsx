import { useEffect, useMemo, useRef, useState } from "react";
import { DateFilterPopover } from "../components/DateFilterPopover";
import { PageHero } from "../components/PageHero";
import { PlaceholderPanel } from "../components/PlaceholderPanel";
import { PreviewTable } from "../components/PreviewTable";
import { SearchableTagPopover } from "../components/SearchableTagPopover";
import { TradeChart, type TradeChartLayerVisibility } from "../components/TradeChart";
import { WorkspaceIcon } from "../components/WorkspaceIcon";
import { tradeTagFieldLabels } from "../lib/trades/tradeTagCatalog";
import type { ChartInterval, HistoricalBarSet } from "../types/chart";
import type { TradeReviewRecord } from "../types/review";
import type { GroupedTrade } from "../types/trade";
import type { EditableTradeRow, EditableTradeTagField } from "../types/tradeTags";

interface TradesPageProps {
  fileName: string;
  trades: EditableTradeRow[];
  databaseTrades: EditableTradeRow[];
  externalTradeDateFilterStart?: string;
  externalTradeDateFilterEnd?: string;
  externalPlaybookFilter?: string;
  externalSymbolFilter?: string;
  externalStatusFilter?: string;
  externalGameFilter?: string;
  externalExecutionFilter?: string;
  externalSelectedTradeId?: string;
  reviews: TradeReviewRecord[];
  historicalBarSets: HistoricalBarSet[];
  reviewChartInterval: ChartInterval;
  dayChartInterval: ChartInterval;
  tagOptionsByField: Record<EditableTradeTagField, string[]>;
  busy: boolean;
  onUpdateReview: (
    tradeId: string,
    updates: Partial<Pick<TradeReviewRecord, "notes" | "chartContext" | "screenshotUrl" | "drawings">>
  ) => void;
  onImportHistoricalBars: (trade: GroupedTrade, file: File) => Promise<void>;
  onFetchHistoricalBars: (trade: GroupedTrade) => Promise<void>;
  onClearHistoricalBars: (trade: GroupedTrade) => void;
  hasTwelveDataApiKey: boolean;
  onChangeReviewChartInterval: (interval: ChartInterval) => void;
  onChangeDayChartInterval: (interval: ChartInterval) => void;
  onUpdateTradeTag: (trade: EditableTradeRow, field: EditableTradeTagField, value: string | null) => void;
  onBulkUpdateTradeTags: (tradeIds: string[], field: EditableTradeTagField, value: string | null) => void;
  onCreateTradeTagOption: (field: EditableTradeTagField, value: string) => void;
}

const formatActiveDateRange = (startValue: string, endValue: string): string => {
  if (startValue && endValue) {
    if (startValue === endValue) {
      return startValue;
    }

    return `${startValue} to ${endValue}`;
  }

  return "All saved sessions";
};

const intradayChartIntervals: ChartInterval[] = ["1m", "5m", "15m", "1h"];
const secondaryChartIntervals: ChartInterval[] = ["1m", "5m", "15m", "1h", "1D", "1W"];
const defaultChartLayerVisibility: TradeChartLayerVisibility = {
  entry: true,
  addToWinner: true,
  averageDown: true,
  exit: true,
  ema9: true,
  ema12: true,
  open: true,
  hod: true,
  lod: true,
  vwap: true,
  volume: true
};

export const TradesPage = ({
  fileName,
  trades,
  databaseTrades,
  externalTradeDateFilterStart = "",
  externalTradeDateFilterEnd = "",
  externalPlaybookFilter = "all",
  externalSymbolFilter = "all",
  externalStatusFilter = "all",
  externalGameFilter = "all",
  externalExecutionFilter = "all",
  externalSelectedTradeId = "",
  reviews,
  historicalBarSets,
  reviewChartInterval,
  dayChartInterval,
  tagOptionsByField,
  busy,
  onUpdateReview,
  onImportHistoricalBars,
  onFetchHistoricalBars,
  onClearHistoricalBars,
  hasTwelveDataApiKey,
  onChangeReviewChartInterval,
  onChangeDayChartInterval,
  onUpdateTradeTag,
  onBulkUpdateTradeTags,
  onCreateTradeTagOption
}: TradesPageProps) => {
  const [selectedTradeId, setSelectedTradeId] = useState<string>("");
  const [selectedTradeIds, setSelectedTradeIds] = useState<string[]>([]);
  const [selectedTradeDateFilterStart, setSelectedTradeDateFilterStart] = useState(externalTradeDateFilterStart);
  const [selectedTradeDateFilterEnd, setSelectedTradeDateFilterEnd] = useState(externalTradeDateFilterEnd);
  const [selectedPlaybookFilter, setSelectedPlaybookFilter] = useState(externalPlaybookFilter);
  const [selectedSymbolFilter, setSelectedSymbolFilter] = useState(externalSymbolFilter);
  const [selectedStatusFilter, setSelectedStatusFilter] = useState(externalStatusFilter);
  const [selectedGameFilter, setSelectedGameFilter] = useState(externalGameFilter);
  const [selectedExecutionFilter, setSelectedExecutionFilter] = useState(externalExecutionFilter);
  const [chartLayerVisibility, setChartLayerVisibility] = useState<TradeChartLayerVisibility>(defaultChartLayerVisibility);
  const [showUntaggedPlaybookOnly, setShowUntaggedPlaybookOnly] = useState(false);
  const [showUntaggedMistakesOnly, setShowUntaggedMistakesOnly] = useState(false);
  const [bulkField, setBulkField] = useState<EditableTradeTagField>("playbook");
  const [bulkEditorAnchor, setBulkEditorAnchor] = useState<DOMRect | null>(null);
  const barsInputRef = useRef<HTMLInputElement | null>(null);

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
    if (externalSelectedTradeId) {
      setSelectedTradeId(externalSelectedTradeId);
    }
  }, [externalSelectedTradeId]);

  const tradeDateOptions = useMemo(
    () => Array.from(new Set(databaseTrades.map((trade) => trade.tradeDate))).sort((left, right) => right.localeCompare(left)),
    [databaseTrades]
  );

  const playbookOptions = useMemo(
    () =>
      Array.from(
        new Set(
          databaseTrades
            .map((trade) => trade.setups[0] ?? "")
            .filter((value) => value.trim().length > 0)
        )
      ).sort((left, right) => left.localeCompare(right)),
    [databaseTrades]
  );

  const symbolOptions = useMemo(
    () => Array.from(new Set(databaseTrades.map((trade) => trade.symbol))).sort((left, right) => left.localeCompare(right)),
    [databaseTrades]
  );

  const statusOptions = useMemo(
    () => Array.from(new Set(databaseTrades.map((trade) => trade.status))).sort((left, right) => left.localeCompare(right)),
    [databaseTrades]
  );

  const gameOptions = useMemo(
    () =>
      Array.from(new Set(databaseTrades.map((trade) => trade.game).filter((value) => value.trim().length > 0))).sort(
        (left, right) => left.localeCompare(right)
      ),
    [databaseTrades]
  );

  const executionOptions = useMemo(
    () =>
      Array.from(
        new Set(
          databaseTrades
            .flatMap((trade) => trade.execution)
            .filter((value) => value.trim().length > 0)
        )
      ).sort((left, right) => left.localeCompare(right)),
    [databaseTrades]
  );

  useEffect(() => {
    if (databaseTrades.length === 0) {
      setSelectedTradeId("");
      return;
    }

    const stillExists = databaseTrades.some((trade) => trade.id === selectedTradeId);
    if (!stillExists) {
      setSelectedTradeId(databaseTrades[0].id);
    }
  }, [databaseTrades, selectedTradeId]);

  useEffect(() => {
    setSelectedTradeIds((current) =>
      current.filter((tradeId) => databaseTrades.some((trade) => trade.id === tradeId))
    );
  }, [databaseTrades]);

  const filteredTrades = useMemo(() => {
    return [...databaseTrades]
      .filter((trade) => {
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

        if (selectedExecutionFilter !== "all" && !trade.execution.includes(selectedExecutionFilter)) {
          return false;
        }

        if (showUntaggedPlaybookOnly && trade.setups[0]) {
          return false;
        }

        if (showUntaggedMistakesOnly && trade.mistakes[0]) {
          return false;
        }

        return true;
      })
      .sort(
        (left, right) =>
          right.tradeDate.localeCompare(left.tradeDate) ||
          left.openTime.localeCompare(right.openTime) ||
          left.closeTime.localeCompare(right.closeTime) ||
          left.symbol.localeCompare(right.symbol) ||
          left.name.localeCompare(right.name)
      );
  }, [
    databaseTrades,
    selectedExecutionFilter,
    selectedGameFilter,
    selectedPlaybookFilter,
    selectedStatusFilter,
    selectedSymbolFilter,
    selectedTradeDateFilterEnd,
    selectedTradeDateFilterStart,
    showUntaggedMistakesOnly,
    showUntaggedPlaybookOnly
  ]);

  const selectedTrade = useMemo(
    () =>
      filteredTrades.find((trade) => trade.id === selectedTradeId) ??
      databaseTrades.find((trade) => trade.id === selectedTradeId) ??
      null,
    [databaseTrades, filteredTrades, selectedTradeId]
  );

  const selectedReview = useMemo(
    () => reviews.find((review) => review.tradeId === selectedTradeId) ?? null,
    [reviews, selectedTradeId]
  );

  const selectedBarSet = useMemo(() => {
    if (!selectedTrade) {
      return null;
    }

    return (
      historicalBarSets.find(
        (barSet) =>
          barSet.symbol === selectedTrade.symbol &&
          barSet.tradeDate === selectedTrade.tradeDate
      ) ?? null
    );
  }, [historicalBarSets, selectedTrade]);

  const workspaceHint =
    trades.length > 0
      ? `Current staged file: ${fileName || "Unsaved workspace"}`
      : `Saved trade library: ${databaseTrades.length} grouped trades`;

  const filteredSymbolCount = useMemo(
    () => new Set(filteredTrades.map((trade) => trade.symbol)).size,
    [filteredTrades]
  );

  const sameSessionTrades = useMemo(() => {
    if (!selectedTrade) {
      return [];
    }

    return databaseTrades.filter(
      (trade) =>
        trade.tradeDate === selectedTrade.tradeDate &&
        trade.symbol === selectedTrade.symbol &&
        trade.id !== selectedTrade.id
    );
  }, [databaseTrades, selectedTrade]);

  return (
    <main className="page-shell">
      <PageHero
        eyebrow="Trades"
        title="Trade Review Workspace"
        description="Review saved trades, clean tags, and inspect chart context from the active slice."
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
            <strong>{filteredSymbolCount}</strong>
          </div>
          <div className="page-hero-stat-card">
            <span>Selected</span>
            <strong>{selectedTrade?.name ?? "No trade selected"}</strong>
          </div>
        </div>
      </PageHero>
      <section className="placeholder-panel trade-view-filter-panel">
        <div className="trade-view-filter-header">
          <div className="panel-header">
            <WorkspaceIcon icon="filter" alt="Trade filters icon" className="panel-header-icon" />
            <h2>Trade Filters</h2>
          </div>
          <span>Show only the trades that match this view.</span>
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
              setShowUntaggedPlaybookOnly(false);
              setShowUntaggedMistakesOnly(false);
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
      <section className="trades-review-grid trades-review-grid-advanced">
        <article className="placeholder-panel chart-panel chart-panel-wide">
          <div className="chart-panel-header">
            <div className="panel-header">
              <WorkspaceIcon icon="trades" alt="Chart area icon" className="panel-header-icon" />
              <h2>Chart Area</h2>
            </div>
            <div className="chart-panel-actions">
              <input
                ref={barsInputRef}
                type="file"
                accept=".csv,text/csv"
                className="drop-zone-input"
                onChange={(event) => {
                  const file = event.target.files?.item(0);
                  if (file && selectedTrade) {
                    void onImportHistoricalBars(selectedTrade, file);
                  }

                  event.currentTarget.value = "";
                }}
              />
              <button
                type="button"
                className="mini-action"
                disabled={!selectedTrade || busy || !hasTwelveDataApiKey}
                onClick={() => selectedTrade && void onFetchHistoricalBars(selectedTrade)}
              >
                <WorkspaceIcon icon="reports" alt="Fetch bars icon" className="mini-action-icon" />
                Fetch Bars
              </button>
              <button
                type="button"
                className="mini-action"
                disabled={!selectedTrade || busy}
                onClick={() => barsInputRef.current?.click()}
              >
                <WorkspaceIcon icon="import" alt="Import bars icon" className="mini-action-icon" />
                Import Bars
              </button>
              <button
                type="button"
                className="mini-action"
                disabled={!selectedBarSet || busy || !selectedTrade}
                onClick={() => selectedTrade && onClearHistoricalBars(selectedTrade)}
              >
                <WorkspaceIcon icon="data" alt="Clear bars icon" className="mini-action-icon" />
                Clear Bars
              </button>
            </div>
          </div>
          <p>{selectedTrade ? selectedTrade.symbol : "No trade selected yet"}</p>
          <span>{workspaceHint}</span>
          {selectedTrade ? (
            <>
              <div className="trade-mini-stats">
                <div>
                  <strong>{selectedTrade.tradeDate}</strong>
                  <span>{selectedTrade.openTime} to {selectedTrade.closeTime}</span>
                </div>
                <div>
                  <strong>{selectedTrade.side}</strong>
                  <span>{selectedTrade.status}</span>
                </div>
                <div>
                  <strong>{selectedTrade.netPnlUsd >= 0 ? "+" : ""}${selectedTrade.netPnlUsd.toFixed(2)}</strong>
                  <span>{selectedTrade.returnPerShare.toFixed(4)} return/share</span>
                </div>
              </div>
              <div className="trade-route">
                <div className="trade-route-row">
                  <span className="trade-route-label">Entry</span>
                  <strong>{selectedTrade.openTime}</strong>
                  <span>{selectedTrade.entryPrice.toFixed(4)}</span>
                </div>
                {selectedTrade.addSignals.map((signal, index) => (
                  <div key={`${signal.time}-${index}`} className="trade-route-row">
                    <span className="trade-route-label">Add</span>
                    <strong>{signal.time}</strong>
                    <span>{signal.price.toFixed(4)}</span>
                  </div>
                ))}
                <div className="trade-route-row">
                  <span className="trade-route-label">Exit</span>
                  <strong>{selectedTrade.closeTime}</strong>
                  <span>{selectedTrade.exitPrice.toFixed(4)}</span>
                </div>
              </div>
              <div className="chart-toolbar-stack">
                <div className="chart-toolbar-row">
                  <div className="chart-toolbar-group chart-toolbar-group-meta">
                    <span className="chart-toolbar-label">Data</span>
                    <div className="chart-toolbar-chip-row">
                      {selectedBarSet ? (
                        <>
                          <span className="chart-meta-badge">{selectedBarSet.bars.length} bars loaded</span>
                          <span className="chart-meta-badge">{selectedBarSet.sourceFileName}</span>
                          <span className="chart-meta-badge">
                            Updated {new Date(selectedBarSet.updatedAt).toLocaleString()}
                          </span>
                        </>
                      ) : (
                        <>
                          <span className="chart-meta-badge">No bar data loaded yet</span>
                          <span className="chart-meta-badge">{selectedTrade.symbol}</span>
                          <span className="chart-meta-badge">{selectedTrade.tradeDate}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
              <div className="trade-chart-grid">
                <div className="trade-chart-pane trade-chart-pane-main">
                  <div className="trade-chart-pane-header">
                    <div>
                      <span className="trade-chart-pane-eyebrow">Trade Review</span>
                      <strong>Main Chart</strong>
                    </div>
                    <span>{selectedTrade.symbol} · {reviewChartInterval}</span>
                  </div>
                  <TradeChart
                    bars={selectedBarSet?.bars ?? []}
                    trade={selectedTrade}
                    interval={reviewChartInterval}
                    layerVisibility={chartLayerVisibility}
                    onToggleLayerVisibility={(layer) =>
                      setChartLayerVisibility((current) => ({
                        ...current,
                        [layer]: !current[layer]
                      }))
                    }
                    drawings={selectedReview?.drawings ?? []}
                    onDrawingsChange={(drawings) => selectedTrade && onUpdateReview(selectedTrade.id, { drawings })}
                    showDrawingTools
                    availableIntervals={intradayChartIntervals}
                    onChangeInterval={onChangeReviewChartInterval}
                  />
                </div>
                {selectedTrade && selectedBarSet ? (
                  <div className="trade-chart-pane trade-chart-pane-secondary day-view-chart-card">
                    <div className="trade-chart-pane-header">
                      <div>
                        <span className="trade-chart-pane-eyebrow">Context</span>
                        <strong>Day View</strong>
                      </div>
                      <span>{selectedTrade.symbol} · {dayChartInterval}</span>
                    </div>
                    <TradeChart
                      bars={
                        dayChartInterval === "1D" || dayChartInterval === "1W"
                          ? (selectedBarSet.dailyBars ?? selectedBarSet.bars)
                          : selectedBarSet.bars
                      }
                      trade={selectedTrade}
                      height={500}
                      showMarkers={false}
                      showEma={false}
                      focusMode="day"
                      interval={dayChartInterval}
                      availableIntervals={secondaryChartIntervals}
                      onChangeInterval={onChangeDayChartInterval}
                    />
                  </div>
                ) : (
                  <div className="trade-chart-pane trade-chart-pane-secondary day-view-chart-card">
                    <PlaceholderPanel
                      title="No Day View Loaded"
                      description="Choose a trade with historical bars to inspect the full session context."
                    />
                  </div>
                )}
              </div>
              {!selectedBarSet ? (
                <div className="empty-chart-state">
                  <strong>No historical bars loaded yet.</strong>
                  <span>
                    {hasTwelveDataApiKey
                      ? `Click Fetch Bars to pull 1-minute candles for ${selectedTrade.symbol} on ${selectedTrade.tradeDate}, or import a bar CSV manually.`
                      : `Add your Twelve Data API key in Settings, then click Fetch Bars for ${selectedTrade.symbol} on ${selectedTrade.tradeDate}, or import a bar CSV manually.`}
                  </span>
                </div>
              ) : null}
            </>
          ) : null}
        </article>
        <article className="placeholder-panel trade-inspector">
          <div className="panel-header">
            <WorkspaceIcon icon="journal" alt="Trade inspector icon" className="panel-header-icon" />
            <h2>Trade Inspector</h2>
          </div>
          {selectedTrade ? (
            <div className="trade-inspector-grid">
              <div className="inspector-card">
                <WorkspaceIcon icon="text" alt="Name icon" className="inspector-card-icon" />
                <strong>Name</strong>
                <span>{selectedTrade.name}</span>
              </div>
              <div className="inspector-card">
                <WorkspaceIcon icon="tags" alt="Game icon" className="inspector-card-icon" />
                <strong>Game</strong>
                <span>{selectedTrade.game || "Unrated"}</span>
              </div>
              <div className="inspector-card">
                <WorkspaceIcon icon="execution" alt="Execution icon" className="inspector-card-icon" />
                <strong>Execution</strong>
                <span>{selectedTrade.execution.join(", ") || "None"}</span>
              </div>
              <div className="inspector-card">
                <WorkspaceIcon icon="filter" alt="Out tag icon" className="inspector-card-icon" />
                <strong>Out Tag</strong>
                <span>{selectedTrade.outTag.join(", ") || "None"}</span>
              </div>
              <div className="inspector-card">
                <WorkspaceIcon icon="plan" alt="Gateways icon" className="inspector-card-icon" />
                <strong>Gateways</strong>
                <span>{selectedTrade.gateways.join(", ") || "None"}</span>
              </div>
              <div className="inspector-card">
                <WorkspaceIcon icon="money" alt="Fees icon" className="inspector-card-icon" />
                <strong>Fees</strong>
                <span>${selectedTrade.feesUsd.toFixed(2)}</span>
              </div>
              <div className="inspector-card">
                <WorkspaceIcon icon="journal" alt="Setups icon" className="inspector-card-icon" />
                <strong>Setups</strong>
                <span>{selectedTrade.setups.join(", ") || "None"}</span>
              </div>
              <div className="inspector-card">
                <WorkspaceIcon icon="checklist" alt="Mistakes icon" className="inspector-card-icon" />
                <strong>Mistakes</strong>
                <span>{selectedTrade.mistakes.join(", ") || "None"}</span>
              </div>
            </div>
          ) : (
            <PlaceholderPanel
              title="No Trade Selected"
              description="Choose a grouped trade from the grid to inspect the tags, fees, and execution details."
            />
          )}
        </article>
        <article className="placeholder-panel related-trades-panel">
          <div className="panel-header">
            <WorkspaceIcon icon="reports" alt="Related trades icon" className="panel-header-icon" />
            <h2>Related Trades</h2>
          </div>
          {selectedTrade && sameSessionTrades.length > 0 ? (
            <div className="related-trade-list">
              {sameSessionTrades.map((trade) => (
                <button
                  key={trade.id}
                  type="button"
                  className="related-trade-item"
                  onClick={() => setSelectedTradeId(trade.id)}
                >
                  <strong>{trade.name}</strong>
                  <span>{trade.openTime} to {trade.closeTime}</span>
                  <span>{trade.netPnlUsd >= 0 ? "+" : ""}${trade.netPnlUsd.toFixed(2)}</span>
                </button>
              ))}
            </div>
          ) : (
            <span className="empty-inline-state">
              {selectedTrade ? "No other trades from this symbol and date." : "Select a trade to compare nearby setups."}
            </span>
          )}
        </article>
        <article className="placeholder-panel trade-review-dock trade-review-bottom">
          <div className="panel-header">
            <WorkspaceIcon icon="journal" alt="Trade review icon" className="panel-header-icon" />
            <h2>Trade Review</h2>
          </div>
          {selectedTrade ? (
            <div className="trade-review-form">
              <label className="review-field">
                <span>Review Notes</span>
                <textarea
                  value={selectedReview?.notes ?? ""}
                  onChange={(event) =>
                    onUpdateReview(selectedTrade.id, { notes: event.target.value })
                  }
                  placeholder="Capture execution notes, emotions, and what to improve next time."
                />
              </label>
              {selectedReview ? (
                <div className="review-meta">
                  <span>Last updated {new Date(selectedReview.updatedAt).toLocaleString()}</span>
                </div>
              ) : null}
            </div>
          ) : (
            <PlaceholderPanel
              title="No Review Loaded"
              description="Choose a trade to add review notes."
            />
          )}
        </article>
      </section>
      <section className="placeholder-panel analytics-panel trade-database-panel">
        <div className="trade-database-toolbar">
          <div className="panel-header">
            <WorkspaceIcon icon="data" alt="Trade database icon" className="panel-header-icon" />
            <h2>Trade Database</h2>
          </div>
          <div className="trade-database-filters">
            <label className="trade-filter-toggle">
              <input
                type="checkbox"
                checked={showUntaggedPlaybookOnly}
                onChange={(event) => setShowUntaggedPlaybookOnly(event.target.checked)}
              />
              <span>Untagged Playbook</span>
            </label>
            <label className="trade-filter-toggle">
              <input
                type="checkbox"
                checked={showUntaggedMistakesOnly}
                onChange={(event) => setShowUntaggedMistakesOnly(event.target.checked)}
              />
              <span>Untagged Mistakes</span>
            </label>
          </div>
          <div className="bulk-tag-toolbar">
            <span>{selectedTradeIds.length} selected</span>
            <select
              className="calendar-date-select"
              value={bulkField}
              onChange={(event) => setBulkField(event.target.value as EditableTradeTagField)}
            >
              {Object.entries(tradeTagFieldLabels).map(([field, label]) => (
                <option key={field} value={field}>
                  {label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="mini-action"
              disabled={selectedTradeIds.length === 0}
              onClick={(event) => setBulkEditorAnchor(event.currentTarget.getBoundingClientRect())}
            >
              Apply Bulk Tag
            </button>
            <button
              type="button"
              className="mini-action"
              disabled={selectedTradeIds.length === 0}
              onClick={() => onBulkUpdateTradeTags(selectedTradeIds, bulkField, null)}
            >
              Clear Field
            </button>
          </div>
        </div>
        <PreviewTable
          trades={filteredTrades}
          tagOptionsByField={tagOptionsByField}
          selectedTradeId={selectedTradeId}
          selectedTradeIds={selectedTradeIds}
          onSelectTrade={(trade) => setSelectedTradeId(trade.id)}
          onToggleTradeSelection={(tradeId) =>
            setSelectedTradeIds((current) =>
              current.includes(tradeId)
                ? current.filter((id) => id !== tradeId)
                : [...current, tradeId]
            )
          }
          onToggleSelectAll={(tradeIds) =>
            setSelectedTradeIds((current) =>
              tradeIds.every((tradeId) => current.includes(tradeId))
                ? current.filter((tradeId) => !tradeIds.includes(tradeId))
                : Array.from(new Set([...current, ...tradeIds]))
            )
          }
          onUpdateTradeTag={onUpdateTradeTag}
          onCreateTradeTagOption={onCreateTradeTagOption}
        />
      </section>
      {bulkEditorAnchor ? (
        <SearchableTagPopover
          anchorRect={bulkEditorAnchor}
          title={`Bulk Update Â· ${tradeTagFieldLabels[bulkField]}`}
          options={tagOptionsByField[bulkField]}
          currentValue=""
          allowClear
          clearLabel={bulkField === "mistake" ? "No mistakes" : `Clear ${tradeTagFieldLabels[bulkField]}`}
          onSelect={(value) => {
            onBulkUpdateTradeTags(selectedTradeIds, bulkField, value);
            setBulkEditorAnchor(null);
          }}
          onCreateOption={(value) => {
            onCreateTradeTagOption(bulkField, value);
            onBulkUpdateTradeTags(selectedTradeIds, bulkField, value);
            setBulkEditorAnchor(null);
          }}
          onClose={() => setBulkEditorAnchor(null)}
        />
      ) : null}
    </main>
  );
};
