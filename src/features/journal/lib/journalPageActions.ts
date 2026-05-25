import { createEmptyJournalDoc, hasJournalDocContent } from "../../../lib/journal/journalContent";
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
    | "tradeNotes"
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
  createJournalPages: (tradeDates: string[]) => void;
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

const formatDateInputValue = (value: Date) => {
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, "0");
  const day = `${value.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export const getJournalWeekStartDate = (tradeDate: string): string => {
  const normalized = normalizeJournalTradeDate(tradeDate);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return normalized;
  }

  const date = new Date(`${normalized}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return normalized;
  }

  const mondayOffset = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - mondayOffset);
  return formatDateInputValue(date);
};

const isSameJournalWeek = (leftTradeDate: string, rightTradeDate: string): boolean =>
  Boolean(leftTradeDate && rightTradeDate) &&
  getJournalWeekStartDate(leftTradeDate) === getJournalWeekStartDate(rightTradeDate);

const getWeeklyEarningsContentForTradeDate = (
  pages: JournalPageRecord[],
  tradeDate: string
): JournalPageRecord["weeklyEarningsContent"] => {
  const sameWeekPages = pages
    .filter((page) => isSameJournalWeek(page.tradeDate, tradeDate))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const pageWithContent = sameWeekPages.find((page) => hasJournalDocContent(page.weeklyEarningsContent));
  return pageWithContent?.weeklyEarningsContent ?? sameWeekPages[0]?.weeklyEarningsContent ?? createEmptyJournalDoc();
};

const buildJournalTemplate = (
  checklistTemplates: JournalChecklistTemplates,
  weeklyEarningsContent: JournalPageRecord["weeklyEarningsContent"] = createEmptyJournalDoc()
) => ({
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
  tradeNotes: [],
  closingChecklistContent: getDefaultChecklistContent(checklistTemplates, "closing"),
  morningChecklistContent: getDefaultChecklistContent(checklistTemplates, "morning"),
  morningContent: createEmptyJournalDoc(),
  closingContent: createEmptyJournalDoc(),
  mppPlanContent: getDefaultChecklistContent(checklistTemplates, "mpp"),
  weeklyEarningsContent,
  inPlayStocksContent: createEmptyJournalDoc(),
  traderReachOutsContent: createEmptyJournalDoc(),
  notesContent: createEmptyJournalDoc()
});

const getTemplateKey = (type: JournalChecklistTemplateType): JournalChecklistTemplateKey =>
  type === "morning" ? "morningTemplates" : type === "closing" ? "closingTemplates" : "mppTemplates";

const getTemplateLabel = (type: JournalChecklistTemplateType): string =>
  type === "morning" ? "Morning" : type === "closing" ? "Closing" : "MPP";

