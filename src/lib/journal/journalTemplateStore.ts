import type { JSONContent } from "@tiptap/core";
import {
  createClosingChecklistDoc,
  createMppPlanDoc,
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
  mppTemplates: NamedChecklistTemplate[];
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
  closingTemplates: [createTemplate("Default Closing", createClosingChecklistDoc())],
  mppTemplates: [createTemplate("Default MPP", createMppPlanDoc())]
});

export const getDefaultChecklistContent = (
  templates: JournalChecklistTemplates,
  type: "morning" | "closing" | "mpp"
): JSONContent =>
  (
    type === "morning"
      ? templates.morningTemplates[0]
      : type === "closing"
        ? templates.closingTemplates[0]
        : templates.mppTemplates[0]
  )?.content ??
  (
    type === "morning"
      ? createMorningChecklistDoc()
      : type === "closing"
        ? createClosingChecklistDoc()
        : createMppPlanDoc()
  );

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
          mppPlanContent?: JSONContent;
        };

    if ("morningChecklistContent" in parsed || "closingChecklistContent" in parsed || "mppPlanContent" in parsed) {
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
        ],
        mppTemplates: [
          createTemplate(
            "Default MPP",
            hasJournalDocContent(parsed.mppPlanContent)
              ? (parsed.mppPlanContent as JSONContent)
              : createMppPlanDoc()
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
      ),
      mppTemplates: ensureTemplateArray(
        templateParsed.mppTemplates,
        "Default MPP",
        createMppPlanDoc
      )
    };
  } catch {
    return defaultJournalChecklistTemplates();
  }
};

export const saveJournalChecklistTemplates = (templates: JournalChecklistTemplates): void => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(templates));
};
