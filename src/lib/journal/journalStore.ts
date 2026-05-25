import type { JSONContent } from "@tiptap/core";
import { invoke, isTauri } from "@tauri-apps/api/core";
import type {
  JournalBlock,
  JournalPageRecord,
  JournalBlockType,
  JournalScreenshotTagRecord,
  JournalScreenshotTradeLink,
  JournalTradeNoteRecord
} from "../../types/journal";
import {
  createClosingChecklistDoc,
  createEmptyJournalDoc,
  createMorningChecklistDoc,
  hasJournalDocContent,
  journalBlocksToDoc
} from "./journalContent";
import { canUseMachineLegacyData, syncStores } from "../sync/syncStore";

const normalizeTradeDate = (tradeDate: string) => {
  if (!tradeDate) {
    return "";
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(tradeDate)) {
    return tradeDate;
  }

  const parsed = new Date(tradeDate);
  if (Number.isNaN(parsed.getTime())) {
    return tradeDate;
  }

  return parsed.toISOString().slice(0, 10);
};

const createBlock = (type: JournalBlockType, text: string, checked?: boolean): JournalBlock => ({
  id: `block-${Math.random().toString(36).slice(2, 10)}`,
  type,
  text,
  checked
});

const parseLegacyContent = (content: string): JournalBlock[] => {
  const lines = content.split(/\r?\n/);
  const blocks: JournalBlock[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      continue;
    }

    if (trimmed === "---") {
      blocks.push(createBlock("divider", ""));
      continue;
    }

    if (trimmed.startsWith("### ")) {
      blocks.push(createBlock("heading3", trimmed.slice(4)));
      continue;
    }

    if (trimmed.startsWith("## ")) {
      blocks.push(createBlock("heading2", trimmed.slice(3)));
      continue;
    }

    if (trimmed.startsWith("# ")) {
      blocks.push(createBlock("heading1", trimmed.slice(2)));
      continue;
    }

    if (trimmed.startsWith("- [ ] ")) {
      blocks.push(createBlock("checklist", trimmed.slice(6), false));
      continue;
    }

    if (trimmed.startsWith("- [x] ")) {
      blocks.push(createBlock("checklist", trimmed.slice(6), true));
      continue;
    }

    if (trimmed.startsWith("- ")) {
      blocks.push(createBlock("bullet", trimmed.slice(2)));
      continue;
    }

    if (trimmed.startsWith("> ")) {
      blocks.push(createBlock("quote", trimmed.slice(2)));
      continue;
    }

    blocks.push(createBlock("paragraph", trimmed));
  }

  return blocks.length > 0 ? blocks : [createBlock("paragraph", "")];
};

const ensureBlocks = (blocks?: JournalBlock[], fallbackText = "") =>
  Array.isArray(blocks) && blocks.length > 0
    ? blocks.map((block) => ({
        ...block,
        id: block.id || `block-${Math.random().toString(36).slice(2, 10)}`
      }))
    : parseLegacyContent(fallbackText);

const createDefaultScreenshotTag = (tradeDate: string): JournalScreenshotTagRecord => ({
  linkedTrades: [],
  linkedTradeId: "",
  linkedTradeDate: "",
  ticker: "",
  playbook: "",
  taggedDate: normalizeTradeDate(tradeDate)
});

const createTradeNoteId = (linkedTradeId = ""): string => {
  if (linkedTradeId) {
    return `trade-note-${linkedTradeId}`;
  }

  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `trade-note-${Math.random().toString(36).slice(2, 10)}`;
};

