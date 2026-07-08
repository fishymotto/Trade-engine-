import type { TradeSessionRecord } from "../../types/session";
import type { GroupedTrade } from "../../types/trade";

export const SECOND_TARGET_MISSED_TAG = "Second Target Missed";

const hasSecondTargetMissedTag = (mistakes: string[]): boolean =>
  mistakes.some((mistake) => mistake.trim().toLowerCase() === SECOND_TARGET_MISSED_TAG.toLowerCase());

const normalizeMistakes = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter(Boolean);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }

  return [];
};

export const isSecondTargetMissed = (trade: GroupedTrade): boolean => {
  const [firstTarget, secondTarget] = trade.closingExecutions;
  if (!firstTarget || !secondTarget) {
    return false;
  }

  return trade.side === "Long"
    ? secondTarget.price < firstTarget.price
    : secondTarget.price > firstTarget.price;
};

export const withSecondTargetMissedMistake = (trade: GroupedTrade, mistakes: unknown): string[] => {
  const normalizedMistakes = normalizeMistakes(mistakes);
  if (!isSecondTargetMissed(trade) || hasSecondTargetMissedTag(normalizedMistakes)) {
    return normalizedMistakes;
  }

  return [...normalizedMistakes, SECOND_TARGET_MISSED_TAG];
};

export const backfillSecondTargetMissedTrades = (
  trades: GroupedTrade[]
): { trades: GroupedTrade[]; changed: boolean; taggedTradeCount: number } => {
  let changed = false;
  let taggedTradeCount = 0;

  const nextTrades = trades.map((trade) => {
    if (!isSecondTargetMissed(trade)) {
      return trade;
    }

    const nextMistakes = withSecondTargetMissedMistake(trade, trade.mistakes);
    if (hasSecondTargetMissedTag(normalizeMistakes(trade.mistakes))) {
      return trade;
    }

    changed = true;
    taggedTradeCount += 1;
    return {
      ...trade,
      mistakes: nextMistakes
    };
  });

  return {
    trades: changed ? nextTrades : trades,
    changed,
    taggedTradeCount
  };
};

export const backfillSecondTargetMissedTradeSessions = (
  sessions: TradeSessionRecord[]
): { sessions: TradeSessionRecord[]; changed: boolean; taggedTradeCount: number } => {
  let changed = false;
  let taggedTradeCount = 0;
  const updatedAt = new Date().toISOString();

  const nextSessions = sessions.map((session) => {
    const tradeBackfill = backfillSecondTargetMissedTrades(session.trades);
    if (!tradeBackfill.changed) {
      return session;
    }

    changed = true;
    taggedTradeCount += tradeBackfill.taggedTradeCount;
    return {
      ...session,
      trades: tradeBackfill.trades,
      updatedAt
    };
  });

  return {
    sessions: changed ? nextSessions : sessions,
    changed,
    taggedTradeCount
  };
};
