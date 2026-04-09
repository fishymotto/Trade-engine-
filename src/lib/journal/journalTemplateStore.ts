import type { JSONContent } from "@tiptap/core";
import {
  createClosingChecklistDoc,
  createMorningChecklistDoc,
  hasJournalDocContent
} from "./journalContent";

const STORAGE_KEY = "trade-engine-journal-checklist-templates";

export interface NamedChecklistTemplate {
  id: string;
  name: string;
  content: JSONContent;
}

export interface JournalChecklistTemplates {
  morningTemplates: NamedChecklistTemplate[];
  closingTemplates: NamedChecklistTemplate[];
}

const createTemplate = (name: string, content: JSONContent): NamedChecklistTemplate => ({
  id: `template-${Math.random().toString(36).slice(2, 10)}`,
  name,
  content
});

const ensureTemplateArray = (
  value: unknown,
  fallbackName: string,
  fallbackFactory: () => JSONContent
): NamedChecklistTemplate[] => {
  if (Array.isArray(value) && value.length > 0) {
    const parsed = value
      .flatMap((entry) => {
        if (!entry || typeof entry !== "object") {
          return [];
        }

        const candidate = entry as Partial<NamedChecklistTemplate>;
        if (!candidate.name || !candidate.content || !hasJournalDocContent(candidate.content)) {
          return [];
        }

        return [
          {
            id: candidate.id || `template-${Math.random().toString(36).slice(2, 10)}`,
            name: candidate.name,
            content: candidate.content
          }
        ];
      });

    if (parsed.length > 0) {
      return parsed;
    }
  }

  return [createTemplate(fallbackName, fallbackFactory())];
};

export const defaultJournalChecklistTemplates = (): JournalChecklistTemplates => ({
  morningTemplates: [createTemplate("Default Morning", createMorningChecklistDoc())],
  closingTemplates: [createTemplate("Default Closing", createClosingChecklistDoc())]
});

export const getDefaultChecklistContent = (
  templates: JournalChecklistTemplates,
  type: "morning" | "closing"
): JSONContent =>
  (type === "morning" ? templates.morningTemplates[0] : templates.closingTemplates[0])?.content ??
  (type === "morning" ? createMorningChecklistDoc() : createClosingChecklistDoc());

export const loadJournalChecklistTemplates = (): JournalChecklistTemplates => {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return defaultJournalChecklistTemplates();
  }

  try {
    const parsed = JSON.parse(raw) as
      | Partial<JournalChecklistTemplates>
      | {
          morningChecklistContent?: JSONContent;
          closingChecklistContent?: JSONContent;
        };

    if ("morningChecklistContent" in parsed || "closingChecklistContent" in parsed) {
      return {
        morningTemplates: [
          createTemplate(
            "Default Morning",
            hasJournalDocContent(parsed.morningChecklistContent)
              ? (parsed.morningChecklistContent as JSONContent)
              : createMorningChecklistDoc()
          )
        ],
        closingTemplates: [
          createTemplate(
            "Default Closing",
            hasJournalDocContent(parsed.closingChecklistContent)
              ? (parsed.closingChecklistContent as JSONContent)
              : createClosingChecklistDoc()
          )
        ]
      };
    }

    const templateParsed = parsed as Partial<JournalChecklistTemplates>;

    return {
      morningTemplates: ensureTemplateArray(
        templateParsed.morningTemplates,
        "Default Morning",
        createMorningChecklistDoc
      ),
      closingTemplates: ensureTemplateArray(
        templateParsed.closingTemplates,
        "Default Closing",
        createClosingChecklistDoc
      )
    };
  } catch {
    return defaultJournalChecklistTemplates();
  }
};

export const saveJournalChecklistTemplates = (templates: JournalChecklistTemplates): void => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(templates));
};
