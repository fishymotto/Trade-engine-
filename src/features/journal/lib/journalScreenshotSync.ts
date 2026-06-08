import type { JSONContent } from "@tiptap/core";
import { createEmptyJournalDoc, hasJournalDocContent } from "../../../lib/journal/journalContent";
import { dedupeJournalPages } from "../../../lib/journal/journalStore";
import type {
  JournalPageRecord,
  JournalScreenshotTagRecord,
  JournalScreenshotTradeLink,
  JournalTradeNoteRecord
} from "../../../types/journal";
import type { TradeReviewRecord } from "../../../types/review";
import type { GroupedTrade } from "../../../types/trade";
import { normalizeJournalTradeDate } from "./journalPageActions";

export interface JournalTradeContext {
  tradeDate: string;
  symbol: string;
  playbook: string;
}

type JournalTradeNoteSyncTrade = Pick<
  GroupedTrade,
  "id" | "tradeDate" | "symbol" | "setups" | "openTime" | "closeTime" | "name"
>;

const TRADE_LINK_SEPARATOR = "::";

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

const createJournalTradeNote = (
  tradeDate: string,
  overrides: Partial<JournalTradeNoteRecord> = {}
): JournalTradeNoteRecord => {
  const timestamp = overrides.updatedAt ?? overrides.createdAt ?? new Date().toISOString();
  const linkedTradeId = overrides.linkedTradeId?.trim() ?? "";
  const linkedTradeDate = normalizeJournalTradeDate(overrides.linkedTradeDate ?? tradeDate);
  const linkedTrades = dedupeTradeLinks([
    ...(Array.isArray(overrides.linkedTrades) ? overrides.linkedTrades : []),
    ...(linkedTradeId
      ? [
          {
            tradeId: linkedTradeId,
            tradeDate: linkedTradeDate
          }
        ]
      : [])
  ]);
  const primaryLinkedTrade = linkedTrades[0] ?? null;

  return {
    id:
      overrides.id?.trim() ||
      (primaryLinkedTrade?.tradeId
        ? `trade-note-${primaryLinkedTrade.tradeId}`
        : `trade-note-${Math.random().toString(36).slice(2, 10)}`),
    title: overrides.title ?? "",
    content: overrides.content ?? createEmptyJournalDoc(),
    linkedTrades,
    linkedTradeId: primaryLinkedTrade?.tradeId ?? "",
    linkedTradeDate: primaryLinkedTrade?.tradeDate ?? "",
    ticker: overrides.ticker ?? "",
    playbook: overrides.playbook ?? "",
    taggedDate: overrides.taggedDate ?? tradeDate,
    createdAt: overrides.createdAt ?? timestamp,
    updatedAt: overrides.updatedAt ?? timestamp
  };
};

const createTradeLinkKey = (tradeId: string, tradeDate: string) => `${tradeId}${TRADE_LINK_SEPARATOR}${tradeDate}`;

const getPrimaryTradePlaybook = (trade: Pick<GroupedTrade, "setups">): string =>
  trade.setups
    ?.map((playbook) => playbook.trim())
    .find((playbook) => playbook && playbook !== "No Setup") ?? "";

const getTradeOrderKey = (trade: JournalTradeNoteSyncTrade): string =>
  [
    normalizeJournalTradeDate(trade.tradeDate),
    trade.openTime,
    trade.closeTime,
    trade.symbol,
    trade.name,
    trade.id
  ]
    .map((value) => value?.trim() ?? "")
    .join("|");

const groupTradesByJournalDate = (
  trades: JournalTradeNoteSyncTrade[]
): Map<string, JournalTradeNoteSyncTrade[]> => {
  const grouped = new Map<string, JournalTradeNoteSyncTrade[]>();
  const seenTradeIds = new Set<string>();

  for (const trade of trades) {
    const tradeId = trade.id?.trim();
    const tradeDate = normalizeJournalTradeDate(trade.tradeDate);
    if (!tradeId || !tradeDate || seenTradeIds.has(tradeId)) {
      continue;
    }

    seenTradeIds.add(tradeId);
    grouped.set(tradeDate, [...(grouped.get(tradeDate) ?? []), trade]);
  }

  for (const [tradeDate, dateTrades] of grouped.entries()) {
    grouped.set(
      tradeDate,
      [...dateTrades].sort((left, right) => getTradeOrderKey(left).localeCompare(getTradeOrderKey(right)))
    );
  }

  return grouped;
};

