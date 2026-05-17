import { useEffect, useMemo, useState } from "react";
import { DateFilterPopover } from "../../../components/DateFilterPopover";
import { FilterSelect } from "../../../components/FilterSelect";
import { PreviewTable } from "../../../components/PreviewTable";
import { TagDrawer } from "../../../components/TagDrawer";
import { WorkspaceIcon } from "../../../components/WorkspaceIcon";
import {
  tradeTagFieldLabels,
  tradeTagFields,
  tradeTagOptionsByField as defaultTradeTagOptionsByField
} from "../../../lib/trades/tradeTagCatalog";
import { getTradePlaybookOptions, getTradePlaybooks, tradeHasPlaybook } from "../../../lib/trades/playbookFilters";
import type { EditableTradeRow, EditableTradeTagField } from "../../../types/tradeTags";

interface TradeDatabasePageProps {
  trades: EditableTradeRow[];
  tagOptionsByField: Record<EditableTradeTagField, string[]>;
  onSelectTrade: (tradeId: string, tradeDate: string) => void;
  onUpdateTradeTag: (trade: EditableTradeRow, field: EditableTradeTagField, value: string | string[] | null) => void;
  onBulkUpdateTradeTags: (tradeIds: string[], field: EditableTradeTagField, value: string | string[] | null) => void;
  onCreateTradeTagOption: (field: EditableTradeTagField, value: string) => void;
  onRenameTradeTagOption: (field: EditableTradeTagField, currentValue: string, nextValue: string) => void;
  onDeleteTradeTagOption: (field: EditableTradeTagField, value: string) => void;
}

