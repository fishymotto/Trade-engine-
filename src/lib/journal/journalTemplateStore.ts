import type { JSONContent } from "@tiptap/core";
import {
  createClosingChecklistDoc,
  createMppPlanDoc,
  createMorningChecklistDoc,
  hasJournalDocContent
} from "./journalContent";
import { canUseMachineLegacyData, syncStores } from "../sync/syncStore";
import { loadDesktopStoreBackup, saveDesktopStoreBackup } from "../storage/desktopStoreBackup";

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

const stableStringify = (value: unknown): string => {
  if (value === null || value === undefined) {
    return JSON.stringify(value);
  }

  if (typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
};

const stripTemplateIdsForComparison = (templates: JournalChecklistTemplates): JournalChecklistTemplates => ({
  morningTemplates: templates.morningTemplates.map(({ name, content }) => ({ id: "", name, content })),
  closingTemplates: templates.closingTemplates.map(({ name, content }) => ({ id: "", name, content })),
  mppTemplates: templates.mppTemplates.map(({ name, content }) => ({ id: "", name, content }))
});

const getComparableTemplatesScore = (templates: JournalChecklistTemplates): string =>
  stableStringify(stripTemplateIdsForComparison(templates));

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
  try {
    const parsed = syncStores.journalChecklistTemplates.load<
      | Partial<JournalChecklistTemplates>
      | {
          morningChecklistContent?: JSONContent;
          closingChecklistContent?: JSONContent;
          mppPlanContent?: JSONContent;
        }
    >(defaultJournalChecklistTemplates());

    if (!parsed) {
      return defaultJournalChecklistTemplates();
    }

    const parsedRecord = parsed as
      | Partial<JournalChecklistTemplates>
      | {
          morningChecklistContent?: JSONContent;
          closingChecklistContent?: JSONContent;
          mppPlanContent?: JSONContent;
        };

    if (
      "morningChecklistContent" in parsedRecord ||
      "closingChecklistContent" in parsedRecord ||
      "mppPlanContent" in parsedRecord
    ) {
      return {
        morningTemplates: [
          createTemplate(
            "Default Morning",
            hasJournalDocContent(parsedRecord.morningChecklistContent)
              ? (parsedRecord.morningChecklistContent as JSONContent)
              : createMorningChecklistDoc()
          )
        ],
        closingTemplates: [
          createTemplate(
            "Default Closing",
            hasJournalDocContent(parsedRecord.closingChecklistContent)
              ? (parsedRecord.closingChecklistContent as JSONContent)
              : createClosingChecklistDoc()
          )
        ],
        mppTemplates: [
          createTemplate(
            "Default MPP",
            hasJournalDocContent(parsedRecord.mppPlanContent)
              ? (parsedRecord.mppPlanContent as JSONContent)
              : createMppPlanDoc()
          )
        ]
      };
    }

    const templateParsed = parsedRecord as Partial<JournalChecklistTemplates>;

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

export const persistJournalChecklistTemplates = async (
  templates: JournalChecklistTemplates
): Promise<JournalChecklistTemplates> => {
  const normalized = {
    morningTemplates: ensureTemplateArray(templates.morningTemplates, "Default Morning", createMorningChecklistDoc),
    closingTemplates: ensureTemplateArray(templates.closingTemplates, "Default Closing", createClosingChecklistDoc),
    mppTemplates: ensureTemplateArray(templates.mppTemplates, "Default MPP", createMppPlanDoc)
  };
  const syncPromise = syncStores.journalChecklistTemplates.save(normalized);
  const activeUserId = syncStores.journalChecklistTemplates.getUserId();

  if (canUseMachineLegacyData(activeUserId)) {
    try {
      await saveDesktopStoreBackup("journal-checklist-templates", normalized);
    } catch (error) {
      console.warn("[journal-templates] Failed to save desktop journal checklist backup.", error);
    }
  }

  await syncPromise;
  return normalized;
};

export const recoverJournalChecklistTemplatesFromDesktopBackup = async (
  localTemplates = loadJournalChecklistTemplates()
): Promise<JournalChecklistTemplates | null> => {
  const activeUserId = syncStores.journalChecklistTemplates.getUserId();
  if (!canUseMachineLegacyData(activeUserId)) {
    return null;
  }

  const desktopTemplates = await loadDesktopStoreBackup<JournalChecklistTemplates>("journal-checklist-templates");
  if (!desktopTemplates) {
    return null;
  }

  const normalizedDesktopTemplates = {
    morningTemplates: ensureTemplateArray(desktopTemplates.morningTemplates, "Default Morning", createMorningChecklistDoc),
    closingTemplates: ensureTemplateArray(desktopTemplates.closingTemplates, "Default Closing", createClosingChecklistDoc),
    mppTemplates: ensureTemplateArray(desktopTemplates.mppTemplates, "Default MPP", createMppPlanDoc)
  };

  const localScore = getComparableTemplatesScore(localTemplates);
  const desktopScore = getComparableTemplatesScore(normalizedDesktopTemplates);
  const defaultScore = getComparableTemplatesScore(defaultJournalChecklistTemplates());
  if (desktopScore === defaultScore || (localScore !== defaultScore && localScore === desktopScore)) {
    return null;
  }

  if (localScore !== defaultScore && localScore !== desktopScore) {
    return null;
  }

  await persistJournalChecklistTemplates(normalizedDesktopTemplates);
  return normalizedDesktopTemplates;
};

export const saveJournalChecklistTemplates = (
  templates: JournalChecklistTemplates
): Promise<JournalChecklistTemplates> => persistJournalChecklistTemplates(templates);
