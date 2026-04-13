import type { JSONContent } from "@tiptap/core";

export type LibraryCollectionId =
  | "idea-inbox"
  | "book-club"
  | "trading-notes"
  | "replay"
  | "signal-mapping";

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
  properties?: Record<string, string | string[] | boolean>;
  content: JSONContent;
  createdAt: string;
  updatedAt: string;
}