const getTodayTradeDateKey = (): string => {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const getSearchableTradeText = (trade: EditableTradeRow): string =>
  [
    trade.name,
    trade.tradeDate,
    trade.symbol,
    trade.side,
    trade.status,
    trade.game,
    trade.openTime,
    trade.closeTime,
    trade.holdTime,
    ...trade.setups,
    ...trade.mistakes,
    ...trade.catalyst,
    ...trade.outTag,
    ...trade.gateways,
    ...trade.execution
  ]
    .join(" ")
    .toLowerCase();

export const TradeDatabasePage = ({
  trades,
  tagOptionsByField,
  onSelectTrade,
  onUpdateTradeTag,
  onBulkUpdateTradeTags,
  onCreateTradeTagOption,
  onRenameTradeTagOption,
  onDeleteTradeTagOption
}: TradeDatabasePageProps) => {
  const todayTradeDate = useMemo(() => getTodayTradeDateKey(), []);
  const [selectedTradeDateFilter, setSelectedTradeDateFilter] = useState(todayTradeDate);
  const [selectedPlaybookFilter, setSelectedPlaybookFilter] = useState("all");
  const [selectedSymbolFilter, setSelectedSymbolFilter] = useState("all");
  const [selectedStatusFilter, setSelectedStatusFilter] = useState("all");
  const [selectedGameFilter, setSelectedGameFilter] = useState("all");
  const [selectedExecutionFilter, setSelectedExecutionFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTradeIds, setSelectedTradeIds] = useState<string[]>([]);
  const [showUntaggedPlaybookOnly, setShowUntaggedPlaybookOnly] = useState(false);
  const [showUntaggedMistakesOnly, setShowUntaggedMistakesOnly] = useState(false);
  const [bulkField, setBulkField] = useState<EditableTradeTagField>("playbook");
  const [isBulkEditorOpen, setIsBulkEditorOpen] = useState(false);
  const [bulkEditorSearchQuery, setBulkEditorSearchQuery] = useState("");

  const activeTagFields = useMemo(
    () => tradeTagFields.filter((field) => tagOptionsByField[field].length > 0),
    [tagOptionsByField]
  );
  const isPlaybookTagEnabled = tagOptionsByField.playbook.length > 0;
  const isMistakeTagEnabled = tagOptionsByField.mistake.length > 0;

  useEffect(() => {
    if (activeTagFields.length > 0 && !activeTagFields.includes(bulkField)) {
      setBulkField(activeTagFields[0]);
    }
  }, [activeTagFields, bulkField]);

  useEffect(() => {
    setSelectedTradeIds((current) => current.filter((tradeId) => trades.some((trade) => trade.id === tradeId)));
  }, [trades]);

  const tradeDateOptions = useMemo(
    () => Array.from(new Set(trades.map((trade) => trade.tradeDate))).sort((left, right) => right.localeCompare(left)),
    [trades]
  );

  const playbookOptions = useMemo(() => getTradePlaybookOptions(trades), [trades]);

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

  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const filteredTrades = useMemo(() => {
    return [...trades]
      .filter((trade) => {
        if (selectedTradeDateFilter !== "all" && trade.tradeDate !== selectedTradeDateFilter) {
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

        if (showUntaggedPlaybookOnly && getTradePlaybooks(trade).length > 0) {
          return false;
        }

        if (showUntaggedMistakesOnly && trade.mistakes[0]) {
          return false;
        }

        if (normalizedSearchQuery && !getSearchableTradeText(trade).includes(normalizedSearchQuery)) {
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
    normalizedSearchQuery,
    selectedExecutionFilter,
    selectedGameFilter,
    selectedPlaybookFilter,
    selectedStatusFilter,
    selectedSymbolFilter,
    selectedTradeDateFilter,
    showUntaggedMistakesOnly,
    showUntaggedPlaybookOnly,
    trades
  ]);

  const filteredSymbolCount = useMemo(
    () => new Set(filteredTrades.map((trade) => trade.symbol)).size,
    [filteredTrades]
  );
  const filteredNetPnl = useMemo(
    () => filteredTrades.reduce((sum, trade) => sum + trade.netPnlUsd, 0),
    [filteredTrades]
  );

  const hasNonDateFilters =
    normalizedSearchQuery.length > 0 ||
    selectedPlaybookFilter !== "all" ||
    selectedSymbolFilter !== "all" ||
    selectedStatusFilter !== "all" ||
    selectedGameFilter !== "all" ||
    selectedExecutionFilter !== "all" ||
    showUntaggedPlaybookOnly ||
    showUntaggedMistakesOnly;

  const activeFilters = [
    {
      key: "date",
      label: "Date",
      value: selectedTradeDateFilter === "all" ? "All dates" : selectedTradeDateFilter
    },
    normalizedSearchQuery
      ? { key: "search", label: "Search", value: searchQuery.trim() }
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
    setSelectedTradeDateFilter(todayTradeDate);
    setSelectedPlaybookFilter("all");
    setSelectedSymbolFilter("all");
    setSelectedStatusFilter("all");
    setSelectedGameFilter("all");
    setSelectedExecutionFilter("all");
    setSearchQuery("");
    setShowUntaggedPlaybookOnly(false);
    setShowUntaggedMistakesOnly(false);
    setSelectedTradeIds([]);
  };

  const emptyStateLabel =
    selectedTradeDateFilter === todayTradeDate && !hasNonDateFilters
      ? "No trades saved for today's date yet."
      : "No trades match the current database filters.";

  return (
    <main className="page-shell trade-database-page">
      <section className="placeholder-panel analytics-panel trade-database-panel trade-database-page-panel">
        <div className="trade-database-toolbar">
          <section className="trade-view-filter-panel trade-database-search-panel">
            <div className="trade-view-filter-header">
              <div className="panel-header">
                <WorkspaceIcon icon="astronaut" alt="Trade database icon" className="panel-header-icon" />
                <h2>Trade Database</h2>
              </div>
              <button type="button" className="mini-action" onClick={clearFilters}>
                Clear All
              </button>
            </div>
            <div className="trade-database-summary-grid">
              <div className="page-hero-stat-card">
                <span>Date</span>
                <strong>{selectedTradeDateFilter === "all" ? "All dates" : selectedTradeDateFilter}</strong>
              </div>
              <div className="page-hero-stat-card">
                <span>Trades</span>
                <strong>{filteredTrades.length}</strong>
              </div>
              <div className="page-hero-stat-card">
                <span>Symbols</span>
                <strong>{filteredSymbolCount}</strong>
              </div>
              <div className={`page-hero-stat-card ${filteredNetPnl >= 0 ? "report-hero-stat-card-positive" : "report-hero-stat-card-negative"}`}>
                <span>Net PnL</span>
                <strong>{`${filteredNetPnl >= 0 ? "+" : "-"}$${Math.abs(filteredNetPnl).toFixed(2)}`}</strong>
              </div>
            </div>
            <div className="trade-view-filter-grid trade-database-filter-grid">
              <label className="trade-filter-field">
                <span>Date</span>
                <DateFilterPopover
                  value={selectedTradeDateFilter}
                  onChange={setSelectedTradeDateFilter}
                  availableDates={tradeDateOptions}
                  allValue="all"
                  allLabel="All Dates"
                />
              </label>
              <label className="trade-filter-field trade-database-search-field">
                <span>Search</span>
                <input
                  type="search"
                  className="trade-search-input"
                  value={searchQuery}
                  placeholder="Name, symbol, tag..."
                  aria-label="Search trade database"
                  onChange={(event) => setSearchQuery(event.target.value)}
                />
              </label>
              <label className="trade-filter-field">
                <span>Playbook</span>
                <FilterSelect
                  ariaLabel="Trade database playbook filter"
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
                  ariaLabel="Trade database symbol filter"
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
                  ariaLabel="Trade database status filter"
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
                  ariaLabel="Trade database game filter"
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
                  ariaLabel="Trade database execution filter"
                  value={selectedExecutionFilter}
                  onChange={setSelectedExecutionFilter}
                  options={[
                    { label: "All Execution", value: "all" },
                    ...executionOptions.map((execution) => ({ label: execution, value: execution }))
                  ]}
                />
              </label>
            </div>
            <div className="active-filter-chip-row dashboard-review-chip-row" aria-label="Active trade database filters">
              {activeFilters.map((filter) => (
                <span key={filter.key} className="active-filter-chip">
                  <strong>{filter.label}</strong>
                  <span>{filter.value}</span>
                </span>
              ))}
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
          </section>
        </div>
        <PreviewTable
          trades={filteredTrades}
          tagOptionsByField={tagOptionsByField}
          selectedTradeIds={selectedTradeIds}
          onSelectTrade={(trade) => onSelectTrade(trade.id, trade.tradeDate)}
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
          onRenameTradeTagOption={onRenameTradeTagOption}
          onDeleteTradeTagOption={onDeleteTradeTagOption}
          emptyStateLabel={emptyStateLabel}
          pinLeadingColumns
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
          onRenameOption={(currentValue, nextValue) => {
            onRenameTradeTagOption(bulkField, currentValue, nextValue);
          }}
          onDeleteOption={(value) => {
            onDeleteTradeTagOption(bulkField, value);
          }}
          canManageOption={(value) =>
            !defaultTradeTagOptionsByField[bulkField].some(
              (option) => option.toLowerCase() === value.toLowerCase()
            )
          }
          onClose={() => {
            setIsBulkEditorOpen(false);
            setBulkEditorSearchQuery("");
          }}
        />
      ) : null}
    </main>
  );
};
