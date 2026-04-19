import { invoke, isTauri } from "@tauri-apps/api/core";

const sanitizeExternalUrl = (rawUrl: string): string | null => {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return null;
  }

  const withoutViewSource = trimmed.replace(/^view-source:/i, "").trim();

  try {
    const parsed = new URL(withoutViewSource);
    const protocol = parsed.protocol.toLowerCase();
    if (protocol !== "http:" && protocol !== "https:") {
      return null;
    }

    return parsed.toString();
  } catch {
    return null;
  }
};

export const canOpenExternalUrl = (url: string): boolean => Boolean(sanitizeExternalUrl(url));

export const openExternalUrl = async (url: string): Promise<void> => {
  const sanitized = sanitizeExternalUrl(url);
  if (!sanitized) {
    return;
  }

  if (isTauri()) {
    await invoke("open_external_url", { url: sanitized });
    return;
  }

  window.open(sanitized, "_blank", "noopener,noreferrer");
};
