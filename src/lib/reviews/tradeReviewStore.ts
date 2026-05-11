import { invoke, isTauri } from "@tauri-apps/api/core";
import type { TradeReviewRecord } from "../../types/review";
import { canUseMachineLegacyData, syncStores } from "../sync/syncStore";

const normalizeTradeReviews = (value: unknown): TradeReviewRecord[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is TradeReviewRecord => Boolean(entry && typeof entry === "object"));
};

const getSerializedSize = (value: unknown): number => {
  try {
    return JSON.stringify(value).length;
  } catch {
    return 0;
  }
};

const getLatestTimestamp = (reviews: TradeReviewRecord[]): number =>
  reviews.reduce((latest, review) => {
    const parsed = Date.parse(review.updatedAt || "");
    return Number.isFinite(parsed) ? Math.max(latest, parsed) : latest;
  }, 0);

const shouldUseDesktopTradeReviewsForRecovery = (
  localReviews: TradeReviewRecord[],
  desktopReviews: TradeReviewRecord[]
): boolean => {
  if (desktopReviews.length === 0) {
    return false;
  }

  if (localReviews.length === 0) {
    return true;
  }

  if (desktopReviews.length > localReviews.length) {
    return true;
  }

  const localSize = getSerializedSize(localReviews);
  const desktopSize = getSerializedSize(desktopReviews);
  if (desktopSize > localSize) {
    return true;
  }

  return getLatestTimestamp(desktopReviews) > getLatestTimestamp(localReviews) && desktopSize >= localSize;
};

const loadTradeReviewsFromLocalStorage = (): TradeReviewRecord[] => {
  const parsed = syncStores.tradeReviews.load<TradeReviewRecord[]>([]);
  return Array.isArray(parsed) ? parsed : [];
};

const loadTradeReviewsFromDesktopBackup = async (): Promise<TradeReviewRecord[] | null> => {
  if (!isTauri()) {
    return null;
  }

  try {
    const reviews = await invoke<unknown>("load_trade_reviews");
    return normalizeTradeReviews(reviews);
  } catch {
    return null;
  }
};

export const loadTradeReviews = async (): Promise<TradeReviewRecord[]> => {
  const localReviews = loadTradeReviewsFromLocalStorage();
  const activeUserId = syncStores.tradeReviews.getUserId();
  if (!canUseMachineLegacyData(activeUserId)) {
    return localReviews;
  }

  const desktopReviews = await loadTradeReviewsFromDesktopBackup();
  if (!desktopReviews || !shouldUseDesktopTradeReviewsForRecovery(localReviews, desktopReviews)) {
    return localReviews;
  }

  return desktopReviews;
};

export const saveTradeReviews = async (reviews: TradeReviewRecord[]): Promise<void> => {
  const syncPromise = syncStores.tradeReviews.save(reviews);
  const activeUserId = syncStores.tradeReviews.getUserId();

  if (isTauri() && canUseMachineLegacyData(activeUserId)) {
    try {
      await invoke("save_trade_reviews", { reviews });
    } catch (error) {
      console.warn("[reviews] Failed to save desktop trade review backup.", error);
    }
  }

  await syncPromise;
};
