import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  deleteWorkspaceAttachmentIfUnused,
  resolveWorkspaceAttachmentSrc
} from "../workspace/workspaceAttachmentClient";

export type PlaybookAttachmentKind = "screenshot" | "recording";

export const pickAndSavePlaybookAttachment = async (
  playbookId: string,
  exampleId: string,
  kind: PlaybookAttachmentKind
): Promise<string> => {
  if (!isTauri()) {
    return "";
  }

  const path = await invoke<string>("pick_and_save_playbook_attachment", {
    playbookId,
    exampleId,
    kind
  });

  return path ?? "";
};

export const deletePlaybookAttachment = async (path: string): Promise<void> => {
  await deleteWorkspaceAttachmentIfUnused(path);
};

export const resolvePlaybookAttachmentSrc = (path: string): string => {
  return resolveWorkspaceAttachmentSrc(path);
};
