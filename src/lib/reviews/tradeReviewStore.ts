import type { TradeReviewRecord } from "../../types/review";

const STORAGE_KEY = "trade-engine-trade-reviews";

export const loadTradeReviews = (): TradeReviewRecord[] => {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as TradeReviewRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const saveTradeReviews = (reviews: TradeReviewRecord[]): void => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(reviews));
};
