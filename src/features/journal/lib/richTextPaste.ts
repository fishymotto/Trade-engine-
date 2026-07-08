import type { JSONContent } from "@tiptap/core";

type PastedListType = "bulletList" | "orderedList" | "taskList";

interface PendingPastedListItem {
  text: string;
  checked?: boolean;
}

const createCleanTextContent = (text: string): JSONContent[] | undefined => {
  const cleaned = text
    .replace(/\u00a0/g, " ")
    .replace(/\u200b/g, "")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label: string, url: string) => {
      const cleanLabel = label.trim();
      const cleanUrl = url.trim();
      return cleanLabel === cleanUrl ? cleanLabel : `${cleanLabel} (${cleanUrl})`;
    })
    .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, "$2")
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, "$1")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  return cleaned ? [{ type: "text", text: cleaned }] : undefined;
};

const createCleanParagraphNode = (text: string): JSONContent => {
  const content = createCleanTextContent(text);
  return content ? { type: "paragraph", content } : { type: "paragraph" };
};

const splitMarkdownTableRow = (rawLine: string): string[] => {
  const cells: string[] = [];
  let currentCell = "";

  for (let index = 0; index < rawLine.length; index += 1) {
    const character = rawLine[index];
    const nextCharacter = rawLine[index + 1];

    if (character === "\\" && nextCharacter === "|") {
      currentCell += "|";
      index += 1;
      continue;
    }

    if (character === "|") {
      cells.push(currentCell.trim());
      currentCell = "";
      continue;
    }

    currentCell += character;
  }

  cells.push(currentCell.trim());

  if (rawLine.trimStart().startsWith("|") && cells[0] === "") {
    cells.shift();
  }

  if (rawLine.trimEnd().endsWith("|") && cells[cells.length - 1] === "") {
    cells.pop();
  }

  return cells;
};

const isMarkdownTableDivider = (value: string): boolean => /^:?-{3,}:?$/.test(value.replace(/\s+/g, ""));

const normalizeTableCells = (cells: string[], columnCount: number): string[] =>
  Array.from({ length: columnCount }, (_, index) => cells[index] ?? "");

const createTableCellNode = (type: "tableHeader" | "tableCell", text: string): JSONContent => ({
  type,
  content: [createCleanParagraphNode(text)]
});

const createTableNode = (headerCells: string[], bodyRows: string[][]): JSONContent => ({
  type: "table",
  content: [
    {
      type: "tableRow",
      content: headerCells.map((cell) => createTableCellNode("tableHeader", cell))
    },
    ...bodyRows.map((row) => ({
      type: "tableRow",
      content: normalizeTableCells(row, headerCells.length).map((cell) => createTableCellNode("tableCell", cell))
    }))
  ]
});

const parseMarkdownTableAt = (
  lines: string[],
  startIndex: number
): { node: JSONContent; nextIndex: number } | null => {
  const headerLine = lines[startIndex] ?? "";
  const dividerLine = lines[startIndex + 1] ?? "";
  if (!headerLine.includes("|") || !dividerLine.includes("|")) {
    return null;
  }

  const headerCells = splitMarkdownTableRow(headerLine);
  const dividerCells = splitMarkdownTableRow(dividerLine);
  if (
    headerCells.length < 2 ||
    dividerCells.length !== headerCells.length ||
    !dividerCells.every(isMarkdownTableDivider)
  ) {
    return null;
  }

  const bodyRows: string[][] = [];
  let nextIndex = startIndex + 2;
  while (nextIndex < lines.length) {
    const line = lines[nextIndex] ?? "";
    if (!line.trim() || !line.includes("|")) {
      break;
    }

    const cells = splitMarkdownTableRow(line);
    if (cells.length < 2) {
      break;
    }

    bodyRows.push(cells);
    nextIndex += 1;
  }

  return {
    node: createTableNode(headerCells, bodyRows),
    nextIndex
  };
};

const parseFlattenedMarkdownTable = (rawText: string): JSONContent | null => {
  if (!rawText.includes("|") || rawText.includes("\n")) {
    return null;
  }

  const cells = splitMarkdownTableRow(rawText);
  const dividerStart = cells.findIndex(isMarkdownTableDivider);
  if (dividerStart < 2) {
    return null;
  }

  let dividerEnd = dividerStart;
  while (dividerEnd < cells.length && isMarkdownTableDivider(cells[dividerEnd] ?? "")) {
    dividerEnd += 1;
  }

  const columnCount = dividerEnd - dividerStart;
  const headerCells = cells.slice(0, dividerStart).filter(Boolean);
  if (columnCount < 2 || headerCells.length !== columnCount) {
    return null;
  }

  const bodyRows: string[][] = [];
  let currentRow: string[] = [];
  const remainingCells = cells.slice(dividerEnd);
  while (remainingCells[0] === "") {
    remainingCells.shift();
  }

  const flushRow = () => {
    if (currentRow.some(Boolean)) {
      bodyRows.push(normalizeTableCells(currentRow, columnCount));
    }
    currentRow = [];
  };

  for (const cell of remainingCells) {
    if (currentRow.length === columnCount) {
      flushRow();
      if (!cell) {
        continue;
      }
    }

    if (currentRow.length === 0 && !cell) {
      continue;
    }

    currentRow.push(cell);
  }
  flushRow();

  return bodyRows.length > 0 ? createTableNode(headerCells, bodyRows) : null;
};

