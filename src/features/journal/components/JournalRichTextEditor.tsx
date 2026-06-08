import type { JSONContent } from "@tiptap/core";
import {
  Details,
  DetailsContent,
  DetailsSummary
} from "@tiptap/extension-details";
import Placeholder from "@tiptap/extension-placeholder";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import Highlight from "@tiptap/extension-highlight";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import Image from "@tiptap/extension-image";
import { TableKit } from "@tiptap/extension-table";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDebouncedSave } from "../../../lib/hooks/useDebouncedSave";
import { FLUSH_DEBOUNCED_SAVES_EVENT } from "../../../lib/sync/pendingSaveFlush";
import {
  collectRichTextAttachmentPaths,
  deleteWorkspaceAttachmentIfUnused,
  normalizeRichTextContentForStorage,
  prepareRichTextContentForEditor,
  type InlineImageInsertResult
} from "../../../lib/workspace/workspaceAttachmentClient";
import type { JournalSaveState, JournalSlashCommandItem } from "../../../types/journalEditor";
import { JournalBlockActionsMenu } from "./JournalBlockActionsMenu";
import { JournalBubbleMenu } from "./JournalBubbleMenu";
import { JournalSlashMenu } from "./JournalSlashMenu";

interface JournalRichTextEditorProps {
  content: JSONContent;
  onChange: (content: JSONContent) => void;
  placeholder?: string;
  readOnly?: boolean;
  compact?: boolean;
  autosize?: boolean;
  heightPreset?: "default" | "short";
  taskListColumns?: 1 | 2;
  appearance?: "default" | "notion";
  showBlockActions?: boolean;
  blockActionsVisibility?: "always" | "focus";
  onImageInsert?: (file: File) => Promise<string | InlineImageInsertResult>;
  onImageOpen?: (src: string) => void;
  draftStorageKey?: string;
  sourceUpdatedAt?: string;
}

const MAX_INLINE_IMAGE_BYTES = 10 * 1024 * 1024;
const CONTENT_SAVE_DEBOUNCE_MS = 800;
const DRAFT_SAVE_DEBOUNCE_MS = 3000;
const ACCEPTED_INLINE_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/svg+xml"
]);
const EDITOR_DRAFT_STORAGE_PREFIX = "trade-engine-journal-editor-draft::";
const MAX_STORED_DRAFT_BYTES = 512 * 1024;

interface StoredEditorDraft {
  content: JSONContent;
  updatedAt: string;
}

const getCurrentSlashQueryFromState = (state: Editor["state"]): string | null => {
  const { selection } = state;
  if (!selection.empty) {
    return null;
  }

  const { $from } = selection;
  const parent = $from.parent;
  if (parent.type.name !== "paragraph") {
    return null;
  }

  const text = parent.textContent;
  if (!text.startsWith("/")) {
    return null;
  }

  return text.slice(1);
};

const getCurrentSlashQuery = (editor: Editor): string | null => getCurrentSlashQueryFromState(editor.state);

const clearCurrentParagraph = (editor: Editor) => {
  const { $from } = editor.state.selection;
  const start = $from.start();
  const end = start + $from.parent.content.size;
  editor.chain().focus().deleteRange({ from: start, to: end }).run();
};

const createTaskListNode = (items: string[]) => ({
  type: "taskList",
  content: items.map((text) => ({
    type: "taskItem",
    attrs: { checked: false },
    content: [{ type: "paragraph", content: [{ type: "text", text }] }]
  }))
});

const createBulletListNode = (items: string[]) => ({
  type: "bulletList",
  content: items.map((text) => ({
    type: "listItem",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }]
  }))
});

const createParagraphNodes = (items: string[]) =>
  items.map((text) => ({
    type: "paragraph",
    content: [{ type: "text", text }]
  }));

const createAttachmentPathSet = (content: JSONContent): Set<string> =>
  new Set(collectRichTextAttachmentPaths(content));

const countWords = (rawText: string) => {
  const normalized = rawText.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return 0;
  }

  return normalized.split(" ").length;
};

const countMeaningfulContent = (content?: JSONContent | null): number => {
  if (!content || typeof content !== "object") {
    return 0;
  }

  let total = 0;

  const visit = (node: JSONContent) => {
    if ("text" in node && typeof node.text === "string") {
      total += node.text.trim().length;
    }

    if (node.type === "horizontalRule" || node.type === "image") {
      total += 1;
    }

    if (node.type === "taskItem" || node.type === "listItem") {
      total += 1;
    }

    if (Array.isArray(node.content)) {
      node.content.forEach((child) => visit(child));
    }
  };

  visit(content);
  return total;
};

