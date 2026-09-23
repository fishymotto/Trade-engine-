import { useMemo, useState } from "react";
import type { ExecutionPiece, GroupedTrade } from "../../../types/trade";

type ExecutionKind = "Entry" | "Add" | "Exit";
type ExecutionSortDirection = "asc" | "desc";

interface ExecutionRow {
  kind: ExecutionKind;
  qualifier?: string;
  time: string;
  timestamp: string;
  gateway?: string;
  side: "Buy" | "Sell";
  quantity?: number;
  positionSize?: number;
  price: number;
  netPnlUsd?: number;
  perShareUsd?: number;
  commissionUsd?: number;
  feesUsd?: number;
  returnPercent?: number;
  sourceIndex?: number;
}

const formatSignedUsd = (value: number): string => {
  const sign = value > 0 ? "+" : "";
  return `${sign}$${value.toFixed(2)}`;
};

const formatSignedPercent = (value: number): string => {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
};

const formatShares = (value: number): string => {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toLocaleString()} Shares`;
};

const deriveSide = (tradeSide: GroupedTrade["side"], kind: ExecutionKind): "Buy" | "Sell" => {
  if (tradeSide === "Long") {
    return kind === "Exit" ? "Sell" : "Buy";
  }
  return kind === "Exit" ? "Buy" : "Sell";
};

const buildRowFromExecution = (
  kind: ExecutionKind,
  execution: ExecutionPiece,
  qualifier?: string
): ExecutionRow => {
  const notional = execution.price * execution.quantity;
  const returnPercent = notional > 0 ? (execution.netPnlUsd / notional) * 100 : undefined;
  const perShareUsd = execution.quantity > 0 ? execution.netPnlUsd / execution.quantity : undefined;
  const feesExCommission = execution.feesUsd - execution.gatewayFee;

  return {
    kind,
    qualifier,
    time: execution.time,
    timestamp: execution.timestamp,
    gateway: execution.gatewayName,
    side: execution.side,
    quantity: execution.quantity,
    price: execution.price,
    netPnlUsd: execution.netPnlUsd,
    perShareUsd,
    commissionUsd: execution.gatewayFee,
    feesUsd: feesExCommission,
    returnPercent,
    sourceIndex: execution.sourceIndex
  };
};

const buildFallbackRow = (trade: GroupedTrade, kind: ExecutionKind): ExecutionRow => {
  const price = kind === "Exit" ? trade.exitPrice : trade.entryPrice;
  const time = kind === "Exit" ? trade.closeTime : trade.openTime;
  return {
    kind,
    time,
    timestamp: `${trade.tradeDate}T${time}`,
    side: deriveSide(trade.side, kind),
    price
  };
};

const buildExecutionRows = (trade: GroupedTrade): ExecutionRow[] => {
  const rows: ExecutionRow[] = [];

  if (trade.openingExecutions.length > 0) {
    const [first, ...rest] = trade.openingExecutions;
    rows.push(buildRowFromExecution("Entry", first));

    rest.forEach((execution, index) => {
      const signal = trade.addSignals[index];
      const qualifier = signal?.averagedDown ? "Avg down" : signal?.addedToWinner ? "To winner" : undefined;
      rows.push(buildRowFromExecution("Add", execution, qualifier));
    });
  } else {
    rows.push(buildFallbackRow(trade, "Entry"));
  }

  if (trade.closingExecutions.length > 0) {
    trade.closingExecutions.forEach((execution, index) => {
      const isPartial = index < trade.closingExecutions.length - 1;
      rows.push(buildRowFromExecution("Exit", execution, isPartial ? "Partial" : undefined));
    });
  } else {
    rows.push(buildFallbackRow(trade, "Exit"));
  }

  return rows;
};

const applyRunningPosition = (rows: ExecutionRow[]): ExecutionRow[] => {
  let runningPosition = 0;
  return rows.map((row) => {
    if (row.quantity && row.quantity > 0) {
      const signed = row.side === "Buy" ? row.quantity : -row.quantity;
      runningPosition += signed;
      return { ...row, positionSize: runningPosition };
    }

    return row;
  });
};

const compareExecutionRowsByTime = (
  left: ExecutionRow,
  right: ExecutionRow,
  direction: ExecutionSortDirection
): number => {
  const timestampCompare = left.timestamp.localeCompare(right.timestamp, undefined, {
    numeric: true,
    sensitivity: "base"
  });

  if (timestampCompare !== 0) {
    return direction === "asc" ? timestampCompare : -timestampCompare;
  }

  return (left.sourceIndex ?? Number.MAX_SAFE_INTEGER) - (right.sourceIndex ?? Number.MAX_SAFE_INTEGER);
};

export function TradeExecutionsTable({ trade }: { trade: GroupedTrade }) {
  const [timeSortDirection, setTimeSortDirection] = useState<ExecutionSortDirection>("asc");
  const rows = useMemo(() => {
    const chronologicalRows = [...buildExecutionRows(trade)].sort((left, right) =>
      compareExecutionRowsByTime(left, right, "asc")
    );
    const positionedRows = applyRunningPosition(chronologicalRows);

    if (timeSortDirection === "asc") {
      return positionedRows;
    }

    return [...positionedRows].sort((left, right) => compareExecutionRowsByTime(left, right, "desc"));
  }, [trade, timeSortDirection]);
  const sortDirectionLabel = timeSortDirection === "asc" ? "ascending" : "descending";
  const toggleTimeSort = () => {
    setTimeSortDirection((current) => (current === "asc" ? "desc" : "asc"));
  };

  return (
    <div className="trade-executions">
      <div className="trade-execution-grid trade-execution-header" role="row">
        <span className="trade-execution-header-cell">Type</span>
        <span className="trade-execution-header-cell">Side</span>
        <span className="trade-execution-header-cell">
          <button
            type="button"
            className="sortable-header-button"
            aria-label={`Sort executions by time. Currently ${sortDirectionLabel}.`}
            title="Sort executions by time"
            onClick={toggleTimeSort}
          >
            <span>Time</span>
            <span className="sort-indicator sort-indicator-active" aria-hidden="true">
              {timeSortDirection === "asc" ? "\u2191" : "\u2193"}
            </span>
          </button>
        </span>
        <span className="trade-execution-header-cell">Gateway</span>
        <span className="trade-execution-header-cell trade-execution-cell-right">Size</span>
        <span className="trade-execution-header-cell trade-execution-cell-right">Pos</span>
        <span className="trade-execution-header-cell trade-execution-cell-right">Price</span>
        <span className="trade-execution-header-cell trade-execution-cell-right">Return</span>
        <span className="trade-execution-header-cell trade-execution-cell-right">P/Share</span>
        <span className="trade-execution-header-cell trade-execution-cell-right">Comm</span>
        <span className="trade-execution-header-cell trade-execution-cell-right">Fees</span>
        <span className="trade-execution-header-cell trade-execution-cell-right">Return%</span>
      </div>
      <div className="trade-execution-body" role="rowgroup">
        {rows.map((row, index) => {
          const key = row.sourceIndex != null ? `${row.kind}-${row.sourceIndex}` : `${row.kind}-${row.time}-${index}`;
          const pnlTone = row.netPnlUsd == null ? "" : row.netPnlUsd >= 0 ? "positive-value" : "negative-value";

          return (
            <div key={key} className="trade-execution-grid trade-execution-row" role="row">
              <div className="trade-execution-cell trade-execution-cell-type">
                <span className="trade-execution-kind">{row.kind}</span>
                {row.qualifier ? <span className="trade-execution-qualifier">{row.qualifier}</span> : null}
              </div>
              <div className="trade-execution-cell">
                <span className={`execution-side-pill ${row.side === "Buy" ? "is-buy" : "is-sell"}`}>{row.side}</span>
              </div>
              <div className="trade-execution-cell trade-execution-cell-time">
                <span>{row.time}</span>
              </div>
              <div className="trade-execution-cell">
                <span>{row.gateway ? row.gateway : "-"}</span>
              </div>
              <div className="trade-execution-cell trade-execution-cell-right">
                {row.quantity != null ? `${row.quantity.toLocaleString()} Shares` : "-"}
              </div>
              <div className="trade-execution-cell trade-execution-cell-right">
                {row.positionSize != null ? formatShares(row.positionSize) : "-"}
              </div>
              <div className="trade-execution-cell trade-execution-cell-right trade-execution-cell-numeric">
                {row.price.toFixed(4)}
              </div>
              <div
                className={`trade-execution-cell trade-execution-cell-right trade-execution-cell-numeric ${pnlTone}`}
              >
                {row.netPnlUsd != null ? formatSignedUsd(row.netPnlUsd) : "-"}
              </div>
              <div
                className={`trade-execution-cell trade-execution-cell-right trade-execution-cell-numeric ${pnlTone}`}
              >
                {row.perShareUsd != null ? formatSignedUsd(row.perShareUsd) : "-"}
              </div>
              <div className="trade-execution-cell trade-execution-cell-right trade-execution-cell-numeric">
                {row.commissionUsd != null ? formatSignedUsd(row.commissionUsd) : "-"}
              </div>
              <div className="trade-execution-cell trade-execution-cell-right trade-execution-cell-numeric">
                {row.feesUsd != null ? formatSignedUsd(row.feesUsd) : "-"}
              </div>
              <div
                className={`trade-execution-cell trade-execution-cell-right trade-execution-cell-numeric ${pnlTone}`}
              >
                {row.returnPercent != null ? formatSignedPercent(row.returnPercent) : "-"}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

