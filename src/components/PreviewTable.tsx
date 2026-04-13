import { useMemo, useState } from "react";
import { getTickerIcon, getTickerSector } from "../lib/tickers/tickerIcons";
import { tradeTagFieldLabels } from "../lib/trades/tradeTagCatalog";
import type { EditableTradeRow, EditableTradeTagField } from "../types/tradeTags";
import { TagDrawer } from "./TagDrawer";

interface PreviewTableProps {
  trades: EditableTradeRow[];
  tagOptionsByField: Record<EditableTradeTagField, string[]>;
  selectedTradeId?: string;
  selectedTradeIds: string[];
  onSelectTrade?: (trade: EditableTradeRow) => void;
  onToggleTradeSelection: (tradeId: string) => void;
  onToggleSelectAll: (tradeIds: string[]) => void;
  onUpdateTradeTag: (trade: EditableTradeRow, field: EditableTradeTagField, value: string | null) => void;
  onCreateTradeTagOption: (field: EditableTradeTagField, value: string) => void;
}

type CellEditorState = {
  tradeId: string;
  field: EditableTradeTagField;
};

type PreviewSortKey =
  | "name"
  | "tradeDate"
  | "symbol"
  | "side"
  | "openTime"
  | "closeTime"
  | "holdTime"
  | "size"
  | "entryPrice"
  | "exitPrice"
  | "netPnlUsd"
  | "returnPerShare"
  | EditableTradeTagField;

type PreviewSortConfig = {
  key: PreviewSortKey;
  direction: "asc" | "desc";
};

type PreviewColumn = {
  key: PreviewSortKey;
  label: string;
  getSortValue: (trade: EditableTradeRow) => string | number | null | undefined;
};

const parseHoldTimeSeconds = (value: string): number => {
  const hours = Number(value.match(/(\d+)\s*h/)?.[1] ?? 0);
  const minutes = Number(value.match(/(\d+)\s*m/)?.[1] ?? 0);
  const seconds = Number(value.match(/(\d+)\s*s/)?.[1] ?? 0);

  return hours * 3600 + minutes * 60 + seconds;
};

const previewColumns: PreviewColumn[] = [
  { key: "name", label: "Name", getSortValue: (trade) => trade.name },
  { key: "tradeDate", label: "Trade Date", getSortValue: (trade) => trade.tradeDate },
  { key: "symbol", label: "Symbol", getSortValue: (trade) => trade.symbol },
  { key: "side", label: "Side", getSortValue: (trade) => trade.side },
  { key: "openTime", label: "Open Time", getSortValue: (trade) => trade.openTime },
  { key: "closeTime", label: "Close Time", getSortValue: (trade) => trade.closeTime },
  { key: "holdTime", label: "Hold Time", getSortValue: (trade) => parseHoldTimeSeconds(trade.holdTime) },
  { key: "size", label: "Size", getSortValue: (trade) => trade.size },
  { key: "entryPrice", label: "Entry Price", getSortValue: (trade) => trade.entryPrice },
  { key: "exitPrice", label: "Exit Price", getSortValue: (trade) => trade.exitPrice },
  { key: "netPnlUsd", label: "Net PnL USD", getSortValue: (trade) => trade.netPnlUsd },
  { key: "returnPerShare", label: "Return / Share", getSortValue: (trade) => trade.returnPerShare },
  { key: "status", label: "Status", getSortValue: (trade) => getFieldDisplayValue(trade, "status") },
  { key: "mistake", label: "Mistakes", getSortValue: (trade) => getFieldDisplayValue(trade, "mistake") },
  { key: "playbook", label: "Playbook", getSortValue: (trade) => getFieldDisplayValue(trade, "playbook") },
  { key: "game", label: "Game", getSortValue: (trade) => getFieldDisplayValue(trade, "game") },
  { key: "outTag", label: "Out Tag", getSortValue: (trade) => getFieldDisplayValue(trade, "outTag") },
  { key: "execution", label: "Execution", getSortValue: (trade) => getFieldDisplayValue(trade, "execution") }
];

const tagColumnKeys: EditableTradeTagField[] = ["status", "mistake", "playbook", "game", "outTag", "execution"];

const isTagColumnKey = (key: PreviewSortKey): key is EditableTradeTagField =>
  tagColumnKeys.includes(key as EditableTradeTagField);

