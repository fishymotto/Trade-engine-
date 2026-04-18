import { convertFileSrc, invoke, isTauri } from "@tauri-apps/api/core";

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
  if (!isTauri()) {
    return;
  }

  await invoke("delete_playbook_attachment", { path });
};

export const resolvePlaybookAttachmentSrc = (path: string): string => {
  if (!path) {
    return "";
  }

  if (!isTauri()) {
    return path;
  }

  const normalizedPath = path.includes("\\") ? path.replace(/\\/g, "/") : path;
  return convertFileSrc(normalizedPath);
};
