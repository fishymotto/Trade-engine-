import type { GroupedTrade } from "../../types/trade";

const normalizePlaybookValue = (value: string): string => value.trim().toLowerCase();

export const getTradePlaybooks = (trade: GroupedTrade): string[] =>
  trade.setups.filter((value) => value.trim().length > 0);

export const getTradePlaybookOptions = (trades: GroupedTrade[]): string[] =>
  Array.from(new Set(trades.flatMap((trade) => getTradePlaybooks(trade)))).sort((left, right) =>
    left.localeCompare(right)
  );

export const tradeHasPlaybook = (trade: GroupedTrade, playbook: string): boolean => {
  const normalizedPlaybook = normalizePlaybookValue(playbook);
  if (!normalizedPlaybook) {
    return false;
  }

  return getTradePlaybooks(trade).some((value) => normalizePlaybookValue(value) === normalizedPlaybook);
};
