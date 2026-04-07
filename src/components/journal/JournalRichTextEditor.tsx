import type { JSONContent } from "@tiptap/core";
import {
  Details,
  DetailsContent,
  DetailsSummary
} from "@tiptap/extension-details";
import Placeholder from "@tiptap/extension-placeholder";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDebouncedSave } from "../../hooks/useDebouncedSave";
import type { JournalSaveState, JournalSlashCommandItem } from "../../types/journalEditor";
import { JournalBubbleMenu } from "./JournalBubbleMenu";
import { JournalSlashMenu } from "./JournalSlashMenu";

interface JournalRichTextEditorProps {
  content: JSONContent;
  onChange: (content: JSONContent) => void;
  placeholder?: string;
  readOnly?: boolean;
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
    label: "Risk Check",
    description: "Insert a compact risk review section",
    keywords: ["template", "risk", "rules"],
    command: (editor) => {
      clearCurrentParagraph(editor);
      editor
        .chain()
        .focus()
        .insertContent([
          { type: "heading3", attrs: { level: 3 }, content: [{ type: "text", text: "Risk Check" }] },
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
    key: "closingReview",
    label: "Closing Review",
    description: "Insert an end-of-day reflection template",
    keywords: ["template", "closing", "review"],
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
  readOnly = false
}: JournalRichTextEditorProps) => {
  const [pendingContent, setPendingContent] = useState<JSONContent>(content);
  const [saveState, setSaveState] = useState<JournalSaveState>("saved");
  const [slashQuery, setSlashQuery] = useState("");
  const [activeSlashIndex, setActiveSlashIndex] = useState(0);

  const slashCommands = useMemo(() => createSlashCommands(), []);
  const filteredCommandsRef = useRef<JournalSlashCommandItem[]>([]);
  const activeSlashIndexRef = useRef(0);
  const editorRef = useRef<Editor | null>(null);

  const updateSlashState = useCallback((editor: Editor) => {
    const query = getCurrentSlashQuery(editor);
    setSlashQuery(query ?? "");
  }, []);

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
      Details.configure({
        persist: true,
        HTMLAttributes: {
          class: "journal-details-block"
        },
        renderToggleButton: ({ element, isOpen }) => {
          element.type = "button";
          element.className = "journal-details-toggle";
          element.textContent = isOpen ? "▾" : "▸";
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
      })
    ],
    content,
    editable: !readOnly,
    immediatelyRender: false,
    editorProps: {
      handleKeyDown: (_view, event) => {
        const currentEditor = editorRef.current;
        if (!currentEditor) {
          return false;
        }

        const slashActive = getCurrentSlashQueryFromState(currentEditor.state) !== null;
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
      }
    },
    onCreate: ({ editor: nextEditor }) => {
      updateSlashState(nextEditor);
    },
    onUpdate: ({ editor: nextEditor }) => {
      const nextContent = nextEditor.getJSON();
      setPendingContent(nextContent);
      setSaveState("saving");
      updateSlashState(nextEditor);
    },
    onSelectionUpdate: ({ editor: nextEditor }) => {
      updateSlashState(nextEditor);
    }
  });

  useDebouncedSave(
    pendingContent,
    450,
    (nextContent) => {
      onChange(nextContent);
      setSaveState("saved");
    },
    saveState === "saving"
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

  if (!editor) {
    return null;
  }

  return (
    <div className="journal-rich-editor-shell">
      {!readOnly ? <JournalBubbleMenu editor={editor} /> : null}
      <div className="journal-rich-editor-status">
        <span>{saveState === "saving" ? "Saving..." : "Saved"}</span>
      </div>
      <div className="journal-rich-editor-surface">
        <EditorContent editor={editor} className="journal-rich-editor" />
        {!readOnly && slashQuery !== null && slashQuery !== undefined && getCurrentSlashQuery(editor) !== null ? (
          <JournalSlashMenu
            items={filteredSlashCommands}
            query={slashQuery}
            activeIndex={activeSlashIndex}
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
