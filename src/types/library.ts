import type { JSONContent } from "@tiptap/core";

export type LibraryCollectionId =
  | "idea-inbox"
  | "book-club"
  | "quotes"
  | "trading-notes"
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
