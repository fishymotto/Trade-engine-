import type { JSONContent } from "@tiptap/core";
import { convertFileSrc, invoke, isTauri } from "@tauri-apps/api/core";

const WORKSPACE_ATTACHMENT_FOLDER_TOKEN = "playbook-attachments";
const ABSOLUTE_FILE_PATH_PATTERN = /^[A-Za-z]:[\\/]|^\\\\/;
const EXTERNAL_SRC_PATTERN = /^(data:|blob:|https?:|tauri:|asset:)/i;
const RICH_TEXT_IMAGE_FILE_PATH_ATTR = "filePath";
const DEFAULT_UNUSED_ATTACHMENT_CHECK_DELAY_MS = 1500;

export const JOURNAL_PAGES_STORAGE_KEY = "trade-engine-journal-pages";
export const PLAYBOOKS_STORAGE_KEY = "trade-engine-playbooks";
export const LIBRARY_PAGES_STORAGE_KEY = "trade-engine-library-pages";

export type WorkspaceLocalStorageOverrides = Record<string, unknown | undefined>;

interface DeleteWorkspaceAttachmentIfUnusedOptions {
  delayMs?: number;
  storageOverrides?: WorkspaceLocalStorageOverrides;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const waitForMs = (delayMs: number): Promise<void> =>
  new Promise((resolve) => {
    if (typeof window === "undefined" || delayMs <= 0) {
      resolve();
      return;
    }

    window.setTimeout(resolve, delayMs);
  });

const parseStoredValue = (raw: string): unknown => {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
};

const readFileAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }

      reject(new Error("The file could not be read."));
    };
    reader.onerror = () => reject(reader.error ?? new Error("The file could not be read."));
    reader.readAsDataURL(file);
  });

const bytesToHex = (bytes: Uint8Array): string => {
  let output = "";
  for (const byte of bytes) {
    output += byte.toString(16).padStart(2, "0");
  }

  return output;
};

export interface SaveWorkspaceAttachmentInput {
  category: string;
  recordId: string;
  slotKey: string;
  file: File;
}

export interface InlineImageInsertResult {
  src: string;
  storageSrc?: string;
}

export interface WorkspaceAttachmentCategorySummary {
  key: string;
  label: string;
  fileCount: number;
  referencedFileCount: number;
  orphanedFileCount: number;
  totalBytes: number;
  referencedBytes: number;
  orphanedBytes: number;
}

export interface WorkspaceAttachmentAuditResult {
  scannedFileCount: number;
  referencedFileCount: number;
  orphanedFileCount: number;
  deletedFileCount: number;
  totalBytes: number;
  orphanedBytes: number;
  deletedBytes: number;
  missingReferenceCount: number;
  categories: WorkspaceAttachmentCategorySummary[];
}

export const isWorkspaceAttachmentPath = (path: string): boolean => {
  const trimmed = path.trim();
  if (!trimmed || !ABSOLUTE_FILE_PATH_PATTERN.test(trimmed)) {
    return false;
  }

  return trimmed.toLowerCase().includes(WORKSPACE_ATTACHMENT_FOLDER_TOKEN);
};

export const saveUploadedWorkspaceAttachment = async ({
  category,
  recordId,
  slotKey,
  file
}: SaveWorkspaceAttachmentInput): Promise<string> => {
  if (!isTauri()) {
    return readFileAsDataUrl(file);
  }

  const contentHex = bytesToHex(new Uint8Array(await file.arrayBuffer()));
  const savedPath = await invoke<string>("save_workspace_attachment", {
    category,
    recordId,
    slotKey,
    fileName: file.name,
    contentHex
  });

  return savedPath ?? "";
};

export const saveWorkspaceInlineImage = async (
  input: SaveWorkspaceAttachmentInput
): Promise<InlineImageInsertResult> => {
  const savedPath = await saveUploadedWorkspaceAttachment(input);
  if (!savedPath) {
    return { src: "" };
  }

  if (!isWorkspaceAttachmentPath(savedPath)) {
    return { src: savedPath };
  }

  return {
    src: resolveWorkspaceAttachmentSrc(savedPath),
    storageSrc: savedPath
  };
};

export const deleteWorkspaceAttachment = async (path: string): Promise<void> => {
  if (!isTauri() || !isWorkspaceAttachmentPath(path)) {
    return;
  }

  await invoke("delete_playbook_attachment", { path });
};

export const collectWorkspaceAttachmentPaths = (value: unknown): string[] => {
  const uniquePaths = new Set<string>();
  const seenRecords = new Set<object>();

  const collectPaths = (entry: unknown) => {
    if (typeof entry === "string") {
      const trimmed = entry.trim();
      if (isWorkspaceAttachmentPath(trimmed)) {
        uniquePaths.add(trimmed);
      }
      return;
    }

    if (Array.isArray(entry)) {
      entry.forEach((item) => collectPaths(item));
      return;
    }

    if (!isRecord(entry) || seenRecords.has(entry)) {
      return;
    }

    seenRecords.add(entry);
    Object.values(entry).forEach((item) => collectPaths(item));
  };

  collectPaths(value);
  return Array.from(uniquePaths);
};

