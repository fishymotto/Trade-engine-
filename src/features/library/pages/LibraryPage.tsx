import { useEffect, useMemo, useRef, useState } from "react";
import { JournalRichTextEditor } from "../../journal/components/JournalRichTextEditor";
import { PlaybooksPage } from "../../playbooks/pages/PlaybooksPage";
import { PageHero } from "../../../components/PageHero";
import { WorkspaceIcon } from "../../../components/WorkspaceIcon";
import { PropertyMultiSelect } from "../../../components/PropertyMultiSelect";
import { FilterSelect } from "../../../components/FilterSelect";
import { TagDrawer } from "../../../components/TagDrawer";
import { getTickerIcon, resolveTickerGroupIcon } from "../../../lib/tickers/tickerIcons";
import {
  createLibraryBookRow,
  createLibraryPage,
  createLibraryQuoteRow,
  libraryCollections,
  loadLibraryPages,
  saveLibraryPages
} from "../../../lib/library/libraryStore";
import type { LibraryCollectionId, LibraryPageRecord } from "../../../types/library";
import type { Settings } from "../../../types/trade";
import type { GroupedTrade } from "../../../types/trade";
import { ReviewDatabaseTable } from "../components/ReviewDatabaseTable";
import { TickerGroupIconPicker } from "../components/TickerGroupIconPicker";
import { ReviewReflectionPanel } from "../components/review/ReviewReflectionPanel";
import { coerceReviewReflectionState, loadReviewTemplates, saveReviewTemplates } from "../../../lib/review/reviewTemplateStore";
import { SYNC_HYDRATED_EVENT } from "../../../lib/sync/syncStore";
import {
  buildReviewPropertiesPatch,
  computeOverallScore,
  computeReviewMetrics,
  getDailyShutdownRiskFromSettings,
  getReviewPeriodForCollection,
  getReviewRangesFromTrades,
  getReviewRange,
  getReviewTitleForRange,
  REVIEW_PROPERTY_KEYS
} from "../lib/reviewUtils";

const statusOptions = ["Active", "Draft", "Review", "Archived"];
const REVIEW_REFLECTION_KEY = "__review_reflection_v1";

const formatUpdatedAt = (value: string): string => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "Just now";
  }

  return parsed.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
};

const getDateOnlyIsoString = (value: string): string => {
  if (!value) {
    return "";
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  return parsed.toISOString().slice(0, 10);
};

const parseTags = (value: string): string[] =>
  value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);

const renderPropertyValue = (
  page: LibraryPageRecord,
  propertyName: string,
  fallback = "-"
): string => {
  const value = page.properties?.[propertyName];
  if (Array.isArray(value)) {
    const parts = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
    return parts.length > 0 ? parts.join(", ") : fallback;
  }

  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }

  if (typeof value === "number") {
    return String(value);
  }

  if (typeof value === "string") {
    return value || fallback;
  }

  return fallback;
};

const readFileAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }

      reject(new Error("The file could not be read."));
    };
    reader.onerror = () =>
      reject(reader.error ?? new Error("The file could not be read."));
    reader.readAsDataURL(file);
  });

const renderPropertyList = (page: LibraryPageRecord, propertyName: string): string[] => {
  const value = page.properties?.[propertyName];
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  }

  if (typeof value === "string" && value.trim()) {
    return [value.trim()];
  }

  return [];
};

const normalizeTickerToken = (value: string): string => value.trim().replace(/^\$/, "").toUpperCase();

const isBookRow = (page: LibraryPageRecord): boolean => page.tags.includes("book-row");

const isQuoteRow = (page: LibraryPageRecord): boolean => page.tags.includes("quote-row");

const bookReadingStatusOptions = ["To Read", "In Progress", "Completed", "Abandoned", "Imported"];

const getBookFieldValue = (page: LibraryPageRecord, propertyName: string): string =>
  renderPropertyValue(page, propertyName, "");

const getQuoteFieldValue = (page: LibraryPageRecord, propertyName: string): string =>
  renderPropertyValue(page, propertyName, "");

const getQuoteUsedValue = (page: LibraryPageRecord): boolean => {
  const value = page.properties?.Used;
  return typeof value === "boolean" ? value : false;
};

const getQuoteDateUsedValue = (page: LibraryPageRecord): string => {
  const value = page.properties?.["Date Used"];
  return typeof value === "string" ? value : "";
};

const getQuoteDateUsedForInput = (page: LibraryPageRecord): string =>
  getDateOnlyIsoString(getQuoteDateUsedValue(page));

const getReadingStatusToneClass = (value: string): string => {
  switch (value) {
    case "Completed":
      return "library-status-pill-completed";
    case "In Progress":
      return "library-status-pill-progress";
    case "Abandoned":
      return "library-status-pill-abandoned";
    case "To Read":
      return "library-status-pill-toread";
    default:
      return "";
  }
};

const scoreOptions = ["", "1", "2", "3", "4", "5"];

