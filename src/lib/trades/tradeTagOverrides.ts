import type { GroupedTrade } from "../../types/trade";
import type {
  EditableTradeRow,
  EditableTradeTagField,
  TradeTagOverrideRecord
} from "../../types/tradeTags";

const hasOwn = <T extends object>(value: T, key: keyof T): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

export const getTradeOverrideKey = (trade: Pick<GroupedTrade, "tradeDate" | "symbol" | "openTime" | "closeTime">): string =>
  `${trade.tradeDate}__${trade.symbol}__${trade.openTime}__${trade.closeTime}`;

export const applyTradeTagOverrides = (
  trades: GroupedTrade[],
  overrides: TradeTagOverrideRecord[]
): EditableTradeRow[] => {
  const overridesByKey = new Map(overrides.map((override) => [override.key, override]));

  return trades.map((trade) => {
    const overrideKey = getTradeOverrideKey(trade);
    const override = overridesByKey.get(overrideKey);

    if (!override) {
      return {
        ...trade,
        overrideKey,
        manualTags: {}
      };
    }

    const nextTrade: EditableTradeRow = {
      ...trade,
      overrideKey,
      manualTags: {
        status: hasOwn(override, "status"),
        mistake: hasOwn(override, "mistake"),
        playbook: hasOwn(override, "playbook"),
        game: hasOwn(override, "game"),
        outTag: hasOwn(override, "outTag"),
        execution: hasOwn(override, "execution")
      }
    };

    if (hasOwn(override, "status")) {
      nextTrade.status = override.status ?? trade.status;
    }

    if (hasOwn(override, "mistake")) {
      nextTrade.mistakes = override.mistake ? [override.mistake] : [];
    }

    if (hasOwn(override, "playbook")) {
      nextTrade.setups = override.playbook ? [override.playbook] : [];
    }

    if (hasOwn(override, "game")) {
      nextTrade.game = override.game ?? "";
    }

    if (hasOwn(override, "outTag")) {
      nextTrade.outTag = override.outTag ? [override.outTag] : [];
    }

    if (hasOwn(override, "execution")) {
      nextTrade.execution = override.execution ? [override.execution] : [];
    }

    return nextTrade;
  });
};

export const upsertTradeTagOverride = (
  currentOverrides: TradeTagOverrideRecord[],
  trade: Pick<GroupedTrade, "tradeDate" | "symbol" | "openTime" | "closeTime">,
  field: EditableTradeTagField,
  value: string | null
): TradeTagOverrideRecord[] => {
  const key = getTradeOverrideKey(trade);
  const existing = currentOverrides.find((override) => override.key === key);
  const nextOverride: TradeTagOverrideRecord = {
    key,
    tradeDate: trade.tradeDate,
    symbol: trade.symbol,
    openTime: trade.openTime,
    closeTime: trade.closeTime,
    ...(existing ?? {}),
    updatedAt: new Date().toISOString()
  };

  switch (field) {
    case "status":
      nextOverride.status = value as TradeTagOverrideRecord["status"];
      break;
    case "mistake":
      nextOverride.mistake = value;
      break;
    case "playbook":
      nextOverride.playbook = value;
      break;
    case "game":
      nextOverride.game = value as TradeTagOverrideRecord["game"];
      break;
    case "outTag":
      nextOverride.outTag = value;
      break;
    case "execution":
      nextOverride.execution = value;
      break;
    default:
      break;
  }

  const nextOverrides = currentOverrides.filter((override) => override.key !== key);
  return [...nextOverrides, nextOverride].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
};

export const removeTradeTagOverridesForTradeDates = (
  currentOverrides: TradeTagOverrideRecord[],
  tradeDates: string[]
): TradeTagOverrideRecord[] => {
  const blockedDates = new Set(tradeDates);
  return currentOverrides.filter((override) => !blockedDates.has(override.tradeDate));
};

export const hasTradeTagOverridesForTradeDates = (
  currentOverrides: TradeTagOverrideRecord[],
  tradeDates: string[]
): boolean => {
  const allowedDates = new Set(tradeDates);
  return currentOverrides.some((override) => allowedDates.has(override.tradeDate));
};
