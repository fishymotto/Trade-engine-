import type { ExecutionPiece, GroupedTrade, RawExecutionRow, TradeDirection } from "../../../types/trade";

interface MutableTrade {
  id: string;
  tradeDate: string;
  symbol: string;
  side: TradeDirection;
  openingExecutions: ExecutionPiece[];
  closingExecutions: ExecutionPiece[];
  addSignals: GroupedTrade["addSignals"];
}

const toIsoDate = (tradeDate: string): string =>
  tradeDate.includes("-") ? tradeDate : tradeDate.replace(/(\d{1,2})\/(\d{1,2})\/(\d{4})/, "$3-$1-$2");

const toTimestamp = (tradeDate: string, time: string): string => `${toIsoDate(tradeDate)}T${time}`;

const normalizeSide = (orderSide: string): "Buy" | "Sell" => {
  const normalized = orderSide.trim().toUpperCase();
  if (normalized === "B" || normalized === "BUY") {
    return "Buy";
  }

  if (normalized === "S" || normalized === "SELL" || normalized === "T") {
    return "Sell";
  }

  throw new Error(`Unsupported ORDER_SIDE value "${orderSide}".`);
};

const formatHoldTime = (seconds: number): string => {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${String(remainingSeconds).padStart(2, "0")}s`;
};

const roundMoney = (value: number): number => Number(value.toFixed(4));

const weightedAverage = (executions: ExecutionPiece[]): number => {
  const totalShares = executions.reduce((sum, execution) => sum + execution.quantity, 0);
  if (totalShares === 0) {
    return 0;
  }

  const weighted = executions.reduce((sum, execution) => sum + execution.price * execution.quantity, 0);
  return weighted / totalShares;
};

const createPiece = (row: RawExecutionRow, quantity: number, ratio: number): ExecutionPiece => ({
  tradeDate: toIsoDate(row.tradeDate),
  time: row.time,
  timestamp: toTimestamp(row.tradeDate, row.time),
  symbol: row.symbol,
  gatewayName: row.gatewayName,
  side: normalizeSide(row.orderSide),
  quantity,
  price: row.price,
  grossPnlUsd: roundMoney(row.grossPnlUsd * ratio),
  netPnlUsd: roundMoney(row.netPnlUsd * ratio),
  feesUsd: roundMoney(row.feesUsd * ratio),
  gatewayFee: roundMoney(row.gatewayFee * ratio),
  sourceIndex: row.originalIndex
});

const createTrade = (row: RawExecutionRow, direction: TradeDirection): MutableTrade => ({
  id: `${row.symbol}-${toIsoDate(row.tradeDate)}-${row.originalIndex}`,
  tradeDate: toIsoDate(row.tradeDate),
  symbol: row.symbol,
  side: direction,
  openingExecutions: [],
  closingExecutions: [],
  addSignals: []
});

const getSignedQuantity = (piece: ExecutionPiece): number => (piece.side === "Buy" ? piece.quantity : -piece.quantity);
const getDirectionFromSignedPosition = (position: number): TradeDirection => (position >= 0 ? "Long" : "Short");

const getUnrealizedState = (trade: MutableTrade, addPrice: number): { positive: boolean; negative: boolean } => {
  const currentAverage = weightedAverage(trade.openingExecutions);
  if (trade.side === "Long") {
    return { positive: addPrice > currentAverage, negative: addPrice < currentAverage };
  }

  return { positive: addPrice < currentAverage, negative: addPrice > currentAverage };
};

const finalizeTrade = (trade: MutableTrade): GroupedTrade => {
  const entryPrice = weightedAverage(trade.openingExecutions);
  const exitPrice = weightedAverage(trade.closingExecutions);
  const size = trade.openingExecutions.reduce((sum, execution) => sum + execution.quantity, 0);
  const allExecutions = trade.openingExecutions.concat(trade.closingExecutions);
  const grossPnlUsd = allExecutions.reduce((sum, execution) => sum + execution.grossPnlUsd, 0);
  const netPnlUsd = allExecutions.reduce((sum, execution) => sum + execution.netPnlUsd, 0);
  const feesUsd = allExecutions.reduce((sum, execution) => sum + execution.feesUsd, 0);
  const gateways = Array.from(
    new Set(allExecutions.map((execution) => execution.gatewayName).filter(Boolean))
  ).sort();
  const openTime = trade.openingExecutions[0]?.time ?? "";
  const closeTime = trade.closingExecutions[trade.closingExecutions.length - 1]?.time ?? openTime;
  const openMs = Date.parse(trade.openingExecutions[0]?.timestamp ?? "");
  const closeMs = Date.parse(trade.closingExecutions[trade.closingExecutions.length - 1]?.timestamp ?? "");
  const holdSeconds = Number.isFinite(openMs) && Number.isFinite(closeMs)
    ? Math.max(0, Math.round((closeMs - openMs) / 1000))
    : 0;
  const returnPerShare = size > 0 ? netPnlUsd / size : 0;

  return {
    id: trade.id,
    name: "",
    tradeDate: trade.tradeDate,
    symbol: trade.symbol,
    side: trade.side,
    openTime,
    closeTime,
    holdTime: formatHoldTime(holdSeconds),
    holdSeconds,
    size,
    entryPrice,
    exitPrice,
    grossPnlUsd,
    feesUsd,
    netPnlUsd,
    netReturn: netPnlUsd,
    returnPerShare,
    status: netPnlUsd > 0 ? "Win" : "Loss",
    mistakes: [],
    setups: [],
    catalyst: [],
    game: "",
    outTag: [],
    gateways,
    execution: [],
    firstOpeningPrice: trade.openingExecutions[0]?.price ?? 0,
    openingExecutions: trade.openingExecutions,
    closingExecutions: trade.closingExecutions,
    addSignals: trade.addSignals
  };
};

const assignTradeNames = (trades: GroupedTrade[]): GroupedTrade[] => {
  const grouped = new Map<string, GroupedTrade[]>();

  for (const trade of trades) {
    const key = `${trade.tradeDate}-${trade.symbol}`;
    const bucket = grouped.get(key) ?? [];
    bucket.push(trade);
    grouped.set(key, bucket);
  }

  const namedTrades: GroupedTrade[] = [];
  for (const bucket of grouped.values()) {
    bucket.sort((a, b) => a.openTime.localeCompare(b.openTime)).forEach((trade, index) => {
      namedTrades.push({
        ...trade,
        name: `${trade.symbol} #${String(index + 1).padStart(2, "0")}`
      });
    });
  }

  return namedTrades.sort((a, b) =>
    `${a.tradeDate}-${a.symbol}-${a.openTime}`.localeCompare(`${b.tradeDate}-${b.symbol}-${b.openTime}`)
  );
};

