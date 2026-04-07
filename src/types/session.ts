import type { GroupedTrade } from "./trade";

export interface TradeSessionRecord {
  tradeDate: string;
  trades: GroupedTrade[];
  sourceFileName: string;
  importedAt: string;
  updatedAt: string;
}
