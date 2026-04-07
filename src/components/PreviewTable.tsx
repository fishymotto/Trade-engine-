import { useMemo, useState } from "react";
import { tickerIcons } from "../lib/tickers/tickerIcons";
import { tradeTagFieldLabels } from "../lib/trades/tradeTagCatalog";
import type { EditableTradeRow, EditableTradeTagField } from "../types/tradeTags";
import { SearchableTagPopover } from "./SearchableTagPopover";

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
  anchorRect: DOMRect;
};

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
  onOpenEditor: (tradeId: string, field: EditableTradeTagField, rect: DOMRect) => void
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
        onOpenEditor(trade.id, field, event.currentTarget.getBoundingClientRect());
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

  const selectedCount = selectedTradeIds.length;
  const selectableTradeIds = useMemo(() => trades.map((trade) => trade.id), [trades]);
  const allVisibleSelected =
    selectableTradeIds.length > 0 &&
    selectableTradeIds.every((tradeId) => selectedTradeIds.includes(tradeId));

  const activeTrade = cellEditor
    ? trades.find((trade) => trade.id === cellEditor.tradeId) ?? null
    : null;

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
            <th>Name</th>
            <th>Trade Date</th>
            <th>Symbol</th>
            <th>Side</th>
            <th>Open Time</th>
            <th>Close Time</th>
            <th>Hold Time</th>
            <th>Size</th>
            <th>Entry Price</th>
            <th>Exit Price</th>
            <th>Net PnL USD</th>
            <th>Return / Share</th>
            <th>Status</th>
            <th>Mistakes</th>
            <th>Playbook</th>
            <th>Game</th>
            <th>Out Tag</th>
            <th>Execution</th>
          </tr>
        </thead>
        <tbody>
          {trades.length === 0 ? (
            <tr>
              <td colSpan={19} className="empty-state">
                No trades match the current filters.
              </td>
            </tr>
          ) : (
            trades.map((trade) => (
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
                <td>{trade.name}</td>
                <td>{trade.tradeDate}</td>
                <td>
                  <div className="symbol-cell">
                    {tickerIcons[trade.symbol] ? (
                      <img
                        className={`ticker-icon ticker-icon-${trade.symbol.toLowerCase()}`}
                        src={tickerIcons[trade.symbol]}
                        alt={`${trade.symbol} icon`}
                      />
                    ) : null}
                    <span>{trade.symbol}</span>
                  </div>
                </td>
                <td>{trade.side}</td>
                <td>{trade.openTime}</td>
                <td>{trade.closeTime}</td>
                <td>{trade.holdTime}</td>
                <td>{trade.size}</td>
                <td>{trade.entryPrice.toFixed(4)}</td>
                <td>{trade.exitPrice.toFixed(4)}</td>
                <td>{trade.netPnlUsd.toFixed(4)}</td>
                <td>{trade.returnPerShare.toFixed(4)}</td>
                <td>{renderEditableCell(trade, "status", (tradeId, field, anchorRect) => setCellEditor({ tradeId, field, anchorRect }))}</td>
                <td>{renderEditableCell(trade, "mistake", (tradeId, field, anchorRect) => setCellEditor({ tradeId, field, anchorRect }))}</td>
                <td>{renderEditableCell(trade, "playbook", (tradeId, field, anchorRect) => setCellEditor({ tradeId, field, anchorRect }))}</td>
                <td>{renderEditableCell(trade, "game", (tradeId, field, anchorRect) => setCellEditor({ tradeId, field, anchorRect }))}</td>
                <td>{renderEditableCell(trade, "outTag", (tradeId, field, anchorRect) => setCellEditor({ tradeId, field, anchorRect }))}</td>
                <td>{renderEditableCell(trade, "execution", (tradeId, field, anchorRect) => setCellEditor({ tradeId, field, anchorRect }))}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      {cellEditor && activeTrade ? (
        <SearchableTagPopover
          anchorRect={cellEditor.anchorRect}
          title={`${tradeTagFieldLabels[cellEditor.field]} · ${activeTrade.name}`}
          options={tagOptionsByField[cellEditor.field]}
          currentValue={getFieldDisplayValue(activeTrade, cellEditor.field)}
          allowClear
          clearLabel={
            cellEditor.field === "mistake"
              ? "No mistakes"
              : `Clear ${tradeTagFieldLabels[cellEditor.field]}`
          }
          onSelect={(value) => {
            onUpdateTradeTag(activeTrade, cellEditor.field, value);
            setCellEditor(null);
          }}
          onCreateOption={(value) => {
            onCreateTradeTagOption(cellEditor.field, value);
            onUpdateTradeTag(activeTrade, cellEditor.field, value);
            setCellEditor(null);
          }}
          onClose={() => setCellEditor(null)}
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
