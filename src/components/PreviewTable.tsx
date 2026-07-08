import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { getTickerIcon, getTickerSector } from "../lib/tickers/tickerIcons";
import { tradeTagFieldLabels, tradeTagOptionsByField as defaultTradeTagOptionsByField } from "../lib/trades/tradeTagCatalog";
import type { EditableTradeRow, EditableTradeTagField } from "../types/tradeTags";
import { TagDrawer } from "./TagDrawer";

interface PreviewTableProps {
  trades: EditableTradeRow[];
  tagOptionsByField: Record<EditableTradeTagField, string[]>;
  selectedTradeId?: string;
  onSelectTrade?: (trade: EditableTradeRow) => void;
  showSelection?: boolean;
  selectedTradeIds?: string[];
  onToggleTradeSelection?: (tradeId: string) => void;
  onToggleSelectAll?: (tradeIds: string[]) => void;
  enableTagEditing?: boolean;
  onUpdateTradeTag?: (trade: EditableTradeRow, field: EditableTradeTagField, value: string | string[] | null) => void;
  onBulkUpdateTradeTags?: (tradeIds: string[], field: EditableTradeTagField, value: string | string[] | null) => void;
  onCreateTradeTagOption?: (field: EditableTradeTagField, value: string) => void;
  onRenameTradeTagOption?: (field: EditableTradeTagField, currentValue: string, nextValue: string) => void;
  onDeleteTradeTagOption?: (field: EditableTradeTagField, value: string) => void;
  visibleColumnKeys?: PreviewSortKey[];
  emptyStateLabel?: string;
  pinLeadingColumns?: boolean;
  maxTableHeight?: string;
  enableBatchPlaybookActions?: boolean;
}

type CellEditorState = {
  tradeId: string;
  field: EditableTradeTagField;
};

type BatchEditorState = {
  field: EditableTradeTagField;
  selectedValues: string[];
};

export type PreviewSortKey =
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
  { key: "catalyst", label: "Catalyst", getSortValue: (trade) => getFieldDisplayValue(trade, "catalyst") },
  { key: "game", label: "Game", getSortValue: (trade) => getFieldDisplayValue(trade, "game") },
  { key: "outTag", label: "Out Tag", getSortValue: (trade) => getFieldDisplayValue(trade, "outTag") },
  { key: "execution", label: "Execution", getSortValue: (trade) => getFieldDisplayValue(trade, "execution") },
  { key: "tradeDate", label: "Trade Date", getSortValue: (trade) => trade.tradeDate }
];

const tagColumnKeys: EditableTradeTagField[] = ["status", "mistake", "playbook", "catalyst", "game", "outTag", "execution"];

const isTagColumnKey = (key: PreviewSortKey): key is EditableTradeTagField =>
  tagColumnKeys.includes(key as EditableTradeTagField);

const toKebabCase = (value: string): string => value.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);

const getColumnClassName = (key: PreviewSortKey): string => `preview-col-${toKebabCase(key)}`;

const pinnedColumnClassByKey: Partial<Record<PreviewSortKey, string>> = {
  name: "preview-col-sticky preview-col-sticky-name",
  symbol: "preview-col-sticky preview-col-sticky-symbol",
  side: "preview-col-sticky preview-col-sticky-side"
};

const getPinnedColumnClassName = (key: PreviewSortKey): string => pinnedColumnClassByKey[key] ?? "";

const summarizeTags = (values: string[]): string => {
  if (values.length === 0) {
    return "";
  }

  if (values.length === 1) {
    return values[0] ?? "";
  }

  return `${values[0]} +${values.length - 1}`;
};

const getToneIndex = (value: string): number =>
  value.split("").reduce((sum, character) => sum + character.charCodeAt(0), 0) % 6;

