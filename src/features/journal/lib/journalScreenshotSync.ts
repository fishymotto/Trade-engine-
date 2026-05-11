import { dedupeJournalPages } from "../../../lib/journal/journalStore";
import type { JournalPageRecord, JournalScreenshotTagRecord, JournalScreenshotTradeLink } from "../../../types/journal";
import type { TradeReviewRecord } from "../../../types/review";
import type { GroupedTrade } from "../../../types/trade";
import { normalizeJournalTradeDate } from "./journalPageActions";

export interface JournalTradeContext {
  tradeDate: string;
  symbol: string;
  playbook: string;
}

const parseTimestamp = (value: string): number => {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const createJournalScreenshotTag = (tradeDate: string): JournalScreenshotTagRecord => ({
  linkedTrades: [],
  linkedTradeId: "",
  linkedTradeDate: "",
  ticker: "",
  playbook: "",
  taggedDate: tradeDate
});

const parseTradeContextFromTradeId = (
  tradeId: string
): { tradeDate: string; symbol: string } | null => {
  const match = tradeId.match(/^(?<symbol>[A-Z0-9]+)-(?<tradeDate>\d{4}-\d{2}-\d{2})-/);
  if (!match?.groups?.tradeDate || !match.groups.symbol) {
    return null;
  }

  return {
    tradeDate: match.groups.tradeDate,
    symbol: match.groups.symbol
  };
};

export const collectScreenshotLinks = (
  screenshotTag: JournalScreenshotTagRecord | undefined
): JournalScreenshotTradeLink[] => {
  if (!screenshotTag) {
    return [];
  }

  const fromLinkedTrades = Array.isArray(screenshotTag.linkedTrades)
    ? screenshotTag.linkedTrades.filter(
        (link) =>
          Boolean(link) &&
          typeof link.tradeId === "string" &&
          link.tradeId.trim().length > 0 &&
          typeof link.tradeDate === "string" &&
          link.tradeDate.trim().length > 0
      )
    : [];

  const legacyLink =
    screenshotTag.linkedTradeId?.trim() && screenshotTag.linkedTradeDate?.trim()
      ? [
          {
            tradeId: screenshotTag.linkedTradeId.trim(),
            tradeDate: screenshotTag.linkedTradeDate.trim()
          }
        ]
      : [];

  const deduped = new Map<string, JournalScreenshotTradeLink>();
  for (const link of [...fromLinkedTrades, ...legacyLink]) {
    deduped.set(`${link.tradeId}::${link.tradeDate}`, link);
  }

  return Array.from(deduped.values());
};

export const recoverReviewScreenshotsFromJournalPages = (
  pages: JournalPageRecord[]
): Map<string, { screenshotUrl: string; updatedAt: string }> => {
  const recovered = new Map<string, { screenshotUrl: string; updatedAt: string }>();

  for (const page of pages) {
    for (const [index, screenshotUrl] of page.screenshotUrls.entries()) {
      if (!screenshotUrl || typeof screenshotUrl !== "string") {
        continue;
      }

      const links = collectScreenshotLinks(page.screenshotTags[index]);
      if (links.length === 0) {
        continue;
      }

      for (const link of links) {
        const current = recovered.get(link.tradeId);
        if (!current || parseTimestamp(page.updatedAt) >= parseTimestamp(current.updatedAt)) {
          recovered.set(link.tradeId, {
            screenshotUrl,
            updatedAt: page.updatedAt
          });
        }
      }
    }
  }

  return recovered;
};

export const buildJournalTradeContextById = (
  trades: Pick<GroupedTrade, "id" | "tradeDate" | "symbol" | "setups">[]
): Map<string, JournalTradeContext> => {
  const contextById = new Map<string, JournalTradeContext>();

  for (const trade of trades) {
    contextById.set(trade.id, {
      tradeDate: normalizeJournalTradeDate(trade.tradeDate),
      symbol: trade.symbol,
      playbook: trade.setups?.[0] ?? ""
    });
  }

  return contextById;
};

export const syncTradeReviewsFromJournalPages = (
  currentReviews: TradeReviewRecord[],
  journalPages: JournalPageRecord[]
): TradeReviewRecord[] => {
  const recoveredByTradeId = recoverReviewScreenshotsFromJournalPages(journalPages);
  if (recoveredByTradeId.size === 0) {
    return currentReviews;
  }

  const next = [...currentReviews];
  const indexByTradeId = new Map<string, number>(next.map((review, index) => [review.tradeId, index]));
  let changed = false;

  for (const [tradeId, recovered] of recoveredByTradeId.entries()) {
    const reviewIndex = indexByTradeId.get(tradeId);
    if (reviewIndex === undefined) {
      next.push({
        tradeId,
        notes: "",
        chartContext: "",
        screenshotUrl: recovered.screenshotUrl,
        drawings: [],
        updatedAt: recovered.updatedAt
      });
      changed = true;
      continue;
    }

    const existing = next[reviewIndex];
    if (!existing || existing.screenshotUrl.trim().length > 0) {
      continue;
    }

    next[reviewIndex] = {
      ...existing,
      screenshotUrl: recovered.screenshotUrl,
      updatedAt:
        parseTimestamp(recovered.updatedAt) > parseTimestamp(existing.updatedAt)
          ? recovered.updatedAt
          : existing.updatedAt
    };
    changed = true;
  }

  return changed ? next : currentReviews;
};

export const syncJournalPagesFromTradeReviews = (
  currentPages: JournalPageRecord[],
  tradeReviews: TradeReviewRecord[],
  tradeContextById: Map<string, JournalTradeContext>
): JournalPageRecord[] => {
  const next = [...currentPages];
  let changed = false;
  const indexByTradeDate = new Map<string, number>(
    next.map((page, index) => [normalizeJournalTradeDate(page.tradeDate), index])
  );

  for (const review of tradeReviews) {
    if (!review.screenshotUrl || review.screenshotUrl.trim().length === 0) {
      continue;
    }

    const fromTradeMap = tradeContextById.get(review.tradeId);
    const parsed = fromTradeMap ? null : parseTradeContextFromTradeId(review.tradeId);
    const tradeDate = fromTradeMap?.tradeDate ?? parsed?.tradeDate ?? "";
    if (!tradeDate) {
      continue;
    }

    const pageIndex = indexByTradeDate.get(tradeDate);
    if (pageIndex === undefined) {
      continue;
    }

    const page = next[pageIndex];
    if (!page) {
      continue;
    }

    const screenshotUrls = [...page.screenshotUrls];
    const screenshotTags = [...page.screenshotTags];
    let pageChanged = false;

    let urlIndex = screenshotUrls.findIndex((url) => url === review.screenshotUrl);
    const hadTagAtIndexBeforeMutation =
      urlIndex >= 0 && urlIndex < screenshotTags.length && Boolean(screenshotTags[urlIndex]);

    if (urlIndex < 0) {
      screenshotUrls.push(review.screenshotUrl);
      screenshotTags.push(createJournalScreenshotTag(tradeDate));
      urlIndex = screenshotUrls.length - 1;
      pageChanged = true;
    }

    while (screenshotTags.length <= urlIndex) {
      screenshotTags.push(createJournalScreenshotTag(tradeDate));
      pageChanged = true;
    }

    const rawTag = screenshotTags[urlIndex] ?? createJournalScreenshotTag(tradeDate);
    const links = collectScreenshotLinks(rawTag);
    const hasLink = links.some(
      (link) => link.tradeId === review.tradeId && normalizeJournalTradeDate(link.tradeDate) === tradeDate
    );

    // Respect explicit Journal tag selections; only auto-link when the tag entry did not exist yet.
    if (!hasLink && !hadTagAtIndexBeforeMutation) {
      links.push({
        tradeId: review.tradeId,
        tradeDate
      });
      pageChanged = true;
    }

    const primaryLink = links[0];
    const existingTaggedDate = normalizeJournalTradeDate(rawTag.taggedDate || tradeDate);
    const nextTag: JournalScreenshotTagRecord = {
      ...rawTag,
      linkedTrades: links,
      linkedTradeId: primaryLink?.tradeId ?? rawTag.linkedTradeId,
      linkedTradeDate: primaryLink?.tradeDate ?? rawTag.linkedTradeDate,
      ticker: rawTag.ticker || fromTradeMap?.symbol || parsed?.symbol || "",
      playbook: rawTag.playbook || fromTradeMap?.playbook || "",
      taggedDate: existingTaggedDate || tradeDate
    };

    if (
      nextTag.linkedTrades.length !== (rawTag.linkedTrades?.length ?? 0) ||
      nextTag.linkedTradeId !== rawTag.linkedTradeId ||
      nextTag.linkedTradeDate !== rawTag.linkedTradeDate ||
      nextTag.ticker !== rawTag.ticker ||
      nextTag.playbook !== rawTag.playbook ||
      nextTag.taggedDate !== rawTag.taggedDate
    ) {
      screenshotTags[urlIndex] = nextTag;
      pageChanged = true;
    }

    if (pageChanged) {
      next[pageIndex] = {
        ...page,
        screenshotUrls,
        screenshotTags
      };
      changed = true;
    }
  }

  return changed ? dedupeJournalPages(next) : currentPages;
};
