import type { JSONContent } from "@tiptap/core";
import type { JournalBlock } from "../../types/journal";

const createTextContent = (text: string): JSONContent[] | undefined =>
  text ? [{ type: "text", text }] : undefined;

const createParagraphNode = (text = ""): JSONContent => ({
  type: "paragraph",
  content: createTextContent(text)
});

const createDoc = (content: JSONContent[]): JSONContent => ({
  type: "doc",
  content: content.length > 0 ? content : [createParagraphNode("")]
});

export const createEmptyJournalDoc = (): JSONContent => createDoc([createParagraphNode("")]);

export const hasJournalDocContent = (content?: JSONContent | null): boolean => {
  if (!content || content.type !== "doc" || !Array.isArray(content.content)) {
    return false;
  }

  return content.content.some((node) => {
    if (node.type === "horizontalRule") {
      return true;
    }

    const textContent = Array.isArray(node.content)
      ? node.content
          .flatMap((child) => ("text" in child && typeof child.text === "string" ? [child.text] : []))
          .join("")
          .trim()
      : "";

    if (textContent) {
      return true;
    }

    if (Array.isArray(node.content)) {
      return node.content.some((child) => {
        if (child.type === "taskItem" || child.type === "listItem") {
          return true;
        }
        return false;
      });
    }

    return false;
  });
};

export const journalBlocksToDoc = (blocks: JournalBlock[]): JSONContent => {
  const nodes: JSONContent[] = [];
  const bulletBuffer: string[] = [];
  const checklistBuffer: Array<{ text: string; checked: boolean }> = [];

  const flushBuffers = () => {
    if (bulletBuffer.length > 0) {
      nodes.push({
        type: "bulletList",
        content: bulletBuffer.map((text) => ({
          type: "listItem",
          content: [createParagraphNode(text)]
        }))
      });
      bulletBuffer.length = 0;
    }

    if (checklistBuffer.length > 0) {
      nodes.push({
        type: "taskList",
        content: checklistBuffer.map((item) => ({
          type: "taskItem",
          attrs: { checked: item.checked },
          content: [createParagraphNode(item.text)]
        }))
      });
      checklistBuffer.length = 0;
    }
  };

  for (const block of blocks) {
    switch (block.type) {
      case "bullet":
        bulletBuffer.push(block.text);
        break;
      case "checklist":
        checklistBuffer.push({ text: block.text, checked: Boolean(block.checked) });
        break;
      case "divider":
        flushBuffers();
        nodes.push({ type: "horizontalRule" });
        break;
      case "heading1":
      case "heading2":
      case "heading3":
        flushBuffers();
        nodes.push({
          type: "heading",
          attrs: {
            level:
              block.type === "heading1" ? 1 : block.type === "heading2" ? 2 : 3
          },
          content: createTextContent(block.text)
        });
        break;
      case "quote":
      case "callout":
        flushBuffers();
        nodes.push({
          type: "blockquote",
          content: [createParagraphNode(block.text)]
        });
        break;
      case "paragraph":
      default:
        flushBuffers();
        nodes.push(createParagraphNode(block.text));
        break;
    }
  }

  flushBuffers();
  return createDoc(nodes);
};
