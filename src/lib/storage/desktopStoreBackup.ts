import { invoke, isTauri } from "@tauri-apps/api/core";

export type DesktopStoreBackupKey =
  | "historical-bars"
  | "journal-checklist-templates"
  | "workspace-state"
  | "headlines"
  | "select-option-additions"
  | "review-templates"
  | "trade-tag-catalog";

export const loadDesktopStoreBackup = async <T>(storeKey: DesktopStoreBackupKey): Promise<T | null> => {
  if (!isTauri()) {
    return null;
  }

  try {
    const value = await invoke<unknown>("load_workspace_store_backup", { storeKey });
    return value === null ? null : (value as T);
  } catch {
    return null;
  }
};

export const saveDesktopStoreBackup = async (
  storeKey: DesktopStoreBackupKey,
  value: unknown
): Promise<void> => {
  if (!isTauri()) {
    return;
  }

  await invoke("save_workspace_store_backup", { storeKey, value });
};
