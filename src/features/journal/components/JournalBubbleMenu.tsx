import type { Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { useCallback, useRef, useState } from "react";

interface JournalBubbleMenuProps {
  editor: Editor;
  onImageInsert?: (file: File) => Promise<unknown>;
  imageUploadInProgress?: boolean;
  appearance?: "default" | "notion";
}

const IconButton = ({
  active,
  icon,
  label,
  onClick,
  disabled = false
}: {
  active: boolean;
  icon: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) => (
  <button
    type="button"
    title={label}
    aria-label={label}
    disabled={disabled}
    className={`journal-bubble-button ${active ? "is-active" : ""}`}
    onClick={onClick}
  >
    <span className="journal-bubble-icon">{icon}</span>
  </button>
);

export const JournalBubbleMenu = ({
  editor,
  onImageInsert,
  imageUploadInProgress = false,
  appearance = "default"
}: JournalBubbleMenuProps) => {
  const [linkUrl, setLinkUrl] = useState("");
  const [showLinkInput, setShowLinkInput] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const handleAddLink = useCallback(() => {
    if (!linkUrl) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }

    editor
      .chain()
      .focus()
      .extendMarkRange("link")
      .setLink({ href: linkUrl })
      .run();

    setLinkUrl("");
    setShowLinkInput(false);
  }, [editor, linkUrl]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleAddLink();
    } else if (e.key === "Escape") {
      setShowLinkInput(false);
      setLinkUrl("");
    }
  };

  const handleImageSelect = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.currentTarget.files?.[0];
      if (!file) {
        return;
      }

      try {
        if (onImageInsert) {
          await onImageInsert(file);
        } else {
          const reader = new FileReader();
          const imageUrl = await new Promise<string>((resolve) => {
            reader.onload = (e) => {
              resolve(e.target?.result as string);
            };
            reader.readAsDataURL(file);
          });

          editor.chain().focus().setImage({ src: imageUrl, alt: file.name }).run();
        }
      } catch (error) {
        console.error("Failed to insert image:", error);
      }

      if (imageInputRef.current) {
        imageInputRef.current.value = "";
      }
    },
    [editor, onImageInsert]
  );

  return (
    <BubbleMenu
      editor={editor}
      options={{ onShow: () => undefined }}
      className={`journal-bubble-menu${appearance === "notion" ? " journal-bubble-menu-notion" : ""}`}
    >
      <div className="journal-bubble-section">
        <IconButton
          icon="B"
          label="Bold"
          active={editor.isActive("bold")}
          onClick={() => editor.chain().focus().toggleBold().run()}
        />
        <IconButton
          icon="I"
          label="Italic"
          active={editor.isActive("italic")}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        />
        <IconButton
          icon="U"
          label="Underline"
          active={editor.isActive("underline")}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
        />
        <IconButton
          icon="S"
          label="Strikethrough"
          active={editor.isActive("strike")}
          onClick={() => editor.chain().focus().toggleStrike().run()}
        />
      </div>

      <div className="journal-bubble-divider" />

      <div className="journal-bubble-section">
        <IconButton
          icon="</>"
          label="Code"
          active={editor.isActive("code")}
          onClick={() => editor.chain().focus().toggleCode().run()}
        />
        <IconButton
          icon="HL"
          label="Highlight"
          active={editor.isActive("highlight")}
          onClick={() => {
            const currentColor = editor.getAttributes("highlight").color;
            const colors = ["#FFF4B4", "#B4E7FF", "#B4FFB4", "#FFB4B4", "#E7D5FF"];
            const currentIndex = colors.indexOf(currentColor || "");
            const nextColor = colors[(currentIndex + 1) % colors.length];
            editor.chain().focus().toggleHighlight({ color: nextColor }).run();
          }}
        />
        <IconButton
          icon="x2"
          label="Subscript"
          active={editor.isActive("subscript")}
          onClick={() => editor.chain().focus().toggleSubscript().run()}
        />
        <IconButton
          icon="x^2"
          label="Superscript"
          active={editor.isActive("superscript")}
          onClick={() => editor.chain().focus().toggleSuperscript().run()}
        />
      </div>

      <div className="journal-bubble-divider" />

      <div className="journal-bubble-section">
        {!showLinkInput ? (
          <IconButton
            icon="Link"
            label="Link"
            active={editor.isActive("link")}
            onClick={() => {
              const url = editor.getAttributes("link").href;
              setLinkUrl(url || "");
              setShowLinkInput(true);
            }}
          />
        ) : (
          <div className="journal-link-input-container">
            <input
              autoFocus
              type="url"
              className="journal-link-input"
              placeholder="https://example.com"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            <button
              type="button"
              className="journal-link-confirm"
              onClick={handleAddLink}
              title="Apply link"
            >
              OK
            </button>
            <button
              type="button"
              className="journal-link-cancel"
              onClick={() => {
                setShowLinkInput(false);
                setLinkUrl("");
              }}
              title="Cancel"
            >
              X
            </button>
          </div>
        )}
      </div>

      <div className="journal-bubble-divider" />

      <div className="journal-bubble-section">
        <input
          ref={imageInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
          className="journal-image-input"
          onChange={handleImageSelect}
        />
        <IconButton
          icon="Img"
          label={imageUploadInProgress ? "Uploading image" : "Image"}
          active={editor.isActive("image")}
          disabled={imageUploadInProgress}
          onClick={() => imageInputRef.current?.click()}
        />
        <IconButton
          icon="Tgl"
          label="Toggle"
          active={editor.isActive("details")}
          onClick={() => {
            editor
              .chain()
              .focus()
              .insertContent({
                type: "details",
                attrs: { open: true },
                content: [
                  {
                    type: "detailsSummary",
                    content: [{ type: "text", text: "Expandable section" }]
                  },
                  {
                    type: "detailsContent",
                    content: [{ type: "paragraph" }]
                  }
                ]
              })
              .run();
          }}
        />
        <IconButton
          icon="List"
          label="Bullet list"
          active={editor.isActive("bulletList")}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        />
      </div>
    </BubbleMenu>
  );
};