const formatTradeDateRangeLabel = (tradeDates: string[]): string => {
  if (tradeDates.length === 0) {
    return "";
  }

  if (tradeDates.length === 1) {
    return tradeDates[0];
  }

  return `${tradeDates[0]} through ${tradeDates[tradeDates.length - 1]}`;
};

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
  timestamp: string,
  options?: {
    weeklyEarningsContent?: JournalPageRecord["weeklyEarningsContent"];
  }
): JournalPageRecord => {
  const templateContent = buildJournalTemplate(checklistTemplates, options?.weeklyEarningsContent);

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
    tradeNotes: templateContent.tradeNotes,
    closingChecklistContent: templateContent.closingChecklistContent,
    morningChecklistContent: templateContent.morningChecklistContent,
    morningContent: templateContent.morningContent,
    closingContent: templateContent.closingContent,
    mppPlanContent: templateContent.mppPlanContent,
    weeklyEarningsContent: templateContent.weeklyEarningsContent,
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
    const nextPage = createJournalPageRecord(
      tradeDate,
      checklistTemplates,
      new Date(startTimestamp + index).toISOString(),
      {
        weeklyEarningsContent: getWeeklyEarningsContentForTradeDate(
          [...currentPages, ...missingPages],
          tradeDate
        )
      }
    );
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
  const createJournalPages = (tradeDates: string[]) => {
    const normalizedTradeDates = Array.from(
      new Set(
        tradeDates
          .map((tradeDate) => normalizeJournalTradeDate(tradeDate.trim()))
          .filter((tradeDate) => tradeDate.length > 0)
      )
    ).sort((left, right) => left.localeCompare(right));

    if (normalizedTradeDates.length === 0) {
      return;
    }

    const currentPages = getJournalPages();
    const missingPages = createMissingJournalPages({
      currentPages,
      tradeDates: normalizedTradeDates,
      checklistTemplates: journalChecklistTemplates,
      startTimestamp: Date.now()
    });
    const nextPages =
      missingPages.length > 0 ? sortJournalPagesByTradeDateDesc([...currentPages, ...missingPages]) : currentPages;
    const pageToSelect =
      nextPages.find((page) => page.tradeDate === normalizedTradeDates[0]) ??
      missingPages[0] ??
      null;

    if (missingPages.length > 0) {
      persistJournalPages(nextPages);
    }

    if (pageToSelect) {
      setSelectedJournalPageId(pageToSelect.id);
    }

    if (normalizedTradeDates.length <= 1) {
      return;
    }

    const rangeLabel = formatTradeDateRangeLabel(normalizedTradeDates);
    if (missingPages.length === 0) {
      setMessage(`Journal pages for ${rangeLabel} already exist.`);
      return;
    }

    const existingCount = normalizedTradeDates.length - missingPages.length;
    setMessage(
      existingCount > 0
        ? `Added ${missingPages.length} journal pages for ${rangeLabel}. ${existingCount} already existed.`
        : `Added ${missingPages.length} journal pages for ${rangeLabel}.`
    );
  };

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
    const newPage = createJournalPageRecord(normalizedTradeDate, journalChecklistTemplates, timestamp, {
      weeklyEarningsContent: getWeeklyEarningsContentForTradeDate(currentPages, normalizedTradeDate)
    });
    persistJournalPages(sortJournalPagesByTradeDateDesc([...currentPages, newPage]));
    setSelectedJournalPageId(newPage.id);
  };

  const updateJournalPage = (pageId: string, updates: JournalPageUpdates) => {
    setSelectedJournalPageId(pageId);
    const nextTradeDate = updates.tradeDate ? normalizeJournalTradeDate(updates.tradeDate) : null;
    const nextPages = getJournalPages().map((page) =>
      page.id === pageId
        ? {
            ...page,
            ...updates,
            tradeDate: nextTradeDate ?? page.tradeDate,
            updatedAt: new Date().toISOString()
          }
        : page
    );
    const shouldResort = nextTradeDate !== null;
    persistJournalPages(shouldResort ? sortJournalPagesByTradeDateDesc(nextPages) : nextPages);
  };

  const updateJournalContent = (
    pageId: string,
    field: JournalContentField,
    content: JournalPageRecord[JournalContentField]
  ) => {
    const currentPages = getJournalPages();
    const sourcePage = currentPages.find((page) => page.id === pageId);
    const targetWeekStart =
      field === "weeklyEarningsContent" && sourcePage ? getJournalWeekStartDate(sourcePage.tradeDate) : "";
    const updatedAt = new Date().toISOString();
    const nextPages = currentPages.map((page) =>
      page.id === pageId ||
      (field === "weeklyEarningsContent" && targetWeekStart && getJournalWeekStartDate(page.tradeDate) === targetWeekStart)
        ? {
            ...page,
            [field]: content,
            updatedAt
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
    createJournalPages,
    updateJournalPage,
    updateJournalContent,
    saveJournalChecklistTemplateAs,
    updateJournalChecklistTemplate,
    deleteJournalChecklistTemplate
  };
};