const createDefaultTradeNoteRecord = (tradeDate: string): JournalTradeNoteRecord => {
  const timestamp = new Date().toISOString();

  return {
    id: createTradeNoteId(),
    title: "",
    content: createEmptyJournalDoc(),
    linkedTrades: [],
    linkedTradeId: "",
    linkedTradeDate: "",
    ticker: "",
    playbook: "",
    taggedDate: normalizeTradeDate(tradeDate),
    createdAt: timestamp,
    updatedAt: timestamp
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object");

const dedupeScreenshotTradeLinks = (
  links: JournalScreenshotTradeLink[]
): JournalScreenshotTradeLink[] => {
  const unique = new Map<string, JournalScreenshotTradeLink>();
  for (const link of links) {
    if (!link.tradeId || !link.tradeDate) {
      continue;
    }

    unique.set(`${link.tradeId}::${link.tradeDate}`, link);
  }

  return Array.from(unique.values());
};

const normalizeScreenshotTradeLinks = (
  value: unknown,
  fallbackTradeDate: string
): JournalScreenshotTradeLink[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized = value
    .map((entry) => {
      if (!isRecord(entry)) {
        return null;
      }

      const tradeId = typeof entry.tradeId === "string" ? entry.tradeId.trim() : "";
      if (!tradeId) {
        return null;
      }

      const tradeDateRaw = typeof entry.tradeDate === "string" ? entry.tradeDate : fallbackTradeDate;
      const tradeDate = normalizeTradeDate(tradeDateRaw);
      if (!tradeDate) {
        return null;
      }

      return {
        tradeId,
        tradeDate
      };
    })
    .filter((entry): entry is JournalScreenshotTradeLink => entry !== null);

  return dedupeScreenshotTradeLinks(normalized);
};

const ensureContent = (
  content?: JSONContent,
  fallbackBlocks?: JournalBlock[],
  fallbackText = ""
): JSONContent => {
  if (hasJournalDocContent(content)) {
    return content as JSONContent;
  }

  if (Array.isArray(fallbackBlocks) && fallbackBlocks.length > 0) {
    return journalBlocksToDoc(fallbackBlocks);
  }

  const parsedBlocks = parseLegacyContent(fallbackText);
  return parsedBlocks.length > 0 ? journalBlocksToDoc(parsedBlocks) : createEmptyJournalDoc();
};

const normalizeJournalTradeNotes = (
  value: unknown,
  tradeDate: string,
  pageCreatedAt: string,
  pageUpdatedAt: string
): JournalTradeNoteRecord[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (!isRecord(entry)) {
        return null;
      }

      const linkedTrades = normalizeScreenshotTradeLinks(
        (entry as { linkedTrades?: unknown }).linkedTrades,
        tradeDate
      );
      const linkedTradeId = typeof entry.linkedTradeId === "string" ? entry.linkedTradeId.trim() : "";
      const linkedTradeDateRaw = typeof entry.linkedTradeDate === "string" ? entry.linkedTradeDate : "";
      const legacyLinkedTrades =
        linkedTradeId.length > 0
          ? [
              {
                tradeId: linkedTradeId,
                tradeDate: normalizeTradeDate(linkedTradeDateRaw || tradeDate)
              }
            ]
          : [];
      const normalizedLinkedTrades = dedupeScreenshotTradeLinks([...linkedTrades, ...legacyLinkedTrades]);
      const primaryLinkedTrade = normalizedLinkedTrades[0] ?? null;
      const fallback = createDefaultTradeNoteRecord(tradeDate);
      const createdAt =
        typeof entry.createdAt === "string" && entry.createdAt.trim().length > 0
          ? entry.createdAt
          : pageCreatedAt || fallback.createdAt;
      const updatedAt =
        typeof entry.updatedAt === "string" && entry.updatedAt.trim().length > 0
          ? entry.updatedAt
          : pageUpdatedAt || createdAt;

      return {
        id:
          typeof entry.id === "string" && entry.id.trim().length > 0
            ? entry.id.trim()
            : createTradeNoteId(primaryLinkedTrade?.tradeId ?? linkedTradeId),
        title: typeof entry.title === "string" ? entry.title : "",
        content: ensureContent(entry.content as JSONContent | undefined),
        linkedTrades: normalizedLinkedTrades,
        linkedTradeId: primaryLinkedTrade?.tradeId ?? "",
        linkedTradeDate: primaryLinkedTrade?.tradeDate ?? "",
        ticker: typeof entry.ticker === "string" ? entry.ticker : "",
        playbook: typeof entry.playbook === "string" ? entry.playbook : "",
        taggedDate:
          typeof entry.taggedDate === "string" && entry.taggedDate.trim().length > 0
            ? normalizeTradeDate(entry.taggedDate)
            : normalizeTradeDate(tradeDate),
        createdAt,
        updatedAt
      };
    })
    .filter((entry): entry is JournalTradeNoteRecord => entry !== null);
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

const readDocText = (content?: JSONContent): string => {
  if (!content || typeof content !== "object") {
    return "";
  }

  const nodes = Array.isArray(content.content) ? content.content : [];
  const collect = (node: JSONContent): string => {
    const ownText = "text" in node && typeof node.text === "string" ? node.text : "";
    const children = Array.isArray(node.content) ? node.content.map((child) => collect(child)).join(" ") : "";
    return `${ownText} ${children}`.trim();
  };

  return nodes
    .map((node) => collect(node))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
};

const countCheckedItems = (content?: JSONContent): number => {
  if (!content || typeof content !== "object") {
    return 0;
  }

  let checkedCount = 0;

  const visit = (node: JSONContent) => {
    const attrs = "attrs" in node && typeof node.attrs === "object" && node.attrs ? node.attrs : undefined;
    if (attrs && "checked" in attrs && attrs.checked === true) {
      checkedCount += 1;
    }

    const children = Array.isArray(node.content) ? node.content : [];
    children.forEach((child) => visit(child));
  };

  visit(content);
  return checkedCount;
};

const isDefaultMorningChecklist = (content: JSONContent): boolean =>
  stableStringify(content) === stableStringify(createMorningChecklistDoc());

const isDefaultClosingChecklist = (content: JSONContent): boolean =>
  stableStringify(content) === stableStringify(createClosingChecklistDoc());

const isEmptyJournalDoc = (content: JSONContent): boolean =>
  stableStringify(content) === stableStringify(createEmptyJournalDoc());

const getTradeNoteContentScore = (tradeNotes: JournalTradeNoteRecord[]): number =>
  tradeNotes.reduce((total, note) => {
    let score = total;

    if (!isEmptyJournalDoc(note.content) && readDocText(note.content).length > 0) {
      score += 5;
    }

    if (note.linkedTradeId.trim().length > 0) {
      score += 2;
    }

    return score;
  }, 0);

const getJournalContentScore = (page: JournalPageRecord): number => {
  let score = 0;

  if (!isEmptyJournalDoc(page.morningContent) && readDocText(page.morningContent).length > 0) {
    score += 10;
  }

  if (!isEmptyJournalDoc(page.closingContent) && readDocText(page.closingContent).length > 0) {
    score += 10;
  }

  if (!isEmptyJournalDoc(page.mppPlanContent) && readDocText(page.mppPlanContent).length > 0) {
    score += 6;
  }

  if (hasJournalDocContent(page.weeklyEarningsContent)) {
    score += 6;
  }

  if (!isEmptyJournalDoc(page.inPlayStocksContent) && readDocText(page.inPlayStocksContent).length > 0) {
    score += 6;
  }

  if (!isEmptyJournalDoc(page.traderReachOutsContent) && readDocText(page.traderReachOutsContent).length > 0) {
    score += 6;
  }

  if (!isEmptyJournalDoc(page.notesContent) && readDocText(page.notesContent).length > 0) {
    score += 6;
  }

  score += getTradeNoteContentScore(page.tradeNotes);

  if (!isDefaultMorningChecklist(page.morningChecklistContent)) {
    score += 4;
  }

  if (!isDefaultClosingChecklist(page.closingChecklistContent)) {
    score += 4;
  }

  score += Math.min(8, countCheckedItems(page.morningChecklistContent) + countCheckedItems(page.closingChecklistContent));
  score += Math.min(6, page.screenshotUrls.length * 2);

  if (page.dayGrade.trim().length > 0) {
    score += 2;
  }

  if (page.marketRegime.trim().length > 0) {
    score += 2;
  }

  if (page.mpp.trim().length > 0) {
    score += 2;
  }

  return score;
};

const getTimestamp = (value: string): number => {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeJournalPagesValue = (value: unknown): JournalPageRecord[] => {
  if (Array.isArray(value)) {
    return value as JournalPageRecord[];
  }

  if (value && typeof value === "object" && "value" in value && Array.isArray((value as { value?: unknown }).value)) {
    return (value as { value: JournalPageRecord[] }).value;
  }

  return [];
};

const getJournalPagesScore = (pages: JournalPageRecord[]): number =>
  dedupeJournalPages(pages).reduce((total, page) => total + getJournalContentScore(page), 0);

const shouldUseDesktopJournalPagesForRecovery = (
  localPages: JournalPageRecord[],
  desktopPages: JournalPageRecord[]
): boolean => {
  if (desktopPages.length === 0) {
    return false;
  }

  if (desktopPages.length > localPages.length) {
    return true;
  }

  if (desktopPages.length < localPages.length) {
    return false;
  }

  return getJournalPagesScore(desktopPages) > getJournalPagesScore(localPages);
};

const readJournalPagesFromDesktopBackup = async (): Promise<JournalPageRecord[] | null> => {
  try {
    const pages = await invoke<unknown>("load_journal_pages");
    return normalizeJournalPagesValue(pages);
  } catch {
    return null;
  }
};

const shouldReplacePage = (existing: JournalPageRecord, candidate: JournalPageRecord): boolean => {
  const existingScore = getJournalContentScore(existing);
  const candidateScore = getJournalContentScore(candidate);

  if (candidateScore !== existingScore) {
    return candidateScore > existingScore;
  }

  return getTimestamp(candidate.updatedAt) >= getTimestamp(existing.updatedAt);
};

type LegacyCarryForwardField = "inPlayStocksContent" | "traderReachOutsContent";

const findLegacyCarryForwardSourcePage = (
  pages: JournalPageRecord[],
  tradeDate: string,
  field: LegacyCarryForwardField
): JournalPageRecord | null => {
  const priorPages = pages
    .filter((page) => page.tradeDate < tradeDate)
    .sort((left, right) => right.tradeDate.localeCompare(left.tradeDate));

  const withContent = priorPages.find((page) => hasJournalDocContent(page[field]));
  return withContent ?? priorPages[0] ?? null;
};

const hasManualJournalSignals = (page: JournalPageRecord): boolean => {
  if (page.screenshotUrls.length > 0) {
    return true;
  }

  if (page.tradeNotes.length > 0) {
    return true;
  }

  if (
    page.dayGrade.trim().length > 0 ||
    page.marketRegime.trim().length > 0 ||
    page.mpp.trim().length > 0 ||
    page.sleepHours.trim().length > 0 ||
    page.sleepScore.trim().length > 0 ||
    page.morningMood.trim().length > 0 ||
    page.openMood.trim().length > 0 ||
    page.afternoonMood.trim().length > 0 ||
    page.closeMood.trim().length > 0
  ) {
    return true;
  }

  return !(
    isEmptyJournalDoc(page.morningContent) &&
    isEmptyJournalDoc(page.closingContent) &&
    isEmptyJournalDoc(page.notesContent)
  );
};

const isLikelyUntouchedGeneratedPage = (page: JournalPageRecord): boolean => {
  if (hasManualJournalSignals(page)) {
    return false;
  }

  const createdAt = getTimestamp(page.createdAt);
  const updatedAt = getTimestamp(page.updatedAt);

  return createdAt > 0 && updatedAt > 0 && updatedAt <= createdAt + 1000;
};

const stripLegacyCarriedForwardSections = (pages: JournalPageRecord[]): JournalPageRecord[] => {
  const pagesAsc = [...pages].sort((left, right) => left.tradeDate.localeCompare(right.tradeDate));
  let changed = false;

  const nextPages = pagesAsc.map((page, index) => {
    const priorPages = pagesAsc.slice(0, index);
    const matchingLegacyFields = (["inPlayStocksContent", "traderReachOutsContent"] as const).filter((field) => {
      const sourcePage = findLegacyCarryForwardSourcePage(priorPages, page.tradeDate, field);
      if (!sourcePage || !hasJournalDocContent(sourcePage[field]) || !hasJournalDocContent(page[field])) {
        return false;
      }

      return stableStringify(sourcePage[field]) === stableStringify(page[field]);
    });

    const shouldStripLegacyCarryForward =
      isLikelyUntouchedGeneratedPage(page) ||
      (!hasManualJournalSignals(page) && matchingLegacyFields.length === 2);

    if (!shouldStripLegacyCarryForward || matchingLegacyFields.length === 0) {
      return page;
    }

    changed = true;

    return matchingLegacyFields.reduce(
      (nextPage, field) => ({
        ...nextPage,
        [field]: createEmptyJournalDoc()
      }),
      page
    );
  });

  return changed ? nextPages : pages;
};

const normalizeJournalPage = (
  page: JournalPageRecord & {
    content?: string;
    morningJournal?: string;
    closingChecklistContent?: JSONContent;
    morningChecklistContent?: JSONContent;
    closingJournal?: string;
    mppPlan?: string;
    morningContent?: JSONContent;
    closingContent?: JSONContent;
    mppPlanContent?: JSONContent;
    weeklyEarningsContent?: JSONContent;
    inPlayStocksContent?: JSONContent;
    traderReachOutsContent?: JSONContent;
    notesContent?: JSONContent;
    sleepHours?: string;
    sleepScore?: string;
    morningMood?: string;
    openMood?: string;
    afternoonMood?: string;
    closeMood?: string;
    marketRegime?: string;
    screenshotTags?: unknown;
    tradeNotes?: unknown;
  }
): JournalPageRecord => {
  const morningBlocks = ensureBlocks(page.morningBlocks, page.morningJournal ?? "");
  const closingBlocks = ensureBlocks(page.closingBlocks, page.closingJournal ?? "");
  const mppPlanBlocks = ensureBlocks(page.mppPlanBlocks, page.mppPlan ?? "");
  const blocks = ensureBlocks(page.blocks, page.content ?? "");
  const screenshotUrls = Array.isArray((page as { screenshotUrls?: unknown }).screenshotUrls)
    ? ((page as { screenshotUrls?: unknown[] }).screenshotUrls ?? []).filter(
        (value): value is string => typeof value === "string" && value.trim().length > 0
      )
    : [];
  const rawScreenshotTags = Array.isArray((page as { screenshotTags?: unknown }).screenshotTags)
    ? ((page as { screenshotTags?: unknown[] }).screenshotTags ?? [])
    : [];
  const tradeNotes = normalizeJournalTradeNotes(
    (page as { tradeNotes?: unknown }).tradeNotes,
    page.tradeDate,
    page.createdAt,
    page.updatedAt
  );
  const screenshotTags = screenshotUrls.map((_, index) => {
    const raw = rawScreenshotTags[index];
    if (!isRecord(raw)) {
      return createDefaultScreenshotTag(page.tradeDate);
    }

    const legacyLinkedTradeId = typeof raw.linkedTradeId === "string" ? raw.linkedTradeId.trim() : "";
    const legacyLinkedTradeDateRaw = typeof raw.linkedTradeDate === "string" ? raw.linkedTradeDate : "";
    const legacyLinkedTradeDate = normalizeTradeDate(legacyLinkedTradeDateRaw || page.tradeDate);
    const normalizedLinkedTrades = normalizeScreenshotTradeLinks(raw.linkedTrades, normalizeTradeDate(page.tradeDate));
    const linkedTrades = dedupeScreenshotTradeLinks([
      ...normalizedLinkedTrades,
      ...(legacyLinkedTradeId && legacyLinkedTradeDate
        ? [
            {
              tradeId: legacyLinkedTradeId,
              tradeDate: legacyLinkedTradeDate
            }
          ]
        : [])
    ]);
    const primaryLinkedTrade = linkedTrades[0] ?? null;

    return {
      linkedTrades,
      linkedTradeId: primaryLinkedTrade?.tradeId ?? createDefaultScreenshotTag(page.tradeDate).linkedTradeId,
      linkedTradeDate: primaryLinkedTrade?.tradeDate ?? createDefaultScreenshotTag(page.tradeDate).linkedTradeDate,
      ticker: typeof raw.ticker === "string" ? raw.ticker : "",
      playbook: typeof raw.playbook === "string" ? raw.playbook : "",
      taggedDate:
        typeof raw.taggedDate === "string" && raw.taggedDate.trim().length > 0
          ? normalizeTradeDate(raw.taggedDate)
          : normalizeTradeDate(page.tradeDate)
    };
  });

  return {
    id: page.id,
    title: page.title || "Daily Journal",
    tradeDate: normalizeTradeDate(page.tradeDate),
    dayGrade: page.dayGrade ?? "",
    marketRegime: page.marketRegime ?? "",
    mpp: page.mpp ?? "",
    sleepHours: page.sleepHours ?? "",
    sleepScore: page.sleepScore ?? "",
    morningMood: page.morningMood ?? "",
    openMood: page.openMood ?? "",
    afternoonMood: page.afternoonMood ?? "",
    closeMood: page.closeMood ?? "",
    screenshotUrls,
    screenshotTags,
    tradeNotes,
    closingChecklistContent: hasJournalDocContent(page.closingChecklistContent)
      ? (page.closingChecklistContent as JSONContent)
      : createClosingChecklistDoc(),
    morningChecklistContent: hasJournalDocContent(page.morningChecklistContent)
      ? (page.morningChecklistContent as JSONContent)
      : createMorningChecklistDoc(),
    morningContent: ensureContent(page.morningContent, morningBlocks, page.morningJournal ?? ""),
    closingContent: ensureContent(page.closingContent, closingBlocks, page.closingJournal ?? ""),
    mppPlanContent: ensureContent(page.mppPlanContent, mppPlanBlocks, page.mppPlan ?? ""),
    weeklyEarningsContent: ensureContent(page.weeklyEarningsContent),
    inPlayStocksContent: ensureContent(page.inPlayStocksContent),
    traderReachOutsContent: ensureContent(page.traderReachOutsContent),
    notesContent: ensureContent(page.notesContent, blocks, page.content ?? ""),
    morningBlocks,
    closingBlocks,
    mppPlanBlocks,
    blocks,
    createdAt: page.createdAt,
    updatedAt: page.updatedAt
  };
};

export const dedupeJournalPages = (pages: JournalPageRecord[]): JournalPageRecord[] => {
  const dedupedByDate = new Map<string, JournalPageRecord>();

  for (const page of pages.map(normalizeJournalPage)) {
    const existing = dedupedByDate.get(page.tradeDate);
    if (!existing) {
      dedupedByDate.set(page.tradeDate, page);
      continue;
    }

    if (shouldReplacePage(existing, page)) {
      dedupedByDate.set(page.tradeDate, page);
    }
  }

  return stripLegacyCarriedForwardSections(Array.from(dedupedByDate.values())).sort((left, right) =>
    right.tradeDate.localeCompare(left.tradeDate)
  );
};

type PersistedJournalPageRecord = Omit<
  JournalPageRecord,
  "morningBlocks" | "closingBlocks" | "mppPlanBlocks" | "blocks"
>;

const serializeJournalPagesForPersistence = (
  pages: JournalPageRecord[]
): PersistedJournalPageRecord[] =>
  pages.map(({ morningBlocks, closingBlocks, mppPlanBlocks, blocks, ...page }) => page);

export const loadJournalPages = async (): Promise<JournalPageRecord[]> => {
  const localPages = normalizeJournalPagesValue(syncStores.journalPages.load<unknown>([]));
  const activeUserId = syncStores.journalPages.getUserId();
  const allowLegacyDesktopBackup = canUseMachineLegacyData(activeUserId);

  if (!allowLegacyDesktopBackup) {
    return localPages;
  }

  const desktopPages = await readJournalPagesFromDesktopBackup();

  if (desktopPages && shouldUseDesktopJournalPagesForRecovery(localPages, desktopPages)) {
    const dedupedPages = dedupeJournalPages(desktopPages);
    return dedupedPages;
  }

  return localPages;
};

export const saveJournalPages = async (pages: JournalPageRecord[]): Promise<void> => {
  const dedupedPages = dedupeJournalPages(pages);
  const persistedPages = serializeJournalPagesForPersistence(dedupedPages);
  const syncPromise = syncStores.journalPages.save(persistedPages);

  const activeUserId = syncStores.journalPages.getUserId();
  if (!canUseMachineLegacyData(activeUserId)) {
    await syncPromise;
    return;
  }

  const desktopPages = await readJournalPagesFromDesktopBackup();
  if (desktopPages && shouldUseDesktopJournalPagesForRecovery(dedupedPages, desktopPages)) {
    console.warn("[journal] Skipped lossy desktop journal write to protect richer backup.");
    return;
  }

  try {
    await invoke("save_journal_pages", { pages: persistedPages });
  } catch (error) {
    if (isTauri()) {
      console.warn("[journal] Failed to save desktop journal backup.", error);
    }
  }

  await syncPromise;
};
