import type { JSONContent } from "@tiptap/core";
import type { JournalBlock, JournalPageRecord, JournalBlockType } from "../../types/journal";
import { createEmptyJournalDoc, hasJournalDocContent, journalBlocksToDoc } from "./journalContent";

const STORAGE_KEY = "trade-engine-journal-pages";

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

const normalizeJournalPage = (
  page: JournalPageRecord & {
    content?: string;
    morningJournal?: string;
    closingJournal?: string;
    mppPlan?: string;
    morningContent?: JSONContent;
    closingContent?: JSONContent;
    mppPlanContent?: JSONContent;
    notesContent?: JSONContent;
  }
): JournalPageRecord => {
  const morningBlocks = ensureBlocks(page.morningBlocks, page.morningJournal ?? "");
  const closingBlocks = ensureBlocks(page.closingBlocks, page.closingJournal ?? "");
  const mppPlanBlocks = ensureBlocks(page.mppPlanBlocks, page.mppPlan ?? "");
  const blocks = ensureBlocks(page.blocks, page.content ?? "");

  return {
    id: page.id,
    title: page.title || "Daily Journal",
    tradeDate: normalizeTradeDate(page.tradeDate),
    dayGrade: page.dayGrade ?? "",
    mpp: page.mpp ?? "",
    morningContent: ensureContent(page.morningContent, morningBlocks, page.morningJournal ?? ""),
    closingContent: ensureContent(page.closingContent, closingBlocks, page.closingJournal ?? ""),
    mppPlanContent: ensureContent(page.mppPlanContent, mppPlanBlocks, page.mppPlan ?? ""),
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

    if (new Date(page.updatedAt).getTime() >= new Date(existing.updatedAt).getTime()) {
      dedupedByDate.set(page.tradeDate, page);
    }
  }

  return Array.from(dedupedByDate.values()).sort((left, right) =>
    right.tradeDate.localeCompare(left.tradeDate)
  );
};

export const loadJournalPages = (): JournalPageRecord[] => {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as Array<JournalPageRecord & { content?: string }>;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return dedupeJournalPages(parsed.map(normalizeJournalPage));
  } catch {
    return [];
  }
};

export const saveJournalPages = (pages: JournalPageRecord[]): void => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(dedupeJournalPages(pages)));
};
