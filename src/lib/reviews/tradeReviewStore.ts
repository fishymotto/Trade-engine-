import type { TradeReviewRecord } from "../../types/review";
import { syncStores } from "../sync/syncStore";

export const loadTradeReviews = (): TradeReviewRecord[] => {
  const parsed = syncStores.tradeReviews.load<TradeReviewRecord[]>([]);
  return Array.isArray(parsed) ? parsed : [];
};

export const saveTradeReviews = (reviews: TradeReviewRecord[]): void => {
  void syncStores.tradeReviews.save(reviews);
};
