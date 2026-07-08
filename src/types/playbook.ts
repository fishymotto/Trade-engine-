import type { JSONContent } from "@tiptap/core";

export interface PlaybookSectionRecord {
  id: string;
  title: string;
  description: string;
  content: JSONContent;
}

export type PlaybookExampleRating = "A+" | "A" | "B+";
export type PlaybookStatus = "Testing" | "Active" | "Proven" | "Needs Review" | "Retired";

export interface PlaybookExampleTradeSnapshot {
  name: string;
  tradeDate: string;
  symbol: string;
  side: string;
  status: string;
  game: string;
  setup: string;
  setups: string[];
  openTime: string;
  closeTime: string;
  holdTime: string;
  holdSeconds: number;
  size: number;
  entryPrice: number;
  exitPrice: number;
  netPnlUsd: number;
  returnPerShare: number;
  feesUsd: number;
  executionCount: number;
  addCount: number;
  averagedDownCount: number;
  addedToWinnerCount: number;
}

export interface PlaybookExampleRecord {
  id: string;
  tradeId: string;
  tradeDate: string;
  rating: PlaybookExampleRating;
  tradeSnapshot?: PlaybookExampleTradeSnapshot | null;
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
  status: PlaybookStatus;
  description: string;
  focus: string;
  sections: PlaybookSectionRecord[];
  screenshotUrls: string[];
  aPlusExamples: PlaybookExampleRecord[];
  createdAt: string;
  updatedAt: string;
}