const getFieldDisplayValue = (trade: EditableTradeRow, field: EditableTradeTagField): string => {
  switch (field) {
    case "status":
      return trade.status;
    case "mistake":
      return trade.mistakes[0] ?? "";
    case "playbook":
      return trade.setups[0] ?? "";
    case "game":
      return trade.game;
    case "outTag":
      return trade.outTag[0] ?? "";
    case "execution":
      return trade.execution[0] ?? "";
    default:
      return "";
  }
};

const getTagToneClass = (field: EditableTradeTagField, value: string): string => {
  switch (field) {
    case "status":
      if (value === "Win") {
        return "tag-pill-status-win";
      }

      if (value === "Loss") {
        return "tag-pill-status-loss";
      }

      return "tag-pill-status";
    case "mistake":
      return "tag-pill-mistake";
    case "playbook":
      return "tag-pill-playbook";
    case "game":
      return "tag-pill-game";
    case "outTag":
      return "tag-pill-out-tag";
    case "execution":
      return "tag-pill-execution";
    default:
      return "";
  }
};

const renderEditableCell = (
  trade: EditableTradeRow,
  field: EditableTradeTagField,
  onOpenEditor: (tradeId: string, field: EditableTradeTagField) => void
) => {
  const value = getFieldDisplayValue(trade, field);
  const isManual = trade.manualTags[field];

  return (
    <button
      type="button"
      className={`tag-pill-button ${value ? getTagToneClass(field, value) : "tag-pill-empty"} ${
        isManual ? "tag-pill-manual" : ""
      }`}
      onClick={(event) => {
        event.stopPropagation();
        onOpenEditor(trade.id, field);
      }}
    >
      {value || `Add ${tradeTagFieldLabels[field]}`}
    </button>
  );
};

