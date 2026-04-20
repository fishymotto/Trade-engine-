import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DateFilterPopover } from "../../../components/DateFilterPopover";
import { FilterSelect } from "../../../components/FilterSelect";
import { PageHero } from "../../../components/PageHero";
import { PlaceholderPanel } from "../../../components/PlaceholderPanel";
import { PreviewTable } from "../../../components/PreviewTable";
import { TagDrawer } from "../../../components/TagDrawer";
import { TradeChart, type TradeChartLayerVisibility } from "../../../components/TradeChart";
import { WorkspaceIcon } from "../../../components/WorkspaceIcon";
import { TradeExecutionsTable } from "../components/TradeExecutionsTable";
import { tradeTagFieldLabels, tradeTagFields } from "../../../lib/trades/tradeTagCatalog";
import type { ChartInterval, HistoricalBarSet } from "../../../types/chart";
import type { TradeReviewRecord } from "../../../types/review";
import type { GroupedTrade } from "../../../types/trade";
import type { EditableTradeRow, EditableTradeTagField } from "../../../types/tradeTags";

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
  externalSelectedTradeRequestId?: number;
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
  onUpdateTradeTag: (trade: EditableTradeRow, field: EditableTradeTagField, value: string | string[] | null) => void;
  onBulkUpdateTradeTags: (tradeIds: string[], field: EditableTradeTagField, value: string | string[] | null) => void;
  onCreateTradeTagOption: (field: EditableTradeTagField, value: string) => void;
  onClearExternalSelectedTrade?: () => void;
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
  volume: true,
  rsi: false,
  bollingerBands: false,
  macd: false,
  stochastic: false
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
  externalSelectedTradeRequestId = 0,
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
  onCreateTradeTagOption,
  onClearExternalSelectedTrade
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
  const [isBulkEditorOpen, setIsBulkEditorOpen] = useState(false);
  const [bulkEditorSearchQuery, setBulkEditorSearchQuery] = useState("");
  const [quickTagEditorField, setQuickTagEditorField] = useState<EditableTradeTagField | null>(null);
  const [quickTagEditorSearchQuery, setQuickTagEditorSearchQuery] = useState("");
  const barsInputRef = useRef<HTMLInputElement | null>(null);
  const activeTagFields = useMemo(
    () => tradeTagFields.filter((field) => tagOptionsByField[field].length > 0),
    [tagOptionsByField]
  );
  const isPlaybookTagEnabled = tagOptionsByField.playbook.length > 0;
  const isMistakeTagEnabled = tagOptionsByField.mistake.length > 0;
  const quickTagLabels: Partial<Record<EditableTradeTagField, string>> = useMemo(
    () => ({
      game: "Game",
      playbook: "Setup",
      mistake: "Mistakes",
      outTag: "Out Tags"
    }),
    []
  );

  useEffect(() => {
    if (activeTagFields.length > 0 && !activeTagFields.includes(bulkField)) {
      setBulkField(activeTagFields[0]);
    }
  }, [activeTagFields, bulkField]);
  const lastHandledExternalSelectionRef = useRef<number | null>(null);

  const getQuickTagValue = (trade: EditableTradeRow, field: EditableTradeTagField): string | string[] => {
    switch (field) {
      case "game":
        return trade.game;
      case "playbook":
        return trade.setups[0] ?? "";
      case "mistake":
        return trade.mistakes ?? [];
      case "outTag":
        return trade.outTag[0] ?? "";
      default:
        return "";
    }
  };

  const getToneIndex = (value: string): number =>
    value.split("").reduce((sum, character) => sum + character.charCodeAt(0), 0) % 6;

  const selectTradeAndReveal = (trade: EditableTradeRow) => {
    setSelectedTradeId(trade.id);
    setSelectedTradeDateFilterStart(trade.tradeDate);
    setSelectedTradeDateFilterEnd(trade.tradeDate);

    if (selectedPlaybookFilter !== "all" && (trade.setups[0] ?? "") !== selectedPlaybookFilter) {
      setSelectedPlaybookFilter("all");
    }

    if (selectedSymbolFilter !== "all" && trade.symbol !== selectedSymbolFilter) {
      setSelectedSymbolFilter("all");
    }

    if (selectedStatusFilter !== "all" && trade.status !== selectedStatusFilter) {
      setSelectedStatusFilter("all");
    }

    if (selectedGameFilter !== "all" && trade.game !== selectedGameFilter) {
      setSelectedGameFilter("all");
    }

    if (selectedExecutionFilter !== "all" && !trade.execution.includes(selectedExecutionFilter)) {
      setSelectedExecutionFilter("all");
    }

    setShowUntaggedPlaybookOnly(false);
    setShowUntaggedMistakesOnly(false);
  };

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
      if (lastHandledExternalSelectionRef.current === externalSelectedTradeRequestId) {
        return;
      }

      const externalTrade =
        databaseTrades.find(
          (trade) =>
            trade.id === externalSelectedTradeId &&
            (!externalTradeDateFilterStart || trade.tradeDate === externalTradeDateFilterStart)
        ) ?? databaseTrades.find((trade) => trade.id === externalSelectedTradeId);

      if (!externalTrade && databaseTrades.length === 0) {
        return;
      }

      lastHandledExternalSelectionRef.current = externalSelectedTradeRequestId;

      if (externalTrade) {
        setSelectedTradeId(externalTrade.id);
        setSelectedTradeDateFilterStart(externalTrade.tradeDate);
        setSelectedTradeDateFilterEnd(externalTrade.tradeDate);
        setSelectedPlaybookFilter("all");
        setSelectedSymbolFilter("all");
        setSelectedStatusFilter("all");
        setSelectedGameFilter("all");
        setSelectedExecutionFilter("all");
        setShowUntaggedPlaybookOnly(false);
        setShowUntaggedMistakesOnly(false);
        onClearExternalSelectedTrade?.();
        return;
      }

      setSelectedTradeId(externalSelectedTradeId);
      onClearExternalSelectedTrade?.();
    }
  }, [
    databaseTrades,
    externalSelectedTradeId,
    externalSelectedTradeRequestId,
    externalTradeDateFilterStart,
    onClearExternalSelectedTrade
  ]);

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

    setSelectedTradeId((current) =>
      databaseTrades.some((trade) => trade.id === current)
        ? current
        : databaseTrades[0].id
    );
  }, [databaseTrades]);

  useEffect(() => {
    setSelectedTradeIds((current) =>
      current.filter((tradeId) => databaseTrades.some((trade) => trade.id === tradeId))
    );
  }, [databaseTrades]);

  const matchesReviewSliceFilters = useCallback(
    (trade: EditableTradeRow) => {
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
    },
    [
      selectedExecutionFilter,
      selectedGameFilter,
      selectedPlaybookFilter,
      selectedStatusFilter,
      selectedSymbolFilter,
      selectedTradeDateFilterEnd,
      selectedTradeDateFilterStart,
      showUntaggedMistakesOnly,
      showUntaggedPlaybookOnly
    ]
  );

  const filteredTrades = useMemo(() => {
    return [...databaseTrades]
      .filter(matchesReviewSliceFilters)
      .sort(
        (left, right) =>
          right.tradeDate.localeCompare(left.tradeDate) ||
          left.openTime.localeCompare(right.openTime) ||
          left.closeTime.localeCompare(right.closeTime) ||
          left.symbol.localeCompare(right.symbol) ||
          left.name.localeCompare(right.name)
      );
  }, [databaseTrades, matchesReviewSliceFilters]);

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
      : null,
    showUntaggedPlaybookOnly
      ? { key: "untagged-playbook", label: "Playbook", value: "Untagged only" }
      : null,
    showUntaggedMistakesOnly
      ? { key: "untagged-mistakes", label: "Mistakes", value: "Untagged only" }
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
    setShowUntaggedPlaybookOnly(false);
    setShowUntaggedMistakesOnly(false);
  };

  const relatedTrades = useMemo(() => {
    const selectedTradeIdValue = selectedTrade?.id ?? "";
    const relationshipPlaybook =
      selectedPlaybookFilter !== "all" ? selectedPlaybookFilter : (selectedTrade?.setups[0] ?? "");

    let matchingTrades: EditableTradeRow[] = [];

    if (relationshipPlaybook) {
      matchingTrades = databaseTrades.filter(
        (trade) => trade.id !== selectedTradeIdValue && trade.setups.includes(relationshipPlaybook)
      );
    } else if (selectedTrade) {
      matchingTrades = databaseTrades.filter(
        (trade) =>
          trade.tradeDate === selectedTrade.tradeDate &&
          trade.symbol === selectedTrade.symbol &&
          trade.id !== selectedTrade.id
      );
    } else if (selectedSymbolFilter !== "all") {
      matchingTrades = databaseTrades.filter(
        (trade) => trade.id !== selectedTradeIdValue && trade.symbol === selectedSymbolFilter
      );
    } else {
      return [];
    }

    return matchingTrades
      .filter(matchesReviewSliceFilters)
      .sort(
      (left, right) =>
        right.tradeDate.localeCompare(left.tradeDate) ||
        left.openTime.localeCompare(right.openTime) ||
        left.closeTime.localeCompare(right.closeTime) ||
        left.name.localeCompare(right.name)
    );
  }, [databaseTrades, matchesReviewSliceFilters, selectedPlaybookFilter, selectedSymbolFilter, selectedTrade]);

  const relatedTradesDescription =
    selectedPlaybookFilter !== "all"
      ? `Other trades tagged ${selectedPlaybookFilter}.`
      : selectedTrade?.setups[0]
        ? `Other trades tagged ${selectedTrade.setups[0]}.`
        : selectedTrade
          ? "No playbook tagged yet, showing other trades from this symbol and date."
          : selectedSymbolFilter !== "all"
            ? `Other trades for ${selectedSymbolFilter} in the current slice.`
            : "";

  return (
    <main className="page-shell">
      <PageHero
        eyebrow="Trades"
        title="Trade Review"
        className="page-hero-trades"
        content={
          <section className="trade-view-filter-panel page-hero-review-slice-embedded">
            <div className="trade-view-filter-header">
              <div className="panel-header">
                <WorkspaceIcon icon="filter" alt="Trade filters icon" className="panel-header-icon" />
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
                  ariaLabel="Trade playbook filter"
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
                  ariaLabel="Trade symbol filter"
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
                  ariaLabel="Trade status filter"
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
                  ariaLabel="Trade game filter"
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
                  ariaLabel="Trade execution filter"
                  value={selectedExecutionFilter}
                  onChange={setSelectedExecutionFilter}
                  options={[
                    { label: "All Execution", value: "all" },
                    ...executionOptions.map((execution) => ({ label: execution, value: execution }))
                  ]}
                />
              </label>
            </div>
            <div className="active-filter-chip-row dashboard-review-chip-row" aria-label="Active trade slice">
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
        }
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
              <div className="trade-quick-tags" aria-label="Trade tag summary">
                <div className="trade-quick-tag">
                  <span className="trade-quick-tag-label">Symbol</span>
                  <strong className="trade-quick-tag-value">{selectedTrade.symbol}</strong>
                </div>
                <button
                  type="button"
                  className={`trade-quick-tag trade-quick-tag-button ${selectedTrade.game ? "" : "trade-quick-tag-empty"}`}
                  onClick={() => {
                    setQuickTagEditorField("game");
                    setQuickTagEditorSearchQuery("");
                  }}
                >
                  <span className="trade-quick-tag-label">Game</span>
                  <strong className="trade-quick-tag-value">{selectedTrade.game || "None"}</strong>
                </button>
                <button
                  type="button"
                  className={`trade-quick-tag trade-quick-tag-button ${selectedTrade.setups[0] ? "" : "trade-quick-tag-empty"}`}
                  onClick={() => {
                    setQuickTagEditorField("playbook");
                    setQuickTagEditorSearchQuery("");
                  }}
                >
                  <span className="trade-quick-tag-label">Setup</span>
                  <strong className="trade-quick-tag-value">{selectedTrade.setups[0] || "None"}</strong>
                </button>
                <button
                  type="button"
                  className={`trade-quick-tag trade-quick-tag-button ${selectedTrade.mistakes.length > 0 ? "" : "trade-quick-tag-empty"}`}
                  onClick={() => {
                    setQuickTagEditorField("mistake");
                    setQuickTagEditorSearchQuery(selectedTrade.mistakes.length === 1 ? selectedTrade.mistakes[0] ?? "" : "");
                  }}
                >
                  <span className="trade-quick-tag-label">Mistakes</span>
                  <strong className="trade-quick-tag-value">
                    {selectedTrade.mistakes.length > 0
                      ? `${selectedTrade.mistakes[0]}${selectedTrade.mistakes.length > 1 ? ` +${selectedTrade.mistakes.length - 1}` : ""}`
                      : "None"}
                  </strong>
                </button>
                <div className={`trade-quick-tag ${selectedTrade.gateways.length > 0 ? "" : "trade-quick-tag-empty"}`}>
                  <span className="trade-quick-tag-label">Gateways</span>
                  <strong className="trade-quick-tag-value">{selectedTrade.gateways.join(", ") || "None"}</strong>
                </div>
                <div
                  className={`trade-quick-tag trade-quick-tag-status ${
                    selectedTrade.status === "Win" ? "trade-quick-tag-status-win" : "trade-quick-tag-status-loss"
                  }`}
                >
                  <span className="trade-quick-tag-label">Win / Loss</span>
                  <strong className="trade-quick-tag-value">{selectedTrade.status}</strong>
                </div>
                <button
                  type="button"
                  className={`trade-quick-tag trade-quick-tag-button ${selectedTrade.outTag[0] ? "" : "trade-quick-tag-empty"}`}
                  onClick={() => {
                    setQuickTagEditorField("outTag");
                    setQuickTagEditorSearchQuery("");
                  }}
                >
                  <span className="trade-quick-tag-label">Out Tags</span>
                  <strong className="trade-quick-tag-value">{selectedTrade.outTag[0] || "None"}</strong>
                </button>
                <div className={`trade-quick-tag ${selectedTrade.feesUsd ? "" : "trade-quick-tag-empty"}`}>
                  <span className="trade-quick-tag-label">Fees</span>
                  <strong className="trade-quick-tag-value">${selectedTrade.feesUsd.toFixed(2)}</strong>
                </div>
              </div>
              <div className="trade-mini-stats">
                <div>
                  <strong>Date &amp; Time Range</strong>
                  <span>{selectedTrade.tradeDate}</span>
                  <span>{selectedTrade.openTime} to {selectedTrade.closeTime}</span>
                </div>
                <div>
                  <strong>Hold Time</strong>
                  <span>{selectedTrade.holdTime}</span>
                </div>
                <div>
                  <strong>Short / Long</strong>
                  <span>{selectedTrade.side}</span>
                </div>
                <div>
                  <strong>Size</strong>
                  <span>{selectedTrade.size.toLocaleString()}</span>
                </div>
                <div>
                  <strong>Average Entry Price</strong>
                  <span>{selectedTrade.entryPrice.toFixed(4)}</span>
                </div>
                <div>
                  <strong>Average Exit Price</strong>
                  <span>{selectedTrade.exitPrice.toFixed(4)}</span>
                </div>
                <div>
                  <strong>Return / Share</strong>
                  <span>{selectedTrade.returnPerShare.toFixed(4)}</span>
                </div>
                <div>
                  <strong>Total Return</strong>
                  <span>{selectedTrade.netPnlUsd >= 0 ? "+" : ""}${selectedTrade.netPnlUsd.toFixed(2)}</span>
                </div>
              </div>
              <TradeExecutionsTable trade={selectedTrade} />
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
                    fillHeight
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
                      fillHeight
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
        {/* <article className="trade-chart-pane trade-chart-pane-secondary day-view-chart-card day-view-panel">
          <div className="trade-chart-pane-header">
            <div>
              <span className="trade-chart-pane-eyebrow">Context</span>
              <strong>Day View</strong>
            </div>
            {selectedTrade ? <span>{selectedTrade.symbol} · {dayChartInterval}</span> : <span>No trade selected</span>}
          </div>
          {selectedTrade && selectedBarSet ? (
            <TradeChart
              bars={
                dayChartInterval === "1D" || dayChartInterval === "1W"
                  ? (selectedBarSet.dailyBars ?? selectedBarSet.bars)
                  : selectedBarSet.bars
              }
              trade={selectedTrade}
              fillHeight
              showMarkers={false}
              showEma={false}
              focusMode="day"
              interval={dayChartInterval}
              availableIntervals={secondaryChartIntervals}
              onChangeInterval={onChangeDayChartInterval}
            />
          ) : (
            <PlaceholderPanel
              title="No Day View Loaded"
              description="Choose a trade with historical bars to inspect the full session context."
            />
          )}
        </article> */}
        <article className="placeholder-panel related-trades-panel">
          <div className="panel-header">
            <WorkspaceIcon icon="reports" alt="Related trades icon" className="panel-header-icon" />
            <h2>Related Trades</h2>
          </div>
          {selectedTrade ? <span className="related-trades-context">{relatedTradesDescription}</span> : null}
          <PreviewTable
            trades={relatedTrades}
            tagOptionsByField={tagOptionsByField}
            selectedTradeId={selectedTradeId}
            showSelection={false}
            enableTagEditing
            onSelectTrade={(trade) => selectTradeAndReveal(trade)}
            onUpdateTradeTag={onUpdateTradeTag}
            onCreateTradeTagOption={onCreateTradeTagOption}
            emptyStateLabel={
              selectedTrade
                ? "No other trades match this relationship in the current slice."
                : "Select a trade to compare related setups."
            }
          />
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
        <article className="placeholder-panel trade-inspector trade-inspector-bottom">
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
                {selectedTrade.mistakes.length > 0 ? (
                  <div className="inspector-tag-row">
                    {selectedTrade.mistakes.map((mistake) => (
                      <button
                        key={mistake}
                        type="button"
                        className="inspector-tag-pill"
                        onClick={() => {
                          setQuickTagEditorField("mistake");
                          setQuickTagEditorSearchQuery(mistake);
                        }}
                      >
                        <span className={`tag-option-pill tag-option-pill-${getToneIndex(mistake)}`}>
                          {mistake}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <button
                    type="button"
                    className="inspector-tag-empty-link"
                    onClick={() => {
                      setQuickTagEditorField("mistake");
                      setQuickTagEditorSearchQuery("");
                    }}
                  >
                    Add mistake
                  </button>
                )}
              </div>
            </div>
          ) : (
            <PlaceholderPanel
              title="No Trade Selected"
              description="Choose a grouped trade from the grid to inspect the tags, fees, and execution details."
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
            {isPlaybookTagEnabled ? (
              <label className="trade-filter-toggle">
                <input
                  type="checkbox"
                  checked={showUntaggedPlaybookOnly}
                  onChange={(event) => setShowUntaggedPlaybookOnly(event.target.checked)}
                />
                <span>Untagged Playbook</span>
              </label>
            ) : null}
            {isMistakeTagEnabled ? (
              <label className="trade-filter-toggle">
                <input
                  type="checkbox"
                  checked={showUntaggedMistakesOnly}
                  onChange={(event) => setShowUntaggedMistakesOnly(event.target.checked)}
                />
                <span>Untagged Mistakes</span>
              </label>
            ) : null}
          </div>
          <div className="bulk-tag-toolbar">
            <span>{selectedTradeIds.length} selected</span>
            <select
              className="calendar-date-select"
              value={bulkField}
              disabled={activeTagFields.length === 0}
              onChange={(event) => setBulkField(event.target.value as EditableTradeTagField)}
            >
              {activeTagFields.map((field) => (
                <option key={field} value={field}>
                  {tradeTagFieldLabels[field]}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="mini-action"
              disabled={selectedTradeIds.length === 0 || activeTagFields.length === 0}
              onClick={() => {
                setBulkEditorSearchQuery("");
                setIsBulkEditorOpen(true);
              }}
            >
              Apply Bulk Tag
            </button>
            <button
              type="button"
              className="mini-action"
              disabled={selectedTradeIds.length === 0 || activeTagFields.length === 0}
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
          onSelectTrade={(trade) => selectTradeAndReveal(trade)}
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
      {isBulkEditorOpen ? (
        <TagDrawer
          isOpen={isBulkEditorOpen}
          title={`Bulk Update - ${tradeTagFieldLabels[bulkField]}`}
          options={tagOptionsByField[bulkField]}
          currentValue=""
          allowClear
          clearLabel={bulkField === "mistake" ? "No mistakes" : `Clear ${tradeTagFieldLabels[bulkField]}`}
          searchValue={bulkEditorSearchQuery}
          onSearchChange={setBulkEditorSearchQuery}
          onSelect={(value) => {
            onBulkUpdateTradeTags(selectedTradeIds, bulkField, value);
            setIsBulkEditorOpen(false);
            setBulkEditorSearchQuery("");
          }}
          onCreateOption={(value) => {
            onCreateTradeTagOption(bulkField, value);
            onBulkUpdateTradeTags(selectedTradeIds, bulkField, value);
            setIsBulkEditorOpen(false);
            setBulkEditorSearchQuery("");
          }}
          onClose={() => {
            setIsBulkEditorOpen(false);
            setBulkEditorSearchQuery("");
          }}
        />
      ) : null}
      {quickTagEditorField && selectedTrade ? (
        <TagDrawer
          isOpen={!!quickTagEditorField}
          title={`${quickTagLabels[quickTagEditorField] ?? tradeTagFieldLabels[quickTagEditorField]} - ${selectedTrade.name}`}
          options={tagOptionsByField[quickTagEditorField]}
          selectionMode={quickTagEditorField === "mistake" ? "multi" : "single"}
          currentValue={
            quickTagEditorField === "mistake"
              ? ""
              : (getQuickTagValue(selectedTrade, quickTagEditorField) as string)
          }
          currentValues={
            quickTagEditorField === "mistake"
              ? (getQuickTagValue(selectedTrade, "mistake") as string[])
              : []
          }
          allowClear
          clearLabel={
            quickTagEditorField === "mistake"
              ? "No mistakes"
              : `Clear ${quickTagLabels[quickTagEditorField] ?? tradeTagFieldLabels[quickTagEditorField]}`
          }
          searchValue={quickTagEditorSearchQuery}
          onSearchChange={setQuickTagEditorSearchQuery}
          onSelect={(value) => {
            onUpdateTradeTag(selectedTrade, quickTagEditorField, value);
            if (quickTagEditorField !== "mistake") {
              setQuickTagEditorField(null);
              setQuickTagEditorSearchQuery("");
            }
          }}
          onCreateOption={(value) => {
            onCreateTradeTagOption(quickTagEditorField, value);
            if (quickTagEditorField === "mistake") {
              const currentValues = selectedTrade.mistakes ?? [];
              const nextValues = currentValues.includes(value) ? currentValues : [...currentValues, value];
              onUpdateTradeTag(selectedTrade, "mistake", nextValues);
              return;
            }

            onUpdateTradeTag(selectedTrade, quickTagEditorField, value);
            setQuickTagEditorField(null);
            setQuickTagEditorSearchQuery("");
          }}
          onClose={() => {
            setQuickTagEditorField(null);
            setQuickTagEditorSearchQuery("");
          }}
        />
      ) : null}
    </main>
  );
};
