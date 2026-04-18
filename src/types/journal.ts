import type { JSONContent } from "@tiptap/core";

export type JournalBlockType =
  | "paragraph"
  | "heading1"
  | "heading2"
  | "heading3"
  | "bullet"
  | "checklist"
  | "quote"
  | "callout"
  | "divider";

export interface JournalBlock {
  id: string;
  type: JournalBlockType;
  text: string;
  checked?: boolean;
}

export type JournalSectionField = "morningBlocks" | "closingBlocks" | "mppPlanBlocks" | "blocks";
export type JournalContentField =
  | "closingChecklistContent"
  | "morningChecklistContent"
  | "morningContent"
  | "closingContent"
  | "mppPlanContent"
  | "notesContent";

export interface JournalPageRecord {
  id: string;
  title: string;
  tradeDate: string;
  dayGrade: string;
  marketRegime: string;
  mpp: string;
  sleepHours: string;
  sleepScore: string;
  morningMood: string;
  openMood: string;
  afternoonMood: string;
  closeMood: string;
  screenshotUrls: string[];
  closingChecklistContent: JSONContent;
  morningChecklistContent: JSONContent;
  morningContent: JSONContent;
  closingContent: JSONContent;
  mppPlanContent: JSONContent;
  notesContent: JSONContent;
  morningBlocks: JournalBlock[];
  closingBlocks: JournalBlock[];
  mppPlanBlocks: JournalBlock[];
  blocks: JournalBlock[];
  createdAt: string;
  updatedAt: string;
}