const parseTimestamp = (value?: string | null): number | null => {
  if (!value || !value.trim()) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const getDraftStorageItemKey = (draftStorageKey: string) => `${EDITOR_DRAFT_STORAGE_PREFIX}${draftStorageKey}`;

const serializeStoredDraft = (content: JSONContent, updatedAt: string): string | null => {
  try {
    const serialized = JSON.stringify({
      content,
      updatedAt
    } satisfies StoredEditorDraft);

    if (serialized.length > MAX_STORED_DRAFT_BYTES) {
      return null;
    }

    return serialized;
  } catch {
    return null;
  }
};

const loadStoredDraft = (draftStorageKey?: string): StoredEditorDraft | null => {
  if (!draftStorageKey || typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(getDraftStorageItemKey(draftStorageKey));
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<StoredEditorDraft>;
    if (!parsed || typeof parsed !== "object" || !parsed.content || typeof parsed.updatedAt !== "string") {
      return null;
    }

    return {
      content: parsed.content as JSONContent,
      updatedAt: parsed.updatedAt
    };
  } catch {
    return null;
  }
};

const saveStoredDraft = (draftStorageKey: string, content: JSONContent, updatedAt: string) => {
  if (typeof window === "undefined") {
    return;
  }

  try {
    const storageItemKey = getDraftStorageItemKey(draftStorageKey);
    const serialized = serializeStoredDraft(content, updatedAt);
    if (!serialized) {
      window.localStorage.removeItem(storageItemKey);
      return;
    }

    window.localStorage.setItem(storageItemKey, serialized);
  } catch {
    // Draft recovery is best-effort only.
  }
};

const clearStoredDraft = (draftStorageKey?: string) => {
  if (!draftStorageKey || typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.removeItem(getDraftStorageItemKey(draftStorageKey));
  } catch {
    // Draft recovery is best-effort only.
  }
};

const shouldUseStoredDraft = (
  incomingContent: JSONContent,
  sourceUpdatedAt: string | undefined,
  storedDraft: StoredEditorDraft | null
): boolean => {
  if (!storedDraft) {
    return false;
  }

  const draftSerialized = serializeNormalizedContent(storedDraft.content);
  const incomingSerialized = serializeNormalizedContent(incomingContent);
  if (draftSerialized === incomingSerialized) {
    return false;
  }

  const draftUpdatedAt = parseTimestamp(storedDraft.updatedAt);
  const sourceTimestamp = parseTimestamp(sourceUpdatedAt);
  const draftScore = countMeaningfulContent(storedDraft.content);
  const incomingScore = countMeaningfulContent(incomingContent);

  if (draftUpdatedAt !== null && sourceTimestamp !== null) {
    return draftUpdatedAt > sourceTimestamp + 1000;
  }

  return draftScore > incomingScore;
};

const readFileAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }

      reject(new Error("Unable to read image file."));
    };
    reader.onerror = () => reject(reader.error ?? new Error("Unable to read image file."));
    reader.readAsDataURL(file);
  });

const serializeNormalizedContent = (content: JSONContent): string =>
  JSON.stringify(normalizeRichTextContentForStorage(content));

const JournalInlineImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      filePath: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-file-path"),
        renderHTML: (attributes) => {
          const filePath = typeof attributes.filePath === "string" ? attributes.filePath.trim() : "";
          return filePath ? { "data-file-path": filePath } : {};
        }
      }
    };
  }
});

