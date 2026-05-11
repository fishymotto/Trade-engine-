import { createEmptyJournalDoc } from "../../../lib/journal/journalContent";
import {
  getDefaultChecklistContent,
  type JournalChecklistTemplates,
  type NamedChecklistTemplate
} from "../../../lib/journal/journalTemplateStore";
import type { JournalContentField, JournalPageRecord } from "../../../types/journal";

type JournalChecklistTemplateType = "morning" | "closing" | "mpp";
type JournalChecklistTemplateKey = "morningTemplates" | "closingTemplates" | "mppTemplates";

export type JournalPageUpdates = Partial<
  Pick<
    JournalPageRecord,
    | "title"
    | "tradeDate"
    | "dayGrade"
    | "marketRegime"
    | "mpp"
    | "sleepHours"
    | "sleepScore"
    | "morningMood"
    | "openMood"
    | "afternoonMood"
    | "closeMood"
    | "screenshotUrls"
    | "screenshotTags"
  >
>;

interface CreateJournalPageActionsOptions {
  getJournalPages: () => JournalPageRecord[];
  journalChecklistTemplates: JournalChecklistTemplates;
  persistJournalPages: (nextPages: JournalPageRecord[]) => void;
  setSelectedJournalPageId: (pageId: string) => void;
  setJournalChecklistTemplates: (
    updater: (current: JournalChecklistTemplates) => JournalChecklistTemplates
  ) => void;
  setMessage: (message: string) => void;
}

interface CreateMissingJournalPagesOptions {
  currentPages: JournalPageRecord[];
  tradeDates: string[];
  checklistTemplates: JournalChecklistTemplates;
  startTimestamp?: number;
}

export interface JournalPageActions {
  createJournalPage: (tradeDate: string) => void;
  updateJournalPage: (pageId: string, updates: JournalPageUpdates) => void;
  updateJournalContent: (
    pageId: string,
    field: JournalContentField,
    content: JournalPageRecord[JournalContentField]
  ) => void;
  saveJournalChecklistTemplateAs: (
    type: JournalChecklistTemplateType,
    name: string,
    content: NamedChecklistTemplate["content"]
  ) => void;
  updateJournalChecklistTemplate: (
    type: JournalChecklistTemplateType,
    templateId: string,
    content: NamedChecklistTemplate["content"]
  ) => void;
  deleteJournalChecklistTemplate: (type: JournalChecklistTemplateType, templateId: string) => void;
}

const sortJournalPagesByTradeDateDesc = (pages: JournalPageRecord[]): JournalPageRecord[] =>
  [...pages].sort((left, right) => right.tradeDate.localeCompare(left.tradeDate));

const buildJournalTemplate = (checklistTemplates: JournalChecklistTemplates) => ({
  title: "Daily Journal",
  dayGrade: "",
  marketRegime: "",
  mpp: "",
  sleepHours: "",
  sleepScore: "",
  morningMood: "",
  openMood: "",
  afternoonMood: "",
  closeMood: "",
  screenshotUrls: [],
  screenshotTags: [],
  closingChecklistContent: getDefaultChecklistContent(checklistTemplates, "closing"),
  morningChecklistContent: getDefaultChecklistContent(checklistTemplates, "morning"),
  morningContent: createEmptyJournalDoc(),
  closingContent: createEmptyJournalDoc(),
  mppPlanContent: getDefaultChecklistContent(checklistTemplates, "mpp"),
  inPlayStocksContent: createEmptyJournalDoc(),
  traderReachOutsContent: createEmptyJournalDoc(),
  notesContent: createEmptyJournalDoc()
});

const getTemplateKey = (type: JournalChecklistTemplateType): JournalChecklistTemplateKey =>
  type === "morning" ? "morningTemplates" : type === "closing" ? "closingTemplates" : "mppTemplates";

const getTemplateLabel = (type: JournalChecklistTemplateType): string =>
  type === "morning" ? "Morning" : type === "closing" ? "Closing" : "MPP";

