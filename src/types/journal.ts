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
export type JournalContentField = "morningContent" | "closingContent" | "mppPlanContent" | "notesContent";

export interface JournalPageRecord {
  id: string;
  title: string;
  tradeDate: string;
  dayGrade: string;
  mpp: string;
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
