import { useEffect, useMemo, useRef, useState } from "react";
import { JournalRichTextEditor } from "../components/JournalRichTextEditor";
import { PageHero } from "../../../components/PageHero";
import { PreviewTable } from "../../../components/PreviewTable";
import { WorkspaceIcon } from "../../../components/WorkspaceIcon";
import { getDatabaseStats, getTradeSummary } from "../../../lib/analytics/tradeAnalytics";
import type { JournalChecklistTemplates, NamedChecklistTemplate } from "../../../lib/journal/journalTemplateStore";
import { getTickerIcon as getTickerIconSrc, getTickerSector } from "../../../lib/tickers/tickerIcons";
import { useEditableSelectOptions } from "../../../lib/select/useEditableSelectOptions";
import type { JournalContentField, JournalPageRecord } from "../../../types/journal";
import type { EditableTradeRow, EditableTradeTagField } from "../../../types/tradeTags";
import { HeadlinesBar } from "../../headlines/components/HeadlinesBar";

interface JournalPageProps {
  pages: JournalPageRecord[];
  selectedPageId: string;
  trades: EditableTradeRow[];
  tagOptionsByField: Record<EditableTradeTagField, string[]>;
  checklistTemplates: JournalChecklistTemplates;
  externalSelectedTradeDate: string;
  onSelectPage: (pageId: string) => void;
  onSelectTrade: (tradeId: string, tradeDate: string) => void;
  onCreatePage: (tradeDate: string) => void;
  onUpdatePage: (
    pageId: string,
    updates: Partial<
      Pick<
        JournalPageRecord,
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
      >
    >
  ) => void;
  onUpdateContent: (pageId: string, field: JournalContentField, content: JournalPageRecord[JournalContentField]) => void;
  onSaveChecklistTemplateAs: (
    type: "morning" | "closing" | "mpp",
    name: string,
    content: NamedChecklistTemplate["content"]
  ) => void;
  onUpdateChecklistTemplate: (
    type: "morning" | "closing" | "mpp",
    templateId: string,
    content: NamedChecklistTemplate["content"]
  ) => void;
  onDeleteChecklistTemplate: (type: "morning" | "closing" | "mpp", templateId: string) => void;
  onUpdateTradeTag: (trade: EditableTradeRow, field: EditableTradeTagField, value: string | string[] | null) => void;
  onCreateTradeTagOption: (field: EditableTradeTagField, value: string) => void;
}

const dayGradeOptions = ["", "A+", "A", "A-", "B+", "B", "B-", "C+", "C", "C-"];
const sleepHourOptions = Array.from({ length: 11 }, (_, index) => (4 + index * 0.5).toString());
const sleepScoreOptions = ["", "1", "2", "3", "4", "5"];
const ADD_OPTION_VALUE = "__add_option__";

const defaultMoodOptions = [
  "",
  "Flow State",
  "Locked in",
  "Focused",
  "Productive",
  "Confident",
  "Calm",
  "Well rested",
  "Excited",
  "Meh",
  "Slow Moving",
  "Tired",
  "Sore",
  "Hesitant",
  "Distracted",
  "Feeling a little behind",
  "Foggy",
  "Nervous",
  "Anxious",
  "Bummed Out",
  "Starting to get sick",
  "Stressed",
  "Frustrated",
  "Irritable",
  "Mentally Checked Out",
  "Overconfident",
  "Tilted",
  "Sick",
  "Panicked",
  "Revenge Trading"
];

const defaultMarketRegimeOptions = ["", "Trend", "Chop", "Range", "High Vol", "Low Vol", "News", "Earnings"];
const screenshotColumnLabels = ["Open Chart", "Close Chart", "Context Chart"] as const;

const getScreenshotSlotMeta = (index: number) => {
  const rowNumber = Math.floor(index / 3) + 1;
  const columnLabel = screenshotColumnLabels[index % 3];
  return {
    label: columnLabel,
    rowLabel: rowNumber === 1 ? "Primary Set" : `Set ${rowNumber}`
  };
};

const readFileAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }

      reject(new Error("The screenshot file could not be read."));
    };
    reader.onerror = () => reject(reader.error ?? new Error("The screenshot file could not be read."));
    reader.readAsDataURL(file);
  });

const formatJournalDate = (tradeDate: string) => {
  if (!tradeDate) {
    return "No Date";
  }

  const normalized = `${tradeDate}T00:00:00`;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return tradeDate;
  }

  return parsed.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
};

const getSortableTimestamp = (value: string) => {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
};

const formatSignedMoney = (value: number) => `${value >= 0 ? "+" : ""}$${value.toFixed(2)}`;

const normalizeDateForInput = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  return parsed.toISOString().slice(0, 10);
};

const getMonthKey = (tradeDate: string) => (tradeDate && tradeDate.length >= 7 ? tradeDate.slice(0, 7) : "No Date"); // "2026-04"

