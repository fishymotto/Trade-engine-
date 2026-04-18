import type { JSONContent } from "@tiptap/core";

export interface PlaybookSectionRecord {
  id: string;
  title: string;
  description: string;
  content: JSONContent;
}

export type PlaybookExampleRating = "A+" | "A" | "B+";

export interface PlaybookExampleRecord {
  id: string;
  tradeId: string;
  tradeDate: string;
  rating: PlaybookExampleRating;
  notes: JSONContent;
  screenshotPaths: string[];
  recordingPath: string;
  createdAt: string;
  updatedAt: string;
}

export interface PlaybookRecord {
  id: string;
  name: string;
  aliases: string[];
  description: string;
  focus: string;
  sections: PlaybookSectionRecord[];
  screenshotUrls: string[];
  aPlusExamples: PlaybookExampleRecord[];
  createdAt: string;
  updatedAt: string;
}