const dedupeTradeLinks = (links: JournalScreenshotTradeLink[]): JournalScreenshotTradeLink[] => {
  const unique = new Map<string, JournalScreenshotTradeLink>();
  for (const link of links) {
    const tradeId = typeof link.tradeId === "string" ? link.tradeId.trim() : "";
    const tradeDate = normalizeJournalTradeDate(typeof link.tradeDate === "string" ? link.tradeDate : "");
    if (!tradeId || !tradeDate) {
      continue;
    }

    unique.set(createTradeLinkKey(tradeId, tradeDate), {
      tradeId,
      tradeDate
    });
  }

  return Array.from(unique.values());
};

const collectTradeNoteLinks = (note: JournalTradeNoteRecord | undefined): JournalScreenshotTradeLink[] => {
  if (!note) {
    return [];
  }

  return dedupeTradeLinks([
    ...(Array.isArray(note.linkedTrades) ? note.linkedTrades : []),
    ...(note.linkedTradeId?.trim() && note.linkedTradeDate?.trim()
      ? [
          {
            tradeId: note.linkedTradeId.trim(),
            tradeDate: note.linkedTradeDate.trim()
          }
        ]
      : [])
  ]);
};

const noteHasTradeLink = (
  note: JournalTradeNoteRecord,
  tradeId: string,
  tradeDate: string
): boolean => collectTradeNoteLinks(note).some((link) => createTradeLinkKey(link.tradeId, link.tradeDate) === createTradeLinkKey(tradeId, tradeDate));

const applyTradeLinksToNote = (
  note: JournalTradeNoteRecord,
  nextLinks: JournalScreenshotTradeLink[]
): JournalTradeNoteRecord => {
  const linkedTrades = dedupeTradeLinks(nextLinks);
  const primaryLinkedTrade = linkedTrades[0] ?? null;

  return {
    ...note,
    linkedTrades,
    linkedTradeId: primaryLinkedTrade?.tradeId ?? "",
    linkedTradeDate: primaryLinkedTrade?.tradeDate ?? ""
  };
};

const buildTradeLinkedNote = (
  note: JournalTradeNoteRecord,
  trade: JournalTradeNoteSyncTrade,
  timestamp: string
): JournalTradeNoteRecord => {
  const tradeDate = normalizeJournalTradeDate(trade.tradeDate);
  const tradeLink = {
    tradeId: trade.id,
    tradeDate
  };
  const linkedNote = applyTradeLinksToNote(note, [tradeLink]);
  const playbook = getPrimaryTradePlaybook(trade);

  return {
    ...linkedNote,
    ticker: linkedNote.ticker || trade.symbol,
    playbook: linkedNote.playbook || playbook,
    taggedDate: normalizeJournalTradeDate(linkedNote.taggedDate) || tradeDate,
    updatedAt: timestamp
  };
};

const createTradeLinkedNote = (
  tradeDate: string,
  trade: JournalTradeNoteSyncTrade,
  timestamp: string
): JournalTradeNoteRecord =>
  createJournalTradeNote(tradeDate, {
    linkedTrades: [
      {
        tradeId: trade.id,
        tradeDate
      }
    ],
    linkedTradeId: trade.id,
    linkedTradeDate: tradeDate,
    ticker: trade.symbol,
    playbook: getPrimaryTradePlaybook(trade),
    taggedDate: tradeDate,
    createdAt: timestamp,
    updatedAt: timestamp
  });

const getTradeNoteOrderRank = (
  note: JournalTradeNoteRecord,
  tradeOrderByLink: Map<string, number>
): number => {
  const linkRanks = collectTradeNoteLinks(note)
    .map((link) => tradeOrderByLink.get(createTradeLinkKey(link.tradeId, link.tradeDate)))
    .filter((rank): rank is number => typeof rank === "number");

  return linkRanks.length > 0 ? Math.min(...linkRanks) : Number.MAX_SAFE_INTEGER;
};