export const createCleanPastedContent = (rawText: string): JSONContent[] => {
  const normalizedText = rawText.replace(/\r\n?/g, "\n");
  const flattenedTable = parseFlattenedMarkdownTable(normalizedText.trim());
  if (flattenedTable) {
    return [flattenedTable];
  }

  const nodes: JSONContent[] = [];
  const paragraphLines: string[] = [];
  let pendingListType: PastedListType | null = null;
  let pendingListItems: PendingPastedListItem[] = [];

  const flushParagraph = () => {
    if (paragraphLines.length === 0) {
      return;
    }

    nodes.push(createCleanParagraphNode(paragraphLines.join(" ")));
    paragraphLines.length = 0;
  };

  const flushList = () => {
    if (!pendingListType || pendingListItems.length === 0) {
      pendingListType = null;
      pendingListItems = [];
      return;
    }

    if (pendingListType === "taskList") {
      nodes.push({
        type: "taskList",
        content: pendingListItems.map((item) => ({
          type: "taskItem",
          attrs: { checked: item.checked ?? false },
          content: [createCleanParagraphNode(item.text)]
        }))
      });
    } else {
      nodes.push({
        type: pendingListType,
        content: pendingListItems.map((item) => ({
          type: "listItem",
          content: [createCleanParagraphNode(item.text)]
        }))
      });
    }

    pendingListType = null;
    pendingListItems = [];
  };

  const pushListItem = (type: PastedListType, item: PendingPastedListItem) => {
    flushParagraph();
    if (pendingListType && pendingListType !== type) {
      flushList();
    }

    pendingListType = type;
    pendingListItems.push(item);
  };

  const lines = normalizedText.split("\n");

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const table = parseMarkdownTableAt(lines, lineIndex);
    if (table) {
      flushParagraph();
      flushList();
      nodes.push(table.node);
      lineIndex = table.nextIndex - 1;
      continue;
    }

    const rawLine = lines[lineIndex] ?? "";
    const trimmed = rawLine.trim();

    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }

    if (/^(```|~~~)/.test(trimmed)) {
      flushParagraph();
      flushList();
      continue;
    }

    if (/^[-*_]{3,}$/.test(trimmed)) {
      flushParagraph();
      flushList();
      nodes.push({ type: "horizontalRule" });
      continue;
    }

    const line = trimmed.replace(/^>\s?/, "");
    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      flushParagraph();
      flushList();
      const content = createCleanTextContent(headingMatch[2] ?? "");
      nodes.push({
        type: "heading",
        attrs: { level: Math.min(headingMatch[1]?.length ?? 1, 3) },
        ...(content ? { content } : {})
      });
      continue;
    }

    const taskMatch = line.match(/^[-*+•]\s+\[([ xX])\]\s+(.+)$/);
    if (taskMatch) {
      pushListItem("taskList", {
        checked: (taskMatch[1] ?? "").toLowerCase() === "x",
        text: taskMatch[2] ?? ""
      });
      continue;
    }

    const bulletMatch = line.match(/^[-*+•]\s+(.+)$/);
    if (bulletMatch) {
      pushListItem("bulletList", { text: bulletMatch[1] ?? "" });
      continue;
    }

    const orderedMatch = line.match(/^\d+[.)]\s+(.+)$/);
    if (orderedMatch) {
      pushListItem("orderedList", { text: orderedMatch[1] ?? "" });
      continue;
    }

    flushList();
    paragraphLines.push(line);
  }

  flushParagraph();
  flushList();

  return nodes.length > 0 ? nodes : [createCleanParagraphNode(rawText)];
};

const hasExternalEditorHtml = (html: string): boolean => Boolean(html.trim()) && !html.includes("data-pm-slice");

const hasMarkdownPasteArtifacts = (text: string): boolean =>
  /(^|\n)\s*(```|~~~|#{1,3}\s|[-*+•]\s+|\d+[.)]\s+|>\s+|\[[ xX]\]\s+)/.test(text) ||
  /(\*\*|__|~~|`[^`\n]+`|\[[^\]]+\]\([^)]+\))/.test(text) ||
  /(^|\n)\s*\|?.+\|.+\n\s*\|?\s*:?-{3,}:?\s*\|/.test(text);

export const shouldNormalizePastedText = (text: string, html: string): boolean => {
  if (!text.trim()) {
    return false;
  }

  if (hasExternalEditorHtml(html)) {
    return true;
  }

  return hasMarkdownPasteArtifacts(text);
};