const buildWorkspaceLocalStorageSnapshot = (
  overrides?: WorkspaceLocalStorageOverrides
): Record<string, unknown> => {
  const snapshot: Record<string, unknown> = {};
  if (typeof window !== "undefined") {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const storageKey = window.localStorage.key(index);
      if (!storageKey) {
        continue;
      }

      const rawValue = window.localStorage.getItem(storageKey);
      if (rawValue === null) {
        continue;
      }

      snapshot[storageKey] = parseStoredValue(rawValue);
    }
  }

  if (!overrides) {
    return snapshot;
  }

  for (const [storageKey, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete snapshot[storageKey];
      continue;
    }

    snapshot[storageKey] = value;
  }

  return snapshot;
};

export const deleteWorkspaceAttachmentIfUnused = async (
  path: string,
  options?: DeleteWorkspaceAttachmentIfUnusedOptions
): Promise<boolean> => {
  const trimmed = path.trim();
  if (!isTauri() || !isWorkspaceAttachmentPath(trimmed)) {
    return false;
  }

  const delayMs = options?.delayMs ?? DEFAULT_UNUSED_ATTACHMENT_CHECK_DELAY_MS;
  if (delayMs > 0) {
    await waitForMs(delayMs);
  }

  const snapshot = buildWorkspaceLocalStorageSnapshot(options?.storageOverrides);
  if (collectWorkspaceAttachmentPaths(snapshot).includes(trimmed)) {
    return false;
  }

  await deleteWorkspaceAttachment(trimmed);
  return true;
};

export const resolveWorkspaceAttachmentSrc = (path: string): string => {
  const trimmed = path.trim();
  if (!trimmed) {
    return "";
  }

  if (EXTERNAL_SRC_PATTERN.test(trimmed) || !isTauri() || !isWorkspaceAttachmentPath(trimmed)) {
    return trimmed;
  }

  const normalizedPath = trimmed.includes("\\") ? trimmed.replace(/\\/g, "/") : trimmed;
  return convertFileSrc(normalizedPath);
};

const getRichTextImageStorageSrc = (attrs: Record<string, unknown>): string => {
  const filePathValue =
    typeof attrs[RICH_TEXT_IMAGE_FILE_PATH_ATTR] === "string"
      ? attrs[RICH_TEXT_IMAGE_FILE_PATH_ATTR]
      : typeof attrs["data-file-path"] === "string"
        ? attrs["data-file-path"]
        : "";
  const trimmedFilePath = filePathValue.trim();
  if (trimmedFilePath && isWorkspaceAttachmentPath(trimmedFilePath)) {
    return trimmedFilePath;
  }

  const srcValue = typeof attrs.src === "string" ? attrs.src.trim() : "";
  return isWorkspaceAttachmentPath(srcValue) ? srcValue : "";
};

const visitRichTextContent = (
  content: JSONContent,
  visitor: (node: JSONContent) => void
): void => {
  visitor(content);
  if (!Array.isArray(content.content)) {
    return;
  }

  for (const child of content.content) {
    visitRichTextContent(child, visitor);
  }
};

const mapRichTextContent = (
  content: JSONContent,
  transform: (node: JSONContent) => JSONContent
): JSONContent => {
  const nextNode = transform(content);
  if (!Array.isArray(nextNode.content)) {
    return nextNode;
  }

  return {
    ...nextNode,
    content: nextNode.content.map((child) => mapRichTextContent(child, transform))
  };
};

export const collectRichTextAttachmentPaths = (content: JSONContent): string[] => {
  const attachmentPaths = new Set<string>();
  visitRichTextContent(content, (node) => {
    if (node.type !== "image" || !isRecord(node.attrs)) {
      return;
    }

    const storageSrc = getRichTextImageStorageSrc(node.attrs);
    if (storageSrc) {
      attachmentPaths.add(storageSrc);
    }
  });

  return Array.from(attachmentPaths);
};

export const prepareRichTextContentForEditor = (content: JSONContent): JSONContent =>
  mapRichTextContent(content, (node) => {
    if (node.type !== "image" || !isRecord(node.attrs)) {
      return node;
    }

    const storageSrc = getRichTextImageStorageSrc(node.attrs);
    if (!storageSrc) {
      return node;
    }

    return {
      ...node,
      attrs: {
        ...node.attrs,
        src: resolveWorkspaceAttachmentSrc(storageSrc),
        [RICH_TEXT_IMAGE_FILE_PATH_ATTR]: storageSrc
      }
    };
  });

export const normalizeRichTextContentForStorage = (content: JSONContent): JSONContent =>
  mapRichTextContent(content, (node) => {
    if (node.type !== "image" || !isRecord(node.attrs)) {
      return node;
    }

    const storageSrc = getRichTextImageStorageSrc(node.attrs);
    if (!storageSrc) {
      return node;
    }

    return {
      ...node,
      attrs: {
        ...node.attrs,
        src: storageSrc,
        [RICH_TEXT_IMAGE_FILE_PATH_ATTR]: storageSrc
      }
    };
  });
