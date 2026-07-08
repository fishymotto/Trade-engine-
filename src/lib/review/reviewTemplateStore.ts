import type { JSONContent } from "@tiptap/core";
import { createEmptyJournalDoc } from "../journal/journalContent";
import { canUseMachineLegacyData, syncStores } from "../sync/syncStore";
import { loadDesktopStoreBackup, saveDesktopStoreBackup } from "../storage/desktopStoreBackup";
import type {
  NamedReviewTemplate,
  ReviewChecklistGroupKey,
  ReviewChecklistState,
  ReviewPeriod,
  ReviewReflectionState,
  ReviewRiskCheckMetrics,
  ReviewTemplates,
  ReviewReadingEntry
} from "../../types/libraryReview";

const STORAGE_VERSION = 1 as const;

const createTemplateId = () => `review-template-${Math.random().toString(36).slice(2, 10)}`;

const isDoc = (value: unknown): value is JSONContent =>
  Boolean(value) && typeof value === "object" && (value as { type?: unknown }).type === "doc";

const emptyChecklist = (): ReviewChecklistState => ({
  meditation: [false, false, false, false, false],
  riskCheck: [false, false, false, false, false],
  morningJournal: [false, false, false, false, false],
  closingJournal: [false, false, false, false, false]
});

const emptyRiskCheckMetrics = (): ReviewRiskCheckMetrics => ({
  riskSplitFollowed: "",
  corePlaybookTrades: "",
  corePlaybooks: [],
  wakeUpPlanFollowed: ""
});

const normalizeChecklist = (value: unknown): ReviewChecklistState => {
  const fallback = emptyChecklist();
  if (!value || typeof value !== "object") {
    return fallback;
  }

  const record = value as Partial<Record<ReviewChecklistGroupKey, unknown>>;
  const normalizeRow = (row: unknown) =>
    Array.isArray(row) ? row.slice(0, 5).map((cell) => Boolean(cell)).concat(Array(5).fill(false)).slice(0, 5) : null;

  const meditation = normalizeRow(record.meditation) ?? fallback.meditation;
  const riskCheck = normalizeRow(record.riskCheck) ?? fallback.riskCheck;
  const morningJournal = normalizeRow(record.morningJournal) ?? fallback.morningJournal;
  const closingJournal = normalizeRow(record.closingJournal) ?? fallback.closingJournal;

  return { meditation, riskCheck, morningJournal, closingJournal };
};

const normalizeMetricValue = (value: unknown): string => {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return "";
};

const normalizeRiskCheckMetrics = (value: unknown): ReviewRiskCheckMetrics => {
  const fallback = emptyRiskCheckMetrics();
  if (!value || typeof value !== "object") {
    return fallback;
  }

  const record = value as Partial<Record<keyof ReviewRiskCheckMetrics, unknown>>;
  const corePlaybooks = Array.isArray(record.corePlaybooks)
    ? Array.from(
        new Set(
          record.corePlaybooks
            .filter((entry): entry is string => typeof entry === "string")
            .map((entry) => entry.trim())
            .filter(Boolean)
        )
      )
    : fallback.corePlaybooks;

  return {
    riskSplitFollowed: normalizeMetricValue(record.riskSplitFollowed),
    corePlaybookTrades: normalizeMetricValue(record.corePlaybookTrades),
    corePlaybooks,
    wakeUpPlanFollowed: normalizeMetricValue(record.wakeUpPlanFollowed)
  };
};

const normalizeReading = (value: unknown): ReviewReadingEntry[] => {
  if (!Array.isArray(value)) {
    return [
      { book: "", author: "", pages: "" },
      { book: "", author: "", pages: "" }
    ];
  }

  const parsed = value
    .flatMap((entry) => {
      if (!entry || typeof entry !== "object") {
        return [];
      }

      const candidate = entry as Partial<ReviewReadingEntry>;
      return [
        {
          book: typeof candidate.book === "string" ? candidate.book : "",
          author: typeof candidate.author === "string" ? candidate.author : "",
          pages: typeof candidate.pages === "string" ? candidate.pages : ""
        }
      ];
    })
    .slice(0, 20);

  if (parsed.length >= 2) {
    return parsed;
  }

  return [...parsed, ...Array.from({ length: 2 - parsed.length }, () => ({ book: "", author: "", pages: "" }))];
};

export const defaultReviewReflectionState = (): ReviewReflectionState => ({
  takeaway: createEmptyJournalDoc(),
  reading: [
    { book: "", author: "", pages: "" },
    { book: "", author: "", pages: "" }
  ],
  checklist: emptyChecklist(),
  riskCheckMetrics: emptyRiskCheckMetrics(),
  improvementGoals: createEmptyJournalDoc()
});

export const coerceReviewReflectionState = (value: unknown): ReviewReflectionState => {
  if (!value || typeof value !== "object") {
    return defaultReviewReflectionState();
  }

  const record = value as Partial<ReviewReflectionState>;
  return {
    takeaway: isDoc(record.takeaway) ? (record.takeaway as JSONContent) : createEmptyJournalDoc(),
    reading: normalizeReading(record.reading),
    checklist: normalizeChecklist(record.checklist),
    riskCheckMetrics: normalizeRiskCheckMetrics(record.riskCheckMetrics),
    improvementGoals: isDoc(record.improvementGoals) ? (record.improvementGoals as JSONContent) : createEmptyJournalDoc()
  };
};