const sortTradeNotesByTradeOrder = (
  tradeNotes: JournalTradeNoteRecord[],
  orderedTrades: JournalTradeNoteSyncTrade[]
): JournalTradeNoteRecord[] => {
  const tradeOrderByLink = new Map<string, number>();
  orderedTrades.forEach((trade, index) => {
    tradeOrderByLink.set(createTradeLinkKey(trade.id, normalizeJournalTradeDate(trade.tradeDate)), index);
  });

  return tradeNotes
    .map((note, index) => ({
      note,
      index,
      rank: getTradeNoteOrderRank(note, tradeOrderByLink)
    }))
    .sort((left, right) => left.rank - right.rank || left.index - right.index)
    .map((entry) => entry.note);
};

const hasSameTradeNoteOrder = (
  left: JournalTradeNoteRecord[],
  right: JournalTradeNoteRecord[]
): boolean =>
  left.length === right.length && left.every((note, index) => note.id === right[index]?.id);

const syncTradeNotesFromTrades = (
  page: JournalPageRecord,
  orderedTrades: JournalTradeNoteSyncTrade[]
): { tradeNotes: JournalTradeNoteRecord[]; changed: boolean } => {
  if (orderedTrades.length === 0) {
    return { tradeNotes: page.tradeNotes, changed: false };
  }

  const timestamp = new Date().toISOString();
  const pageTradeDate = normalizeJournalTradeDate(page.tradeDate);
  let changed = false;
  const tradeNotes = [...page.tradeNotes];
  const claimedUnlinkedNoteIndexes = new Set<number>();

  for (const trade of orderedTrades) {
    const tradeDate = normalizeJournalTradeDate(trade.tradeDate);
    const linkedNoteIndex = tradeNotes.findIndex((note) => noteHasTradeLink(note, trade.id, tradeDate));
    if (linkedNoteIndex >= 0) {
      const linkedNote = tradeNotes[linkedNoteIndex];
      if (!linkedNote) {
        continue;
      }

      const playbook = getPrimaryTradePlaybook(trade);
      const nextLinkedNote: JournalTradeNoteRecord = {
        ...linkedNote,
        linkedTradeId: linkedNote.linkedTradeId || trade.id,
        linkedTradeDate: normalizeJournalTradeDate(linkedNote.linkedTradeDate) || tradeDate,
        ticker: linkedNote.ticker || trade.symbol,
        playbook: linkedNote.playbook || playbook,
        taggedDate: normalizeJournalTradeDate(linkedNote.taggedDate) || tradeDate
      };

      if (stableStringify(linkedNote) !== stableStringify(nextLinkedNote)) {
        tradeNotes[linkedNoteIndex] = {
          ...nextLinkedNote,
          updatedAt: timestamp
        };
        changed = true;
      }
      continue;
    }

    const reusableNoteIndex = tradeNotes.findIndex(
      (note, index) =>
        !claimedUnlinkedNoteIndexes.has(index) &&
        collectTradeNoteLinks(note).length === 0 &&
        (normalizeJournalTradeDate(note.taggedDate) || pageTradeDate) === pageTradeDate
    );

    if (reusableNoteIndex >= 0) {
      const reusableNote = tradeNotes[reusableNoteIndex];
      if (!reusableNote) {
        continue;
      }

      tradeNotes[reusableNoteIndex] = buildTradeLinkedNote(reusableNote, trade, timestamp);
      claimedUnlinkedNoteIndexes.add(reusableNoteIndex);
      changed = true;
      continue;
    }

    tradeNotes.push(createTradeLinkedNote(tradeDate, trade, timestamp));
    changed = true;
  }

  const sortedTradeNotes = sortTradeNotesByTradeOrder(tradeNotes, orderedTrades);
  if (!hasSameTradeNoteOrder(tradeNotes, sortedTradeNotes)) {
    changed = true;
  }

  return {
    tradeNotes: sortedTradeNotes,
    changed
  };
};

