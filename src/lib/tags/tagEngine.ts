import type { GameTag, GroupedTrade } from "../../types/trade";

const roundToPriceBucket = (value: number): number => Math.round(value / 0.03) * 0.03;

const applyAttemptTags = (trades: GroupedTrade[]): void => {
  const grouped = new Map<string, GroupedTrade[]>();

  for (const trade of trades) {
    const key = `${trade.tradeDate}-${trade.symbol}-${roundToPriceBucket(trade.firstOpeningPrice).toFixed(2)}`;
    const bucket = grouped.get(key) ?? [];
    bucket.push(trade);
    grouped.set(key, bucket);
  }

  for (const bucket of grouped.values()) {
    const ordered = bucket.sort((a, b) => a.openTime.localeCompare(b.openTime));
    let windowStart = "";
    let attemptIndex = 0;

    for (const trade of ordered) {
      const openTimestamp = Date.parse(`${trade.tradeDate}T${trade.openTime}`);
      const windowStartTimestamp = windowStart ? Date.parse(`${trade.tradeDate}T${windowStart}`) : NaN;

      if (!windowStart || !Number.isFinite(windowStartTimestamp) || openTimestamp - windowStartTimestamp > 30 * 60 * 1000) {
        windowStart = trade.openTime;
        attemptIndex = 1;
        continue;
      }

      attemptIndex += 1;
      const attemptLabelMap: Record<number, string> = {
        2: "Second Attempt",
        3: "Third Attempt",
        4: "Fourth Attempt",
        5: "Fifth Attempt"
      };

      const label = attemptLabelMap[attemptIndex];
      if (label) {
        trade.mistakes.push(label);
      }
    }
  }
};

const getGameTag = (returnPerShare: number): GameTag => {
  if (returnPerShare >= 0.13) {
    return "A Game";
  }
  if (returnPerShare >= 0.07) {
    return "B+ Game";
  }
  if (returnPerShare >= 0.02) {
    return "B Game";
  }
  if (returnPerShare >= -0.04) {
    return "B- Game";
  }
  return "C Game";
};

export const applyTradeTags = (trades: GroupedTrade[]): GroupedTrade[] => {
  const taggedTrades = trades.map((trade) => {
    const mistakes: string[] = [];
    const setups: string[] = [];
    const outTag: string[] = [];
    const execution: string[] = [];
    const closeExecutionCount = trade.closingExecutions.length;
    const closingShareTotal = trade.closingExecutions.reduce((sum, executionItem) => sum + executionItem.quantity, 0);
    const aggressiveClosingShares = trade.closingExecutions
      .filter((executionItem) => executionItem.gatewayFee > 0)
      .reduce((sum, executionItem) => sum + executionItem.quantity, 0);
    const passiveClosingShares = trade.closingExecutions
      .filter((executionItem) => executionItem.gatewayFee < 0)
      .reduce((sum, executionItem) => sum + executionItem.quantity, 0);

    if (trade.size < 100) {
      mistakes.push("Small Size");
    }

    if (trade.addSignals.some((signal) => signal.averagedDown)) {
      mistakes.push("Averaged Down");
    }

    if (trade.returnPerShare < -0.06 || trade.netPnlUsd < -15) {
      mistakes.push("Too Much Risk");
    }

    if (trade.symbol === "CVE" && trade.openTime >= "09:30:00" && trade.openTime <= "09:34:59") {
      setups.push("Opening Drive Wide Spread");
    }

    if (trade.openTime >= "15:50:00" && trade.openTime <= "16:00:00") {
      setups.push(trade.side === "Long" ? "Buy Imbalance" : "Sell Imbalance");
    }

    if (closingShareTotal > 0 && aggressiveClosingShares > 0 && passiveClosingShares === 0) {
      outTag.push("Aggressive");
    } else if (closingShareTotal > 0 && passiveClosingShares > 0 && aggressiveClosingShares === 0) {
      outTag.push("Passive");
    } else if (closingShareTotal > 0 && aggressiveClosingShares > 0 && passiveClosingShares > 0) {
      outTag.push("Mixed");
    }

    if (trade.addSignals.some((signal) => signal.addedToWinner)) {
      execution.push("Added to Winner");
    }

    if (trade.openingExecutions.length > 1) {
      execution.push("Scaled In");
    }

    if (closeExecutionCount > 1) {
      execution.push("Scaled Out");
    }

    if (trade.openingExecutions.length === 1 && trade.closingExecutions.length === 1) {
      execution.push("One Clip");
    }

    if (trade.holdSeconds > 600) {
      execution.push("Extended Hold");
    }

    return {
      ...trade,
      mistakes,
      setups,
      game: getGameTag(trade.returnPerShare),
      outTag,
      execution
    };
  });

  applyAttemptTags(taggedTrades);
  return taggedTrades;
};