const createDefaultTemplate = (period: ReviewPeriod): NamedReviewTemplate => ({
  id: createTemplateId(),
  name: period === "weekly" ? "Default Weekly" : "Default Monthly",
  content: defaultReviewReflectionState()
});

export const defaultReviewTemplates = (): ReviewTemplates => ({
  weeklyTemplates: [createDefaultTemplate("weekly")],
  monthlyTemplates: [createDefaultTemplate("monthly")]
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

const normalizeTemplate = (value: unknown, fallbackName: string): NamedReviewTemplate | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<NamedReviewTemplate>;
  if (typeof candidate.name !== "string" || !candidate.name.trim()) {
    return null;
  }

  const content = (candidate.content ?? {}) as Partial<ReviewReflectionState>;
  const takeaway = isDoc(content.takeaway) ? (content.takeaway as JSONContent) : createEmptyJournalDoc();
  const improvementGoals = isDoc(content.improvementGoals)
    ? (content.improvementGoals as JSONContent)
    : createEmptyJournalDoc();

  return {
    id: typeof candidate.id === "string" && candidate.id.trim() ? candidate.id : createTemplateId(),
    name: candidate.name,
    content: coerceReviewReflectionState({
      takeaway,
      reading: content.reading,
      checklist: content.checklist,
      riskCheckMetrics: content.riskCheckMetrics,
      improvementGoals
    })
  };
};

const ensureTemplateArray = (value: unknown, period: ReviewPeriod): NamedReviewTemplate[] => {
  if (Array.isArray(value) && value.length > 0) {
    const parsed = value
      .flatMap((entry) => {
        const normalized = normalizeTemplate(entry, period === "weekly" ? "Default Weekly" : "Default Monthly");
        return normalized ? [normalized] : [];
      })
      .filter(Boolean);

    if (parsed.length > 0) {
      return parsed;
    }
  }

  return [createDefaultTemplate(period)];
};

export const loadReviewTemplates = (): ReviewTemplates => {
  try {
    const parsed = syncStores.reviewTemplates.load<Partial<ReviewTemplates> & { version?: number }>(defaultReviewTemplates());
    if (!parsed || typeof parsed !== "object") {
      return defaultReviewTemplates();
    }

    return {
      weeklyTemplates: ensureTemplateArray((parsed as Partial<ReviewTemplates>).weeklyTemplates, "weekly"),
      monthlyTemplates: ensureTemplateArray((parsed as Partial<ReviewTemplates>).monthlyTemplates, "monthly")
    };
  } catch {
    return defaultReviewTemplates();
  }
};

export const persistReviewTemplates = async (templates: ReviewTemplates): Promise<ReviewTemplates> => {
  const normalized: ReviewTemplates = {
    weeklyTemplates: ensureTemplateArray(templates.weeklyTemplates, "weekly"),
    monthlyTemplates: ensureTemplateArray(templates.monthlyTemplates, "monthly")
  };
  const payload = { ...normalized, version: STORAGE_VERSION };
  const syncPromise = syncStores.reviewTemplates.save(payload);
  const activeUserId = syncStores.reviewTemplates.getUserId();

  if (canUseMachineLegacyData(activeUserId)) {
    try {
      await saveDesktopStoreBackup("review-templates", payload);
    } catch (error) {
      console.warn("[review-templates] Failed to save desktop review templates backup.", error);
    }
  }

  await syncPromise;
  return normalized;
};

export const recoverReviewTemplatesFromDesktopBackup = async (
  localTemplates = loadReviewTemplates()
): Promise<ReviewTemplates | null> => {
  const activeUserId = syncStores.reviewTemplates.getUserId();
  if (!canUseMachineLegacyData(activeUserId)) {
    return null;
  }

  const desktopTemplates = await loadDesktopStoreBackup<Partial<ReviewTemplates> & { version?: number }>("review-templates");
  if (!desktopTemplates || typeof desktopTemplates !== "object") {
    return null;
  }

  const normalizedDesktopTemplates: ReviewTemplates = {
    weeklyTemplates: ensureTemplateArray(desktopTemplates.weeklyTemplates, "weekly"),
    monthlyTemplates: ensureTemplateArray(desktopTemplates.monthlyTemplates, "monthly")
  };

  const localScore = stableStringify(localTemplates);
  const desktopScore = stableStringify(normalizedDesktopTemplates);
  const defaultScore = stableStringify(defaultReviewTemplates());
  if (desktopScore === defaultScore || desktopScore === localScore) {
    return null;
  }

  if (localScore !== defaultScore) {
    return null;
  }

  await persistReviewTemplates(normalizedDesktopTemplates);
  return normalizedDesktopTemplates;
};

export const saveReviewTemplates = (templates: ReviewTemplates): void => {
  void persistReviewTemplates(templates);
};
