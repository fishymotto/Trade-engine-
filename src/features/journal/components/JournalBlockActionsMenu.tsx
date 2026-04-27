import type { JSONContent } from "@tiptap/core";
import type { Editor } from "@tiptap/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

interface JournalBlockActionsMenuProps {
  editor: Editor;
  appearance?: "default" | "notion";
}

interface BlockActionItem {
  key: string;
  label: string;
  description: string;
  keywords: string[];
  run: (editor: Editor) => void;
}

const getCurrentBlockRange = (editor: Editor): { from: number; to: number; content: JSONContent } | null => {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (!node.isBlock) {
      continue;
    }

    return {
      from: $from.before(depth),
      to: $from.after(depth),
      content: node.toJSON()
    };
  }

  return null;
};

const createToggleSection = (): JSONContent => ({
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
});

export const JournalBlockActionsMenu = ({ editor, appearance = "default" }: JournalBlockActionsMenuProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const duplicateCurrentBlock = useCallback((nextEditor: Editor) => {
    const range = getCurrentBlockRange(nextEditor);
    if (!range) {
      return;
    }

    nextEditor.chain().focus().insertContentAt(range.to, range.content).run();
  }, []);

  const deleteCurrentBlock = useCallback((nextEditor: Editor) => {
    const range = getCurrentBlockRange(nextEditor);
    if (!range) {
      return;
    }

    nextEditor.chain().focus().deleteRange({ from: range.from, to: range.to }).run();
  }, []);

  const copyCurrentBlockText = useCallback((nextEditor: Editor) => {
    const range = getCurrentBlockRange(nextEditor);
    if (!range || typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
      return;
    }

    const copiedText = nextEditor.state.doc.textBetween(range.from, range.to, "\n").trim();
    if (!copiedText) {
      return;
    }

    void navigator.clipboard.writeText(copiedText);
  }, []);

  const blockActions = useMemo<BlockActionItem[]>(
    () => [
      {
        key: "turn-paragraph",
        label: "Turn into Paragraph",
        description: "Convert current block to plain text",
        keywords: ["turn into", "paragraph", "text"],
        run: (nextEditor) => {
          nextEditor.chain().focus().setParagraph().run();
        }
      },
      {
        key: "turn-h2",
        label: "Turn into Heading",
        description: "Convert current block to a heading",
        keywords: ["turn into", "heading", "title"],
        run: (nextEditor) => {
          nextEditor.chain().focus().setHeading({ level: 2 }).run();
        }
      },
      {
        key: "turn-bullet",
        label: "Turn into Bullet List",
        description: "Toggle bulleted list formatting",
        keywords: ["turn into", "bullet", "list"],
        run: (nextEditor) => {
          nextEditor.chain().focus().toggleBulletList().run();
        }
      },
      {
        key: "turn-numbered",
        label: "Turn into Numbered List",
        description: "Toggle numbered list formatting",
        keywords: ["turn into", "numbered", "ordered"],
        run: (nextEditor) => {
          nextEditor.chain().focus().toggleOrderedList().run();
        }
      },
      {
        key: "turn-checklist",
        label: "Toggle Checklist",
        description: "Convert to checklist style tasks",
        keywords: ["toggle list", "checklist", "tasks"],
        run: (nextEditor) => {
          nextEditor.chain().focus().toggleTaskList().run();
        }
      },
      {
        key: "insert-toggle",
        label: "Insert Toggle Section",
        description: "Add an expandable dropdown section",
        keywords: ["toggle", "details", "collapse", "dropdown"],
        run: (nextEditor) => {
          nextEditor.chain().focus().insertContent(createToggleSection()).run();
        }
      },
      {
        key: "color-blue",
        label: "Color: Blue Highlight",
        description: "Apply blue highlight to selection",
        keywords: ["color", "highlight", "blue"],
        run: (nextEditor) => {
          nextEditor.chain().focus().setHighlight({ color: "#B4E7FF" }).run();
        }
      },
      {
        key: "color-clear",
        label: "Color: Clear Highlight",
        description: "Remove highlight from selection",
        keywords: ["color", "clear", "remove"],
        run: (nextEditor) => {
          nextEditor.chain().focus().unsetHighlight().run();
        }
      },
      {
        key: "copy-block",
        label: "Copy Block Text",
        description: "Copy current block text to clipboard",
        keywords: ["copy", "link", "block"],
        run: copyCurrentBlockText
      },
      {
        key: "duplicate-block",
        label: "Duplicate Block",
        description: "Duplicate the current block",
        keywords: ["duplicate", "block"],
        run: duplicateCurrentBlock
      },
      {
        key: "delete-block",
        label: "Delete Block",
        description: "Delete the current block",
        keywords: ["delete", "remove", "block"],
        run: deleteCurrentBlock
      }
    ],
    [copyCurrentBlockText, deleteCurrentBlock, duplicateCurrentBlock]
  );

  const filteredActions = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return blockActions;
    }

    return blockActions.filter((item) => {
      const haystack = [item.label, item.description, ...item.keywords].join(" ").toLowerCase();
      return haystack.includes(normalized);
    });
  }, [blockActions, query]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    searchInputRef.current?.focus();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target)) {
        setIsOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    window.addEventListener("mousedown", handleOutsideClick);
    window.addEventListener("keydown", handleEscape);

    return () => {
      window.removeEventListener("mousedown", handleOutsideClick);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen]);

  return (
    <div
      ref={rootRef}
      className={`journal-block-actions${appearance === "notion" ? " journal-block-actions-notion" : ""}`}
    >
      <button
        type="button"
        className="journal-block-actions-trigger"
        aria-label="Block actions"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((current) => !current)}
      >
        + Actions
      </button>
      {isOpen ? (
        <div className="journal-block-actions-menu">
          <input
            ref={searchInputRef}
            className="journal-block-actions-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search actions..."
          />
          <div className="journal-block-actions-list" role="menu" aria-label="Block actions">
            {filteredActions.length === 0 ? (
              <div className="journal-block-actions-empty">No matching actions</div>
            ) : (
              filteredActions.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  role="menuitem"
                  className="journal-block-actions-item"
                  onClick={() => {
                    item.run(editor);
                    setQuery("");
                    setIsOpen(false);
                  }}
                >
                  <strong>{item.label}</strong>
                  <span>{item.description}</span>
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
};
