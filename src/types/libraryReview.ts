import type { JSONContent } from "@tiptap/core";

export type ReviewPeriod = "weekly" | "monthly";

export type ReviewChecklistGroupKey = "meditation" | "riskCheck" | "morningJournal" | "closingJournal";

export interface ReviewReadingEntry {
  book: string;
  author: string;
  pages: string;
}

export type ReviewChecklistState = Record<ReviewChecklistGroupKey, boolean[]>;

export interface ReviewReflectionState {
  takeaway: JSONContent;
  reading: ReviewReadingEntry[];
  checklist: ReviewChecklistState;
  improvementGoals: JSONContent;
}

export interface NamedReviewTemplate {
  id: string;
  name: string;
  content: ReviewReflectionState;
}

export interface ReviewTemplates {
  weeklyTemplates: NamedReviewTemplate[];
  monthlyTemplates: NamedReviewTemplate[];
}

