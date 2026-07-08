import type { JSONContent } from "@tiptap/core";

export type LibraryCollectionId =
  | "idea-inbox"
  | "book-club"
  | "strong-views"
  | "quotes"
  | "weekly-improvement-goals"
  | "weekly-review"
  | "monthly-review"
  | "replay"
  | "signal-mapping"
  | "ticker-groups";

export interface LibraryCollectionDefinition {
  id: LibraryCollectionId;
  name: string;
  description: string;
  accent: string;
}

export interface LibraryPageRecord {
  id: string;
  collectionId: LibraryCollectionId;
  title: string;
  status: string;
  tags: string[];
  sourceUrl: string;
  properties?: Record<string, unknown>;
  content: JSONContent;
  createdAt: string;
  updatedAt: string;
}

export interface StrongViewProperties {
  ticker: string;
  date: string;
  keyLevelUp: string;
  keyLevelDown: string;
  bias: string;
  atr: string;
  rvol: string;
  support: string | JSONContent;
  resistance: string | JSONContent;
  openClose: string | JSONContent;
  notes: string | JSONContent;
  catalyst: string | JSONContent;
  gamePlan: string | JSONContent;
  morningChat: string;
}