const formatMonthHeader = (monthKey: string) => {
  if (monthKey === "No Date") {
    return monthKey;
  }

  const [year, month] = monthKey.split("-");
  const date = new Date(`${monthKey}-01T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return monthKey;
  }
  return date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
};

const groupPagesByMonth = (pages: JournalPageRecord[]): Map<string, JournalPageRecord[]> => {
  const grouped = new Map<string, JournalPageRecord[]>();
  for (const page of pages) {
    const monthKey = getMonthKey(page.tradeDate);
    const existing = grouped.get(monthKey) ?? [];
    existing.push(page);
    grouped.set(monthKey, existing);
  }
  return grouped;
};

export const JournalPage = ({
  pages,
  selectedPageId,
  trades,
  tagOptionsByField,
  checklistTemplates,
  externalSelectedTradeDate,
  onSelectPage,
  onSelectTrade,
  onCreatePage,
  onUpdatePage,
  onUpdateContent,
  onSaveChecklistTemplateAs,
  onUpdateChecklistTemplate,
  onDeleteChecklistTemplate,
  onUpdateTradeTag,
  onCreateTradeTagOption
}: JournalPageProps) => {
  const [draftTradeDate, setDraftTradeDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [visibleScreenshotRows, setVisibleScreenshotRows] = useState(1);
  const [expandedScreenshotUrl, setExpandedScreenshotUrl] = useState("");
  const [pendingScreenshotSlotIndex, setPendingScreenshotSlotIndex] = useState<number | null>(null);
  const [selectedMorningTemplateId, setSelectedMorningTemplateId] = useState("");
  const [selectedClosingTemplateId, setSelectedClosingTemplateId] = useState("");
  const [selectedMppTemplateId, setSelectedMppTemplateId] = useState("");
  const [selectedJournalTradeId, setSelectedJournalTradeId] = useState("");
  const [selectedJournalTradeIds, setSelectedJournalTradeIds] = useState<string[]>([]);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [tempDate, setTempDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(() => new Set());
  const lastExternalSyncRef = useRef("");
  const expandedMonthsInitializedRef = useRef(false);
  const screenshotInputRef = useRef<HTMLInputElement | null>(null);

  const handleImageInsert = async (file: File): Promise<string> => {
    return readFileAsDataUrl(file);
  };

  const selectedPage = useMemo(
    () => pages.find((page) => page.id === selectedPageId) ?? pages[0] ?? null,
    [pages, selectedPageId]
  );

  const { options: moodOptions, addOption: addMoodOption } = useEditableSelectOptions(
    "journal.options.moods",
    defaultMoodOptions
  );
  const { options: marketRegimeOptions, addOption: addMarketRegimeOption } = useEditableSelectOptions(
    "journal.options.marketRegimes",
    defaultMarketRegimeOptions
  );

  const handleAddableSelectChange = (
    nextValue: string,
    addOption: (value: string) => string | null,
    onCommit: (value: string) => void
  ) => {
    if (nextValue !== ADD_OPTION_VALUE) {
      onCommit(nextValue);
      return;
    }

    const proposed = window.prompt("Add a new option:");
    if (!proposed) {
      return;
    }

    const added = addOption(proposed);
    if (!added) {
      return;
    }

    onCommit(added);
  };

  const sortedPages = useMemo(
    () =>
      [...pages].sort((left, right) => {
        const tradeDateCompare = right.tradeDate.localeCompare(left.tradeDate);
        if (tradeDateCompare !== 0) {
          return tradeDateCompare;
        }

        const updatedAtCompare = getSortableTimestamp(right.updatedAt) - getSortableTimestamp(left.updatedAt);
        if (updatedAtCompare !== 0) {
          return updatedAtCompare;
        }

        const createdAtCompare = getSortableTimestamp(right.createdAt) - getSortableTimestamp(left.createdAt);
        if (createdAtCompare !== 0) {
          return createdAtCompare;
        }

        return right.id.localeCompare(left.id);
      }),
    [pages]
  );
  const sortedPagesRef = useRef(sortedPages);

  useEffect(() => {
    sortedPagesRef.current = sortedPages;
  }, [sortedPages]);

  useEffect(() => {
    if (!expandedMonthsInitializedRef.current && sortedPages.length > 0) {
      const firstMonth = getMonthKey(sortedPages[0].tradeDate);
      setExpandedMonths(new Set([firstMonth]));
      expandedMonthsInitializedRef.current = true;
    }
  }, [sortedPages.length]);

  useEffect(() => {
    if (!selectedPage?.tradeDate) {
      return;
    }

    const monthKey = getMonthKey(selectedPage.tradeDate);
    setExpandedMonths((current) => {
      if (current.has(monthKey)) {
        return current;
      }

      const next = new Set(current);
      next.add(monthKey);
      return next;
    });
  }, [selectedPage?.tradeDate]);

  const monthGroups = useMemo(() => {
    const grouped = groupPagesByMonth(sortedPages);
    return Array.from(grouped.entries()).sort(([leftKey], [rightKey]) => {
      if (leftKey === "No Date") {
        return 1;
      }

      if (rightKey === "No Date") {
        return -1;
      }

      return rightKey.localeCompare(leftKey);
    });
  }, [sortedPages]);

  const toggleMonth = (monthKey: string) => {
    setExpandedMonths((current) => {
      const next = new Set(current);
      if (next.has(monthKey)) {
        next.delete(monthKey);
      } else {
        next.add(monthKey);
      }
      return next;
    });
  };

  const navigateToJournalDate = (value: string) => {
    const normalized = normalizeDateForInput(value);
    if (!normalized) {
      return;
    }

    const matchingPage = sortedPagesRef.current.find((page) => page.tradeDate === normalized);
    if (matchingPage) {
      onSelectPage(matchingPage.id);
    }
  };

  const promptForNewJournalDate = () => {
    const response = window.prompt("Journal date", draftTradeDate);
    const trimmed = response?.trim() ?? "";
    if (!trimmed) {
      return;
    }

    const normalized = normalizeDateForInput(trimmed);
    if (!normalized) {
      window.alert("Please enter a valid date.");
      return;
    }

    setDraftTradeDate(normalized);
    onCreatePage(normalized);
  };

  const linkedTrades = useMemo(
    () =>
      selectedPage
        ? trades
            .filter((trade) => trade.tradeDate === selectedPage.tradeDate)
            .sort((left, right) => left.openTime.localeCompare(right.openTime))
        : [],
    [selectedPage, trades]
  );

  const linkedTickers = useMemo(
    () => Array.from(new Set(linkedTrades.map((trade) => trade.symbol))).sort(),
    [linkedTrades]
  );
  const journalPageSummaries = useMemo(
    () =>
      new Map(
        pages.map((page) => {
          const pageTrades = trades.filter((trade) => trade.tradeDate === page.tradeDate);
          const summary = getTradeSummary(pageTrades);
          return [
            page.id,
            {
              netPnl: summary.totalNetPnl,
              tradeCount: summary.totalTrades,
              tickers: Array.from(new Set(pageTrades.map((trade) => trade.symbol))).sort()
            }
          ];
        })
      ),
    [pages, trades]
  );

  const linkedTradeSummary = useMemo(() => getTradeSummary(linkedTrades), [linkedTrades]);
  const linkedDatabaseStats = useMemo(() => getDatabaseStats(linkedTrades), [linkedTrades]);
  const linkedTickerStats = useMemo(() => {
    const grouped = new Map<string, EditableTradeRow[]>();

    for (const trade of linkedTrades) {
      const ticker = trade.symbol.trim();
      if (!ticker) {
        continue;
      }

      const current = grouped.get(ticker) ?? [];
      current.push(trade);
      grouped.set(ticker, current);
    }

    return Array.from(grouped.entries())
      .map(([ticker, tickerTrades]) => ({
        ticker,
        summary: getTradeSummary(tickerTrades)
      }))
      .sort(
        (left, right) =>
          right.summary.totalNetPnl - left.summary.totalNetPnl ||
          right.summary.totalTrades - left.summary.totalTrades ||
          left.ticker.localeCompare(right.ticker)
      );
  }, [linkedTrades]);
  const linkedPlaybookStats = useMemo(() => {
    const grouped = new Map<string, EditableTradeRow[]>();

    for (const trade of linkedTrades) {
      for (const setup of trade.setups) {
        const playbook = setup.trim();
        if (!playbook || playbook === "No Setup") {
          continue;
        }

        const current = grouped.get(playbook) ?? [];
        current.push(trade);
        grouped.set(playbook, current);
      }
    }

    return Array.from(grouped.entries())
      .map(([playbook, playbookTrades]) => ({
        playbook,
        summary: getTradeSummary(playbookTrades)
      }))
      .sort(
        (left, right) =>
          right.summary.totalNetPnl - left.summary.totalNetPnl ||
          right.summary.totalTrades - left.summary.totalTrades ||
          left.playbook.localeCompare(right.playbook)
      );
  }, [linkedTrades]);
  const visibleScreenshotSlots = useMemo(() => {
    const requiredSlots = Math.max(3, selectedPage?.screenshotUrls.length ?? 0);
    return Math.max(requiredSlots, visibleScreenshotRows * 3);
  }, [selectedPage?.screenshotUrls.length, visibleScreenshotRows]);
  const selectedMorningTemplate = useMemo(
    () =>
      checklistTemplates.morningTemplates.find((template) => template.id === selectedMorningTemplateId) ??
      checklistTemplates.morningTemplates[0] ??
      null,
    [checklistTemplates.morningTemplates, selectedMorningTemplateId]
  );
  const selectedClosingTemplate = useMemo(
    () =>
      checklistTemplates.closingTemplates.find((template) => template.id === selectedClosingTemplateId) ??
      checklistTemplates.closingTemplates[0] ??
      null,
    [checklistTemplates.closingTemplates, selectedClosingTemplateId]
  );
  const selectedMppTemplate = useMemo(
    () =>
      checklistTemplates.mppTemplates.find((template) => template.id === selectedMppTemplateId) ??
      checklistTemplates.mppTemplates[0] ??
      null,
    [checklistTemplates.mppTemplates, selectedMppTemplateId]
  );

  useEffect(() => {
    if (!externalSelectedTradeDate) {
      return;
    }

    if (lastExternalSyncRef.current === externalSelectedTradeDate) {
      return;
    }

    lastExternalSyncRef.current = externalSelectedTradeDate;
    setDraftTradeDate(externalSelectedTradeDate);
    const matchingPage = sortedPagesRef.current.find((page) => page.tradeDate === externalSelectedTradeDate);
    if (matchingPage) {
      onSelectPage(matchingPage.id);
    }
  }, [externalSelectedTradeDate, onSelectPage]);

  useEffect(() => {
    const imageCount = selectedPage?.screenshotUrls.length ?? 0;
    setVisibleScreenshotRows(Math.max(1, Math.ceil(Math.max(imageCount, 3) / 3)));
    setExpandedScreenshotUrl("");
    setPendingScreenshotSlotIndex(null);
  }, [selectedPage?.id, selectedPage?.screenshotUrls.length]);

  useEffect(() => {
    setSelectedJournalTradeIds([]);
    setSelectedJournalTradeId((current) =>
      linkedTrades.some((trade) => trade.id === current) ? current : linkedTrades[0]?.id ?? ""
    );
  }, [linkedTrades]);

  useEffect(() => {
    if (!selectedMorningTemplateId && checklistTemplates.morningTemplates[0]) {
      setSelectedMorningTemplateId(checklistTemplates.morningTemplates[0].id);
      return;
    }

    if (
      selectedMorningTemplateId &&
      !checklistTemplates.morningTemplates.some((template) => template.id === selectedMorningTemplateId)
    ) {
      setSelectedMorningTemplateId(checklistTemplates.morningTemplates[0]?.id ?? "");
    }
  }, [checklistTemplates.morningTemplates, selectedMorningTemplateId]);

  useEffect(() => {
    if (!selectedClosingTemplateId && checklistTemplates.closingTemplates[0]) {
      setSelectedClosingTemplateId(checklistTemplates.closingTemplates[0].id);
      return;
    }

    if (
      selectedClosingTemplateId &&
      !checklistTemplates.closingTemplates.some((template) => template.id === selectedClosingTemplateId)
    ) {
      setSelectedClosingTemplateId(checklistTemplates.closingTemplates[0]?.id ?? "");
    }
  }, [checklistTemplates.closingTemplates, selectedClosingTemplateId]);

  useEffect(() => {
    if (!selectedMppTemplateId && checklistTemplates.mppTemplates[0]) {
      setSelectedMppTemplateId(checklistTemplates.mppTemplates[0].id);
      return;
    }

    if (
      selectedMppTemplateId &&
      !checklistTemplates.mppTemplates.some((template) => template.id === selectedMppTemplateId)
    ) {
      setSelectedMppTemplateId(checklistTemplates.mppTemplates[0]?.id ?? "");
    }
  }, [checklistTemplates.mppTemplates, selectedMppTemplateId]);

  const promptForTemplateName = (type: "morning" | "closing" | "mpp") => {
    const suggestion = `${type === "morning" ? "Morning" : type === "closing" ? "Closing" : "MPP"} Template`;
    const response = window.prompt("Template name", suggestion);
    const trimmed = response?.trim();
    return trimmed || "";
  };

  const confirmDeleteTemplate = (type: "morning" | "closing" | "mpp", template: NamedChecklistTemplate | null) => {
    if (!template) {
      return;
    }

    const templateCount =
      type === "morning"
        ? checklistTemplates.morningTemplates.length
        : type === "closing"
          ? checklistTemplates.closingTemplates.length
          : checklistTemplates.mppTemplates.length;

    if (templateCount <= 1) {
      return;
    }

    const confirmed = window.confirm(`Delete the ${type} template "${template.name}"?`);
    if (!confirmed) {
      return;
    }

    onDeleteChecklistTemplate(type, template.id);
  };

  return (
    <main className="page-shell">
      <PageHero
        eyebrow="Journal"
        title="Trading Journal"
        description="Manual daily review pages with fixed journal sections, compact trade context, and room for deeper written notes."
      />
      <section className="journal-grid">
        <aside className="journal-sidebar">
          <div className="journal-sidebar-header">
            <div>
              <strong>Daily Journal</strong>
              <span>{pages.length} saved</span>
            </div>
          </div>
          <div className="journal-create-panel">
            <div className="journal-create-row">
              <label className="journal-date-label">
                <span>Journal Date</span>
                <input
                  type="date"
                  value={draftTradeDate}
                  onChange={(event) => {
                    setDraftTradeDate(event.target.value);
                    navigateToJournalDate(event.target.value);
                  }}
                  onClick={() => navigateToJournalDate(draftTradeDate)}
                  className="journal-date-input"
                />
              </label>
              <button type="button" className="mini-action journal-create-button" onClick={promptForNewJournalDate}>
                <WorkspaceIcon icon="journal" alt="Create journal icon" className="mini-action-icon" />
                New Journal
              </button>
            </div>
          </div>
          <div className="journal-page-section">
            <div className="journal-section-heading">Entries</div>
            <div className="journal-page-list">
              {sortedPages.length === 0 ? (
                <span className="empty-inline-state">Create your first daily journal page.</span>
              ) : (
                monthGroups.map(([monthKey, monthPages]) => {
                  const expanded = expandedMonths.has(monthKey);
                  return (
                    <div key={monthKey} className="journal-month-group">
                      <button
                        type="button"
                        className={`journal-month-toggle${expanded ? " journal-month-toggle-expanded" : ""}`}
                        onClick={() => toggleMonth(monthKey)}
                      >
                        <span className="journal-month-label">{formatMonthHeader(monthKey)}</span>
                        <span className="journal-month-meta">{monthPages.length}</span>
                        <span className="journal-month-chevron" aria-hidden="true">
                          ▸
                        </span>
                      </button>
                      {expanded ? (
                        <div className="journal-month-entries">
                          {monthPages.map((page) => {
                            const pageSummary = journalPageSummaries.get(page.id);
                            const gradeLabel = page.dayGrade || "No Grade";
                            const netPnl = pageSummary?.netPnl ?? 0;
                            const tickers = pageSummary?.tickers ?? [];
                            return (
                              <button
                                key={page.id}
                                type="button"
                                className={`journal-page-item ${page.id === selectedPage?.id ? "journal-page-item-active" : ""}`}
                                onClick={() => onSelectPage(page.id)}
                              >
                                <div className="journal-page-row">
                                  <div className="journal-page-title">
                                    <WorkspaceIcon icon="journal" alt="Journal page icon" className="journal-page-icon" />
                                    <strong>{formatJournalDate(page.tradeDate)}</strong>
                                  </div>
                                  <span className={`journal-grade-pill${page.dayGrade ? "" : " journal-grade-pill-empty"}`}>
                                    {gradeLabel}
                                  </span>
                                </div>
                                <div className="journal-page-meta">
                                  <span
                                    className={`journal-page-pnl ${
                                      netPnl >= 0 ? "journal-page-pnl-positive" : "journal-page-pnl-negative"
                                    }`}
                                  >
                                    {netPnl >= 0 ? "+" : ""}${netPnl.toFixed(2)}
                                  </span>
                                  <span>{pageSummary?.tradeCount ?? 0} trades</span>
                                </div>
                                {tickers.length > 0 ? (
                                  <div className="journal-page-tickers">
                                    {tickers.slice(0, 4).map((ticker) => (
                                      <span key={`${page.id}-${ticker}`} className="journal-page-ticker-pill">
                                        {ticker}
                                      </span>
                                    ))}
                                    {tickers.length > 4 ? (
                                      <span className="journal-page-ticker-pill">+{tickers.length - 4}</span>
                                    ) : null}
                                  </div>
                                ) : null}
                              </button>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  );
                })
              )}
              </div>
          </div>
        </aside>
        <section className="journal-editor">
          {selectedPage ? (
            <>
              <header className="journal-page-header">
                <div className="journal-page-header-top">
                  <div className="journal-page-title-row">
                    <WorkspaceIcon icon="journal" alt="Journal page icon" className="journal-page-header-icon" />
                    <div>
                      <div className="journal-section-heading">Daily Journal</div>
                      <h2>{formatJournalDate(selectedPage.tradeDate)}</h2>
                      <label className="journal-market-regime-card">
                        <span>Market Regime</span>
                        <select
                          className="journal-header-select"
                          value={selectedPage.marketRegime}
                          onChange={(event) =>
                            handleAddableSelectChange(event.target.value, addMarketRegimeOption, (value) =>
                              onUpdatePage(selectedPage.id, { marketRegime: value })
                            )
                          }
                        >
                          {marketRegimeOptions.map((option) => (
                            <option key={option || "empty"} value={option}>
                              {option || "Select Regime"}
                            </option>
                          ))}
                          <option value={ADD_OPTION_VALUE}>Add…</option>
                        </select>
                      </label>
                    </div>
                  </div>
                  <div className="journal-header-ticker-card">
                    <div
                      className={`journal-ticker-pills ${
                        linkedTickers.length > 24
                          ? "journal-ticker-pills--tiny"
                          : linkedTickers.length > 15
                            ? "journal-ticker-pills--compact"
                            : "journal-ticker-pills--roomy"
                      }`}
                    >
                      {linkedTickers.length === 0 ? (
                        <span className="empty-inline-state">No linked tickers for this date yet.</span>
                      ) : (
                        linkedTickers.map((ticker) => {
                          const tickerIcon = getTickerIconSrc(ticker);
                          const tickerSector = getTickerSector(ticker);

                          return (
                            <span key={ticker} className="symbol-pill">
                              {tickerIcon ? (
                                <img
                                  src={tickerIcon}
                                  alt={tickerSector ? `${tickerSector} sector icon` : `${ticker} ticker icon`}
                                  className="symbol-pill-icon"
                                />
                              ) : (
                                <WorkspaceIcon icon="trades" alt={`${ticker} ticker icon`} className="symbol-pill-icon" />
                              )}
                              {ticker}
                            </span>
                          );
                        })
                      )}
                    </div>
                  </div>
                  <div className="journal-header-stat-group">
                    <label className="journal-header-stat-card">
                      <span>Hours Slept</span>
                      <select
                        className="journal-header-select"
                        value={selectedPage.sleepHours}
                        onChange={(event) => onUpdatePage(selectedPage.id, { sleepHours: event.target.value })}
                      >
                        {sleepHourOptions.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="journal-header-stat-card">
                      <span>Sleep Score</span>
                      <select
                        className="journal-header-select"
                        value={selectedPage.sleepScore}
                        onChange={(event) => onUpdatePage(selectedPage.id, { sleepScore: event.target.value })}
                      >
                        {sleepScoreOptions.map((option) => (
                          <option key={option || "empty"} value={option}>
                            {option || "Select Score"}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="journal-header-stat-card">
                      <span>Day Grade</span>
                      <select
                        className="journal-header-select"
                        value={selectedPage.dayGrade}
                        onChange={(event) => onUpdatePage(selectedPage.id, { dayGrade: event.target.value })}
                      >
                        {dayGradeOptions.map((option) => (
                          <option key={option || "empty"} value={option}>
                            {option || "Select Grade"}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="journal-header-stat-card">
                      <span>MPP</span>
                      <input
                        type="number"
                        step="1"
                        className="journal-header-stat-input"
                        value={selectedPage.mpp}
                        onChange={(event) => onUpdatePage(selectedPage.id, { mpp: event.target.value })}
                        placeholder="0"
                      />
                    </label>
                    <label className="journal-header-stat-card">
                      <span>Morning</span>
                      <select
                        className="journal-header-select"
                        value={selectedPage.morningMood}
                        onChange={(event) =>
                          handleAddableSelectChange(event.target.value, addMoodOption, (value) =>
                            onUpdatePage(selectedPage.id, { morningMood: value })
                          )
                        }
                      >
                        {moodOptions.map((option) => (
                          <option key={option || "empty"} value={option}>
                            {option}
                          </option>
                        ))}
                        <option value={ADD_OPTION_VALUE}>Add…</option>
                      </select>
                    </label>
                    <label className="journal-header-stat-card">
                      <span>Open</span>
                      <select
                        className="journal-header-select"
                        value={selectedPage.openMood}
                        onChange={(event) =>
                          handleAddableSelectChange(event.target.value, addMoodOption, (value) =>
                            onUpdatePage(selectedPage.id, { openMood: value })
                          )
                        }
                      >
                        {moodOptions.map((option) => (
                          <option key={option || "empty"} value={option}>
                            {option}
                          </option>
                        ))}
                        <option value={ADD_OPTION_VALUE}>Add…</option>
                      </select>
                    </label>
                    <label className="journal-header-stat-card">
                      <span>Afternoon</span>
                      <select
                        className="journal-header-select"
                        value={selectedPage.afternoonMood}
                        onChange={(event) =>
                          handleAddableSelectChange(event.target.value, addMoodOption, (value) =>
                            onUpdatePage(selectedPage.id, { afternoonMood: value })
                          )
                        }
                      >
                        {moodOptions.map((option) => (
                          <option key={option || "empty"} value={option}>
                            {option}
                          </option>
                        ))}
                        <option value={ADD_OPTION_VALUE}>Add…</option>
                      </select>
                    </label>
                    <label className="journal-header-stat-card">
                      <span>Close</span>
                      <select
                        className="journal-header-select"
                        value={selectedPage.closeMood}
                        onChange={(event) =>
                          handleAddableSelectChange(event.target.value, addMoodOption, (value) =>
                            onUpdatePage(selectedPage.id, { closeMood: value })
                          )
                        }
                      >
                        {moodOptions.map((option) => (
                          <option key={option || "empty"} value={option}>
                            {option}
                          </option>
                        ))}
                        <option value={ADD_OPTION_VALUE}>Add…</option>
                      </select>
                    </label>
                  </div>
                </div>
                <div>
                  <div className="journal-meta">
                    <span>{linkedTrades.length} linked trades</span>
                    <span>Updated {new Date(selectedPage.updatedAt).toLocaleString()}</span>
                  </div>
                </div>
              </header>

              <section className="journal-properties-grid">
                <div className="journal-property-card journal-property-card-wide">
                  <div className="journal-property-metric-grid">
                    <section className="journal-metric-card">
                      <div className="journal-metric-card-header">
                        <strong>Overall Performance</strong>
                        <span>{formatJournalDate(selectedPage.tradeDate)}</span>
                      </div>
                      <div className="journal-metric-list">
                        <div>
                          <span>Net P&amp;L</span>
                          <strong>{formatSignedMoney(linkedTradeSummary.totalNetPnl)}</strong>
                        </div>
                        <div>
                          <span>Gross P&amp;L</span>
                          <strong>{formatSignedMoney(linkedTradeSummary.totalGrossPnl)}</strong>
                        </div>
                        <div>
                          <span>Win Rate</span>
                          <strong>{linkedTradeSummary.winRate.toFixed(1)}%</strong>
                        </div>
                        <div>
                          <span>Trades</span>
                          <strong>{linkedTradeSummary.totalTrades}</strong>
                        </div>
                        <div>
                          <span>Fees</span>
                          <strong>${linkedTradeSummary.totalFees.toFixed(2)}</strong>
                        </div>
                        <div>
                          <span>Avg Trade</span>
                          <strong>{formatSignedMoney(linkedTradeSummary.avgTrade)}</strong>
                        </div>
                        <div>
                          <span>Profit Factor</span>
                          <strong>{linkedTradeSummary.profitFactor.toFixed(2)}</strong>
                        </div>
                      </div>
                    </section>

                    <section className="journal-metric-card">
                      <div className="journal-metric-card-header">
                        <strong>Database Stats</strong>
                      </div>
                      <div className="journal-metric-list">
                        <div>
                          <span>Total Trades</span>
                          <strong>{linkedDatabaseStats.totalTrades}</strong>
                        </div>
                        <div>
                          <span>Executions</span>
                          <strong>{linkedDatabaseStats.totalExecutions}</strong>
                        </div>
                        <div>
                          <span>Shares Traded</span>
                          <strong>{linkedDatabaseStats.totalSharesTraded.toLocaleString()}</strong>
                        </div>
                        <div>
                          <span>Gross P&amp;L</span>
                          <strong>{formatSignedMoney(linkedDatabaseStats.totalGrossPnl)}</strong>
                        </div>
                        <div>
                          <span>Fees</span>
                          <strong>${linkedDatabaseStats.totalFees.toFixed(2)}</strong>
                        </div>
                        <div>
                          <span>Sessions</span>
                          <strong>{linkedDatabaseStats.sessions}</strong>
                        </div>
                        <div>
                          <span>Symbols</span>
                          <strong>{linkedDatabaseStats.symbols}</strong>
                        </div>
                      </div>
                    </section>

                    <section className="journal-metric-card">
                      <div className="journal-metric-card-header">
                        <strong>Ticker Stats</strong>
                        <span>{linkedTickerStats.length} symbols</span>
                      </div>
                      {linkedTickerStats.length === 0 ? (
                        <span className="empty-inline-state">No trades on this day yet.</span>
                      ) : (
                        <div
                          className="journal-playbook-stat-scroll"
                          role="region"
                          aria-label="Ticker stats list"
                          tabIndex={0}
                        >
                          <div className="journal-playbook-stat-list">
                            {linkedTickerStats.map(({ ticker, summary }) => (
                              <div key={ticker} className="journal-playbook-stat-row">
                                <div>
                                  <strong>{ticker}</strong>
                                  <span>
                                    {summary.totalTrades} trade{summary.totalTrades === 1 ? "" : "s"} ·{" "}
                                    {summary.totalSharesTraded.toLocaleString()} shares · {summary.winRate.toFixed(1)}%
                                    {" "}WR · ${summary.totalFees.toFixed(2)} fees · Gross{" "}
                                    {formatSignedMoney(summary.totalGrossPnl)}
                                  </span>
                                </div>
                                <strong
                                  className={
                                    summary.totalNetPnl >= 0
                                      ? "journal-page-pnl-positive"
                                      : "journal-page-pnl-negative"
                                  }
                                >
                                  {formatSignedMoney(summary.totalNetPnl)}
                                </strong>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </section>

                    <section className="journal-metric-card">
                      <div className="journal-metric-card-header">
                        <strong>Playbook Stats</strong>
                        <span>{linkedPlaybookStats.length} tagged</span>
                      </div>
                      {linkedPlaybookStats.length === 0 ? (
                        <span className="empty-inline-state">No playbooks tagged for this day yet.</span>
                      ) : (
                        <div className="journal-playbook-stat-scroll" role="region" aria-label="Playbook stats list" tabIndex={0}>
                          <div className="journal-playbook-stat-list">
                            {linkedPlaybookStats.map(({ playbook, summary }) => (
                            <div key={playbook} className="journal-playbook-stat-row">
                              <div>
                                <strong>{playbook}</strong>
                                <span>
                                  {summary.totalTrades} trade{summary.totalTrades === 1 ? "" : "s"} ·{" "}
                                  {summary.winRate.toFixed(1)}% WR · ${summary.totalFees.toFixed(2)} fees
                                </span>
                              </div>
                              <strong
                                className={
                                  summary.totalNetPnl >= 0
                                    ? "journal-page-pnl-positive"
                                    : "journal-page-pnl-negative"
                                }
                              >
                                {formatSignedMoney(summary.totalNetPnl)}
                              </strong>
                            </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </section>
                  </div>
                </div>
              </section>

                <section className="journal-writing-split-grid">
                  <section className="journal-writing-section">
                  <div className="journal-writing-header">
                    <div className="journal-writing-header-title">
                      <WorkspaceIcon icon="checklist" alt="Morning checklist icon" className="mini-action-icon" />
                      <strong>Morning Checklist</strong>
                    </div>
                    <div className="journal-writing-header-actions">
                      <select
                        className="calendar-date-select"
                        value={selectedMorningTemplate?.id ?? ""}
                        onChange={(event) => setSelectedMorningTemplateId(event.target.value)}
                      >
                        {checklistTemplates.morningTemplates.map((template) => (
                          <option key={template.id} value={template.id}>
                            {template.name}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="mini-action mini-action-soft"
                        onClick={() => {
                          if (!selectedMorningTemplate) {
                            return;
                          }

                          onUpdateContent(
                            selectedPage.id,
                            "morningChecklistContent",
                            selectedMorningTemplate.content
                          );
                        }}
                      >
                        Load Template
                      </button>
                      <button
                        type="button"
                        className="mini-action"
                        disabled={!selectedMorningTemplate}
                        onClick={() => {
                          if (!selectedMorningTemplate) {
                            return;
                          }

                          const confirmed = window.confirm(
                            `Overwrite template "${selectedMorningTemplate.name}" with the current checklist?`
                          );
                          if (!confirmed) {
                            return;
                          }

                          onUpdateChecklistTemplate(
                            "morning",
                            selectedMorningTemplate.id,
                            selectedPage.morningChecklistContent
                          );
                        }}
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        className="mini-action"
                        onClick={() => {
                          const templateName = promptForTemplateName("morning");
                          if (!templateName) {
                            return;
                          }

                          onSaveChecklistTemplateAs(
                            "morning",
                            templateName,
                            selectedPage.morningChecklistContent
                          );
                        }}
                      >
                        Save As
                      </button>
                      <button
                        type="button"
                        className="mini-action mini-action-danger"
                        disabled={checklistTemplates.morningTemplates.length <= 1 || !selectedMorningTemplate}
                        onClick={() => confirmDeleteTemplate("morning", selectedMorningTemplate)}
                      >
                        Delete Template
                      </button>
                    </div>
                  </div>
                    <JournalRichTextEditor
                      key={`${selectedPage.id}-morning-checklist`}
                      content={selectedPage.morningChecklistContent}
                      onChange={(content) => onUpdateContent(selectedPage.id, "morningChecklistContent", content)}
                      onImageInsert={handleImageInsert}
                      placeholder="Type '/' for commands"
                      taskListColumns={2}
                      compact
                    />
                  </section>

                  <section className="journal-writing-section">
                    <div className="journal-writing-header">
                      <div className="journal-writing-header-title">
                        <WorkspaceIcon icon="text" alt="Morning journal icon" className="mini-action-icon" />
                        <strong>Morning Journal</strong>
                      </div>
                    </div>
                    <JournalRichTextEditor
                      key={`${selectedPage.id}-morning`}
                      content={selectedPage.morningContent}
                      onChange={(content) => onUpdateContent(selectedPage.id, "morningContent", content)}
                      onImageInsert={handleImageInsert}
                      placeholder="Type '/' for commands"
                      compact
                    />
                </section>
              </section>

              <HeadlinesBar
                key={`headlines-${selectedPage.tradeDate}`}
                className="journal-headlines-bar"
                journalDate={selectedPage.tradeDate}
              />

                <section className="journal-writing-split-grid">
                  <section className="journal-writing-section">
                  <div className="journal-writing-header">
                    <div className="journal-writing-header-title">
                      <WorkspaceIcon icon="checklist" alt="Closing checklist icon" className="mini-action-icon" />
                      <strong>Closing Checklist</strong>
                    </div>
                    <div className="journal-writing-header-actions">
                      <select
                        className="calendar-date-select"
                        value={selectedClosingTemplate?.id ?? ""}
                        onChange={(event) => setSelectedClosingTemplateId(event.target.value)}
                      >
                        {checklistTemplates.closingTemplates.map((template) => (
                          <option key={template.id} value={template.id}>
                            {template.name}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="mini-action mini-action-soft"
                        onClick={() => {
                          if (!selectedClosingTemplate) {
                            return;
                          }

                          onUpdateContent(
                            selectedPage.id,
                            "closingChecklistContent",
                            selectedClosingTemplate.content
                          );
                        }}
                      >
                        Load Template
                      </button>
                      <button
                        type="button"
                        className="mini-action"
                        disabled={!selectedClosingTemplate}
                        onClick={() => {
                          if (!selectedClosingTemplate) {
                            return;
                          }

                          const confirmed = window.confirm(
                            `Overwrite template "${selectedClosingTemplate.name}" with the current checklist?`
                          );
                          if (!confirmed) {
                            return;
                          }

                          onUpdateChecklistTemplate(
                            "closing",
                            selectedClosingTemplate.id,
                            selectedPage.closingChecklistContent
                          );
                        }}
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        className="mini-action"
                        onClick={() => {
                          const templateName = promptForTemplateName("closing");
                          if (!templateName) {
                            return;
                          }

                          onSaveChecklistTemplateAs(
                            "closing",
                            templateName,
                            selectedPage.closingChecklistContent
                          );
                        }}
                      >
                        Save As
                      </button>
                      <button
                        type="button"
                        className="mini-action mini-action-danger"
                        disabled={checklistTemplates.closingTemplates.length <= 1 || !selectedClosingTemplate}
                        onClick={() => confirmDeleteTemplate("closing", selectedClosingTemplate)}
                      >
                        Delete Template
                      </button>
                    </div>
                  </div>
                    <JournalRichTextEditor
                      key={`${selectedPage.id}-closing-checklist`}
                      content={selectedPage.closingChecklistContent}
                      onChange={(content) => onUpdateContent(selectedPage.id, "closingChecklistContent", content)}
                      onImageInsert={handleImageInsert}
                      placeholder="Type '/' for commands"
                      taskListColumns={2}
                      compact
                    />
                  </section>

                  <section className="journal-writing-section">
                    <div className="journal-writing-header">
                      <div className="journal-writing-header-title">
                        <WorkspaceIcon icon="text" alt="Closing journal icon" className="mini-action-icon" />
                        <strong>Closing Journal</strong>
                      </div>
                    </div>
                    <JournalRichTextEditor
                      key={`${selectedPage.id}-closing`}
                      content={selectedPage.closingContent}
                      onChange={(content) => onUpdateContent(selectedPage.id, "closingContent", content)}
                      onImageInsert={handleImageInsert}
                      placeholder="Type '/' for commands"
                      compact
                    />
                </section>
              </section>

              <section className="journal-writing-section">
                <div className="journal-writing-header">
                  <div className="journal-writing-header-title">
                    <WorkspaceIcon icon="plan" alt="MPP plan icon" className="mini-action-icon" />
                    <strong>MPP Plan</strong>
                  </div>
                  <div className="journal-writing-header-actions">
                    <select
                      className="calendar-date-select"
                      value={selectedMppTemplate?.id ?? ""}
                      onChange={(event) => setSelectedMppTemplateId(event.target.value)}
                    >
                      {checklistTemplates.mppTemplates.map((template) => (
                        <option key={template.id} value={template.id}>
                          {template.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="mini-action mini-action-soft"
                      onClick={() => {
                        if (!selectedMppTemplate) {
                          return;
                        }

                        onUpdateContent(selectedPage.id, "mppPlanContent", selectedMppTemplate.content);
                      }}
                    >
                      Load Template
                    </button>
                    <button
                      type="button"
                      className="mini-action"
                      disabled={!selectedMppTemplate}
                      onClick={() => {
                        if (!selectedMppTemplate) {
                          return;
                        }

                        const confirmed = window.confirm(
                          `Overwrite template "${selectedMppTemplate.name}" with the current plan?`
                        );
                        if (!confirmed) {
                          return;
                        }

                        onUpdateChecklistTemplate("mpp", selectedMppTemplate.id, selectedPage.mppPlanContent);
                      }}
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      className="mini-action"
                      onClick={() => {
                        const templateName = promptForTemplateName("mpp");
                        if (!templateName) {
                          return;
                        }

                        onSaveChecklistTemplateAs("mpp", templateName, selectedPage.mppPlanContent);
                      }}
                    >
                      Save As
                    </button>
                    <button
                      type="button"
                      className="mini-action mini-action-danger"
                      disabled={checklistTemplates.mppTemplates.length <= 1 || !selectedMppTemplate}
                      onClick={() => confirmDeleteTemplate("mpp", selectedMppTemplate)}
                    >
                      Delete Template
                    </button>
                  </div>
                </div>
                <JournalRichTextEditor
                  key={`${selectedPage.id}-mpp`}
                  content={selectedPage.mppPlanContent}
                  onChange={(content) => onUpdateContent(selectedPage.id, "mppPlanContent", content)}
                  placeholder="Type '/' for commands"
                />
              </section>

                <section className="journal-writing-section">
                  <div className="journal-writing-header">
                    <div className="journal-writing-header-title">
                      <WorkspaceIcon icon="journal" alt="Chart screenshots icon" className="mini-action-icon" />
                      <div className="journal-screenshot-section-title">
                        <strong>Chart Screenshots</strong>
                        <span>Open, close, and context charts for this trading day.</span>
                      </div>
                    </div>
                    <div className="journal-writing-header-actions">
                      <input
                        ref={screenshotInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/jpg,image/webp,image/gif"
                      multiple
                      className="drop-zone-input"
                      onChange={(event) => {
                        const files = Array.from(event.target.files ?? []);
                        if (!selectedPage || files.length === 0) {
                          event.currentTarget.value = "";
                          return;
                        }

                        void Promise.all(files.map((file) => readFileAsDataUrl(file)))
                          .then((dataUrls) => {
                            if (pendingScreenshotSlotIndex !== null) {
                              const nextScreenshotUrls = [...selectedPage.screenshotUrls];
                              nextScreenshotUrls[pendingScreenshotSlotIndex] = dataUrls[0];
                              if (dataUrls.length > 1) {
                                nextScreenshotUrls.splice(pendingScreenshotSlotIndex + 1, 0, ...dataUrls.slice(1));
                              }
                              onUpdatePage(selectedPage.id, {
                                screenshotUrls: nextScreenshotUrls
                              });
                              setVisibleScreenshotRows((current) =>
                                Math.max(current, Math.ceil(Math.max(nextScreenshotUrls.length, 3) / 3))
                              );
                              setPendingScreenshotSlotIndex(null);
                              return;
                            }

                            onUpdatePage(selectedPage.id, {
                              screenshotUrls: [...selectedPage.screenshotUrls, ...dataUrls]
                            });
                          })
                          .catch(() => undefined);

                        setPendingScreenshotSlotIndex(null);
                        event.currentTarget.value = "";
                      }}
                    />
                    <button
                      type="button"
                      className="mini-action"
                      onClick={() => {
                        setPendingScreenshotSlotIndex(null);
                        screenshotInputRef.current?.click();
                      }}
                    >
                      <WorkspaceIcon icon="camera" alt="Upload screenshot icon" className="mini-action-icon" />
                      Add Screenshots
                    </button>
                    <button
                      type="button"
                      className="mini-action"
                      onClick={() => setVisibleScreenshotRows((current) => current + 1)}
                    >
                      <WorkspaceIcon icon="plan" alt="Add screenshot row icon" className="mini-action-icon" />
                      Add Row
                    </button>
                    <button
                      type="button"
                      className="mini-action"
                      disabled={selectedPage.screenshotUrls.length === 0}
                      onClick={() => onUpdatePage(selectedPage.id, { screenshotUrls: [] })}
                    >
                      <WorkspaceIcon icon="data" alt="Clear screenshots icon" className="mini-action-icon" />
                      Clear All
                      </button>
                    </div>
                  </div>
                  <div className="journal-screenshot-gallery">
                    {Array.from({ length: visibleScreenshotSlots }).map((_, index) => {
                      const screenshotUrl = selectedPage.screenshotUrls[index];
                      const slotMeta = getScreenshotSlotMeta(index);

                      if (!screenshotUrl) {
                        return (
                          <button
                            key={`${selectedPage.id}-slot-${index}`}
                          type="button"
                          className="journal-screenshot-slot"
                          onClick={() => {
                            setPendingScreenshotSlotIndex(index);
                            screenshotInputRef.current?.click();
                          }}
                          >
                            <WorkspaceIcon icon="camera" alt="Empty screenshot slot icon" className="journal-screenshot-slot-icon" />
                            <strong>{slotMeta.label}</strong>
                            <span>{slotMeta.rowLabel}</span>
                            <em>Add Screenshot</em>
                          </button>
                        );
                      }

                      return (
                        <div key={`${selectedPage.id}-shot-${index}`} className="journal-screenshot-card">
                          <div className="journal-screenshot-card-header">
                            <div className="journal-screenshot-card-title">
                              <strong>{slotMeta.label}</strong>
                              <span>{slotMeta.rowLabel}</span>
                            </div>
                          </div>
                          <button
                            type="button"
                            className="journal-screenshot-preview-button"
                            onClick={() => setExpandedScreenshotUrl(screenshotUrl)}
                          >
                          <img
                            className="journal-screenshot-image"
                            src={screenshotUrl}
                            alt={`${formatJournalDate(selectedPage.tradeDate)} screenshot ${index + 1}`}
                          />
                        </button>
                        <div className="journal-screenshot-actions">
                          <button
                            type="button"
                            className="mini-action"
                            onClick={() => {
                              setPendingScreenshotSlotIndex(index);
                              screenshotInputRef.current?.click();
                            }}
                          >
                            Replace
                          </button>
                          <a
                            className="review-link"
                            href={screenshotUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Open
                          </a>
                          <button
                            type="button"
                            className="mini-action mini-action-danger"
                            onClick={() =>
                              onUpdatePage(selectedPage.id, {
                                screenshotUrls: selectedPage.screenshotUrls.filter((_, screenshotIndex) => screenshotIndex !== index)
                              })
                            }
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className="placeholder-panel journal-trade-database-panel">
                <div className="journal-sidebar-header">
                  <div>
                    <strong>Trade Database</strong>
                    <span>{linkedTrades.length} trades for {formatJournalDate(selectedPage.tradeDate)}</span>
                  </div>
                </div>
                <PreviewTable
                  trades={linkedTrades}
                  tagOptionsByField={tagOptionsByField}
                  selectedTradeId={selectedJournalTradeId}
                  selectedTradeIds={selectedJournalTradeIds}
                  onSelectTrade={(trade) => setSelectedJournalTradeId(trade.id)}
                  onToggleTradeSelection={(tradeId) =>
                    setSelectedJournalTradeIds((current) =>
                      current.includes(tradeId)
                        ? current.filter((currentTradeId) => currentTradeId !== tradeId)
                        : [...current, tradeId]
                    )
                  }
                  onToggleSelectAll={(tradeIds) =>
                    setSelectedJournalTradeIds((current) =>
                      tradeIds.every((tradeId) => current.includes(tradeId)) ? [] : tradeIds
                    )
                  }
                  onUpdateTradeTag={onUpdateTradeTag}
                  onCreateTradeTagOption={onCreateTradeTagOption}
                />
              </section>
            </>
          ) : (
            <div className="journal-empty-state">
              <strong>No journal page selected</strong>
              <span>Create a dated journal entry from the left sidebar to begin writing.</span>
            </div>
          )}
        </section>
        <aside className="journal-links">
          <div className="journal-sidebar-header">
            <div>
              <strong>Linked Trades</strong>
              <span>{linkedTrades.length} matches</span>
            </div>
          </div>
          <div className="linked-trade-list">
            {linkedTrades.length === 0 ? (
              <span className="empty-inline-state">No trades linked to this date yet.</span>
            ) : (
              linkedTrades.map((trade) => {
                const tickerIcon = getTickerIconSrc(trade.symbol);
                const tickerSector = getTickerSector(trade.symbol);

                return (
                  <button
                    key={trade.id}
                    type="button"
                    className="linked-trade-card linked-trade-card-button"
                    onClick={() => onSelectTrade(trade.id, trade.tradeDate)}
                  >
                    <div className="linked-trade-title">
                      <strong>{trade.name}</strong>
                    </div>
                    <div className="linked-trade-meta">
                      {tickerIcon ? (
                        <img
                          src={tickerIcon}
                          alt={tickerSector ? `${tickerSector} sector icon` : `${trade.symbol} ticker icon`}
                          className="linked-trade-icon"
                        />
                      ) : (
                        <WorkspaceIcon icon="trades" alt={`${trade.symbol} ticker icon`} className="linked-trade-icon" />
                      )}
                      <span>
                        {trade.symbol} - {trade.side} - {trade.status}
                      </span>
                    </div>
                    <span>{trade.openTime} to {trade.closeTime}</span>
                    <span>{trade.netPnlUsd >= 0 ? "+" : ""}{trade.netPnlUsd.toFixed(2)} net</span>
                  </button>
                );
              })
            )}
          </div>
        </aside>
      </section>
      {expandedScreenshotUrl ? (
        <div
          className="journal-lightbox"
          role="button"
          tabIndex={0}
          onClick={() => setExpandedScreenshotUrl("")}
          onKeyDown={(event) => {
            if (event.key === "Escape" || event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              setExpandedScreenshotUrl("");
            }
          }}
        >
          <div className="journal-lightbox-content" onClick={(event) => event.stopPropagation()}>
            <button
              type="button"
              className="mini-action mini-action-soft"
              onClick={() => setExpandedScreenshotUrl("")}
            >
              Close
            </button>
            <img className="journal-lightbox-image" src={expandedScreenshotUrl} alt="Expanded journal screenshot" />
          </div>
        </div>
      ) : null}
    </main>
  );
};