const consolidateTradeNoteGroup = (
  tradeNotes: JournalTradeNoteRecord[],
  targetIndex: number
): { tradeNotes: JournalTradeNoteRecord[]; targetIndex: number; changed: boolean } => {
  const targetNote = tradeNotes[targetIndex];
  if (!targetNote || !hasJournalDocContent(targetNote.content)) {
    return { tradeNotes, targetIndex, changed: false };
  }

  const matchingIndexes = tradeNotes
    .map((note, index) =>
      index !== targetIndex && hasJournalDocContent(note.content) && contentMatches(note.content, targetNote.content)
        ? index
        : -1
    )
    .filter((index) => index >= 0);

  if (matchingIndexes.length === 0) {
    return { tradeNotes, targetIndex, changed: false };
  }

  const mergedNotes = [targetNote, ...matchingIndexes.map((index) => tradeNotes[index]).filter(Boolean)];
  const mergedLinks = dedupeTradeLinks(mergedNotes.flatMap((note) => collectTradeNoteLinks(note)));
  const mergedNote = applyTradeLinksToNote(targetNote, mergedLinks);
  const earliestCreatedAt = mergedNotes.reduce(
    (current, note) => (parseTimestamp(note.createdAt) < parseTimestamp(current) ? note.createdAt : current),
    targetNote.createdAt
  );
  const latestUpdatedAt = mergedNotes.reduce(
    (current, note) => (parseTimestamp(note.updatedAt) > parseTimestamp(current) ? note.updatedAt : current),
    targetNote.updatedAt
  );
  const fallbackTicker = mergedNotes.map((note) => note.ticker.trim()).find(Boolean) ?? "";
  const fallbackPlaybook = mergedNotes.map((note) => note.playbook.trim()).find(Boolean) ?? "";
  const fallbackTaggedDate = mergedNotes.map((note) => note.taggedDate.trim()).find(Boolean) ?? targetNote.taggedDate;
  const nextTradeNotes = tradeNotes.filter((_, index) => index === targetIndex || !matchingIndexes.includes(index));
  const nextTargetIndex = nextTradeNotes.findIndex((note) => note.id === targetNote.id);
  nextTradeNotes[nextTargetIndex] = {
    ...mergedNote,
    ticker: mergedNote.ticker || fallbackTicker,
    playbook: mergedNote.playbook || fallbackPlaybook,
    taggedDate: mergedNote.taggedDate || fallbackTaggedDate,
    createdAt: earliestCreatedAt,
    updatedAt: latestUpdatedAt
  };

  return {
    tradeNotes: nextTradeNotes,
    targetIndex: nextTargetIndex,
    changed: true
  };
};