const createSlashCommands = (): JournalSlashCommandItem[] => [
  {
    key: "paragraph",
    label: "Paragraph",
    description: "Start writing plain text",
    keywords: ["text", "plain"],
    command: (editor) => {
      clearCurrentParagraph(editor);
      editor.chain().focus().setParagraph().run();
    }
  },
  {
    key: "heading1",
    label: "H1",
    description: "Large section heading",
    keywords: ["heading", "title"],
    command: (editor) => {
      clearCurrentParagraph(editor);
      editor.chain().focus().toggleHeading({ level: 1 }).run();
    }
  },
  {
    key: "heading2",
    label: "H2",
    description: "Section heading",
    keywords: ["heading", "section"],
    command: (editor) => {
      clearCurrentParagraph(editor);
      editor.chain().focus().toggleHeading({ level: 2 }).run();
    }
  },
  {
    key: "heading3",
    label: "H3",
    description: "Smaller heading",
    keywords: ["heading", "subheading"],
    command: (editor) => {
      clearCurrentParagraph(editor);
      editor.chain().focus().toggleHeading({ level: 3 }).run();
    }
  },
  {
    key: "bulletList",
    label: "Bullet list",
    description: "Create a bulleted list",
    keywords: ["bullets", "list"],
    command: (editor) => {
      clearCurrentParagraph(editor);
      editor.chain().focus().toggleBulletList().run();
    }
  },
  {
    key: "orderedList",
    label: "Numbered list",
    description: "Create a numbered list",
    keywords: ["numbers", "list"],
    command: (editor) => {
      clearCurrentParagraph(editor);
      editor.chain().focus().toggleOrderedList().run();
    }
  },
  {
    key: "taskList",
    label: "Checklist",
    description: "Track action items",
    keywords: ["todo", "checkbox", "tasks"],
    command: (editor) => {
      clearCurrentParagraph(editor);
      editor.chain().focus().toggleTaskList().run();
    }
  },
  {
    key: "toggle",
    label: "Toggle",
    description: "Create a collapsible section",
    keywords: ["collapse", "details"],
    command: (editor) => {
      clearCurrentParagraph(editor);
      editor
        .chain()
        .focus()
        .insertContent({
          type: "details",
          attrs: { open: true },
          content: [
            {
              type: "detailsSummary",
              content: [{ type: "text", text: "Toggle heading" }]
            },
            {
              type: "detailsContent",
              content: [{ type: "paragraph" }]
            }
          ]
        })
        .run();
    }
  },
  {
    key: "table",
    label: "Table",
    description: "Insert a 3x3 table",
    keywords: ["grid", "rows", "columns"],
    command: (editor) => {
      clearCurrentParagraph(editor);
      editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
    }
  },
  {
    key: "morningChecklist",
    label: "Morning Checklist",
    description: "Insert a premarket review checklist",
    keywords: ["template", "premarket", "morning"],
    command: (editor) => {
      clearCurrentParagraph(editor);
      editor
        .chain()
        .focus()
        .insertContent([
          { type: "heading3", attrs: { level: 3 }, content: [{ type: "text", text: "Morning Checklist" }] },
          createTaskListNode([
            "Levels marked out",
            "Catalysts reviewed",
            "Primary watchlist confirmed",
            "Risk limits reviewed"
          ])
        ])
        .run();
    }
  },
  {
    key: "riskCheck",
    label: "Risk Reminder",
    description: "Insert a compact risk review section",
    keywords: ["template", "risk", "rules", "risk reminder"],
    command: (editor) => {
      clearCurrentParagraph(editor);
      editor
        .chain()
        .focus()
        .insertContent([
          { type: "heading3", attrs: { level: 3 }, content: [{ type: "text", text: "Risk Reminder" }] },
          createBulletListNode([
            "Current daily loss limit:",
            "Max risk per trade:",
            "What would make me stop trading today?"
          ])
        ])
        .run();
    }
  },
  {
    key: "focusBlock",
    label: "Focus Block",
    description: "Insert quick writing prompts for focus and setup",
    keywords: ["template", "focus", "setup", "review", "risk"],
    command: (editor) => {
      clearCurrentParagraph(editor);
      editor
        .chain()
        .focus()
        .insertContent(
          createParagraphNodes([
            "Risk Reminder:",
            "Main Focus:",
            "Setup I'm Waiting For:",
            "End of Day Review:"
          ])
        )
        .run();
    }
  },
  {
    key: "closingReview",
    label: "Closing Review",
    description: "Insert an end-of-day reflection template",
    keywords: ["template", "closing", "review", "end of day"],
    command: (editor) => {
      clearCurrentParagraph(editor);
      editor
        .chain()
        .focus()
        .insertContent([
          { type: "heading3", attrs: { level: 3 }, content: [{ type: "text", text: "Closing Review" }] },
          createBulletListNode([
            "Best decision today:",
            "Worst decision today:",
            "Main lesson to carry forward:",
            "What needs to change tomorrow?"
          ])
        ])
        .run();
    }
  },
  {
    key: "blockquote",
    label: "Quote",
    description: "Highlight an important note",
    keywords: ["callout", "important"],
    command: (editor) => {
      clearCurrentParagraph(editor);
      editor.chain().focus().toggleBlockquote().run();
    }
  },
  {
    key: "codeBlock",
    label: "Code block",
    description: "Monospace block for structured text",
    keywords: ["code", "mono"],
    command: (editor) => {
      clearCurrentParagraph(editor);
      editor.chain().focus().toggleCodeBlock().run();
    }
  },
  {
    key: "divider",
    label: "Divider",
    description: "Insert a horizontal rule",
    keywords: ["separator", "line"],
    command: (editor) => {
      clearCurrentParagraph(editor);
      editor.chain().focus().setHorizontalRule().run();
    }
  }
];