export const normalizeJournalTradeDate = (value: string): string => {
  if (!value) {
    return "";
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toISOString().slice(0, 10);
};

export const createJournalPageRecord = (
  tradeDate: string,
  checklistTemplates: JournalChecklistTemplates,
  timestamp: string
): JournalPageRecord => {
  const templateContent = buildJournalTemplate(checklistTemplates);

  return {
    id: `journal-${tradeDate}-${timestamp}`,
    title: templateContent.title,
    tradeDate,
    dayGrade: templateContent.dayGrade,
    marketRegime: templateContent.marketRegime,
    mpp: templateContent.mpp,
    sleepHours: templateContent.sleepHours,
    sleepScore: templateContent.sleepScore,
    morningMood: templateContent.morningMood,
    openMood: templateContent.openMood,
    afternoonMood: templateContent.afternoonMood,
    closeMood: templateContent.closeMood,
    screenshotUrls: templateContent.screenshotUrls,
    screenshotTags: templateContent.screenshotTags,
    closingChecklistContent: templateContent.closingChecklistContent,
    morningChecklistContent: templateContent.morningChecklistContent,
    morningContent: templateContent.morningContent,
    closingContent: templateContent.closingContent,
    mppPlanContent: templateContent.mppPlanContent,
    inPlayStocksContent: templateContent.inPlayStocksContent,
    traderReachOutsContent: templateContent.traderReachOutsContent,
    notesContent: templateContent.notesContent,
    morningBlocks: [],
    closingBlocks: [],
    mppPlanBlocks: [],
    blocks: [],
    createdAt: timestamp,
    updatedAt: timestamp
  };
};

export const createMissingJournalPages = ({
  currentPages,
  tradeDates,
  checklistTemplates,
  startTimestamp = Date.now()
}: CreateMissingJournalPagesOptions): JournalPageRecord[] => {
  const existingDates = new Set(currentPages.map((page) => normalizeJournalTradeDate(page.tradeDate)));
  const missingDates = tradeDates.filter((tradeDate) => !existingDates.has(tradeDate));

  if (missingDates.length === 0) {
    return [];
  }

  const sortedMissingDates = [...missingDates].sort((left, right) => left.localeCompare(right));
  const missingPages: JournalPageRecord[] = [];

  for (const [index, tradeDate] of sortedMissingDates.entries()) {
    const nextPage = createJournalPageRecord(tradeDate, checklistTemplates, new Date(startTimestamp + index).toISOString());
    missingPages.push(nextPage);
  }

  return missingPages;
};

export const createJournalPageActions = ({
  getJournalPages,
  journalChecklistTemplates,
  persistJournalPages,
  setSelectedJournalPageId,
  setJournalChecklistTemplates,
  setMessage
}: CreateJournalPageActionsOptions): JournalPageActions => {
  const createJournalPage = (tradeDate: string) => {
    const normalizedTradeDate = normalizeJournalTradeDate(tradeDate.trim());
    if (!normalizedTradeDate) {
      return;
    }

    const currentPages = getJournalPages();
    const existingPage = currentPages.find((page) => page.tradeDate === normalizedTradeDate);
    if (existingPage) {
      setSelectedJournalPageId(existingPage.id);
      setMessage(`Opened the existing journal page for ${normalizedTradeDate}.`);
      return;
    }

    const timestamp = new Date().toISOString();
    const newPage = createJournalPageRecord(normalizedTradeDate, journalChecklistTemplates, timestamp);
    persistJournalPages(sortJournalPagesByTradeDateDesc([...currentPages, newPage]));
    setSelectedJournalPageId(newPage.id);
  };

  const updateJournalPage = (pageId: string, updates: JournalPageUpdates) => {
    setSelectedJournalPageId(pageId);
    const nextPages = getJournalPages().map((page) =>
      page.id === pageId
        ? {
            ...page,
            ...updates,
            tradeDate: updates.tradeDate ? normalizeJournalTradeDate(updates.tradeDate) : page.tradeDate,
            updatedAt: new Date().toISOString()
          }
        : page
    );
    persistJournalPages(sortJournalPagesByTradeDateDesc(nextPages));
  };

  const updateJournalContent = (
    pageId: string,
    field: JournalContentField,
    content: JournalPageRecord[JournalContentField]
  ) => {
    const nextPages = getJournalPages().map((page) =>
      page.id === pageId
        ? {
            ...page,
            [field]: content,
            updatedAt: new Date().toISOString()
          }
        : page
    );
    persistJournalPages(nextPages);
  };

  const saveJournalChecklistTemplateAs = (
    type: JournalChecklistTemplateType,
    name: string,
    content: NamedChecklistTemplate["content"]
  ) => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      return;
    }

    const templateKey = getTemplateKey(type);

    setJournalChecklistTemplates((current) => ({
      ...current,
      [templateKey]: [
        ...current[templateKey].filter((template) => template.name.toLowerCase() !== trimmedName.toLowerCase()),
        {
          id: `template-${Date.now()}`,
          name: trimmedName,
          content
        }
      ]
    }));
    setMessage(`${getTemplateLabel(type)} template "${trimmedName}" saved.`);
  };

  const updateJournalChecklistTemplate = (
    type: JournalChecklistTemplateType,
    templateId: string,
    content: NamedChecklistTemplate["content"]
  ) => {
    if (!templateId) {
      return;
    }

    const templateKey = getTemplateKey(type);

    setJournalChecklistTemplates((current) => {
      const templates = current[templateKey];

      if (!templates.some((template) => template.id === templateId)) {
        return current;
      }

      return {
        ...current,
        [templateKey]: templates.map((template) => (template.id === templateId ? { ...template, content } : template))
      };
    });

    setMessage(`${getTemplateLabel(type)} template updated.`);
  };

  const deleteJournalChecklistTemplate = (type: JournalChecklistTemplateType, templateId: string) => {
    const templateKey = getTemplateKey(type);

    setJournalChecklistTemplates((current) => {
      const templates = current[templateKey];

      if (templates.length <= 1) {
        return current;
      }

      const nextTemplates = templates.filter((template) => template.id !== templateId);
      if (nextTemplates.length === templates.length) {
        return current;
      }

      return {
        ...current,
        [templateKey]: nextTemplates
      };
    });

    setMessage(`${getTemplateLabel(type)} template deleted.`);
  };

  return {
    createJournalPage,
    updateJournalPage,
    updateJournalContent,
    saveJournalChecklistTemplateAs,
    updateJournalChecklistTemplate,
    deleteJournalChecklistTemplate
  };
};
