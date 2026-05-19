import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DateFilterPopover } from "../../../components/DateFilterPopover";
import { FilterSelect } from "../../../components/FilterSelect";
import { JournalRichTextEditor } from "../../journal/components/JournalRichTextEditor";
import { PageHero } from "../../../components/PageHero";
import { PlaceholderPanel } from "../../../components/PlaceholderPanel";
import { PreviewTable } from "../../../components/PreviewTable";
import { TagDrawer } from "../../../components/TagDrawer";
import { TradeChart, type TradeChartLayerVisibility } from "../../../components/TradeChart";
import { WorkspaceIcon } from "../../../components/WorkspaceIcon";
import { TradeExecutionsTable } from "../components/TradeExecutionsTable";
import { tradeTagFieldLabels, tradeTagOptionsByField as defaultTradeTagOptionsByField } from "../../../lib/trades/tradeTagCatalog";
import { getTradePlaybookOptions, tradeHasPlaybook } from "../../../lib/trades/playbookFilters";
import { createEmptyJournalDoc } from "../../../lib/journal/journalContent";
import { saveWorkspaceInlineImage } from "../../../lib/workspace/workspaceAttachmentClient";
import type { ChartInterval, HistoricalBarSet } from "../../../types/chart";
import type { JSONContent } from "@tiptap/core";
import type { TradeReviewRecord } from "../../../types/review";
import type { GroupedTrade } from "../../../types/trade";
import type { EditableTradeRow, EditableTradeTagField } from "../../../types/tradeTags";

