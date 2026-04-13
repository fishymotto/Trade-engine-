import type { JSONContent } from "@tiptap/core";

export interface PlaybookSectionRecord {
  id: string;
  title: string;
  description: string;
  content: JSONContent;
}

export interface PlaybookRecord {
  id: string;
  name: string;
  aliases: string[];
  description: string;
  focus: string;
  sections: PlaybookSectionRecord[];
  screenshotUrls: string[];
  createdAt: string;
  updatedAt: string;
}