export const JournalRichTextEditor = ({
  content,
  onChange,
  placeholder = "Type '/' for commands",
  readOnly = false,
  compact = false,
  autosize = false,
  heightPreset = "default",
  taskListColumns = 1,
  appearance = "default",
  showBlockActions = true,
  blockActionsVisibility = "always",
  onImageInsert,
  onImageOpen,
  draftStorageKey,
  sourceUpdatedAt
}: JournalRichTextEditorProps) => {
  const initialStoredDraftRef = useRef<StoredEditorDraft | null>(loadStoredDraft(draftStorageKey));
  const initialStorageContent = normalizeRichTextContentForStorage(
    shouldUseStoredDraft(content, sourceUpdatedAt, initialStoredDraftRef.current)
      ? initialStoredDraftRef.current?.content ?? content
      : content
  );
  const initialContent = prepareRichTextContentForEditor(initialStorageContent);
  const [pendingContent, setPendingContent] = useState<JSONContent>(initialContent);
  const [saveState, setSaveState] = useState<JournalSaveState>("saved");
  const [slashQuery, setSlashQuery] = useState("");
  const [activeSlashIndex, setActiveSlashIndex] = useState(0);
  const [lastSavedAt, setLastSavedAt] = useState<Date>(() => new Date());
  const [wordCount, setWordCount] = useState(0);
  const [imageUploadInProgress, setImageUploadInProgress] = useState(false);
  const [imageStatusMessage, setImageStatusMessage] = useState<string | null>(null);
  const [imageStatusError, setImageStatusError] = useState(false);

  const slashCommands = useMemo(() => createSlashCommands(), []);
  const filteredCommandsRef = useRef<JournalSlashCommandItem[]>([]);
  const activeSlashIndexRef = useRef(0);
  const editorRef = useRef<Editor | null>(null);
  const onChangeRef = useRef(onChange);
  const onImageOpenRef = useRef(onImageOpen);
  const lastCommittedContentRef = useRef(serializeNormalizedContent(initialStorageContent));
  const latestEditorContentRef = useRef<JSONContent>(initialContent);
  const trackedAttachmentPathsRef = useRef(createAttachmentPathSet(initialStorageContent));
  const imageStatusTimeoutRef = useRef<number | null>(null);
  onChangeRef.current = onChange;
  onImageOpenRef.current = onImageOpen;

  const updateSlashState = useCallback((editor: Editor) => {
    const query = getCurrentSlashQuery(editor);
    setSlashQuery(query ?? "");
  }, []);

  const clearImageStatusTimeout = useCallback(() => {
    if (imageStatusTimeoutRef.current !== null) {
      window.clearTimeout(imageStatusTimeoutRef.current);
      imageStatusTimeoutRef.current = null;
    }
  }, []);

  const updateImageStatus = useCallback(
    (message: string | null, isError = false, clearAfterMs?: number) => {
      clearImageStatusTimeout();
      setImageStatusMessage(message);
      setImageStatusError(isError);

      if (!message || !clearAfterMs) {
        return;
      }

      imageStatusTimeoutRef.current = window.setTimeout(() => {
        setImageStatusMessage(null);
        setImageStatusError(false);
        imageStatusTimeoutRef.current = null;
      }, clearAfterMs);
    },
    [clearImageStatusTimeout]
  );

  const syncTrackedAttachmentPaths = useCallback(
    (content: JSONContent, options?: { deleteRemoved?: boolean }) => {
      const nextAttachmentPaths = createAttachmentPathSet(content);
      const previousAttachmentPaths = trackedAttachmentPathsRef.current;
      trackedAttachmentPathsRef.current = nextAttachmentPaths;

      if (!options?.deleteRemoved || previousAttachmentPaths.size === 0) {
        return;
      }

      const removedPaths = Array.from(previousAttachmentPaths).filter(
        (path) => !nextAttachmentPaths.has(path)
      );
      if (removedPaths.length === 0) {
        return;
      }

      for (const path of removedPaths) {
        void Promise.resolve().then(async () => {
          if (trackedAttachmentPathsRef.current.has(path)) {
            return;
          }

          try {
            await deleteWorkspaceAttachmentIfUnused(path);
          } catch (error) {
            console.warn("[journal] Failed to clean up removed inline image attachment.", error);
          }
        });
      }
    },
    []
  );

  const insertImageFromFile = useCallback(
    async (file: File): Promise<boolean> => {
      const currentEditor = editorRef.current;
      if (!currentEditor || readOnly) {
        return false;
      }

      if (!ACCEPTED_INLINE_IMAGE_TYPES.has(file.type)) {
        updateImageStatus("Unsupported image type. Use PNG, JPG, WEBP, GIF, or SVG.", true, 3600);
        return false;
      }

      if (file.size > MAX_INLINE_IMAGE_BYTES) {
        const maxMb = Math.round(MAX_INLINE_IMAGE_BYTES / (1024 * 1024));
        updateImageStatus(`Image is too large. Max size is ${maxMb} MB.`, true, 3600);
        return false;
      }

      setImageUploadInProgress(true);
      updateImageStatus("Adding image...", false);

      try {
        const imageResult = onImageInsert ? await onImageInsert(file) : await readFileAsDataUrl(file);
        const imageAttrs =
          typeof imageResult === "string"
            ? { src: imageResult, alt: file.name }
            : {
                src: imageResult.src,
                alt: file.name,
                ...(imageResult.storageSrc ? { filePath: imageResult.storageSrc } : {})
              };
        if (!imageAttrs.src) {
          throw new Error("Missing image source.");
        }

        if (typeof imageResult !== "string" && imageResult.storageSrc) {
          const nextTrackedPaths = new Set(trackedAttachmentPathsRef.current);
          nextTrackedPaths.add(imageResult.storageSrc);
          trackedAttachmentPathsRef.current = nextTrackedPaths;
        }

        currentEditor.chain().focus().insertContent({ type: "image", attrs: imageAttrs }).run();
        setSaveState("saving");
        updateImageStatus("Image added.", false, 2000);
        return true;
      } catch (error) {
        console.error("Failed to insert image:", error);
        updateImageStatus("Image upload failed. Please try again.", true, 4200);
        return false;
      } finally {
        setImageUploadInProgress(false);
      }
    },
    [onImageInsert, readOnly, updateImageStatus]
  );

  const commitContent = useCallback(
    (nextContent: JSONContent, options?: { skipUiState?: boolean }) => {
      const normalizedContent = normalizeRichTextContentForStorage(nextContent);
      syncTrackedAttachmentPaths(normalizedContent, { deleteRemoved: true });
      const nextSerialized = JSON.stringify(normalizedContent);
      if (lastCommittedContentRef.current === nextSerialized) {
        if (!options?.skipUiState) {
          setSaveState("saved");
        }
        return false;
      }

      lastCommittedContentRef.current = nextSerialized;
      latestEditorContentRef.current = nextContent;
      onChangeRef.current(normalizedContent);
      if (!options?.skipUiState) {
        setSaveState("saved");
        setLastSavedAt(new Date());
      }
      return true;
    },
    [syncTrackedAttachmentPaths]
  );

  const flushEditorContent = useCallback(
    (options?: { persistDraft?: boolean; skipUiState?: boolean }) => {
      const nextContent = editorRef.current?.getJSON() ?? latestEditorContentRef.current;
      latestEditorContentRef.current = nextContent;

      if (!options?.skipUiState) {
        setPendingContent(nextContent);
      }

      if (options?.persistDraft !== false && draftStorageKey) {
        saveStoredDraft(draftStorageKey, normalizeRichTextContentForStorage(nextContent), new Date().toISOString());
      }

      commitContent(nextContent, { skipUiState: options?.skipUiState });
    },
    [commitContent, draftStorageKey]
  );

  const saveNow = useCallback(() => {
    flushEditorContent({ persistDraft: true });
  }, [flushEditorContent]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] }
      }),
      Placeholder.configure({
        placeholder
      }),
      TaskList,
      TaskItem.configure({
        nested: true
      }),
      Underline,
      Link.configure({
        openOnClick: false,
        autolink: true,
        linkOnPaste: true
      }),
      Highlight.configure({
        multicolor: true
      }),
      Subscript,
      Superscript,
      JournalInlineImage.configure({
        allowBase64: true,
        HTMLAttributes: {
          class: "journal-image"
        }
      }),
      Details.configure({
        persist: true,
        HTMLAttributes: {
          class: "journal-details-block"
        },
        renderToggleButton: ({ element, isOpen }) => {
          element.type = "button";
          element.className = `journal-details-toggle${isOpen ? " is-open" : ""}`;
          element.textContent = "\u25B8";
          element.setAttribute("aria-label", isOpen ? "Collapse section" : "Expand section");
        }
      }),
      DetailsSummary.configure({
        HTMLAttributes: {
          class: "journal-details-summary"
        }
      }),
      DetailsContent.configure({
        HTMLAttributes: {
          class: "journal-details-content"
        }
      }),
      TableKit.configure({
        table: {
          resizable: !readOnly,
          HTMLAttributes: {
            class: "journal-editor-table"
          }
        }
      })
    ],
    content: initialContent,
    editable: !readOnly,
    immediatelyRender: false,
    editorProps: {
      handleClickOn: (_view, _pos, node, _nodePos, event, direct) => {
        if (!direct || node.type.name !== "image" || !onImageOpenRef.current) {
          return false;
        }

        event.preventDefault();
        const filePath = typeof node.attrs.filePath === "string" ? node.attrs.filePath.trim() : "";
        const src = typeof node.attrs.src === "string" ? node.attrs.src.trim() : "";
        const imageSrc = filePath || src;
        if (!imageSrc) {
          return false;
        }

        onImageOpenRef.current(imageSrc);
        return true;
      },
      handleKeyDown: (_view, event) => {
        const currentEditor = editorRef.current;
        if (!currentEditor) {
          return false;
        }

        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
          event.preventDefault();
          saveNow();
          return true;
        }

        const slashActive = getCurrentSlashQueryFromState(currentEditor.state) !== null;
        if (
          !slashActive &&
          !currentEditor.isActive("table") &&
          event.key === "Tab" &&
          !event.altKey &&
          !event.ctrlKey &&
          !event.metaKey
        ) {
          event.preventDefault();
          if (event.shiftKey) {
            return true;
          }

          currentEditor.chain().focus().insertContent("\t").run();
          setSaveState("saving");
          return true;
        }

        if (!slashActive) {
          return false;
        }

        const availableCommands = filteredCommandsRef.current;
        if (availableCommands.length === 0) {
          if (event.key === "Escape") {
            setSlashQuery("");
            return true;
          }
          return false;
        }

        if (event.key === "ArrowDown") {
          event.preventDefault();
          setActiveSlashIndex((current) => {
            const nextIndex = current >= availableCommands.length - 1 ? 0 : current + 1;
            activeSlashIndexRef.current = nextIndex;
            return nextIndex;
          });
          return true;
        }

        if (event.key === "ArrowUp") {
          event.preventDefault();
          setActiveSlashIndex((current) => {
            const nextIndex = current <= 0 ? availableCommands.length - 1 : current - 1;
            activeSlashIndexRef.current = nextIndex;
            return nextIndex;
          });
          return true;
        }

        if (event.key === "Enter" || event.key === "Tab") {
          event.preventDefault();
          const selectedCommand = availableCommands[activeSlashIndexRef.current] ?? availableCommands[0];
          selectedCommand?.command(currentEditor);
          setSlashQuery("");
          setActiveSlashIndex(0);
          activeSlashIndexRef.current = 0;
          setSaveState("saving");
          return true;
        }

        if (event.key === "Escape") {
          event.preventDefault();
          setSlashQuery("");
          setActiveSlashIndex(0);
          activeSlashIndexRef.current = 0;
          return true;
        }

        return false;
      },
      handlePaste: (_view, event) => {
        if (readOnly) {
          return false;
        }

        const files = Array.from(event.clipboardData?.files ?? []);
        const imageFile = files.find((file) => ACCEPTED_INLINE_IMAGE_TYPES.has(file.type));
        if (!imageFile) {
          return false;
        }

        event.preventDefault();
        void insertImageFromFile(imageFile);
        return true;
      },
      handleDrop: (view, event) => {
        if (readOnly) {
          return false;
        }

        const files = Array.from(event.dataTransfer?.files ?? []);
        const imageFile = files.find((file) => ACCEPTED_INLINE_IMAGE_TYPES.has(file.type));
        if (!imageFile) {
          return false;
        }

        const dropPosition = view.posAtCoords({ left: event.clientX, top: event.clientY });
        if (dropPosition) {
          editorRef.current?.chain().focus().setTextSelection(dropPosition.pos).run();
        }

        event.preventDefault();
        void insertImageFromFile(imageFile);
        return true;
      }
    },
    onCreate: ({ editor: nextEditor }) => {
      latestEditorContentRef.current = nextEditor.getJSON();
      setWordCount(countWords(nextEditor.getText()));
      updateSlashState(nextEditor);
    },
    onUpdate: ({ editor: nextEditor }) => {
      const nextContent = nextEditor.getJSON();
      latestEditorContentRef.current = nextContent;
      const nextSerialized = serializeNormalizedContent(nextContent);
      if (nextSerialized === lastCommittedContentRef.current) {
        syncTrackedAttachmentPaths(nextContent, { deleteRemoved: true });
        setSaveState("saved");
      } else {
        setPendingContent(nextContent);
        setSaveState("saving");
      }
      setWordCount(countWords(nextEditor.getText()));
      updateSlashState(nextEditor);
    },
    onBlur: () => {
      flushEditorContent({ persistDraft: true });
    },
    onSelectionUpdate: ({ editor: nextEditor }) => {
      updateSlashState(nextEditor);
    }
  });

  useDebouncedSave(
    pendingContent,
    CONTENT_SAVE_DEBOUNCE_MS,
    (nextContent) => {
      commitContent(nextContent);
    },
    saveState === "saving"
  );

  useDebouncedSave(
    pendingContent,
    DRAFT_SAVE_DEBOUNCE_MS,
    (nextContent) => {
      if (!draftStorageKey) {
        return;
      }

      saveStoredDraft(draftStorageKey, normalizeRichTextContentForStorage(nextContent), new Date().toISOString());
    },
    Boolean(draftStorageKey),
    { skipInitialSave: true }
  );

  const filteredSlashCommands = useMemo(() => {
    const normalized = slashQuery.trim().toLowerCase();
    return slashCommands.filter((item) => {
      if (!normalized) {
        return true;
      }

      const haystack = [item.label, item.description, ...(item.keywords ?? [])]
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalized);
    });
  }, [slashCommands, slashQuery]);

  useEffect(() => {
    filteredCommandsRef.current = filteredSlashCommands;
    setActiveSlashIndex((current) => {
      const nextIndex =
        filteredSlashCommands.length === 0
          ? 0
          : Math.min(current, Math.max(filteredSlashCommands.length - 1, 0));
      activeSlashIndexRef.current = nextIndex;
      return nextIndex;
    });
  }, [filteredSlashCommands]);

  useEffect(() => {
    editorRef.current = editor;

    return () => {
      editorRef.current = null;
    };
  }, [editor]);

  useEffect(
    () => () => {
      clearImageStatusTimeout();
    },
    [clearImageStatusTimeout]
  );

  useEffect(() => {
    if (typeof window === "undefined" || readOnly) {
      return;
    }

    const flushOnLifecycleEvent = () => {
      flushEditorContent({ persistDraft: true, skipUiState: true });
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        flushOnLifecycleEvent();
      }
    };

    window.addEventListener(FLUSH_DEBOUNCED_SAVES_EVENT, flushOnLifecycleEvent);
    window.addEventListener("beforeunload", flushOnLifecycleEvent);
    window.addEventListener("pagehide", flushOnLifecycleEvent);
    window.addEventListener("blur", flushOnLifecycleEvent);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      flushOnLifecycleEvent();
      window.removeEventListener(FLUSH_DEBOUNCED_SAVES_EVENT, flushOnLifecycleEvent);
      window.removeEventListener("beforeunload", flushOnLifecycleEvent);
      window.removeEventListener("pagehide", flushOnLifecycleEvent);
      window.removeEventListener("blur", flushOnLifecycleEvent);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [flushEditorContent, readOnly]);

  useEffect(() => {
    const storedDraft = loadStoredDraft(draftStorageKey);
    const nextStorageContent = normalizeRichTextContentForStorage(
      shouldUseStoredDraft(content, sourceUpdatedAt, storedDraft)
        ? storedDraft?.content ?? content
        : content
    );
    const nextContent = prepareRichTextContentForEditor(nextStorageContent);
    const nextSerialized = JSON.stringify(nextStorageContent);
    const nextAttachmentPaths = createAttachmentPathSet(nextStorageContent);
    if (lastCommittedContentRef.current === nextSerialized) {
      trackedAttachmentPathsRef.current = nextAttachmentPaths;
      if (storedDraft && serializeNormalizedContent(content) === serializeNormalizedContent(storedDraft.content)) {
        clearStoredDraft(draftStorageKey);
      }
      return;
    }

    if (!editor) {
      latestEditorContentRef.current = nextContent;
      setPendingContent(nextContent);
      lastCommittedContentRef.current = nextSerialized;
      trackedAttachmentPathsRef.current = nextAttachmentPaths;
      return;
    }

    const currentSerialized = serializeNormalizedContent(editor.getJSON());

    if (currentSerialized === nextSerialized) {
      lastCommittedContentRef.current = nextSerialized;
      trackedAttachmentPathsRef.current = nextAttachmentPaths;
      return;
    }

    const currentContent = editor.getJSON();
    const currentContentScore = countMeaningfulContent(currentContent);
    const nextContentScore = countMeaningfulContent(nextContent);

    if (
      currentContentScore > 0 &&
      nextContentScore === 0 &&
      nextSerialized !== lastCommittedContentRef.current
    ) {
      console.warn("[journal] Ignored stale empty editor content update.");
      return;
    }

    if (editor.isFocused) {
      return;
    }

    editor.commands.setContent(nextContent, { emitUpdate: false });
    latestEditorContentRef.current = nextContent;
    setPendingContent(nextContent);
    lastCommittedContentRef.current = nextSerialized;
    trackedAttachmentPathsRef.current = nextAttachmentPaths;
    setWordCount(countWords(editor.getText()));
    setSaveState("saved");
  }, [content, draftStorageKey, editor, sourceUpdatedAt]);

  const formattedSavedTime = useMemo(
    () =>
      lastSavedAt.toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit"
      }),
    [lastSavedAt]
  );

  if (!editor) {
    return null;
  }

  return (
    <div
      className={`journal-rich-editor-shell${compact ? " journal-rich-editor-shell-compact" : ""}${
        appearance === "notion" ? " journal-rich-editor-shell-notion" : ""
      }${autosize ? " journal-rich-editor-shell-autosize" : ""}${
        heightPreset === "short" ? " journal-rich-editor-shell-short" : ""
      }${showBlockActions && blockActionsVisibility === "focus" ? " journal-rich-editor-shell-block-actions-focus" : ""
      }`}
    >
      {!readOnly ? (
        <JournalBubbleMenu
          editor={editor}
          onImageInsert={insertImageFromFile}
          imageUploadInProgress={imageUploadInProgress}
          appearance={appearance}
        />
      ) : null}
      {!readOnly ? (
        <div className="journal-rich-editor-status">
          <span className={`journal-rich-editor-status-indicator ${saveState === "saving" ? "is-saving" : "is-saved"}`} />
          <span>{saveState === "saving" ? "Saving..." : `Saved ${formattedSavedTime}`}</span>
          {imageStatusMessage ? (
            <span className={`journal-rich-editor-image-status${imageStatusError ? " is-error" : ""}`}>
              {imageStatusMessage}
            </span>
          ) : null}
          <span className="journal-rich-editor-word-count">{wordCount} words</span>
        </div>
      ) : null}
      <div
        className={`journal-rich-editor-surface${compact ? " journal-rich-editor-surface-compact" : ""}${
          appearance === "notion" ? " journal-rich-editor-surface-notion" : ""
        }`}
      >
        {!readOnly && showBlockActions ? <JournalBlockActionsMenu editor={editor} appearance={appearance} /> : null}
        <EditorContent
          editor={editor}
          className={`journal-rich-editor${taskListColumns === 2 ? " journal-rich-editor-task-columns-2" : ""}${
            onImageOpen ? " journal-rich-editor-image-openable" : ""
          }`}
        />
        {!readOnly && slashQuery !== null && slashQuery !== undefined && getCurrentSlashQuery(editor) !== null ? (
          <JournalSlashMenu
            items={filteredSlashCommands}
            query={slashQuery}
            activeIndex={activeSlashIndex}
            appearance={appearance}
            onHover={(index) => {
              setActiveSlashIndex(index);
              activeSlashIndexRef.current = index;
            }}
            onSelect={(item) => {
              item.command(editor);
              setSlashQuery("");
              setActiveSlashIndex(0);
              activeSlashIndexRef.current = 0;
              setSaveState("saving");
            }}
          />
        ) : null}
      </div>
    </div>
  );
};
