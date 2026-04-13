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

export const createMorningChecklistDoc = (): JSONContent =>
  createDoc([
    {
      type: "taskList",
      content: [
        {
          type: "taskItem",
          attrs: { checked: false },
          content: [createParagraphNode("Levels marked out")]
        },
        {
          type: "taskItem",
          attrs: { checked: false },
          content: [createParagraphNode("Catalysts reviewed")]
        },
        {
          type: "taskItem",
          attrs: { checked: false },
          content: [createParagraphNode("Primary watchlist confirmed")]
        },
        {
          type: "taskItem",
          attrs: { checked: false },
          content: [createParagraphNode("Risk limits reviewed")]
        }
      ]
    }
  ]);

export const createClosingChecklistDoc = (): JSONContent =>
  createDoc([
    {
      type: "taskList",
      content: [
        {
          type: "taskItem",
          attrs: { checked: false },
          content: [createParagraphNode("Fill out tickers traded")]
        },
        {
          type: "taskItem",
          attrs: { checked: false },
          content: [createParagraphNode("Add charts and screenshots")]
        },
        {
          type: "taskItem",
          attrs: { checked: false },
          content: [createParagraphNode("Review mistakes and lessons")]
        },
        {
          type: "taskItem",
          attrs: { checked: false },
          content: [createParagraphNode("Set tomorrow focus")]
        }
      ]
    }
  ]);

export const createMppPlanDoc = (): JSONContent =>
  createDoc([
    {
      type: "heading",
      attrs: { level: 2 },
      content: createTextContent("Objective")
    },
    createParagraphNode(
      "Stabilize equity curve, eliminate unforced errors, and build MPP through disciplined execution and controlled exposure."
    ),
    {
      type: "heading",
      attrs: { level: 2 },
      content: createTextContent("Key Focus")
    },
    {
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [createParagraphNode("Trade only A and A+ setups, no B trades to get active.")]
        },
        {
          type: "listItem",
          content: [createParagraphNode("Entry requires tape confirmation plus sector alignment, no exceptions.")]
        },
        {
          type: "listItem",
          content: [createParagraphNode("Prioritize fast profit capture, do not let green trades drift back to red.")]
        }
      ]
    },
    {
      type: "heading",
      attrs: { level: 2 },
      content: createTextContent("Execution Rules")
    },
    {
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [createParagraphNode("Risk stays fixed, no size increases until MPP is flat or positive.")]
        },
        {
          type: "listItem",
          content: [createParagraphNode("If the tape goes quiet or contradicts the thesis, flatten immediately.")]
        },
        {
          type: "listItem",
          content: [createParagraphNode("No revenge trades, no reclaiming losses.")]
        }
      ]
    }
  ]);

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