const normalizeIsoTradeDate = (value: string): string => {
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

const formatSignedUsd = (value: number): string => {
  const amount = Number.isFinite(value) ? value : 0;
  const formatted = Math.abs(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return amount >= 0 ? `+$${formatted}` : `-$${formatted}`;
};

type BookCellEditorState = {
  pageId: string;
  field: "Reading Status" | "Genre";
};

type QuoteCellEditorState = {
  pageId: string;
  field: "Author" | "Source";
};

type BookSortKey = "title" | "author" | "rating" | "readingStatus";

type BookSortConfig = {
  key: BookSortKey;
  direction: "asc" | "desc";
};

const toggleSortDirection = (direction: "asc" | "desc") => (direction === "asc" ? "desc" : "asc");

const normalizeForSearch = (value: string): string => value.trim().toLowerCase();

const ratingSortValue = (value: string): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : -Infinity;
};

interface LibraryPageProps {
  trades: GroupedTrade[];
  settings: Settings;
  onSelectTrade: (tradeId: string, tradeDate: string) => void;
  onOpenJournalDate?: (tradeDate: string) => void;
  onViewReportsForPlaybook?: (playbookName: string) => void;
  initialSection?: "collections" | "playbooks";
}

export const LibraryPage = ({
  trades,
  settings,
  onSelectTrade,
  onOpenJournalDate,
  onViewReportsForPlaybook,
  initialSection = "collections"
}: LibraryPageProps) => {
  const [activeSection, setActiveSection] = useState<"collections" | "playbooks">(initialSection);
  const [pages, setPages] = useState<LibraryPageRecord[]>(() => loadLibraryPages());
  const [selectedCollectionId, setSelectedCollectionId] =
    useState<LibraryCollectionId>("idea-inbox");
  const [selectedPageId, setSelectedPageId] = useState("");
  const [collectionView, setCollectionView] = useState<"list" | "page">("list");
  const [bookSearchQuery, setBookSearchQuery] = useState("");
  const [bookStatusFilter, setBookStatusFilter] = useState("");
  const [bookGenreFilter, setBookGenreFilter] = useState<string[]>([]);
  const [bookSortConfig, setBookSortConfig] = useState<BookSortConfig>({
    key: "title",
    direction: "asc"
  });
  const [bookCellEditor, setBookCellEditor] = useState<BookCellEditorState | null>(null);
  const [bookCellEditorSearchQuery, setBookCellEditorSearchQuery] = useState("");
  const [isBookGenreFilterOpen, setIsBookGenreFilterOpen] = useState(false);
  const [bookGenreFilterSearchQuery, setBookGenreFilterSearchQuery] = useState("");
  const [quoteSearchQuery, setQuoteSearchQuery] = useState("");
  const [quoteCellEditor, setQuoteCellEditor] = useState<QuoteCellEditorState | null>(null);
  const [quoteCellEditorSearchQuery, setQuoteCellEditorSearchQuery] = useState("");
  const [reviewTemplates, setReviewTemplates] = useState(() => loadReviewTemplates());
  const [selectedWeeklyReviewTemplateId, setSelectedWeeklyReviewTemplateId] = useState(
    () => reviewTemplates.weeklyTemplates[0]?.id ?? ""
  );
  const [selectedMonthlyReviewTemplateId, setSelectedMonthlyReviewTemplateId] = useState(
    () => reviewTemplates.monthlyTemplates[0]?.id ?? ""
  );
  const [showLegacyReviewNotes, setShowLegacyReviewNotes] = useState(false);
  const skipNextPagesSaveRef = useRef(true);
  const skipNextReviewTemplatesSaveRef = useRef(true);

  const handleImageInsert = async (file: File): Promise<string> => {
    return readFileAsDataUrl(file);
  };

  useEffect(() => {
    setActiveSection(initialSection);
    setCollectionView("list");
  }, [initialSection]);

  useEffect(() => {
    if (skipNextPagesSaveRef.current) {
      skipNextPagesSaveRef.current = false;
      return;
    }

    saveLibraryPages(pages);
  }, [pages]);

  useEffect(() => {
    if (skipNextReviewTemplatesSaveRef.current) {
      skipNextReviewTemplatesSaveRef.current = false;
      return;
    }

    saveReviewTemplates(reviewTemplates);
  }, [reviewTemplates]);

  useEffect(() => {
    const handleHydrated = () => {
      const nextPages = loadLibraryPages();
      const nextTemplates = loadReviewTemplates();

      skipNextPagesSaveRef.current = true;
      skipNextReviewTemplatesSaveRef.current = true;
      setPages(nextPages);
      setReviewTemplates(nextTemplates);
      setSelectedWeeklyReviewTemplateId(nextTemplates.weeklyTemplates[0]?.id ?? "");
      setSelectedMonthlyReviewTemplateId(nextTemplates.monthlyTemplates[0]?.id ?? "");
    };

    window.addEventListener(SYNC_HYDRATED_EVENT, handleHydrated);
    return () => window.removeEventListener(SYNC_HYDRATED_EVENT, handleHydrated);
  }, []);

  useEffect(() => {
    const shutdownRiskUsd = getDailyShutdownRiskFromSettings(settings);

    setPages((current) => {
      let changed = false;
      const now = new Date().toISOString();

      const next = current.map((page) => {
        const period = getReviewPeriodForCollection(page.collectionId);
        if (!period) {
          return page;
        }

        const range = getReviewRange(page.properties);
        if (!range) {
          return page;
        }

        const metrics = computeReviewMetrics({
          trades,
          rangeStart: range.start,
          rangeEnd: range.end,
          dailyShutdownRiskUsd: shutdownRiskUsd
        });

        const nextProperties = buildReviewPropertiesPatch({
          metrics,
          existingProperties: page.properties
        });

        if (JSON.stringify(page.properties ?? {}) === JSON.stringify(nextProperties)) {
          return page;
        }

        changed = true;
        return { ...page, properties: nextProperties, updatedAt: now };
      });

      return changed ? next : current;
    });
  }, [settings, trades]);

  useEffect(() => {
    if (trades.length === 0) {
      return;
    }

    setPages((current) => {
      const now = new Date().toISOString();
      const next = [...current];
      let changed = false;

      const ensureReviewPages = (collectionId: "weekly-review" | "monthly-review") => {
        const period = collectionId === "weekly-review" ? "weekly" : "monthly";
        const existingRangeKeys = new Set<string>();

        for (const page of current) {
          if (page.collectionId !== collectionId) {
            continue;
          }

          const range = getReviewRange(page.properties);
          if (!range) {
            continue;
          }

          existingRangeKeys.add(`${range.start}_${range.end}`);
        }

        const ranges = getReviewRangesFromTrades(trades, period);
        for (const range of ranges) {
          const key = `${range.start}_${range.end}`;
          if (existingRangeKeys.has(key)) {
            continue;
          }

          const base = createLibraryPage(collectionId);
          const endTimestamp = new Date(`${range.end}T23:59:59`);
          const timestamp = Number.isNaN(endTimestamp.getTime()) ? now : endTimestamp.toISOString();

          next.push({
            ...base,
            id: `${collectionId}-${range.start}`,
            title: getReviewTitleForRange(period, range.start, range.end),
            status: "Active",
            properties: {
              ...(base.properties ?? {}),
              [REVIEW_PROPERTY_KEYS.rangeStart]: range.start,
              [REVIEW_PROPERTY_KEYS.rangeEnd]: range.end
            },
            createdAt: timestamp,
            updatedAt: timestamp
          });

          existingRangeKeys.add(key);
          changed = true;
        }
      };

      ensureReviewPages("weekly-review");
      ensureReviewPages("monthly-review");

      return changed ? next : current;
    });
  }, [trades]);

  const selectedCollection = useMemo(
    () =>
      libraryCollections.find((collection) => collection.id === selectedCollectionId) ??
      libraryCollections[0],
    [selectedCollectionId]
  );

  const collectionPages = useMemo(
    () => pages.filter((page) => page.collectionId === selectedCollectionId),
    [pages, selectedCollectionId]
  );

  const isBookClub = selectedCollectionId === "book-club";
  const isQuotes = selectedCollectionId === "quotes";
  const isTickerGroups = selectedCollectionId === "ticker-groups";
  const selectedReviewPeriod = getReviewPeriodForCollection(selectedCollectionId);
  const isReviewCollection = selectedReviewPeriod !== null;

  const tickerGroupTickerOptions = useMemo(() => {
    const fromTrades = trades
      .map((trade) => normalizeTickerToken(trade.symbol ?? ""))
      .filter(Boolean);
    const fromGroups = pages
      .filter((page) => page.collectionId === "ticker-groups")
      .flatMap((page) => renderPropertyList(page, "Tickers").map(normalizeTickerToken))
      .filter(Boolean);

    return Array.from(new Set([...fromTrades, ...fromGroups])).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" })
    );
  }, [pages, trades]);

  const bookRows = useMemo(
    () => collectionPages.filter(isBookRow),
    [collectionPages]
  );

  const quoteRows = useMemo(
    () => (isQuotes ? collectionPages : collectionPages.filter(isQuoteRow)),
    [collectionPages, isQuotes]
  );

  const filteredQuoteRows = useMemo(() => {
    const normalizedQuery = normalizeForSearch(quoteSearchQuery);

    if (!normalizedQuery) {
      return quoteRows;
    }

    return quoteRows.filter((page) =>
      normalizeForSearch(getQuoteFieldValue(page, "Author")).includes(normalizedQuery)
    );
  }, [quoteRows, quoteSearchQuery]);

  const quoteAuthorOptions = useMemo(() => {
    const authors = quoteRows
      .map((page) => getQuoteFieldValue(page, "Author").trim())
      .filter(Boolean);

    return Array.from(new Set(authors)).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [quoteRows]);

  const quoteSourceOptions = useMemo(() => {
    const sources = quoteRows
      .map((page) => getQuoteFieldValue(page, "Source").trim())
      .filter(Boolean);

    return Array.from(new Set(sources)).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [quoteRows]);

  const bookStatusFilterOptions = useMemo(
    () => [
      { label: "All statuses", value: "" },
      ...bookReadingStatusOptions.map((status) => ({ label: status, value: status }))
    ],
    []
  );

  const filteredBookRows = useMemo(() => {
    const normalizedQuery = normalizeForSearch(bookSearchQuery);

    const filtered = bookRows.filter((page) => {
      if (normalizedQuery) {
        const matchesTitle = normalizeForSearch(page.title).includes(normalizedQuery);
        const matchesAuthor = normalizeForSearch(getBookFieldValue(page, "Author")).includes(normalizedQuery);
        if (!matchesTitle && !matchesAuthor) {
          return false;
        }
      }

      if (bookStatusFilter) {
        const statusValue = getBookFieldValue(page, "Reading Status") || page.status;
        if (statusValue !== bookStatusFilter) {
          return false;
        }
      }

      if (bookGenreFilter.length > 0) {
        const genres = renderPropertyList(page, "Genre");
        const hasAnyGenre = bookGenreFilter.some((genre) => genres.includes(genre));
        if (!hasAnyGenre) {
          return false;
        }
      }

      return true;
    });

    const sorted = [...filtered].sort((left, right) => {
      const directionMultiplier = bookSortConfig.direction === "asc" ? 1 : -1;

      const compareStrings = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base" });
      const compareNumbers = (a: number, b: number) => (a === b ? 0 : a > b ? 1 : -1);

      switch (bookSortConfig.key) {
        case "title":
          return directionMultiplier * compareStrings(left.title, right.title);
        case "author":
          return (
            directionMultiplier *
            compareStrings(getBookFieldValue(left, "Author"), getBookFieldValue(right, "Author"))
          );
        case "readingStatus":
          return (
            directionMultiplier *
            compareStrings(getBookFieldValue(left, "Reading Status"), getBookFieldValue(right, "Reading Status"))
          );
        case "rating":
          return (
            directionMultiplier *
            compareNumbers(ratingSortValue(getBookFieldValue(left, "Rating")), ratingSortValue(getBookFieldValue(right, "Rating")))
          );
        default:
          return 0;
      }
    });

    return sorted;
  }, [bookGenreFilter, bookRows, bookSearchQuery, bookSortConfig, bookStatusFilter]);

  const databasePages = useMemo(
    () => (isBookClub && bookRows.length > 0 ? bookRows : collectionPages),
    [bookRows, collectionPages, isBookClub]
  );

  const allGenres = useMemo(
    () =>
      Array.from(
        new Set(
          collectionPages
            .flatMap((page) => renderPropertyList(page, "Genre"))
            .filter(Boolean)
        )
      ).sort(),
    [collectionPages]
  );

  const selectedPage = useMemo(
    () => pages.find((page) => page.id === selectedPageId) ?? null,
    [pages, selectedPageId]
  );

  const bestDayEntries = useMemo(() => {
    if (!selectedPage) {
      return [];
    }

    if (!isReviewCollection || !selectedReviewPeriod) {
      return [];
    }

    const range = getReviewRange(selectedPage.properties);
    if (!range?.start || !range?.end) {
      return [];
    }

    const start = normalizeIsoTradeDate(range.start);
    const end = normalizeIsoTradeDate(range.end);
    if (!start || !end) {
      return [];
    }

    const dayNetMap = trades.reduce<Map<string, number>>((acc, trade) => {
      const date = normalizeIsoTradeDate(trade.tradeDate);
      if (!date || date < start || date > end) {
        return acc;
      }

      acc.set(date, (acc.get(date) ?? 0) + (trade.netPnlUsd || 0));
      return acc;
    }, new Map());

    const limit = selectedReviewPeriod === "monthly" ? 3 : 1;
    return Array.from(dayNetMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit);
  }, [isReviewCollection, selectedPage, selectedReviewPeriod, trades]);

  const reviewReadingBookDefaults = useMemo(() => {
    const titles = pages
      .filter((page) => page.collectionId === "book-club" && isBookRow(page))
      .map((page) => page.title.trim())
      .filter(Boolean);

    return Array.from(new Set(titles)).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [pages]);

  const reviewReadingAuthorDefaults = useMemo(() => {
    const authors = pages
      .filter((page) => page.collectionId === "book-club" && isBookRow(page))
      .map((page) => getBookFieldValue(page, "Author").trim())
      .filter(Boolean);

    return Array.from(new Set(authors)).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [pages]);

  const handleSaveReviewTemplate = (period: "weekly" | "monthly", templateId: string, content: unknown) => {
    setReviewTemplates((current) => {
      const key = period === "weekly" ? "weeklyTemplates" : "monthlyTemplates";
      const templates = current[key].map((template) =>
        template.id === templateId ? { ...template, content: coerceReviewReflectionState(content) } : template
      );
      return { ...current, [key]: templates };
    });
  };

  const handleSaveReviewTemplateAs = (period: "weekly" | "monthly", name: string, content: unknown) => {
    const newTemplate = {
      id: `review-template-${Math.random().toString(36).slice(2, 10)}`,
      name,
      content: coerceReviewReflectionState(content)
    };

    setReviewTemplates((current) => {
      const key = period === "weekly" ? "weeklyTemplates" : "monthlyTemplates";
      return { ...current, [key]: [...current[key], newTemplate] };
    });

    if (period === "weekly") {
      setSelectedWeeklyReviewTemplateId(newTemplate.id);
    } else {
      setSelectedMonthlyReviewTemplateId(newTemplate.id);
    }
  };

  const handleDeleteReviewTemplate = (period: "weekly" | "monthly", templateId: string) => {
    setReviewTemplates((current) => {
      const key = period === "weekly" ? "weeklyTemplates" : "monthlyTemplates";
      const existing = current[key];
      const filtered = existing.filter((template) => template.id !== templateId);
      const nextTemplates = filtered.length > 0 ? filtered : existing;
      const fallbackSelected = nextTemplates[0]?.id ?? "";

      if (period === "weekly") {
        setSelectedWeeklyReviewTemplateId((selected) => (selected === templateId ? fallbackSelected : selected));
      } else {
        setSelectedMonthlyReviewTemplateId((selected) => (selected === templateId ? fallbackSelected : selected));
      }

      return { ...current, [key]: nextTemplates };
    });
  };

  const handleOpenJournalDate = (tradeDate: string) => {
    const normalized = normalizeIsoTradeDate(tradeDate);
    if (!normalized) {
      return;
    }

    onOpenJournalDate?.(normalized);
  };

  const bookCellEditorPage = useMemo(() => {
    if (!bookCellEditor) {
      return null;
    }

    return pages.find((page) => page.id === bookCellEditor.pageId) ?? null;
  }, [bookCellEditor, pages]);

  const quoteCellEditorPage = useMemo(() => {
    if (!quoteCellEditor) {
      return null;
    }

    return pages.find((page) => page.id === quoteCellEditor.pageId) ?? null;
  }, [pages, quoteCellEditor]);

  useEffect(() => {
    if (collectionView !== "page") {
      return;
    }

    if (!selectedPage) {
      setCollectionView("list");
      return;
    }

    if (selectedPage.collectionId !== selectedCollectionId) {
      setCollectionView("list");
      setSelectedPageId("");
    }
  }, [collectionView, selectedCollectionId, selectedPage]);

  const totalTags = useMemo(
    () => new Set(pages.flatMap((page) => page.tags.map((tag) => tag.toLowerCase()))).size,
    [pages]
  );

  const updatePage = (pageId: string, updates: Partial<LibraryPageRecord>) => {
    setPages((current) =>
      current.map((page) =>
        page.id === pageId
          ? {
              ...page,
              ...updates,
              updatedAt: new Date().toISOString()
            }
          : page
      )
    );
  };

  const updatePageProperty = (
    page: LibraryPageRecord,
    propertyName: string,
    value: unknown
  ) => {
    updatePage(page.id, {
      properties: {
        ...page.properties,
        [propertyName]: value
      }
    });
  };

  const updateQuoteUsed = (page: LibraryPageRecord, nextUsed: boolean) => {
    const dateUsed = nextUsed ? getQuoteDateUsedForInput(page) || new Date().toISOString().slice(0, 10) : "";

    updatePage(page.id, {
      properties: {
        ...page.properties,
        Used: nextUsed,
        "Date Used": dateUsed
      }
    });
  };

  const updateQuoteDateUsed = (page: LibraryPageRecord, nextDateUsed: string) => {
    const normalized = getDateOnlyIsoString(nextDateUsed);

    if (!normalized) {
      updateQuoteUsed(page, false);
      return;
    }

    updatePage(page.id, {
      properties: {
        ...page.properties,
        Used: true,
        "Date Used": normalized
      }
    });
  };

  useEffect(() => {
    if (!selectedPage || !isReviewCollection) {
      return;
    }

    const current = selectedPage.properties?.[REVIEW_REFLECTION_KEY];
    if (current && typeof current === "object") {
      return;
    }

    updatePage(selectedPage.id, {
      properties: {
        ...(selectedPage.properties ?? {}),
        [REVIEW_REFLECTION_KEY]: coerceReviewReflectionState(null)
      }
    });
    setShowLegacyReviewNotes(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReviewCollection, selectedPage?.id]);

  const updateTickerGroupTickers = (groupPageId: string, nextTickers: string[]) => {
    const normalizedTickers = Array.from(
      new Set(nextTickers.map(normalizeTickerToken).filter(Boolean))
    ).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

    setPages((current) => {
      const now = new Date().toISOString();
      let changed = false;

      const nextPages = current.map((page) => {
        if (page.collectionId !== "ticker-groups") {
          return page;
        }

        const existingTickers = renderPropertyList(page, "Tickers").map(normalizeTickerToken).filter(Boolean);

        if (page.id === groupPageId) {
          const nextProperties = {
            ...(page.properties ?? {}),
            Tickers: normalizedTickers
          };

          if (JSON.stringify(existingTickers) === JSON.stringify(normalizedTickers)) {
            return page;
          }

          changed = true;
          return { ...page, properties: nextProperties, updatedAt: now };
        }

        const filtered = existingTickers.filter((ticker) => !normalizedTickers.includes(ticker));
        if (filtered.length === existingTickers.length) {
          return page;
        }

        changed = true;
        return {
          ...page,
          properties: {
            ...(page.properties ?? {}),
            Tickers: filtered
          },
          updatedAt: now
        };
      });

      return changed ? nextPages : current;
    });
  };

  const handleCreatePage = () => {
    const newPage = createLibraryPage(selectedCollectionId);
    setPages((current) => [newPage, ...current]);
    setSelectedPageId(newPage.id);
    setCollectionView("page");
  };

  const handleCreateBookRow = () => {
    const newPage = createLibraryBookRow();
    setPages((current) => [newPage, ...current]);
    setSelectedPageId(newPage.id);
    setCollectionView("page");
    setBookSearchQuery("");
    setBookStatusFilter("");
    setBookGenreFilter([]);
  };

  const handleCreateQuoteRow = () => {
    const newPage = createLibraryQuoteRow();
    setPages((current) => [newPage, ...current]);
    setSelectedPageId(newPage.id);
    setCollectionView("list");
    setQuoteSearchQuery("");
    setQuoteCellEditor(null);
    setQuoteCellEditorSearchQuery("");
  };

  const handleDeletePage = (pageId: string) => {
    const targetPage = pages.find((page) => page.id === pageId);
    if (!targetPage) {
      return;
    }

    if (!window.confirm(`Delete "${targetPage.title}" from the library?`)) {
      return;
    }

    setPages((current) => current.filter((page) => page.id !== pageId));
    setSelectedPageId("");
    setCollectionView("list");
  };

  const openPage = (pageId: string) => {
    setSelectedPageId(pageId);
    setCollectionView("page");
    setBookCellEditor(null);
    setBookCellEditorSearchQuery("");
    setQuoteCellEditor(null);
    setQuoteCellEditorSearchQuery("");
  };

  const toggleBookSort = (key: BookSortKey) => {
    setBookSortConfig((current) => {
      if (current.key === key) {
        return { key, direction: toggleSortDirection(current.direction) };
      }

      return { key, direction: key === "rating" ? "desc" : "asc" };
    });
  };

  const getBookValidation = (page: LibraryPageRecord) => {
    const titleInvalid = page.title.trim().length === 0;
    const authorInvalid = getBookFieldValue(page, "Author").trim().length === 0;
    const ratingValue = getBookFieldValue(page, "Rating").trim();
    const ratingNumber = ratingValue ? Number(ratingValue) : NaN;
    const ratingInvalid =
      Boolean(ratingValue) &&
      (!Number.isFinite(ratingNumber) || !Number.isInteger(ratingNumber) || ratingNumber < 1 || ratingNumber > 5);

    return { titleInvalid, authorInvalid, ratingInvalid };
  };

  return (
    <main className="page-shell library-page">
      {activeSection === "collections" ? (
        <PageHero
          eyebrow="Library"
          title="Knowledge Library"
          description="A Notion-style home for books, trading notes, replay reviews, signal mapping, and raw ideas."
        >
          <div className="page-hero-stat-grid">
            <div className="page-hero-stat-card">
              <span>Collections</span>
              <strong>{libraryCollections.length}</strong>
            </div>
            <div className="page-hero-stat-card">
              <span>Pages</span>
              <strong>{pages.length}</strong>
            </div>
            <div className="page-hero-stat-card">
              <span>Tags</span>
              <strong>{totalTags}</strong>
            </div>
            <div className="page-hero-stat-card">
              <span>Current View</span>
              <strong>{selectedCollection.name}</strong>
            </div>
          </div>
        </PageHero>
      ) : null}

      <section className="library-layout">
        <aside className="library-collection-panel">
          <div className="panel-header">
            <WorkspaceIcon icon="library" alt="Library collections icon" className="panel-header-icon" />
            <h2>Collections</h2>
          </div>
          <div className="library-collection-list">
            {libraryCollections.map((collection) => {
              const collectionCount = pages.filter((page) => page.collectionId === collection.id).length;
              return (
                <button
                  key={collection.id}
                  type="button"
                  className={`library-collection-button${
                    activeSection === "collections" && collection.id === selectedCollectionId
                      ? " library-collection-button-active"
                      : ""
                  }`}
                  onClick={() => {
                    setActiveSection("collections");
                    setSelectedCollectionId(collection.id);
                    setSelectedPageId("");
                    setCollectionView("list");
                    setBookSearchQuery("");
                    setBookStatusFilter("");
                    setBookGenreFilter([]);
                    setBookCellEditor(null);
                    setBookCellEditorSearchQuery("");
                    setIsBookGenreFilterOpen(false);
                    setBookGenreFilterSearchQuery("");
                    setQuoteSearchQuery("");
                    setQuoteCellEditor(null);
                    setQuoteCellEditorSearchQuery("");
                  }}
                >
                  <span>{collection.accent}</span>
                  <strong>{collection.name}</strong>
                  <small>{collectionCount} page{collectionCount === 1 ? "" : "s"}</small>
                </button>
              );
            })}

            <button
              type="button"
              className={`library-collection-button${
                activeSection === "playbooks" ? " library-collection-button-active" : ""
              }`}
              onClick={() => {
                setActiveSection("playbooks");
                setSelectedPageId("");
                setCollectionView("list");
                setBookCellEditor(null);
                setBookCellEditorSearchQuery("");
                setIsBookGenreFilterOpen(false);
                setBookGenreFilterSearchQuery("");
                setQuoteSearchQuery("");
                setQuoteCellEditor(null);
                setQuoteCellEditorSearchQuery("");
              }}
            >
              <span>Setup</span>
              <strong>Playbooks</strong>
              <small>Open setup library</small>
            </button>
          </div>
        </aside>

        <section className="library-database-panel">
          {activeSection === "playbooks" ? (
            <PlaybooksPage
              embedded
              trades={trades}
              onSelectTrade={onSelectTrade}
              onViewReportsForPlaybook={onViewReportsForPlaybook}
            />
          ) : null}

          {activeSection === "collections" && collectionView === "list" ? (
            <>
              <div className="library-database-header">
                <div>
                  <span className="page-eyebrow">{selectedCollection.accent}</span>
                  <h2>{selectedCollection.name}</h2>
                  <p>{selectedCollection.description}</p>
                </div>
                <button
                  className="button button-primary"
                  type="button"
                  onClick={isQuotes ? handleCreateQuoteRow : handleCreatePage}
                >
                  {isReviewCollection
                    ? selectedReviewPeriod === "weekly"
                      ? "New Weekly Review"
                      : "New Monthly Review"
                    : isTickerGroups
                      ? "New Group"
                      : isQuotes
                        ? "New Quote"
                      : "New Page"}
                </button>
              </div>

              {isTickerGroups ? (
                <div className="library-table-wrap" aria-label="Ticker groups database">
                  <table className="library-table">
                    <thead>
                      <tr>
                        <th>Group</th>
                        <th>Icon</th>
                        <th>Description</th>
                        <th>Tickers</th>
                        <th>Updated</th>
                      </tr>
                    </thead>
                    <tbody>
                      {collectionPages.length > 0 ? (
                        collectionPages.map((page) => {
                          const iconValue = typeof page.properties?.Icon === "string" ? page.properties.Icon : "";
                          const iconUrl = resolveTickerGroupIcon(iconValue);
                          const description = typeof page.properties?.Description === "string" ? page.properties.Description : "";
                          const tickers = renderPropertyList(page, "Tickers").map(normalizeTickerToken).filter(Boolean);

                          return (
                            <tr
                              key={page.id}
                              className={selectedPage?.id === page.id ? "library-table-row-active" : ""}
                              onClick={() => openPage(page.id)}
                            >
                              <td>
                                <button type="button" className="library-table-title" onClick={() => openPage(page.id)}>
                                  {page.title}
                                </button>
                              </td>
                              <td>
                                {iconUrl ? (
                                  <img src={iconUrl} alt={`${page.title} icon`} className="ticker-icon" />
                                ) : (
                                  <span className="library-table-muted">-</span>
                                )}
                              </td>
                              <td>{description || <span className="library-table-muted">-</span>}</td>
                              <td>{tickers.length}</td>
                              <td>{formatUpdatedAt(page.updatedAt)}</td>
                            </tr>
                          );
                        })
                      ) : (
                        <tr>
                          <td colSpan={5}>No groups yet. Create the first ticker group.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              ) : isBookClub && bookRows.length > 0 ? (
            <div className="library-table-wrap library-book-table-wrap" aria-label="Trading and Poker Books database">
              <div className="library-book-table-title">
                <WorkspaceIcon icon="library" alt="" className="panel-header-icon" />
                <div>
                  <h3>Trading and Poker Books</h3>
                  <span>
                    {filteredBookRows.length}
                    {bookSearchQuery.trim() || bookStatusFilter || bookGenreFilter.length > 0 ? ` of ${bookRows.length}` : ""}{" "}
                    books
                  </span>
                </div>
              </div>
              <div className="library-book-controls" aria-label="Book database controls">
                <input
                  className="library-book-search"
                  value={bookSearchQuery}
                  onChange={(event) => setBookSearchQuery(event.target.value)}
                  placeholder="Search by book name or author"
                />
                <FilterSelect
                  value={bookStatusFilter}
                  options={bookStatusFilterOptions}
                  ariaLabel="Filter books by reading status"
                  onChange={setBookStatusFilter}
                />
                <button
                  type="button"
                  className={`library-book-genre-trigger${bookGenreFilter.length > 0 ? " library-book-genre-trigger-active" : ""}`}
                  onClick={() => {
                    setIsBookGenreFilterOpen(true);
                    setBookGenreFilterSearchQuery("");
                  }}
                >
                  {bookGenreFilter.length > 0 ? `Genre: ${bookGenreFilter[0]}${bookGenreFilter.length > 1 ? ` +${bookGenreFilter.length - 1}` : ""}` : "Filter genre"}
                </button>
                <button className="button button-primary" type="button" onClick={handleCreateBookRow}>
                  New Book
                </button>
              </div>
              <table className="library-table library-book-table">
                <thead>
                  <tr>
                    <th>
                      <button type="button" className="sortable-header-button" onClick={() => toggleBookSort("title")}>
                        <span>Book Name</span>
                        <span
                          className={`sort-indicator ${bookSortConfig.key === "title" ? "sort-indicator-active" : ""}`}
                        >
                          {bookSortConfig.key === "title" ? bookSortConfig.direction : "sort"}
                        </span>
                      </button>
                    </th>
                    <th>
                      <button type="button" className="sortable-header-button" onClick={() => toggleBookSort("author")}>
                        <span>Author</span>
                        <span
                          className={`sort-indicator ${bookSortConfig.key === "author" ? "sort-indicator-active" : ""}`}
                        >
                          {bookSortConfig.key === "author" ? bookSortConfig.direction : "sort"}
                        </span>
                      </button>
                    </th>
                    <th>
                      <button
                        type="button"
                        className="sortable-header-button"
                        onClick={() => toggleBookSort("readingStatus")}
                      >
                        <span>Reading Status</span>
                        <span
                          className={`sort-indicator ${bookSortConfig.key === "readingStatus" ? "sort-indicator-active" : ""}`}
                        >
                          {bookSortConfig.key === "readingStatus" ? bookSortConfig.direction : "sort"}
                        </span>
                      </button>
                    </th>
                    <th>
                      <button type="button" className="sortable-header-button" onClick={() => toggleBookSort("rating")}>
                        <span>Rating</span>
                        <span
                          className={`sort-indicator ${bookSortConfig.key === "rating" ? "sort-indicator-active" : ""}`}
                        >
                          {bookSortConfig.key === "rating" ? bookSortConfig.direction : "sort"}
                        </span>
                      </button>
                    </th>
                    <th>Genre</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredBookRows.length > 0 ? (
                    filteredBookRows.map((page) => {
                      const statusValue = getBookFieldValue(page, "Reading Status") || page.status;
                      const genres = renderPropertyList(page, "Genre");
                      const { titleInvalid, authorInvalid, ratingInvalid } = getBookValidation(page);

                      return (
                        <tr
                          key={page.id}
                          className={selectedPage?.id === page.id ? "library-table-row-active" : ""}
                          onClick={() => openPage(page.id)}
                        >
                          <td>
                            <div className="library-book-title-cell">
                              <span className="library-book-icon" aria-hidden="true" />
                              <input
                                className={`library-cell-input${titleInvalid ? " library-cell-input-invalid" : ""}`}
                                value={page.title}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setSelectedPageId(page.id);
                                }}
                                onChange={(event) => updatePage(page.id, { title: event.target.value })}
                                placeholder="Book name"
                              />
                            </div>
                          </td>
                          <td>
                            <input
                              className={`library-cell-input${authorInvalid ? " library-cell-input-invalid" : ""}`}
                              value={getBookFieldValue(page, "Author")}
                              onClick={(event) => {
                                event.stopPropagation();
                                setSelectedPageId(page.id);
                              }}
                              onChange={(event) => updatePageProperty(page, "Author", event.target.value)}
                              placeholder="Author"
                            />
                          </td>
                          <td>
                            <button
                              type="button"
                              className={`library-status-pill ${getReadingStatusToneClass(statusValue)}`}
                              onClick={(event) => {
                                event.stopPropagation();
                                setSelectedPageId(page.id);
                                setBookCellEditor({ pageId: page.id, field: "Reading Status" });
                                setBookCellEditorSearchQuery("");
                              }}
                            >
                              {statusValue || "Set status"}
                            </button>
                          </td>
                          <td>
                            <select
                              className={`library-cell-select${ratingInvalid ? " library-cell-select-invalid" : ""}`}
                              value={getBookFieldValue(page, "Rating")}
                              onClick={(event) => {
                                event.stopPropagation();
                                setSelectedPageId(page.id);
                              }}
                              onChange={(event) => updatePageProperty(page, "Rating", event.target.value)}
                            >
                              <option value="">-</option>
                              {[1, 2, 3, 4, 5].map((value) => (
                                <option key={value} value={String(value)}>
                                  {value}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <button
                              type="button"
                              className="library-genre-cell"
                              onClick={(event) => {
                                event.stopPropagation();
                                setSelectedPageId(page.id);
                                setBookCellEditor({ pageId: page.id, field: "Genre" });
                                setBookCellEditorSearchQuery("");
                              }}
                            >
                              <div className="library-genre-list">
                                {genres.length > 0 ? (
                                  <>
                                    {genres.slice(0, 4).map((genre) => (
                                      <span key={genre}>{genre}</span>
                                    ))}
                                    {genres.length > 4 ? (
                                      <span className="library-genre-more">+{genres.length - 4}</span>
                                    ) : null}
                                  </>
                                ) : (
                                  <span className="library-genre-empty">Add genre</span>
                                )}
                              </div>
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={5} className="empty-state">
                        No books match the current filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          ) : isQuotes ? (
            <div className="library-table-wrap library-quotes-table-wrap" aria-label="Quotes database">
              <div className="library-quotes-table-title">
                <WorkspaceIcon icon="text" alt="" className="panel-header-icon" />
                <div>
                  <h3>Quotes</h3>
                  <span>
                    {filteredQuoteRows.length}
                    {quoteSearchQuery.trim() ? ` of ${quoteRows.length}` : ""} quotes
                  </span>
                </div>
              </div>
              <div className="library-quotes-controls" aria-label="Quotes database controls">
                <input
                  className="library-quotes-search"
                  value={quoteSearchQuery}
                  onChange={(event) => setQuoteSearchQuery(event.target.value)}
                  placeholder="Search by author"
                />
                <button className="button button-primary" type="button" onClick={handleCreateQuoteRow}>
                  New Quote
                </button>
              </div>
              <table className="library-table library-quotes-table">
                <thead>
                  <tr>
                    <th>Quote</th>
                    <th>Author</th>
                    <th>Source</th>
                    <th>Used</th>
                    <th>Date Used</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredQuoteRows.length > 0 ? (
                    filteredQuoteRows.map((page) => (
                      <tr
                        key={page.id}
                        className={selectedPage?.id === page.id ? "library-table-row-active" : ""}
                        onClick={() => setSelectedPageId(page.id)}
                      >
                        <td>
                          <textarea
                            className="library-cell-input library-cell-textarea"
                            value={getQuoteFieldValue(page, "Quote")}
                            onClick={(event) => {
                              event.stopPropagation();
                              setSelectedPageId(page.id);
                            }}
                            onChange={(event) => updatePageProperty(page, "Quote", event.target.value)}
                            placeholder="Type a quote..."
                            rows={2}
                          />
                        </td>
                        <td>
                          <button
                            type="button"
                            className="library-status-pill library-quotes-pill"
                            onClick={(event) => {
                              event.stopPropagation();
                              setSelectedPageId(page.id);
                              setQuoteCellEditor({ pageId: page.id, field: "Author" });
                              setQuoteCellEditorSearchQuery("");
                            }}
                          >
                            {getQuoteFieldValue(page, "Author") || "Set author"}
                          </button>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="library-status-pill library-quotes-pill"
                            onClick={(event) => {
                              event.stopPropagation();
                              setSelectedPageId(page.id);
                              setQuoteCellEditor({ pageId: page.id, field: "Source" });
                              setQuoteCellEditorSearchQuery("");
                            }}
                          >
                            {getQuoteFieldValue(page, "Source") || "Set source"}
                          </button>
                        </td>
                        <td>
                          <label className="library-quotes-used">
                            <input
                              type="checkbox"
                              checked={getQuoteUsedValue(page)}
                              aria-label="Used"
                              onClick={(event) => event.stopPropagation()}
                              onChange={(event) => updateQuoteUsed(page, event.target.checked)}
                            />
                          </label>
                        </td>
                        <td className="library-quotes-date-used">
                          <input
                            className="library-cell-input library-cell-date"
                            type="date"
                            value={getQuoteDateUsedForInput(page)}
                            disabled={!getQuoteUsedValue(page)}
                            onClick={(event) => {
                              event.stopPropagation();
                              setSelectedPageId(page.id);
                            }}
                            onChange={(event) => updateQuoteDateUsed(page, event.target.value)}
                            aria-label="Date used"
                          />
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5} className="empty-state">
                        {quoteRows.length > 0 ? "No quotes match the current search." : "No quotes yet. Create the first quote."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          ) : isReviewCollection && selectedReviewPeriod ? (
            <ReviewDatabaseTable
              pages={databasePages}
              period={selectedReviewPeriod}
              selectedPageId={selectedPage?.id ?? ""}
              onOpenPage={openPage}
            />
          ) : (
            <div className="library-table-wrap" aria-label={`${selectedCollection.name} database view`}>
              <table className="library-table">
                <thead>
                  <tr>
                    <th>Page</th>
                    <th>Status</th>
                    <th>Author</th>
                    <th>Rating</th>
                    <th>Tags</th>
                    <th>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {databasePages.length > 0 ? (
                    databasePages.map((page) => (
                      <tr
                        key={page.id}
                        className={selectedPage?.id === page.id ? "library-table-row-active" : ""}
                        onClick={() => openPage(page.id)}
                      >
                        <td>
                          <button
                            type="button"
                            className="library-table-title"
                            onClick={() => openPage(page.id)}
                          >
                            {page.title}
                          </button>
                        </td>
                        <td>{renderPropertyValue(page, "Reading Status", page.status)}</td>
                        <td>{renderPropertyValue(page, "Author")}</td>
                        <td>{renderPropertyValue(page, "Rating")}</td>
                        <td>{page.tags.slice(0, 3).join(", ") || "-"}</td>
                        <td>{formatUpdatedAt(page.updatedAt)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={6}>No pages yet. Create the first page in this collection.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
              )}

          {!isBookClub && !isReviewCollection && !isTickerGroups ? (
            <div className="library-page-grid" aria-label={`${selectedCollection.name} cards`}>
              {collectionPages.length > 0 ? (
              collectionPages.map((page) => (
                <button
                  key={page.id}
                  type="button"
                  className={`library-page-card${
                    selectedPage?.id === page.id ? " library-page-card-active" : ""
                  }`}
                  onClick={() => openPage(page.id)}
                >
                  <div className="library-page-card-topline">
                    <strong>{page.title}</strong>
                    <span>{page.status}</span>
                  </div>
                  <p>Updated {formatUpdatedAt(page.updatedAt)}</p>
                  <div className="library-page-tags">
                    {page.tags.length > 0 ? (
                      page.tags.slice(0, 4).map((tag) => <span key={tag}>{tag}</span>)
                    ) : (
                      <span>No tags</span>
                    )}
                  </div>
                </button>
              ))
            ) : (
              <div className="library-empty-state">
                <strong>No pages yet</strong>
                <span>Create the first page in {selectedCollection.name}.</span>
              </div>
              )}
            </div>
          ) : null}
            </>
          ) : null}

          {activeSection === "collections" && collectionView === "page" && selectedPage ? (
            <section
              className={`library-detail-card${
                isBookClub && isBookRow(selectedPage)
                  ? " library-open-page-card"
                  : isReviewCollection || isTickerGroups
                    ? " library-open-page-card"
                    : ""
              }${isReviewCollection ? " library-review-page-card" : ""}`}
            >
              <div className="library-detail-header">
                <button type="button" className="mini-action" onClick={() => setCollectionView("list")}>
                  Back to {selectedCollection.name}
                </button>
                <div className="library-title-stack">
                  <span className="page-eyebrow">
                    {isBookClub && isBookRow(selectedPage) ? "Open Book Page" : selectedCollection.name}
                  </span>
                  <input
                    className="library-title-input"
                    value={selectedPage.title}
                    onChange={(event) => updatePage(selectedPage.id, { title: event.target.value })}
                    placeholder="Untitled"
                  />
                  {isReviewCollection && selectedReviewPeriod ? (
                    <div className="library-review-chip-row" aria-label="Tickers traded">
                      {(
                        Array.isArray(selectedPage.properties?.[REVIEW_PROPERTY_KEYS.tickersTraded])
                          ? (selectedPage.properties?.[REVIEW_PROPERTY_KEYS.tickersTraded] as string[])
                          : []
                      )
                        .map(normalizeTickerToken)
                        .filter(Boolean)
                        .map((ticker) => {
                          const iconUrl = getTickerIcon(ticker);

                          return (
                            <span key={ticker} className="symbol-pill">
                              {iconUrl ? (
                                <img src={iconUrl} alt={`${ticker} icon`} className="symbol-pill-icon" />
                              ) : (
                                <WorkspaceIcon icon="trades" alt="" className="symbol-pill-icon" />
                              )}
                              {ticker}
                            </span>
                          );
                        })}
                    </div>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="button button-danger"
                  onClick={() => handleDeletePage(selectedPage.id)}
                >
                  Delete Page
                </button>
              </div>

              {isTickerGroups ? (
                <>
                  <div className="library-open-page-properties ticker-group-open-page">
                    <TickerGroupIconPicker
                      label="Icon"
                      value={typeof selectedPage.properties?.Icon === "string" ? selectedPage.properties.Icon : ""}
                      onChange={(next) => updatePageProperty(selectedPage, "Icon", next)}
                    />

                    <label className="library-open-page-property ticker-group-description">
                      <span>Description</span>
                      <textarea
                        className="library-open-page-textarea"
                        value={renderPropertyValue(selectedPage, "Description", "")}
                        onChange={(event) => updatePageProperty(selectedPage, "Description", event.target.value)}
                        placeholder="Optional short description"
                        rows={3}
                      />
                    </label>

                    <PropertyMultiSelect
                      label="Tickers"
                      values={renderPropertyList(selectedPage, "Tickers").map(normalizeTickerToken).filter(Boolean)}
                      onChange={(values) => updateTickerGroupTickers(selectedPage.id, values)}
                      predefinedOptions={tickerGroupTickerOptions}
                      placeholder="Add ticker (ex: AAPL)"
                      allowCustom
                    />
                  </div>

                  <div className="ticker-group-chip-preview" aria-label="Ticker chip preview">
                    <span className="property-label">Preview</span>
                    <div className="ticker-group-chip-preview-row">
                      {renderPropertyList(selectedPage, "Tickers")
                        .map(normalizeTickerToken)
                        .filter(Boolean)
                        .slice(0, 14)
                        .map((ticker) => {
                          const iconUrl = resolveTickerGroupIcon(
                            typeof selectedPage.properties?.Icon === "string" ? selectedPage.properties.Icon : ""
                          );

                          return (
                            <span key={ticker} className="symbol-pill">
                              {iconUrl ? (
                                <img src={iconUrl} alt={`${selectedPage.title} icon`} className="symbol-pill-icon" />
                              ) : (
                                <WorkspaceIcon icon="trades" alt={`${ticker} ticker icon`} className="symbol-pill-icon" />
                              )}
                              {ticker}
                            </span>
                          );
                        })}
                      {renderPropertyList(selectedPage, "Tickers").length === 0 ? (
                        <span className="ticker-group-chip-preview-empty">Add tickers to preview chips.</span>
                      ) : null}
                    </div>
                    <p className="ticker-group-hint">One ticker can only belong to one group at a time.</p>
                  </div>
                </>
              ) : isReviewCollection && selectedReviewPeriod ? (
                <>
                  <div className="library-open-page-properties">
                    <label className="library-open-page-property">
                      <span>{selectedReviewPeriod === "weekly" ? "Week Start" : "Month Start"}</span>
                      <input
                        type="date"
                        value={renderPropertyValue(selectedPage, REVIEW_PROPERTY_KEYS.rangeStart, "")}
                        onChange={(event) => updatePageProperty(selectedPage, REVIEW_PROPERTY_KEYS.rangeStart, event.target.value)}
                      />
                    </label>
                    <label className="library-open-page-property">
                      <span>{selectedReviewPeriod === "weekly" ? "Week End" : "Month End"}</span>
                      <input
                        type="date"
                        value={renderPropertyValue(selectedPage, REVIEW_PROPERTY_KEYS.rangeEnd, "")}
                        onChange={(event) => updatePageProperty(selectedPage, REVIEW_PROPERTY_KEYS.rangeEnd, event.target.value)}
                      />
                    </label>
                    <label className="library-open-page-property">
                      <span>Daily Shutdown Risk</span>
                      <input type="text" readOnly value={`$${getDailyShutdownRiskFromSettings(settings).toFixed(2)}`} />
                    </label>
                    <label className="library-open-page-property">
                      <span>Closed Orders</span>
                      <input type="text" readOnly value={renderPropertyValue(selectedPage, REVIEW_PROPERTY_KEYS.closedOrders, "-")} />
                    </label>
                    <label className="library-open-page-property">
                      <span>Trades</span>
                      <input type="text" readOnly value={renderPropertyValue(selectedPage, REVIEW_PROPERTY_KEYS.trades, "-")} />
                    </label>
                    <label className="library-open-page-property">
                      <span>Shares</span>
                      <input type="text" readOnly value={renderPropertyValue(selectedPage, REVIEW_PROPERTY_KEYS.shares, "-")} />
                    </label>
                    <label className="library-open-page-property">
                      <span>Win Rate</span>
                      <input type="text" readOnly value={renderPropertyValue(selectedPage, REVIEW_PROPERTY_KEYS.winRate, "-")} />
                    </label>

                    <label className="library-open-page-property">
                      <span>Net</span>
                      <input type="text" readOnly value={renderPropertyValue(selectedPage, REVIEW_PROPERTY_KEYS.net, "-")} />
                    </label>
                    <label className="library-open-page-property">
                      <span>Gross</span>
                      <input type="text" readOnly value={renderPropertyValue(selectedPage, REVIEW_PROPERTY_KEYS.gross, "-")} />
                    </label>
                    <label className="library-open-page-property library-open-page-property-red-days">
                      <span>Red Days</span>
                      <input type="text" readOnly value={renderPropertyValue(selectedPage, REVIEW_PROPERTY_KEYS.redDays, "-")} />
                    </label>
                    <label className="library-open-page-property library-open-page-property-green-days">
                      <span>Green Days</span>
                      <input type="text" readOnly value={renderPropertyValue(selectedPage, REVIEW_PROPERTY_KEYS.greenDays, "-")} />
                    </label>

                    <label className="library-open-page-property">
                      <span>Risk Management (1-5)</span>
                      <select
                        value={renderPropertyValue(selectedPage, REVIEW_PROPERTY_KEYS.risk, "")}
                        onChange={(event) => updatePageProperty(selectedPage, REVIEW_PROPERTY_KEYS.risk, event.target.value)}
                      >
                        {scoreOptions.map((score) => (
                          <option key={score || "empty"} value={score}>
                            {score || "\u2014"}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="library-open-page-property">
                      <span>Psychology (1-5)</span>
                      <select
                        value={renderPropertyValue(selectedPage, REVIEW_PROPERTY_KEYS.psychology, "")}
                        onChange={(event) => updatePageProperty(selectedPage, REVIEW_PROPERTY_KEYS.psychology, event.target.value)}
                      >
                        {scoreOptions.map((score) => (
                          <option key={score || "empty"} value={score}>
                            {score || "\u2014"}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="library-open-page-property">
                      <span>Trading Plans (1-5)</span>
                      <select
                        value={renderPropertyValue(selectedPage, REVIEW_PROPERTY_KEYS.tradingPlans, "")}
                        onChange={(event) => updatePageProperty(selectedPage, REVIEW_PROPERTY_KEYS.tradingPlans, event.target.value)}
                      >
                        {scoreOptions.map((score) => (
                          <option key={score || "empty"} value={score}>
                            {score || "\u2014"}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="library-open-page-property">
                      <span>Overall (1-5)</span>
                      {(() => {
                        const raw = renderPropertyValue(selectedPage, REVIEW_PROPERTY_KEYS.overall, "");
                        const parsed = raw ? Number(raw) : Number.NaN;
                        const normalized =
                          Number.isFinite(parsed) && Math.abs(parsed - Math.round(parsed)) < 1e-6 && parsed >= 1 && parsed <= 5
                            ? String(Math.round(parsed))
                            : raw;

                        return (
                          <select
                            value={normalized}
                            onChange={(event) => updatePageProperty(selectedPage, REVIEW_PROPERTY_KEYS.overall, event.target.value)}
                          >
                            {scoreOptions.map((score) => (
                              <option key={score || "empty"} value={score}>
                                {score || "\u2014"}
                              </option>
                            ))}
                          </select>
                        );
                      })()}
                    </label>
                  </div>

                  <div className="review-breach-days">
                    <span>Breach Days</span>
                    <div className="review-breach-day-list" aria-label="Shutdown-risk breach days">
                      {Array.isArray(selectedPage.properties?.[REVIEW_PROPERTY_KEYS.breachDays]) &&
                      (selectedPage.properties?.[REVIEW_PROPERTY_KEYS.breachDays] as unknown[]).length > 0 ? (
                        (selectedPage.properties?.[REVIEW_PROPERTY_KEYS.breachDays] as unknown[])
                          .filter((day): day is string => typeof day === "string" && day.trim().length > 0)
                          .map((day) => (
                            <button
                              key={day}
                              type="button"
                              className="review-day-pill review-breach-day-pill"
                              onClick={() => handleOpenJournalDate(day)}
                              title={`Open journal for ${normalizeIsoTradeDate(day)}`}
                            >
                              {normalizeIsoTradeDate(day)}
                            </button>
                          ))
                      ) : (
                        <span className="review-breach-day-empty">None</span>
                      )}
                    </div>
                  </div>

                  <div className="review-breach-days">
                    <span>Best Days</span>
                    <div className="review-breach-day-list" aria-label="Best trading days">
                      {bestDayEntries.length > 0 ? (
                        bestDayEntries.map(([day, net]) => (
                          <button
                            key={day}
                            type="button"
                            className="review-day-pill review-best-day-pill"
                            onClick={() => handleOpenJournalDate(day)}
                            title={`${day} · ${formatSignedUsd(net)}`}
                          >
                            {day}
                          </button>
                        ))
                      ) : (
                        <span className="review-breach-day-empty">None</span>
                      )}
                    </div>
                  </div>

                  <ReviewReflectionPanel
                    period={selectedReviewPeriod ?? "weekly"}
                    pageId={selectedPage.id}
                    timeLabels={
                      selectedReviewPeriod === "monthly"
                        ? ["Week 1", "Week 2", "Week 3", "Week 4", "Week 5"]
                        : ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]
                    }
                    improvementGoalsLabel={
                      selectedReviewPeriod === "monthly" ? "Next Month Improvement Goals" : "Next Week Improvement Goals"
                    }
                    templates={
                      selectedReviewPeriod === "monthly" ? reviewTemplates.monthlyTemplates : reviewTemplates.weeklyTemplates
                    }
                    selectedTemplateId={
                      selectedReviewPeriod === "monthly" ? selectedMonthlyReviewTemplateId : selectedWeeklyReviewTemplateId
                    }
                    reflection={coerceReviewReflectionState(selectedPage.properties?.[REVIEW_REFLECTION_KEY])}
                    defaultBookOptions={reviewReadingBookDefaults}
                    defaultAuthorOptions={reviewReadingAuthorDefaults}
                    onSelectTemplateId={
                      selectedReviewPeriod === "monthly"
                        ? setSelectedMonthlyReviewTemplateId
                        : setSelectedWeeklyReviewTemplateId
                    }
                    onChangeReflection={(next) =>
                      updatePage(selectedPage.id, {
                        properties: {
                          ...(selectedPage.properties ?? {}),
                          [REVIEW_REFLECTION_KEY]: next
                        }
                      })
                    }
                    onSaveTemplate={(templateId, content) =>
                      handleSaveReviewTemplate(selectedReviewPeriod === "monthly" ? "monthly" : "weekly", templateId, content)
                    }
                    onSaveTemplateAs={(name, content) =>
                      handleSaveReviewTemplateAs(selectedReviewPeriod === "monthly" ? "monthly" : "weekly", name, content)
                    }
                    onDeleteTemplate={(templateId) =>
                      handleDeleteReviewTemplate(selectedReviewPeriod === "monthly" ? "monthly" : "weekly", templateId)
                    }
                  />

                  <section className="journal-writing-section review-writing-section review-legacy-notes">
                    <div className="journal-writing-header">
                      <div className="journal-writing-header-title">
                        <WorkspaceIcon icon="journal" alt="" className="mini-action-icon" />
                        <strong>Notes</strong>
                      </div>
                      <div className="journal-writing-header-actions">
                        <button
                          type="button"
                          className="mini-action"
                          onClick={() => setShowLegacyReviewNotes((current) => !current)}
                        >
                          {showLegacyReviewNotes ? "Hide" : "Show"}
                        </button>
                      </div>
                    </div>
                    {showLegacyReviewNotes ? (
                      <JournalRichTextEditor
                        content={selectedPage.content}
                        onChange={(content) => updatePage(selectedPage.id, { content })}
                        onImageInsert={handleImageInsert}
                        placeholder="Optional extra notes (legacy editor)"
                        taskListColumns={2}
                      />
                    ) : null}
                  </section>
                </>
              ) : isBookClub && isBookRow(selectedPage) ? (
                <>
                  <div className="library-open-page-properties">
                    <label className="library-open-page-property">
                      <span>Author</span>
                      <input
                        value={getBookFieldValue(selectedPage, "Author")}
                        onChange={(event) => updatePageProperty(selectedPage, "Author", event.target.value)}
                        placeholder="Author"
                      />
                    </label>
                    <label className="library-open-page-property">
                      <span>Status</span>
                      <select
                        value={getBookFieldValue(selectedPage, "Reading Status") || selectedPage.status}
                        onChange={(event) => updatePageProperty(selectedPage, "Reading Status", event.target.value)}
                      >
                        {["To Read", "In Progress", "Completed", "Abandoned", "Imported"].map((status) => (
                          <option key={status} value={status}>
                            {status}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="library-open-page-property">
                      <span>Rating</span>
                      <input
                        value={getBookFieldValue(selectedPage, "Rating")}
                        onChange={(event) => updatePageProperty(selectedPage, "Rating", event.target.value)}
                        placeholder="Optional rating"
                      />
                    </label>
                    <PropertyMultiSelect
                      label="Genres"
                      values={renderPropertyList(selectedPage, "Genre")}
                      onChange={(genres) => updatePageProperty(selectedPage, "Genre", genres)}
                      predefinedOptions={allGenres}
                      placeholder="Add genre"
                      allowCustom
                    />
                    <label className="library-open-page-property library-open-page-property-wide">
                      <span>Source URL</span>
                      <input
                        value={selectedPage.sourceUrl}
                        onChange={(event) => updatePage(selectedPage.id, { sourceUrl: event.target.value })}
                        placeholder="Paste source, video, article, or Notion link"
                      />
                    </label>
                  </div>

                  <div className="library-open-page-notes">
                    <label className="library-open-page-note">
                      <span>Summary</span>
                      <textarea
                        value={getBookFieldValue(selectedPage, "Summary")}
                        onChange={(event) => updatePageProperty(selectedPage, "Summary", event.target.value)}
                        placeholder="Key ideas, takeaways, and notes from the book."
                      />
                    </label>
                    <label className="library-open-page-note">
                      <span>Review</span>
                      <textarea
                        value={getBookFieldValue(selectedPage, "Review")}
                        onChange={(event) => updatePageProperty(selectedPage, "Review", event.target.value)}
                        placeholder="What stood out, what mattered, and how it applies to trading."
                      />
                    </label>
                  </div>
                </>
              ) : (
                <>
                  <div className="library-property-grid">
                    <label>
                      <span>Status</span>
                      <select
                        value={selectedPage.status}
                        onChange={(event) => updatePage(selectedPage.id, { status: event.target.value })}
                      >
                        {statusOptions.map((status) => (
                          <option key={status} value={status}>
                            {status}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>Tags</span>
                      <input
                        value={selectedPage.tags.join(", ")}
                        onChange={(event) => updatePage(selectedPage.id, { tags: parseTags(event.target.value) })}
                        placeholder="mental-game, replay, lesson"
                      />
                    </label>
                    <label>
                      <span>Source URL</span>
                      <input
                        value={selectedPage.sourceUrl}
                        onChange={(event) => updatePage(selectedPage.id, { sourceUrl: event.target.value })}
                        placeholder="Paste source, video, article, or Notion link"
                      />
                    </label>
                    <label>
                      <span>Author / Owner</span>
                      <input
                        value={renderPropertyValue(selectedPage, "Author", "")}
                        onChange={(event) => updatePageProperty(selectedPage, "Author", event.target.value)}
                        placeholder="Author, creator, or owner"
                      />
                    </label>
                    <label>
                      <span>Rating</span>
                      <input
                        value={renderPropertyValue(selectedPage, "Rating", "")}
                        onChange={(event) => updatePageProperty(selectedPage, "Rating", event.target.value)}
                        placeholder="Optional rating"
                      />
                    </label>
                  </div>

                  <JournalRichTextEditor
                    content={selectedPage.content}
                    onChange={(content) => updatePage(selectedPage.id, { content })}
                    onImageInsert={handleImageInsert}
                    placeholder="Type '/' for commands"
                  />
                </>
              )}
            </section>
          ) : null}
        </section>
      </section>
      {bookCellEditor && bookCellEditorPage ? (
        <TagDrawer
          isOpen={!!bookCellEditor}
          title={`${bookCellEditor.field} - ${bookCellEditorPage.title}`}
          options={bookCellEditor.field === "Reading Status" ? bookReadingStatusOptions : allGenres}
          selectionMode={bookCellEditor.field === "Genre" ? "multi" : "single"}
          currentValue={
            bookCellEditor.field === "Reading Status"
              ? getBookFieldValue(bookCellEditorPage, "Reading Status") || bookCellEditorPage.status
              : ""
          }
          currentValues={bookCellEditor.field === "Genre" ? renderPropertyList(bookCellEditorPage, "Genre") : []}
          allowClear={bookCellEditor.field === "Genre"}
          clearLabel={bookCellEditor.field === "Genre" ? "Clear genres" : undefined}
          searchValue={bookCellEditorSearchQuery}
          onSearchChange={setBookCellEditorSearchQuery}
          onSelect={(value) => {
            if (bookCellEditor.field === "Genre") {
              updatePageProperty(bookCellEditorPage, "Genre", Array.isArray(value) ? value : []);
              return;
            }

            if (typeof value === "string") {
              updatePageProperty(bookCellEditorPage, "Reading Status", value);
            }

            setBookCellEditor(null);
            setBookCellEditorSearchQuery("");
          }}
          onCreateOption={
            bookCellEditor.field === "Genre"
              ? (value) => {
                  const current = renderPropertyList(bookCellEditorPage, "Genre");
                  const next = current.includes(value) ? current : [...current, value];
                  updatePageProperty(bookCellEditorPage, "Genre", next);
                }
              : undefined
          }
          onClose={() => {
            setBookCellEditor(null);
            setBookCellEditorSearchQuery("");
          }}
        />
      ) : null}
      {isBookGenreFilterOpen ? (
        <TagDrawer
          isOpen={isBookGenreFilterOpen}
          title="Filter: Genre"
          options={allGenres}
          selectionMode="multi"
          currentValues={bookGenreFilter}
          allowClear
          clearLabel="All genres"
          searchValue={bookGenreFilterSearchQuery}
          onSearchChange={setBookGenreFilterSearchQuery}
          onSelect={(value) => setBookGenreFilter(Array.isArray(value) ? value : [])}
          onClose={() => {
            setIsBookGenreFilterOpen(false);
            setBookGenreFilterSearchQuery("");
          }}
        />
      ) : null}
      {quoteCellEditor && quoteCellEditorPage ? (
        <TagDrawer
          isOpen={!!quoteCellEditor}
          title={`${quoteCellEditor.field} - Quotes`}
          options={quoteCellEditor.field === "Author" ? quoteAuthorOptions : quoteSourceOptions}
          selectionMode="single"
          currentValue={getQuoteFieldValue(quoteCellEditorPage, quoteCellEditor.field)}
          allowClear
          clearLabel={`Clear ${quoteCellEditor.field.toLowerCase()}`}
          searchValue={quoteCellEditorSearchQuery}
          onSearchChange={setQuoteCellEditorSearchQuery}
          onSelect={(value) => {
            if (typeof value === "string") {
              updatePageProperty(quoteCellEditorPage, quoteCellEditor.field, value);
            } else if (value === null) {
              updatePageProperty(quoteCellEditorPage, quoteCellEditor.field, "");
            }

            setQuoteCellEditor(null);
            setQuoteCellEditorSearchQuery("");
          }}
          onCreateOption={(value) => {
            updatePageProperty(quoteCellEditorPage, quoteCellEditor.field, value);
            setQuoteCellEditor(null);
            setQuoteCellEditorSearchQuery("");
          }}
          onClose={() => {
            setQuoteCellEditor(null);
            setQuoteCellEditorSearchQuery("");
          }}
        />
      ) : null}
    </main>
  );
};