export const PreviewTable = ({
  trades,
  tagOptionsByField,
  selectedTradeId,
  selectedTradeIds,
  onSelectTrade,
  onToggleTradeSelection,
  onToggleSelectAll,
  onUpdateTradeTag,
  onCreateTradeTagOption
}: PreviewTableProps) => {
  const [cellEditor, setCellEditor] = useState<CellEditorState | null>(null);
  const [cellEditorSearchQuery, setCellEditorSearchQuery] = useState("");
  const [sortConfig, setSortConfig] = useState<PreviewSortConfig>({ key: "tradeDate", direction: "desc" });
  const isTagFieldEnabled = (field: EditableTradeTagField) => tagOptionsByField[field].length > 0;
  const visibleColumns = useMemo(
    () => previewColumns.filter((column) => !isTagColumnKey(column.key) || isTagFieldEnabled(column.key)),
    [tagOptionsByField]
  );

  const selectedCount = selectedTradeIds.length;
  const sortedTrades = useMemo(() => {
    const activeColumn = previewColumns.find((column) => column.key === sortConfig.key);

    if (!activeColumn) {
      return trades;
    }

    return [...trades].sort((left, right) => {
      const leftValue = activeColumn.getSortValue(left);
      const rightValue = activeColumn.getSortValue(right);

      if (leftValue == null && rightValue == null) {
        return 0;
      }

      if (leftValue == null) {
        return sortConfig.direction === "asc" ? 1 : -1;
      }

      if (rightValue == null) {
        return sortConfig.direction === "asc" ? -1 : 1;
      }

      const comparison =
        typeof leftValue === "number" && typeof rightValue === "number"
          ? leftValue - rightValue
          : String(leftValue).localeCompare(String(rightValue), undefined, {
              numeric: true,
              sensitivity: "base"
            });

      return sortConfig.direction === "asc" ? comparison : -comparison;
    });
  }, [trades, sortConfig]);

  const selectableTradeIds = useMemo(() => sortedTrades.map((trade) => trade.id), [sortedTrades]);
  const allVisibleSelected =
    selectableTradeIds.length > 0 &&
    selectableTradeIds.every((tradeId) => selectedTradeIds.includes(tradeId));

  const activeTrade = cellEditor
    ? trades.find((trade) => trade.id === cellEditor.tradeId) ?? null
    : null;

  const toggleSort = (key: PreviewSortKey) => {
    setSortConfig((current) => {
      if (current.key === key) {
        return { key, direction: current.direction === "asc" ? "desc" : "asc" };
      }

      return { key, direction: "asc" };
    });
  };

  const renderCell = (trade: EditableTradeRow, column: PreviewColumn) => {
    if (isTagColumnKey(column.key)) {
      return renderEditableCell(trade, column.key, (tradeId, field) => {
        setCellEditor({ tradeId, field });
        setCellEditorSearchQuery("");
      });
    }

    switch (column.key) {
      case "name":
        return trade.name;
      case "tradeDate":
        return trade.tradeDate;
      case "symbol": {
        const tickerIcon = getTickerIcon(trade.symbol);
        const tickerSector = getTickerSector(trade.symbol);

        return (
          <div className="symbol-cell">
            {tickerIcon ? (
              <img
                className={`ticker-icon ticker-icon-${trade.symbol.toLowerCase()}`}
                src={tickerIcon}
                alt={tickerSector ? `${tickerSector} sector icon` : `${trade.symbol} icon`}
              />
            ) : null}
            <span>{trade.symbol}</span>
          </div>
        );
      }
      case "side":
        return trade.side;
      case "openTime":
        return trade.openTime;
      case "closeTime":
        return trade.closeTime;
      case "holdTime":
        return trade.holdTime;
      case "size":
        return trade.size;
      case "entryPrice":
        return trade.entryPrice.toFixed(4);
      case "exitPrice":
        return trade.exitPrice.toFixed(4);
      case "netPnlUsd":
        return trade.netPnlUsd.toFixed(4);
      case "returnPerShare":
        return trade.returnPerShare.toFixed(4);
      default:
        return "";
    }
  };

  return (
    <div className="table-shell">
      <table className="preview-table">
        <thead>
          <tr>
            <th className="selection-column">
              <input
                type="checkbox"
                checked={allVisibleSelected}
                aria-label="Select all visible trades"
                onChange={() => onToggleSelectAll(selectableTradeIds)}
              />
            </th>
            {visibleColumns.map((column) => (
              <th key={column.key}>
                <button type="button" className="sortable-header-button" onClick={() => toggleSort(column.key)}>
                  <span>{column.label}</span>
                  <span className={`sort-indicator ${sortConfig.key === column.key ? "sort-indicator-active" : ""}`}>
                    {sortConfig.key === column.key ? sortConfig.direction : "sort"}
                  </span>
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {trades.length === 0 ? (
            <tr>
              <td colSpan={visibleColumns.length + 1} className="empty-state">
                No trades match the current filters.
              </td>
            </tr>
          ) : (
            sortedTrades.map((trade) => {
              return (
              <tr
                key={trade.id}
                className={trade.id === selectedTradeId ? "preview-row-selected" : ""}
                onClick={onSelectTrade ? () => onSelectTrade(trade) : undefined}
              >
                <td className="selection-column">
                  <input
                    type="checkbox"
                    checked={selectedTradeIds.includes(trade.id)}
                    aria-label={`Select ${trade.name}`}
                    onClick={(event) => event.stopPropagation()}
                    onChange={() => onToggleTradeSelection(trade.id)}
                  />
                </td>
                {visibleColumns.map((column) => (
                  <td key={column.key}>{renderCell(trade, column)}</td>
                ))}
              </tr>
              );
            })
          )}
        </tbody>
      </table>
      {cellEditor && activeTrade ? (
        <TagDrawer
          isOpen={!!cellEditor}
          title={`${tradeTagFieldLabels[cellEditor.field]} · ${activeTrade.name}`}
          options={tagOptionsByField[cellEditor.field]}
          currentValue={getFieldDisplayValue(activeTrade, cellEditor.field)}
          allowClear
          clearLabel={
            cellEditor.field === "mistake"
              ? "No mistakes"
              : `Clear ${tradeTagFieldLabels[cellEditor.field]}`
          }
          searchValue={cellEditorSearchQuery}
          onSearchChange={setCellEditorSearchQuery}
          onSelect={(value) => {
            onUpdateTradeTag(activeTrade, cellEditor.field, value);
            setCellEditor(null);
            setCellEditorSearchQuery("");
          }}
          onCreateOption={(value) => {
            onCreateTradeTagOption(cellEditor.field, value);
            onUpdateTradeTag(activeTrade, cellEditor.field, value);
            setCellEditor(null);
            setCellEditorSearchQuery("");
          }}
          onClose={() => {
            setCellEditor(null);
            setCellEditorSearchQuery("");
          }}
        />
      ) : null}
      {selectedCount > 0 ? (
        <div className="table-selection-footer">
          <span>{selectedCount} trade{selectedCount === 1 ? "" : "s"} selected</span>
        </div>
      ) : null}
    </div>
  );
};