const stableStringify = (value: unknown): string => {
  if (value === null || value === undefined) {
    return JSON.stringify(value);
  }

  if (typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
};

const createJournalDocFromPlainText = (text: string): JSONContent => {
  const normalized = text.replace(/\r\n/g, "\n");
  if (!normalized.trim()) {
    return createEmptyJournalDoc();
  }

  return {
    type: "doc",
    content: normalized.split("\n").map((line) =>
      line.trim()
        ? ({ type: "paragraph", content: [{ type: "text", text: line }] } satisfies JSONContent)
        : ({ type: "paragraph" } satisfies JSONContent)
    )
  };
};

const normalizeReviewNotesContent = (value: TradeReviewRecord["notes"]): JSONContent => {
  if (hasJournalDocContent(value as JSONContent)) {
    return value as JSONContent;
  }

  if (typeof value === "string") {
    return createJournalDocFromPlainText(value);
  }

  return createEmptyJournalDoc();
};

const contentMatches = (left: JSONContent, right: JSONContent): boolean =>
  stableStringify(left) === stableStringify(right);

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

export const recoverReviewNotesFromJournalPages = (
  pages: JournalPageRecord[]
): Map<string, { content: JSONContent; updatedAt: string }> => {
  const recovered = new Map<string, { content: JSONContent; updatedAt: string }>();

  for (const page of pages) {
    for (const note of page.tradeNotes) {
      const links = collectTradeNoteLinks(note);
      if (links.length === 0 || !hasJournalDocContent(note.content)) {
        continue;
      }

      for (const link of links) {
        const current = recovered.get(link.tradeId);
        if (!current || parseTimestamp(note.updatedAt) >= parseTimestamp(current.updatedAt)) {
          recovered.set(link.tradeId, {
            content: note.content,
            updatedAt: note.updatedAt
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
  const recoveredScreenshotsByTradeId = recoverReviewScreenshotsFromJournalPages(journalPages);
  const recoveredNotesByTradeId = recoverReviewNotesFromJournalPages(journalPages);
  if (recoveredScreenshotsByTradeId.size === 0 && recoveredNotesByTradeId.size === 0) {
    return currentReviews;
  }

  const next = [...currentReviews];
  const indexByTradeId = new Map<string, number>(next.map((review, index) => [review.tradeId, index]));
  let changed = false;

  for (const [tradeId, recovered] of recoveredScreenshotsByTradeId.entries()) {
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
      indexByTradeId.set(tradeId, next.length - 1);
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

  for (const [tradeId, recovered] of recoveredNotesByTradeId.entries()) {
    const reviewIndex = indexByTradeId.get(tradeId);
    if (reviewIndex === undefined) {
      next.push({
        tradeId,
        notes: recovered.content,
        chartContext: "",
        screenshotUrl: recoveredScreenshotsByTradeId.get(tradeId)?.screenshotUrl ?? "",
        drawings: [],
        updatedAt: recovered.updatedAt
      });
      indexByTradeId.set(tradeId, next.length - 1);
      changed = true;
      continue;
    }

    const existing = next[reviewIndex];
    if (!existing) {
      continue;
    }

    const existingNotes = normalizeReviewNotesContent(existing.notes);
    if (
      parseTimestamp(recovered.updatedAt) <= parseTimestamp(existing.updatedAt) ||
      contentMatches(existingNotes, recovered.content)
    ) {
      continue;
    }

    next[reviewIndex] = {
      ...existing,
      notes: recovered.content,
      updatedAt: recovered.updatedAt
    };
    changed = true;
  }

  return changed ? next : currentReviews;
};

export const syncJournalPagesFromTradeReviews = (
  currentPages: JournalPageRecord[],
  tradeReviews: TradeReviewRecord[],
  tradeContextById: Map<string, JournalTradeContext>,
  trades: JournalTradeNoteSyncTrade[] = []
): JournalPageRecord[] => {
  const next = [...currentPages];
  let changed = false;
  const tradesByDate = groupTradesByJournalDate(trades);
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
      const nextUpdatedAt =
        parseTimestamp(review.updatedAt) > parseTimestamp(page.updatedAt)
          ? review.updatedAt
          : new Date().toISOString();

      next[pageIndex] = {
        ...page,
        screenshotUrls,
        screenshotTags,
        updatedAt: nextUpdatedAt
      };
      changed = true;
    }
  }

  for (const [tradeDate, orderedTrades] of tradesByDate.entries()) {
    const pageIndex = indexByTradeDate.get(tradeDate);
    if (pageIndex === undefined) {
      continue;
    }

    const page = next[pageIndex];
    if (!page) {
      continue;
    }

    const syncedTradeNotes = syncTradeNotesFromTrades(page, orderedTrades);
    if (!syncedTradeNotes.changed) {
      continue;
    }

    next[pageIndex] = {
      ...page,
      tradeNotes: syncedTradeNotes.tradeNotes,
      updatedAt: new Date().toISOString()
    };
    changed = true;
  }

  for (const review of tradeReviews) {
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

    const reviewNotes = normalizeReviewNotesContent(review.notes);
    const reviewTimestamp = parseTimestamp(review.updatedAt);
    const reviewLink = {
      tradeId: review.tradeId,
      tradeDate
    };
    let tradeNotes = [...page.tradeNotes];
    let pageChanged = false;
    let targetIndex = tradeNotes.findIndex((note) => noteHasTradeLink(note, review.tradeId, tradeDate));

    if (targetIndex === -1) {
      if (!hasJournalDocContent(reviewNotes)) {
        continue;
      }

      const mergeCandidateIndex = tradeNotes.findIndex(
        (note) => hasJournalDocContent(note.content) && contentMatches(note.content, reviewNotes)
      );

      if (mergeCandidateIndex === -1) {
        tradeNotes.push(
          createJournalTradeNote(tradeDate, {
            id: `trade-note-${review.tradeId}`,
            content: reviewNotes,
            linkedTrades: [reviewLink],
            linkedTradeId: review.tradeId,
            linkedTradeDate: tradeDate,
            ticker: fromTradeMap?.symbol ?? parsed?.symbol ?? "",
            playbook: fromTradeMap?.playbook ?? "",
            taggedDate: tradeDate,
            createdAt: review.updatedAt,
            updatedAt: review.updatedAt
          })
        );
        targetIndex = tradeNotes.length - 1;
        pageChanged = true;
      } else {
        const existingNote = tradeNotes[mergeCandidateIndex];
        if (!existingNote) {
          continue;
        }

        const nextLinks = dedupeTradeLinks([...collectTradeNoteLinks(existingNote), reviewLink]);
        const nextLinkedNote = applyTradeLinksToNote(existingNote, nextLinks);
        const nextTicker = nextLinkedNote.ticker || fromTradeMap?.symbol || parsed?.symbol || "";
        const nextPlaybook = nextLinkedNote.playbook || fromTradeMap?.playbook || "";
        const nextUpdatedAt =
          reviewTimestamp > parseTimestamp(existingNote.updatedAt) ? review.updatedAt : existingNote.updatedAt;

        if (
          nextLinks.length !== collectTradeNoteLinks(existingNote).length ||
          nextTicker !== existingNote.ticker ||
          nextPlaybook !== existingNote.playbook ||
          nextUpdatedAt !== existingNote.updatedAt
        ) {
          tradeNotes[mergeCandidateIndex] = {
            ...nextLinkedNote,
            ticker: nextTicker,
            playbook: nextPlaybook,
            updatedAt: nextUpdatedAt
          };
          pageChanged = true;
        }

        targetIndex = mergeCandidateIndex;
      }
    } else {
      const existingNote = tradeNotes[targetIndex];
      if (!existingNote) {
        continue;
      }

      const notesDiffer = !contentMatches(existingNote.content, reviewNotes);
      const shouldHydrateEmptyNote =
        !hasJournalDocContent(existingNote.content) &&
        hasJournalDocContent(reviewNotes) &&
        notesDiffer;
      const shouldUpdateContent =
        shouldHydrateEmptyNote ||
        (reviewTimestamp > parseTimestamp(existingNote.updatedAt) && notesDiffer);
      const nextLinks = dedupeTradeLinks([...collectTradeNoteLinks(existingNote), reviewLink]);
      const nextLinkedNote = applyTradeLinksToNote(existingNote, nextLinks);
      const nextTicker = nextLinkedNote.ticker || fromTradeMap?.symbol || parsed?.symbol || "";
      const nextPlaybook = nextLinkedNote.playbook || fromTradeMap?.playbook || "";
      const needsMetadataRepair =
        nextLinkedNote.linkedTradeId !== existingNote.linkedTradeId ||
        nextLinkedNote.linkedTradeDate !== existingNote.linkedTradeDate ||
        nextLinkedNote.linkedTrades.length !== collectTradeNoteLinks(existingNote).length ||
        nextTicker !== existingNote.ticker ||
        nextPlaybook !== existingNote.playbook;

      if (shouldUpdateContent || needsMetadataRepair) {
        tradeNotes[targetIndex] = {
          ...nextLinkedNote,
          content: shouldUpdateContent ? reviewNotes : existingNote.content,
          ticker: nextTicker,
          playbook: nextPlaybook,
          updatedAt: shouldUpdateContent ? review.updatedAt : existingNote.updatedAt
        };
        pageChanged = true;
      }
    }

    const consolidated = consolidateTradeNoteGroup(tradeNotes, targetIndex);
    if (consolidated.changed) {
      tradeNotes = consolidated.tradeNotes;
      targetIndex = consolidated.targetIndex;
      pageChanged = true;
    }

    if (!pageChanged) {
      continue;
    }

    next[pageIndex] = {
      ...page,
      tradeNotes,
      updatedAt:
        reviewTimestamp > parseTimestamp(page.updatedAt)
          ? review.updatedAt
          : page.updatedAt
    };
    changed = true;
  }

  return changed ? dedupeJournalPages(next) : currentPages;
};
