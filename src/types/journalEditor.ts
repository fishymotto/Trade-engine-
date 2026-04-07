import type { Editor } from "@tiptap/react";

export type JournalSaveState = "saving" | "saved";

export interface JournalSlashCommandItem {
  key: string;
  label: string;
  description: string;
  keywords?: string[];
  command: (editor: Editor) => void;
}