export const groupExecutions = (rows: RawExecutionRow[]): GroupedTrade[] => {
  const rowsBySymbolDay = new Map<string, RawExecutionRow[]>();
  for (const row of rows) {
    const key = `${toIsoDate(row.tradeDate)}-${row.symbol}`;
    const bucket = rowsBySymbolDay.get(key) ?? [];
    bucket.push(row);
    rowsBySymbolDay.set(key, bucket);
  }

  const output: GroupedTrade[] = [];

  for (const bucket of rowsBySymbolDay.values()) {
    const sortedRows = [...bucket].sort((a, b) => {
      const timestampCompare = toTimestamp(a.tradeDate, a.time).localeCompare(toTimestamp(b.tradeDate, b.time));
      if (timestampCompare !== 0) {
        return timestampCompare;
      }
      return a.originalIndex - b.originalIndex;
    });

    let currentTrade: MutableTrade | null = null;
    let signedPosition = 0;

    for (const row of sortedRows) {
      const piece = createPiece(row, row.quantity, 1);
      const signedQuantity = getSignedQuantity(piece);

      if (currentTrade === null || signedPosition === 0) {
        currentTrade = createTrade(row, getDirectionFromSignedPosition(signedQuantity));
        currentTrade.openingExecutions.push(piece);
        signedPosition = signedQuantity;
        continue;
      }

      const currentDirection = Math.sign(signedPosition);
      const incomingDirection = Math.sign(signedQuantity);

      if (currentDirection === incomingDirection) {
        const originalOpeningPrice = currentTrade.openingExecutions[0]?.price ?? piece.price;
        const unrealized = getUnrealizedState(currentTrade, piece.price);
        currentTrade.addSignals.push({
          price: piece.price,
          time: piece.time,
          averagedDown:
            currentTrade.side === "Long"
              ? unrealized.negative && piece.price < originalOpeningPrice
              : unrealized.negative && piece.price > originalOpeningPrice,
          addedToWinner:
            currentTrade.side === "Long"
              ? unrealized.positive && piece.price > originalOpeningPrice
              : unrealized.positive && piece.price < originalOpeningPrice
        });
        currentTrade.openingExecutions.push(piece);
        signedPosition += signedQuantity;
        continue;
      }

      if (Math.abs(signedQuantity) <= Math.abs(signedPosition)) {
        currentTrade.closingExecutions.push(piece);
        signedPosition += signedQuantity;
        if (signedPosition === 0) {
          output.push(finalizeTrade(currentTrade));
          currentTrade = null;
        }
        continue;
      }

      const closingQuantity = Math.abs(signedPosition);
      const openingQuantity = Math.abs(signedQuantity) - closingQuantity;
      const ratioForClose = closingQuantity / piece.quantity;
      const ratioForOpen = openingQuantity / piece.quantity;

      currentTrade.closingExecutions.push(createPiece(row, closingQuantity, ratioForClose));
      output.push(finalizeTrade(currentTrade));

      currentTrade = createTrade(row, getDirectionFromSignedPosition(signedQuantity));
      currentTrade.openingExecutions.push(createPiece(row, openingQuantity, ratioForOpen));
      signedPosition = incomingDirection * openingQuantity;
    }

    if (currentTrade && signedPosition !== 0) {
      throw new Error(
        `The imported file ends with an open ${currentTrade.symbol} position. Export a flat PPro8 Trade Detail file and try again.`
      );
    }
  }

  return assignTradeNames(output);
};