interface TradesPageProps {
  databaseTrades: EditableTradeRow[];
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
  externalSelectedTradeId?: string;
  externalSelectedTradeRequestId?: number;
  reviews: TradeReviewRecord[];
  historicalBarSets: HistoricalBarSet[];
  historicalBarSetsLoaded: boolean;
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
  onCreateTradeTagOption: (field: EditableTradeTagField, value: string) => void;
  onRenameTradeTagOption: (field: EditableTradeTagField, currentValue: string, nextValue: string) => void;
  onDeleteTradeTagOption: (field: EditableTradeTagField, value: string) => void;
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

const buildTradeBarKey = (trade: Pick<GroupedTrade, "symbol" | "tradeDate">): string =>
  `${trade.symbol}__${trade.tradeDate}`;

const formatSignedMoney = (value: number): string => `${value >= 0 ? "+" : "-"}$${Math.abs(value).toFixed(2)}`;

const formatSignedDecimal = (value: number, digits = 4): string =>
  `${value >= 0 ? "+" : "-"}${Math.abs(value).toFixed(digits)}`;

const summarizeTaggedValues = (values: string[], emptyLabel = "None"): string => {
  const normalizedValues = values.map((value) => value.trim()).filter((value) => value.length > 0);
  if (normalizedValues.length === 0) {
    return emptyLabel;
  }

  return `${normalizedValues[0]}${normalizedValues.length > 1 ? ` +${normalizedValues.length - 1}` : ""}`;
};

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

const isJournalDoc = (value: unknown): value is JSONContent =>
  !!value &&
  typeof value === "object" &&
  "type" in value &&
  (value as { type?: unknown }).type === "doc";

const createJournalDocFromPlainText = (text: string): JSONContent => {
  const normalized = text.replace(/\r\n/g, "\n");
  if (!normalized.trim()) {
    return createEmptyJournalDoc();
  }

  return {
    type: "doc",
    content: normalized.split("\n").map((line) =>
      line.trim()
        ? ({ type: "paragraph", content: [{ type: "text", text: line }] } satisfies JSONContent)
        : ({ type: "paragraph" } satisfies JSONContent)
    )
  };
};

const getReviewNotesContent = (review: TradeReviewRecord | null | undefined): JSONContent => {
  if (!review) {
    return createEmptyJournalDoc();
  }

  if (isJournalDoc(review.notes)) {
    return review.notes;
  }

  if (typeof review.notes === "string") {
    return createJournalDocFromPlainText(review.notes);
  }

  return createEmptyJournalDoc();
};

export const TradesPage = ({
  databaseTrades,
  externalTradeDateFilterStart = "",
  externalTradeDateFilterEnd = "",
  externalPlaybookFilter = "all",
  externalSymbolFilter = "all",
  externalStatusFilter = "all",
  externalGameFilter = "all",
  externalExecutionFilter = "all",
  onFiltersChange,
  externalSelectedTradeId = "",
  externalSelectedTradeRequestId = 0,
  reviews,
  historicalBarSets,
  historicalBarSetsLoaded,
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
  onCreateTradeTagOption,
  onRenameTradeTagOption,
  onDeleteTradeTagOption,
  onClearExternalSelectedTrade
}: TradesPageProps) => {
  const [selectedTradeId, setSelectedTradeId] = useState<string>("");
  const [selectedTradeDateFilterStart, setSelectedTradeDateFilterStart] = useState(externalTradeDateFilterStart);
  const [selectedTradeDateFilterEnd, setSelectedTradeDateFilterEnd] = useState(externalTradeDateFilterEnd);
  const [selectedPlaybookFilter, setSelectedPlaybookFilter] = useState(externalPlaybookFilter);
  const [selectedSymbolFilter, setSelectedSymbolFilter] = useState(externalSymbolFilter);
  const [selectedStatusFilter, setSelectedStatusFilter] = useState(externalStatusFilter);
  const [selectedGameFilter, setSelectedGameFilter] = useState(externalGameFilter);
  const [selectedExecutionFilter, setSelectedExecutionFilter] = useState(externalExecutionFilter);
  const [chartLayerVisibility, setChartLayerVisibility] = useState<TradeChartLayerVisibility>(defaultChartLayerVisibility);
  const [showAllTickerDayTrades, setShowAllTickerDayTrades] = useState(false);
  const [quickTagEditorField, setQuickTagEditorField] = useState<EditableTradeTagField | null>(null);
  const [quickTagEditorSearchQuery, setQuickTagEditorSearchQuery] = useState("");
  const [autoFetchingTradeKey, setAutoFetchingTradeKey] = useState<string | null>(null);
  const barsInputRef = useRef<HTMLInputElement | null>(null);
  const autoFetchAttemptedKeysRef = useRef<Set<string>>(new Set());
  const quickTagLabels: Partial<Record<EditableTradeTagField, string>> = useMemo(
    () => ({
      game: "Game",
      playbook: "Setup",
      mistake: "Mistakes",
      outTag: "Out Tags"
    }),
    []
  );
  const createTradeReviewImageInsertHandler = (tradeId: string) => async (file: File) =>
    saveWorkspaceInlineImage({
      category: "trade-review-inline-images",
      recordId: tradeId,
      slotKey: "review-notes",
      file
    });

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

  const selectTradeAndReveal = (trade: EditableTradeRow) => {
    setSelectedTradeId(trade.id);
    setSelectedTradeDateFilterStart(trade.tradeDate);
    setSelectedTradeDateFilterEnd(trade.tradeDate);

    if (selectedPlaybookFilter !== "all" && !tradeHasPlaybook(trade, selectedPlaybookFilter)) {
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
    () => getTradePlaybookOptions(databaseTrades),
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

  const matchesReviewSliceFilters = useCallback(
    (trade: EditableTradeRow) => {
      if (selectedTradeDateFilterStart && trade.tradeDate < selectedTradeDateFilterStart) {
        return false;
      }

      if (selectedTradeDateFilterEnd && trade.tradeDate > selectedTradeDateFilterEnd) {
        return false;
      }

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

      if (selectedExecutionFilter !== "all" && !trade.execution.includes(selectedExecutionFilter)) {
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
      selectedTradeDateFilterStart
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

  const selectedTradeBarKey = useMemo(
    () => (selectedTrade ? buildTradeBarKey(selectedTrade) : ""),
    [selectedTrade]
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

  useEffect(() => {
    if (!selectedBarSet) {
      return;
    }

    autoFetchAttemptedKeysRef.current.add(selectedBarSet.key);
  }, [selectedBarSet]);

  useEffect(() => {
    if (
      !historicalBarSetsLoaded ||
      !selectedTrade ||
      !hasTwelveDataApiKey ||
      busy ||
      selectedBarSet ||
      autoFetchAttemptedKeysRef.current.has(selectedTradeBarKey)
    ) {
      return;
    }

    autoFetchAttemptedKeysRef.current.add(selectedTradeBarKey);
    let isCancelled = false;

    const autoFetchBars = async () => {
      setAutoFetchingTradeKey(selectedTradeBarKey);

      try {
        await onFetchHistoricalBars(selectedTrade);
      } finally {
        if (!isCancelled) {
          setAutoFetchingTradeKey((current) => (current === selectedTradeBarKey ? null : current));
        }
      }
    };

    void autoFetchBars();

    return () => {
      isCancelled = true;
    };
  }, [
    busy,
    hasTwelveDataApiKey,
    historicalBarSetsLoaded,
    onFetchHistoricalBars,
    selectedBarSet,
    selectedTrade,
    selectedTradeBarKey
  ]);
  const sameTickerDayTrades = useMemo(() => {
    if (!selectedTrade) {
      return [];
    }

    const matchingTrades = databaseTrades.filter(
      (trade) => trade.tradeDate === selectedTrade.tradeDate && trade.symbol === selectedTrade.symbol
    );

    if (!matchingTrades.some((trade) => trade.id === selectedTrade.id)) {
      matchingTrades.push(selectedTrade);
    }

    return matchingTrades.sort(
      (left, right) =>
        left.openTime.localeCompare(right.openTime) ||
        left.closeTime.localeCompare(right.closeTime) ||
        left.name.localeCompare(right.name)
    );
  }, [databaseTrades, selectedTrade]);
  const hasMultipleTickerDayTrades = sameTickerDayTrades.length > 1;
  const hasAttemptedAutoFetch =
    selectedTradeBarKey.length > 0 && autoFetchAttemptedKeysRef.current.has(selectedTradeBarKey);
  const isAutoFetchingBars = autoFetchingTradeKey === selectedTradeBarKey;
  const reviewChartBars = useMemo(() => {
    if (!selectedBarSet) {
      return [];
    }

    return reviewChartInterval === "1D" || reviewChartInterval === "1W"
      ? (selectedBarSet.dailyBars ?? selectedBarSet.bars)
      : selectedBarSet.bars;
  }, [reviewChartInterval, selectedBarSet]);
  const chartMarkerTrades = useMemo(() => {
    if (!selectedTrade) {
      return [];
    }

    return showAllTickerDayTrades ? sameTickerDayTrades : [selectedTrade];
  }, [sameTickerDayTrades, selectedTrade, showAllTickerDayTrades]);

  useEffect(() => {
    if (!hasMultipleTickerDayTrades && showAllTickerDayTrades) {
      setShowAllTickerDayTrades(false);
    }
  }, [hasMultipleTickerDayTrades, showAllTickerDayTrades]);

  const filteredSymbolCount = useMemo(
    () => new Set(filteredTrades.map((trade) => trade.symbol)).size,
    [filteredTrades]
  );

  const hasExplicitReviewSliceFilters =
    !!selectedTradeDateFilterStart ||
    !!selectedTradeDateFilterEnd ||
    selectedPlaybookFilter !== "all" ||
    selectedSymbolFilter !== "all" ||
    selectedStatusFilter !== "all" ||
    selectedGameFilter !== "all" ||
    selectedExecutionFilter !== "all";

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

  const relatedTrades = useMemo(() => {
    const fallbackTradeDate = !hasExplicitReviewSliceFilters ? selectedTrade?.tradeDate ?? "" : "";

    return databaseTrades
      .filter((trade) => {
        if (selectedTrade && trade.id === selectedTrade.id) {
          return false;
        }

        if (hasExplicitReviewSliceFilters) {
          return matchesReviewSliceFilters(trade);
        }

        return trade.tradeDate === fallbackTradeDate;
      })
      .sort(
        (left, right) =>
          right.tradeDate.localeCompare(left.tradeDate) ||
          left.openTime.localeCompare(right.openTime) ||
          left.closeTime.localeCompare(right.closeTime) ||
          left.name.localeCompare(right.name)
      );
  }, [databaseTrades, hasExplicitReviewSliceFilters, matchesReviewSliceFilters, selectedTrade]);

  const relatedTradesDescription =
    hasExplicitReviewSliceFilters
      ? "Other trades in the current review slice."
      : selectedTrade
        ? `Other trades from ${selectedTrade.tradeDate}.`
        : "";
  const selectedTradeGatewaySummary = selectedTrade ? summarizeTaggedValues(selectedTrade.gateways) : "None";
  const selectedTradeMistakeDetails =
    selectedTrade && selectedTrade.mistakes.length > 0
      ? selectedTrade.mistakes.join(", ")
      : "No mistakes tagged";
  const selectedTradeFillCount = selectedTrade
    ? selectedTrade.openingExecutions.length + selectedTrade.closingExecutions.length
    : 0;

  return (
    <main className="page-shell">
      <PageHero
        eyebrow="Trades"
        title="Trade Review"
        icon="trades"
        className="page-hero-trades"
      />
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
      <section className="trades-review-grid trades-review-grid-advanced">
        <article className="placeholder-panel chart-panel chart-panel-wide">
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
          <div className="chart-panel-header">
            <div className="panel-header">
              <WorkspaceIcon icon="review-workspace" alt="Review workspace icon" className="panel-header-icon" />
              <h2>Review Workspace</h2>
            </div>
          </div>
          {selectedTrade ? (
            <>
              <div className="trade-quick-tags" aria-label="Trade review overview">
                <div className="trade-quick-tag">
                  <span className="trade-quick-tag-label">Symbol</span>
                  <strong className="trade-quick-tag-value">{selectedTrade.symbol}</strong>
                </div>
                <button
                  type="button"
                  className={`trade-quick-tag trade-quick-tag-button ${
                    selectedTrade.game ? "" : "trade-quick-tag-empty"
                  }`}
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
                  className={`trade-quick-tag trade-quick-tag-button ${
                    selectedTrade.setups[0] ? "" : "trade-quick-tag-empty"
                  }`}
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
                  className={`trade-quick-tag trade-quick-tag-button ${
                    selectedTrade.mistakes.length > 0 ? "" : "trade-quick-tag-empty"
                  }`}
                  onClick={() => {
                    setQuickTagEditorField("mistake");
                    setQuickTagEditorSearchQuery(selectedTrade.mistakes.length === 1 ? selectedTrade.mistakes[0] ?? "" : "");
                  }}
                >
                  <span className="trade-quick-tag-label">Mistakes</span>
                  <strong className="trade-quick-tag-value">{selectedTradeMistakeDetails}</strong>
                </button>
                <div
                  className={`trade-quick-tag ${
                    selectedTrade.gateways.length > 0 ? "" : "trade-quick-tag-empty"
                  }`}
                >
                  <span className="trade-quick-tag-label">Gateways</span>
                  <strong className="trade-quick-tag-value">{selectedTradeGatewaySummary}</strong>
                </div>
                <div
                  className={`trade-quick-tag trade-quick-tag-status ${
                    selectedTrade.netPnlUsd >= 0 ? "trade-quick-tag-status-win" : "trade-quick-tag-status-loss"
                  }`}
                >
                  <span className="trade-quick-tag-label">Win / Loss</span>
                  <strong className="trade-quick-tag-value">{selectedTrade.status}</strong>
                </div>
                <button
                  type="button"
                  className={`trade-quick-tag trade-quick-tag-button ${
                    selectedTrade.outTag[0] ? "" : "trade-quick-tag-empty"
                  }`}
                  onClick={() => {
                    setQuickTagEditorField("outTag");
                    setQuickTagEditorSearchQuery("");
                  }}
                >
                  <span className="trade-quick-tag-label">Out Tags</span>
                  <strong className="trade-quick-tag-value">{selectedTrade.outTag[0] || "None"}</strong>
                </button>
                <div
                  className={`trade-quick-tag ${selectedTrade.feesUsd ? "" : "trade-quick-tag-empty"}`}
                >
                  <span className="trade-quick-tag-label">Fees</span>
                  <strong className="trade-quick-tag-value">${selectedTrade.feesUsd.toFixed(2)}</strong>
                </div>
              </div>
              <div className="trade-mini-stats" aria-label="Trade execution stats">
                <div className="trade-mini-stat-card">
                  <span className="trade-mini-stat-label">Date &amp; Time Range</span>
                  <strong className="trade-mini-stat-value">{selectedTrade.tradeDate}</strong>
                  <small className="trade-mini-stat-meta">
                    {selectedTrade.openTime} to {selectedTrade.closeTime}
                  </small>
                </div>
                <div className="trade-mini-stat-card">
                  <span className="trade-mini-stat-label">Hold Time</span>
                  <strong className="trade-mini-stat-value">{selectedTrade.holdTime}</strong>
                  <small className="trade-mini-stat-meta">
                    {selectedTradeFillCount} fill{selectedTradeFillCount === 1 ? "" : "s"}
                  </small>
                </div>
                <div className="trade-mini-stat-card">
                  <span className="trade-mini-stat-label">Short / Long</span>
                  <strong className="trade-mini-stat-value">{selectedTrade.side}</strong>
                </div>
                <div className="trade-mini-stat-card">
                  <span className="trade-mini-stat-label">Size</span>
                  <strong className="trade-mini-stat-value">{selectedTrade.size.toLocaleString()}</strong>
                </div>
                <div className="trade-mini-stat-card">
                  <span className="trade-mini-stat-label">Average Entry Price</span>
                  <strong className="trade-mini-stat-value">{selectedTrade.entryPrice.toFixed(4)}</strong>
                </div>
                <div className="trade-mini-stat-card">
                  <span className="trade-mini-stat-label">Average Exit Price</span>
                  <strong className="trade-mini-stat-value">{selectedTrade.exitPrice.toFixed(4)}</strong>
                </div>
                <div className="trade-mini-stat-card">
                  <span className="trade-mini-stat-label">Return / Share</span>
                  <strong className="trade-mini-stat-value">{formatSignedDecimal(selectedTrade.returnPerShare)}</strong>
                </div>
                <div className="trade-mini-stat-card">
                  <span className="trade-mini-stat-label">Total Return</span>
                  <strong className="trade-mini-stat-value">{formatSignedMoney(selectedTrade.netPnlUsd)}</strong>
                </div>
              </div>
              <div className="trade-chart-meta-strip" aria-label="Chart data">
                {selectedBarSet ? (
                  <>
                    <span className="chart-meta-badge">{selectedBarSet.bars.length} bars</span>
                    <span className="chart-meta-badge">{selectedBarSet.sourceFileName}</span>
                    <span className="chart-meta-badge">
                      Updated {new Date(selectedBarSet.updatedAt).toLocaleString()}
                    </span>
                    <button
                      type="button"
                      className="chart-quick-chip"
                      disabled={busy}
                      onClick={() => selectedTrade && onClearHistoricalBars(selectedTrade)}
                    >
                      Clear Bars
                    </button>
                  </>
                ) : (
                  <>
                    <span className="chart-meta-badge">No bars loaded</span>
                    <span className="chart-meta-badge">{selectedTrade.symbol}</span>
                    <span className="chart-meta-badge">{selectedTrade.tradeDate}</span>
                  </>
                )}
                {hasMultipleTickerDayTrades ? (
                  <button
                    type="button"
                    className={`chart-quick-chip${showAllTickerDayTrades ? " is-active" : ""}`}
                    onClick={() => setShowAllTickerDayTrades((current) => !current)}
                    aria-pressed={showAllTickerDayTrades}
                    title={`Show all ${sameTickerDayTrades.length} ${selectedTrade.symbol} trades from ${selectedTrade.tradeDate}`}
                  >
                    Day Trades ({sameTickerDayTrades.length})
                  </button>
                ) : null}
              </div>
              <div className="trade-chart-grid trade-chart-grid-single">
                <div className="trade-chart-pane trade-chart-pane-main">
                  <TradeChart
                    bars={reviewChartBars}
                    trade={selectedTrade}
                    markerTrades={chartMarkerTrades}
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
                    availableIntervals={secondaryChartIntervals}
                    onChangeInterval={onChangeReviewChartInterval}
                  />
                </div>
                {selectedTrade && selectedBarSet && false ? (
                  <div className="trade-chart-pane trade-chart-pane-secondary day-view-chart-card">
                    <div className="trade-chart-pane-header">
                      <div>
                        <span className="trade-chart-pane-eyebrow">Context</span>
                        <strong>Day View</strong>
                      </div>
                      <span>{selectedTrade!.symbol} · {dayChartInterval}</span>
                    </div>
                    <TradeChart
                      bars={
                        dayChartInterval === "1D" || dayChartInterval === "1W"
                          ? (selectedBarSet!.dailyBars ?? selectedBarSet!.bars)
                          : selectedBarSet!.bars
                      }
                      trade={selectedTrade!}
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
                      ? isAutoFetchingBars
                        ? `Fetching 1-minute bars for ${selectedTrade.symbol} on ${selectedTrade.tradeDate} automatically.`
                        : hasAttemptedAutoFetch
                          ? `Bars auto-fetch when you select a trade. If this one still needs data, retry the fetch or import a bar CSV manually.`
                          : `Bars will auto-fetch as soon as this trade is ready. You can also import a bar CSV manually.`
                      : `Add your Twelve Data API key in Settings to auto-fetch bars for ${selectedTrade.symbol} on ${selectedTrade.tradeDate}, or import a bar CSV manually.`}
                  </span>
                  <div className="empty-chart-state-actions">
                    <button
                      type="button"
                      className="mini-action"
                      disabled={busy}
                      onClick={() => barsInputRef.current?.click()}
                    >
                      <WorkspaceIcon icon="import" alt="Import bars icon" className="mini-action-icon" />
                      Import Bars
                    </button>
                    {hasTwelveDataApiKey && !isAutoFetchingBars && hasAttemptedAutoFetch ? (
                      <button
                        type="button"
                        className="mini-action"
                        disabled={busy}
                        onClick={() => selectedTrade && void onFetchHistoricalBars(selectedTrade)}
                      >
                        <WorkspaceIcon icon="reports" alt="Retry fetch icon" className="mini-action-icon" />
                        Retry Fetch
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}
              <details className="trade-execution-details">
                <summary>
                  <div className="trade-execution-details-copy">
                    <strong>Execution Blotter</strong>
                    <span>Open the full fill-by-fill trail only when you need the audit detail.</span>
                  </div>
                  <span className="trade-execution-details-meta">{selectedTradeFillCount} fills</span>
                </summary>
                <TradeExecutionsTable trade={selectedTrade} />
              </details>
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
        <article className="placeholder-panel trade-review-dock trade-review-bottom">
          <div className="panel-header">
            <WorkspaceIcon icon="journal" alt="Trade review icon" className="panel-header-icon" />
            <h2>Review Notes</h2>
          </div>
          {selectedTrade ? (
            <div className="trade-review-form">
              <label className="review-field">
                <span>Review Notes</span>
                <JournalRichTextEditor
                  key={`${selectedTrade.id}-trade-review-notes`}
                  content={getReviewNotesContent(selectedReview)}
                  onChange={(content) => onUpdateReview(selectedTrade.id, { notes: content })}
                  onImageInsert={createTradeReviewImageInsertHandler(selectedTrade.id)}
                  placeholder="Capture execution notes, emotions, and what to improve next time."
                  compact
                  showBlockActions={false}
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
        <article className="placeholder-panel related-trades-panel">
          <div className="panel-header">
            <WorkspaceIcon icon="related-trades" alt="Related trades icon" className="panel-header-icon" />
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
            onRenameTradeTagOption={onRenameTradeTagOption}
            onDeleteTradeTagOption={onDeleteTradeTagOption}
            emptyStateLabel={
              selectedTrade
                ? "No other trades match this relationship in the current slice."
                : "Select a trade to compare related setups."
            }
          />
        </article>
      </section>
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
          onRenameOption={(currentValue, nextValue) => {
            onRenameTradeTagOption(quickTagEditorField, currentValue, nextValue);
          }}
          onDeleteOption={(value) => {
            onDeleteTradeTagOption(quickTagEditorField, value);
          }}
          canManageOption={(value) =>
            !defaultTradeTagOptionsByField[quickTagEditorField].some(
              (option) => option.toLowerCase() === value.toLowerCase()
            )
          }
          onClose={() => {
            setQuickTagEditorField(null);
            setQuickTagEditorSearchQuery("");
          }}
        />
      ) : null}
    </main>
  );
};
