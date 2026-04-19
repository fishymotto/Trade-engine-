import type { ExecutionPiece, GroupedTrade } from "../../../types/trade";

type ExecutionKind = "Entry" | "Add" | "Exit";

interface ExecutionRow {
  kind: ExecutionKind;
  qualifier?: string;
  time: string;
  gateway?: string;
  side: "Buy" | "Sell";
  quantity?: number;
  positionSize?: number;
  price: number;
  netPnlUsd?: number;
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
  return `${sign}${value.toLocaleString()} sh`;
};

const deriveSide = (tradeSide: GroupedTrade["side"], kind: ExecutionKind): "Buy" | "Sell" => {
  if (tradeSide === "Long") {
    return kind === "Exit" ? "Sell" : "Buy";
  }
  return kind === "Exit" ? "Buy" : "Sell";
};

const buildRowFromExecution = (
  trade: GroupedTrade,
  kind: ExecutionKind,
  execution: ExecutionPiece,
  qualifier?: string
): ExecutionRow => {
  const notional = execution.price * execution.quantity;
  const returnPercent = notional > 0 ? (execution.netPnlUsd / notional) * 100 : undefined;
  const feesExCommission = execution.feesUsd - execution.gatewayFee;

  return {
    kind,
    qualifier,
    time: execution.time,
    gateway: execution.gatewayName,
    side: execution.side,
    quantity: execution.quantity,
    price: execution.price,
    netPnlUsd: execution.netPnlUsd,
    commissionUsd: execution.gatewayFee,
    feesUsd: feesExCommission,
    returnPercent,
    sourceIndex: execution.sourceIndex
  };
};

const buildFallbackRow = (trade: GroupedTrade, kind: ExecutionKind): ExecutionRow => {
  const price = kind === "Exit" ? trade.exitPrice : trade.entryPrice;
  return {
    kind,
    time: kind === "Exit" ? trade.closeTime : trade.openTime,
    side: deriveSide(trade.side, kind),
    price
  };
};

const buildExecutionRows = (trade: GroupedTrade): ExecutionRow[] => {
  const rows: ExecutionRow[] = [];

  if (trade.openingExecutions.length > 0) {
    const [first, ...rest] = trade.openingExecutions;
    rows.push(buildRowFromExecution(trade, "Entry", first));

    rest.forEach((execution, index) => {
      const signal = trade.addSignals[index];
      const qualifier = signal?.averagedDown ? "Avg down" : signal?.addedToWinner ? "To winner" : undefined;
      rows.push(buildRowFromExecution(trade, "Add", execution, qualifier));
    });
  } else {
    rows.push(buildFallbackRow(trade, "Entry"));
  }

  if (trade.closingExecutions.length > 0) {
    trade.closingExecutions.forEach((execution, index) => {
      const isPartial = index < trade.closingExecutions.length - 1;
      rows.push(buildRowFromExecution(trade, "Exit", execution, isPartial ? "Partial" : undefined));
    });
  } else {
    rows.push(buildFallbackRow(trade, "Exit"));
  }

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

export function TradeExecutionsTable({ trade }: { trade: GroupedTrade }) {
  const rows = buildExecutionRows(trade);

  return (
    <div className="trade-executions">
      <div className="trade-execution-grid trade-execution-header" role="row">
        <span className="trade-execution-header-cell">Type</span>
        <span className="trade-execution-header-cell">Side</span>
        <span className="trade-execution-header-cell">Time</span>
        <span className="trade-execution-header-cell">Gateway</span>
        <span className="trade-execution-header-cell trade-execution-cell-right">Size</span>
        <span className="trade-execution-header-cell trade-execution-cell-right">Pos</span>
        <span className="trade-execution-header-cell trade-execution-cell-right">Price</span>
        <span className="trade-execution-header-cell trade-execution-cell-right">Return</span>
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
                <span>{row.gateway ? row.gateway : "—"}</span>
              </div>
              <div className="trade-execution-cell trade-execution-cell-right">
                {row.quantity != null ? `${row.quantity.toLocaleString()} sh` : "—"}
              </div>
              <div className="trade-execution-cell trade-execution-cell-right">
                {row.positionSize != null ? formatShares(row.positionSize) : "—"}
              </div>
              <div className="trade-execution-cell trade-execution-cell-right trade-execution-cell-numeric">
                {row.price.toFixed(4)}
              </div>
              <div
                className={`trade-execution-cell trade-execution-cell-right trade-execution-cell-numeric ${pnlTone}`}
              >
                {row.netPnlUsd != null ? formatSignedUsd(row.netPnlUsd) : "—"}
              </div>
              <div className="trade-execution-cell trade-execution-cell-right trade-execution-cell-numeric">
                {row.commissionUsd != null ? formatSignedUsd(row.commissionUsd) : "—"}
              </div>
              <div className="trade-execution-cell trade-execution-cell-right trade-execution-cell-numeric">
                {row.feesUsd != null ? formatSignedUsd(row.feesUsd) : "—"}
              </div>
              <div
                className={`trade-execution-cell trade-execution-cell-right trade-execution-cell-numeric ${pnlTone}`}
              >
                {row.returnPercent != null ? formatSignedPercent(row.returnPercent) : "—"}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
