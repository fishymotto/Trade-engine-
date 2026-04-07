import type { Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";

interface JournalBubbleMenuProps {
  editor: Editor;
}

export const JournalBubbleMenu = ({ editor }: JournalBubbleMenuProps) => (
  <BubbleMenu editor={editor} options={{ onShow: () => undefined }} className="journal-bubble-menu">
    <button
      type="button"
      className={`journal-bubble-button ${editor.isActive("bold") ? "is-active" : ""}`}
      onClick={() => editor.chain().focus().toggleBold().run()}
    >
      Bold
    </button>
    <button
      type="button"
      className={`journal-bubble-button ${editor.isActive("italic") ? "is-active" : ""}`}
      onClick={() => editor.chain().focus().toggleItalic().run()}
    >
      Italic
    </button>
    <button
      type="button"
      className={`journal-bubble-button ${editor.isActive("strike") ? "is-active" : ""}`}
      onClick={() => editor.chain().focus().toggleStrike().run()}
    >
      Strike
    </button>
    <button
      type="button"
      className={`journal-bubble-button ${editor.isActive("code") ? "is-active" : ""}`}
      onClick={() => editor.chain().focus().toggleCode().run()}
    >
      Code
    </button>
  </BubbleMenu>
);