const getFieldDisplayValue = (trade: EditableTradeRow, field: EditableTradeTagField): string => {
  switch (field) {
    case "status":
      return trade.status;
    case "mistake":
      return summarizeTags(trade.mistakes ?? []);
    case "playbook":
      return trade.setups[0] ?? "";
    case "catalyst":
      return summarizeTags(trade.catalyst ?? []);
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
      return `tag-pill-playbook tag-pill-tone-${getToneIndex(value)}`;
    case "catalyst":
      return "tag-pill-catalyst";
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

const isMultiSelectField = (field: EditableTradeTagField): boolean => field === "mistake" || field === "catalyst";

const getFieldSelectedValues = (trade: EditableTradeRow, field: EditableTradeTagField): string[] => {
  switch (field) {
    case "mistake":
      return trade.mistakes ?? [];
    case "catalyst":
      return trade.catalyst ?? [];
    default:
      return [];
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
  onSelectTrade,
  showSelection = true,
  selectedTradeIds,
  onToggleTradeSelection,
  onToggleSelectAll,
  enableTagEditing = true,
  onUpdateTradeTag,
  onBulkUpdateTradeTags,
  onCreateTradeTagOption,
  onRenameTradeTagOption,
  onDeleteTradeTagOption,
  visibleColumnKeys,
  emptyStateLabel = "No trades match the current filters.",
  pinLeadingColumns = false,
  maxTableHeight,
  enableBatchPlaybookActions = true
}: PreviewTableProps) => {
  const [cellEditor, setCellEditor] = useState<CellEditorState | null>(null);
  const [cellEditorSearchQuery, setCellEditorSearchQuery] = useState("");
  const [batchEditor, setBatchEditor] = useState<BatchEditorState | null>(null);
  const [batchEditorSearchQuery, setBatchEditorSearchQuery] = useState("");
  const [sortConfig, setSortConfig] = useState<PreviewSortConfig>({ key: "tradeDate", direction: "desc" });
  const isTagFieldEnabled = (field: EditableTradeTagField) => tagOptionsByField[field].length > 0;
  const resolvedSelectedTradeIds = selectedTradeIds ?? [];
  const toggleTradeSelection = onToggleTradeSelection ?? (() => undefined);
  const toggleSelectAll = onToggleSelectAll ?? (() => undefined);
  const updateTradeTag = onUpdateTradeTag ?? (() => undefined);
  const createTradeTagOption = onCreateTradeTagOption ?? (() => undefined);
  const renameTradeTagOption = onRenameTradeTagOption ?? (() => undefined);
  const deleteTradeTagOption = onDeleteTradeTagOption ?? (() => undefined);

  const visibleColumns = useMemo(
    () => {
      const allowedKeys = visibleColumnKeys ? new Set(visibleColumnKeys) : null;
      return previewColumns.filter((column) => {
        if (allowedKeys && !allowedKeys.has(column.key)) {
          return false;
        }

        if (isTagColumnKey(column.key) && !isTagFieldEnabled(column.key)) {
          return false;
        }

        return true;
      });
    },
    [tagOptionsByField, visibleColumnKeys]
  );

  const selectedCount = showSelection ? resolvedSelectedTradeIds.length : 0;
  const isPlaybookBatchEnabled = enableBatchPlaybookActions && showSelection && selectedCount > 0;
  const selectedTradesForBatch = useMemo(
    () => trades.filter((trade) => resolvedSelectedTradeIds.includes(trade.id)),
    [trades, resolvedSelectedTradeIds]
  );

  const applyBatchTag = (field: EditableTradeTagField, value: string | string[] | null) => {
    if (selectedTradesForBatch.length === 0) {
      return;
    }

    if (onBulkUpdateTradeTags) {
      onBulkUpdateTradeTags(resolvedSelectedTradeIds, field, value);
      return;
    }

    for (const trade of selectedTradesForBatch) {
      updateTradeTag(trade, field, value);
    }
  };

  const openBatchEditor = (field: EditableTradeTagField) => {
    setCellEditor(null);
    setCellEditorSearchQuery("");
    setBatchEditor({ field, selectedValues: [] });
    setBatchEditorSearchQuery("");
  };

  const closeBatchEditor = () => {
    setBatchEditor(null);
    setBatchEditorSearchQuery("");
  };

  useEffect(() => {
    if (selectedCount === 0 && batchEditor) {
      setBatchEditor(null);
      setBatchEditorSearchQuery("");
    }
  }, [batchEditor, selectedCount]);
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
  const allVisibleSelected = showSelection &&
    selectableTradeIds.length > 0 &&
    selectableTradeIds.every((tradeId) => resolvedSelectedTradeIds.includes(tradeId));

  const activeTrade = cellEditor
    ? trades.find((trade) => trade.id === cellEditor.tradeId) ?? null
    : null;
  const tableShellClassName = `table-shell preview-table-shell${pinLeadingColumns ? " preview-table-shell-pin-leading" : ""}`;
  const tableShellStyle: CSSProperties & Record<string, string> = {};

  if (maxTableHeight) {
    tableShellStyle.maxHeight = maxTableHeight;
  }

  if (pinLeadingColumns) {
    tableShellStyle["--preview-sticky-name-left"] = showSelection ? "38px" : "0px";
    tableShellStyle["--preview-sticky-symbol-left"] = showSelection ? "162px" : "124px";
    tableShellStyle["--preview-sticky-side-left"] = showSelection ? "238px" : "200px";
  }

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
      if (!enableTagEditing) {
        return getFieldDisplayValue(trade, column.key);
      }

      return renderEditableCell(trade, column.key, (tradeId, field) => {
        if (showSelection && resolvedSelectedTradeIds.includes(tradeId)) {
          openBatchEditor(field);
          return;
        }

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
    <div className={tableShellClassName} style={Object.keys(tableShellStyle).length > 0 ? tableShellStyle : undefined}>
      <table className="preview-table">
        <thead>
          <tr>
            {showSelection ? (
              <th
                className={`selection-column preview-col-selection${
                  pinLeadingColumns ? " preview-col-sticky preview-col-sticky-selection" : ""
                }`}
              >
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  aria-label="Select all visible trades"
                  onChange={() => toggleSelectAll(selectableTradeIds)}
                />
              </th>
            ) : null}
            {visibleColumns.map((column) => {
              const tagField = isTagColumnKey(column.key) ? column.key : null;
              const isBatchTagHeader =
                enableTagEditing && showSelection && selectedCount > 0 && tagField !== null;
              const isActiveSort = sortConfig.key === column.key;
              const sortDirectionLabel = sortConfig.direction === "asc" ? "ascending" : "descending";

              return (
                <th
                  key={column.key}
                  className={`${getColumnClassName(column.key)}${
                    pinLeadingColumns ? ` ${getPinnedColumnClassName(column.key)}` : ""
                  }`.trim()}
                >
                  <button
                    type="button"
                    className={`sortable-header-button${isBatchTagHeader ? " batch-tag-header-button" : ""}${
                      isActiveSort && !isBatchTagHeader ? " sortable-header-button-active" : ""
                    }`}
                    aria-label={
                      isBatchTagHeader
                        ? `Batch update ${column.label} for ${selectedCount} selected trades`
                        : isActiveSort
                          ? `Sort by ${column.label}. Currently ${sortDirectionLabel}.`
                          : `Sort by ${column.label}`
                    }
                    title={isBatchTagHeader ? `Batch update ${column.label}` : `Sort by ${column.label}`}
                    onClick={() => {
                      if (isBatchTagHeader && tagField) {
                        openBatchEditor(tagField);
                        return;
                      }

                      toggleSort(column.key);
                    }}
                  >
                    <span>{column.label}</span>
                    {isBatchTagHeader || isActiveSort ? (
                      <span
                        className={`sort-indicator${
                          isBatchTagHeader ? " batch-tag-indicator" : " sort-indicator-active"
                        }`}
                        aria-hidden="true"
                      >
                        {isBatchTagHeader ? "+" : sortConfig.direction === "asc" ? "↑" : "↓"}
                      </span>
                    ) : null}
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {trades.length === 0 ? (
            <tr>
              <td colSpan={visibleColumns.length + (showSelection ? 1 : 0)} className="empty-state">
                {emptyStateLabel}
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
                {showSelection ? (
                  <td
                    className={`selection-column preview-col-selection${
                      pinLeadingColumns ? " preview-col-sticky preview-col-sticky-selection" : ""
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={resolvedSelectedTradeIds.includes(trade.id)}
                      aria-label={`Select ${trade.name}`}
                      onClick={(event) => event.stopPropagation()}
                      onChange={() => toggleTradeSelection(trade.id)}
                    />
                  </td>
                ) : null}
                {visibleColumns.map((column) => (
                  <td
                    key={column.key}
                    className={`${getColumnClassName(column.key)}${
                      pinLeadingColumns ? ` ${getPinnedColumnClassName(column.key)}` : ""
                    }`.trim()}
                  >
                    {renderCell(trade, column)}
                  </td>
                ))}
              </tr>
              );
            })
          )}
        </tbody>
      </table>
      {enableTagEditing && cellEditor && activeTrade ? (
        <TagDrawer
          isOpen={!!cellEditor}
          selectionMode={isMultiSelectField(cellEditor.field) ? "multi" : "single"}
          title={`${tradeTagFieldLabels[cellEditor.field]} - ${activeTrade.name}`}
          options={tagOptionsByField[cellEditor.field]}
          currentValue={isMultiSelectField(cellEditor.field) ? "" : getFieldDisplayValue(activeTrade, cellEditor.field)}
          currentValues={getFieldSelectedValues(activeTrade, cellEditor.field)}
          allowClear
          clearLabel={
            cellEditor.field === "mistake"
              ? "No mistakes"
              : cellEditor.field === "catalyst"
                ? "No catalyst"
              : `Clear ${tradeTagFieldLabels[cellEditor.field]}`
          }
          searchValue={cellEditorSearchQuery}
          onSearchChange={setCellEditorSearchQuery}
          onSelect={(value) => {
            updateTradeTag(activeTrade, cellEditor.field, value);
            if (!isMultiSelectField(cellEditor.field)) {
              setCellEditor(null);
              setCellEditorSearchQuery("");
            }
          }}
          onCreateOption={(value) => {
            createTradeTagOption(cellEditor.field, value);
            if (isMultiSelectField(cellEditor.field)) {
              const currentValues = getFieldSelectedValues(activeTrade, cellEditor.field);
              const nextValues = currentValues.includes(value) ? currentValues : [...currentValues, value];
              updateTradeTag(activeTrade, cellEditor.field, nextValues);
            } else {
              updateTradeTag(activeTrade, cellEditor.field, value);
              setCellEditor(null);
              setCellEditorSearchQuery("");
            }
          }}
          onRenameOption={(currentValue, nextValue) => {
            renameTradeTagOption(cellEditor.field, currentValue, nextValue);
          }}
          onDeleteOption={(value) => {
            deleteTradeTagOption(cellEditor.field, value);
          }}
          canManageOption={(value) =>
            !defaultTradeTagOptionsByField[cellEditor.field].some(
              (option) => option.toLowerCase() === value.toLowerCase()
            )
          }
          onClose={() => {
            setCellEditor(null);
            setCellEditorSearchQuery("");
          }}
        />
      ) : null}
      {batchEditor && selectedCount > 0 ? (
        <TagDrawer
          isOpen
          selectionMode={isMultiSelectField(batchEditor.field) ? "multi" : "single"}
          title={`Batch Update - ${tradeTagFieldLabels[batchEditor.field]} (${selectedCount} selected)`}
          options={tagOptionsByField[batchEditor.field]}
          currentValue=""
          currentValues={batchEditor.selectedValues}
          allowClear
          clearLabel={
            batchEditor.field === "mistake"
              ? "No mistakes"
              : batchEditor.field === "catalyst"
                ? "No catalyst"
                : `Clear ${tradeTagFieldLabels[batchEditor.field]}`
          }
          searchValue={batchEditorSearchQuery}
          onSearchChange={setBatchEditorSearchQuery}
          onSelect={(value) => {
            applyBatchTag(batchEditor.field, value);
            if (isMultiSelectField(batchEditor.field) && Array.isArray(value)) {
              setBatchEditor((current) => current ? { ...current, selectedValues: value } : current);
              return;
            }

            closeBatchEditor();
          }}
          onCreateOption={(value) => {
            createTradeTagOption(batchEditor.field, value);
            if (isMultiSelectField(batchEditor.field)) {
              const nextValues = batchEditor.selectedValues.includes(value)
                ? batchEditor.selectedValues
                : [...batchEditor.selectedValues, value];
              applyBatchTag(batchEditor.field, nextValues);
              setBatchEditor((current) => current ? { ...current, selectedValues: nextValues } : current);
              setBatchEditorSearchQuery("");
              return;
            }

            applyBatchTag(batchEditor.field, value);
            closeBatchEditor();
          }}
          onRenameOption={(currentValue, nextValue) => {
            renameTradeTagOption(batchEditor.field, currentValue, nextValue);
            if (batchEditor.selectedValues.includes(currentValue)) {
              setBatchEditor((current) =>
                current
                  ? {
                      ...current,
                      selectedValues: current.selectedValues.map((value) =>
                        value === currentValue ? nextValue : value
                      )
                    }
                  : current
              );
            }
          }}
          onDeleteOption={(value) => {
            deleteTradeTagOption(batchEditor.field, value);
            if (batchEditor.selectedValues.includes(value)) {
              setBatchEditor((current) =>
                current
                  ? { ...current, selectedValues: current.selectedValues.filter((entry) => entry !== value) }
                  : current
              );
            }
          }}
          canManageOption={(value) =>
            !defaultTradeTagOptionsByField[batchEditor.field].some(
              (option) => option.toLowerCase() === value.toLowerCase()
            )
          }
          onClose={closeBatchEditor}
        />
      ) : null}
      {showSelection && selectedCount > 0 ? (
        <div className="table-selection-footer">
          <span>{selectedCount} trade{selectedCount === 1 ? "" : "s"} selected</span>
          {isPlaybookBatchEnabled ? (
            <div className="table-selection-actions">
              <button
                type="button"
                className="mini-action"
                onClick={() => {
                  openBatchEditor("playbook");
                }}
              >
                Batch Playbook
              </button>
              <button
                type="button"
                className="mini-action mini-action-soft"
                onClick={() => applyBatchTag("playbook", null)}
              >
                Clear Playbook
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};
