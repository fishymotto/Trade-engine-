import type { GroupedTrade } from "../../types/trade";
import type { MPPDayRecord } from "./mppAnalytics";
import { getTradeAssetClass, type TradeAssetClass } from "../trades/assetClassification";

interface AssetMppDayOptions {
  assetClass?: TradeAssetClass;
  currencySymbolList: string;
}

export const getMPPDayRecordsForTrades = (
  trades: GroupedTrade[],
  options: AssetMppDayOptions
): MPPDayRecord[] => {
  const dayMap = new Map<string, MPPDayRecord>();

  for (const trade of trades) {
    if (
      options.assetClass &&
      getTradeAssetClass(trade, options.currencySymbolList) !== options.assetClass
    ) {
      continue;
    }

    const tradeDate = trade.tradeDate.trim();
    if (!tradeDate) {
      continue;
    }

    const current = dayMap.get(tradeDate) ?? { tradeDate, netPnl: 0, trades: 0 };
    current.netPnl += trade.netPnlUsd || 0;
    current.trades = (current.trades ?? 0) + 1;
    dayMap.set(tradeDate, current);
  }

  return Array.from(dayMap.values())
    .map((day) => ({
      ...day,
      netPnl: Number(day.netPnl.toFixed(2))
    }))
    .sort((left, right) => left.tradeDate.localeCompare(right.tradeDate));
};
