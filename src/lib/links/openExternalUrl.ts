import { invoke, isTauri } from "@tauri-apps/api/core";

export const openExternalUrl = async (url: string): Promise<void> => {
  const trimmed = url.trim();
  if (!trimmed) {
    return;
  }

  if (isTauri()) {
    await invoke("open_external_url", { url: trimmed });
    return;
  }

  window.open(trimmed, "_blank", "noopener,noreferrer");
};

