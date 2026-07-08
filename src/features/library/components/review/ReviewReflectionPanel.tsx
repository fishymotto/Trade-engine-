import type { JSONContent } from "@tiptap/core";
import { useEffect, useMemo, useState } from "react";
import { WorkspaceIcon } from "../../../../components/WorkspaceIcon";
import { loadPlaybooks } from "../../../../lib/playbooks/playbookStore";
import { useEditableSelectOptions } from "../../../../lib/select/useEditableSelectOptions";
import { getTradePlaybookOptions, tradeHasPlaybook } from "../../../../lib/trades/playbookFilters";
import type { InlineImageInsertResult } from "../../../../lib/workspace/workspaceAttachmentClient";
import type { NamedReviewTemplate, ReviewPeriod, ReviewReflectionState } from "../../../../types/libraryReview";
import type { GroupedTrade, RiskSessionSetting, Settings } from "../../../../types/trade";
import { JournalRichTextEditor } from "../../../journal/components/JournalRichTextEditor";

const ADD_OPTION_VALUE = "__add_option__";

const checklistGroupLabels = {
  meditation: "Meditation Check",
  riskCheck: "Risk Check",
  morningJournal: "Morning Journal",
  closingJournal: "Closing Journal"
} as const;

const cloneJson = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const ensureTwoRows = (rows: ReviewReflectionState["reading"]) =>
  rows.length >= 2 ? rows : [...rows, ...Array.from({ length: 2 - rows.length }, () => ({ book: "", author: "", pages: "" }))];

const normalizeLinkedOptionKey = (value: string): string => value.trim().replace(/\s+/g, " ").toLowerCase();

const normalizeTradeDate = (value: string): string => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString().slice(0, 10);
};

const parseIsoLocalDate = (value: string): Date | null => {
  const normalized = normalizeTradeDate(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return null;
  }

  const parsed = new Date(`${normalized}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const formatIsoDate = (value: Date): string => {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const getWeekdayDatesInRange = (range: { start: string; end: string } | null): string[] => {
  if (!range) {
    return [];
  }

  const startDate = parseIsoLocalDate(range.start);
  const endDate = parseIsoLocalDate(range.end);
  if (!startDate || !endDate) {
    return [];
  }

  const dates: string[] = [];
  const cursor = new Date(startDate);
  while (cursor <= endDate) {
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) {
      dates.push(formatIsoDate(cursor));
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  return dates;
};

const parseTimeToMinutes = (value: string): number | null => {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?/);
  if (!match) {
    return null;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }

  return hours * 60 + minutes;
};

const isTimeWithinSession = (time: string, session: RiskSessionSetting): boolean => {
  const tradeMinutes = parseTimeToMinutes(time);
  const startMinutes = parseTimeToMinutes(session.startTime);
  const endMinutes = parseTimeToMinutes(session.endTime);
  if (tradeMinutes === null || startMinutes === null || endMinutes === null) {
    return false;
  }

  if (startMinutes <= endMinutes) {
    return tradeMinutes >= startMinutes && tradeMinutes <= endMinutes;
  }

  return tradeMinutes >= startMinutes || tradeMinutes <= endMinutes;
};

const formatUsd = (value: number): string => `$${Math.abs(value).toFixed(0)}`;

const formatSessionName = (name: string): string => name.trim() || "Session";

const getSessionScoreLabel = (name: string): string => {
  const trimmed = formatSessionName(name).replace(/\s+session$/i, "").trim();
  return `${trimmed || "Session"} Risk Followed:`;
};

const formatTimeLabel = (value: string): string => {
  const minutes = parseTimeToMinutes(value);
  if (minutes === null) {
    return value;
  }

  const hours = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const period = hours >= 12 ? "PM" : "AM";
  const displayHour = hours % 12 || 12;
  return `${displayHour}:${String(minute).padStart(2, "0")} ${period}`;
};

const getReviewTrades = (trades: GroupedTrade[], range: { start: string; end: string } | null): GroupedTrade[] => {
  if (!range) {
    return [];
  }

  return trades.filter((trade) => {
    const date = normalizeTradeDate(trade.tradeDate);
    return Boolean(date) && date >= range.start && date <= range.end;
  });
};

type ReviewReflectionPanelProps = {
  period: ReviewPeriod;
  pageId: string;
  reviewRange: { start: string; end: string } | null;
  timeLabels: string[];
  improvementGoalsLabel: string;
  wakeUpPlanAggregate?: { value: number; denominator: number } | null;
  templates: NamedReviewTemplate[];
  selectedTemplateId: string;
  reflection: ReviewReflectionState;
  trades: GroupedTrade[];
  settings: Settings;
  defaultBookOptions: string[];
  defaultAuthorOptions: string[];
  bookAuthorByTitle: Record<string, string>;
  onSelectTemplateId: (templateId: string) => void;
  onChangeReflection: (
    next: ReviewReflectionState | ((current: ReviewReflectionState) => ReviewReflectionState)
  ) => void;
  onSaveTemplate: (templateId: string, content: ReviewReflectionState) => void;
  onSaveTemplateAs: (name: string, content: ReviewReflectionState) => void;
  onDeleteTemplate: (templateId: string) => void;
  onTakeawayImageInsert?: (file: File) => Promise<string | InlineImageInsertResult>;
  onImprovementGoalsImageInsert?: (file: File) => Promise<string | InlineImageInsertResult>;
};

export const ReviewReflectionPanel = ({
  period,
  pageId,
  reviewRange,
  timeLabels,
  improvementGoalsLabel,
  wakeUpPlanAggregate = null,
  templates,
  selectedTemplateId,
  reflection,
  trades,
  settings,
  defaultBookOptions,
  defaultAuthorOptions,
  bookAuthorByTitle,
  onSelectTemplateId,
  onChangeReflection,
  onSaveTemplate,
  onSaveTemplateAs,
  onDeleteTemplate,
  onTakeawayImageInsert,
  onImprovementGoalsImageInsert
}: ReviewReflectionPanelProps) => {
  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === selectedTemplateId) ?? templates[0] ?? null,
    [selectedTemplateId, templates]
  );

  useEffect(() => {
    if (!selectedTemplateId && templates[0]) {
      onSelectTemplateId(templates[0].id);
      return;
    }

    if (selectedTemplateId && !templates.some((template) => template.id === selectedTemplateId)) {
      onSelectTemplateId(templates[0]?.id ?? "");
    }
  }, [onSelectTemplateId, selectedTemplateId, templates]);

  const { options: bookOptions, addOption: addBookOption } = useEditableSelectOptions(
    "review.reading.books",
    defaultBookOptions
  );
  const { options: authorOptions, addOption: addAuthorOption } = useEditableSelectOptions(
    "review.reading.authors",
    defaultAuthorOptions
  );

  const [pendingTemplateName, setPendingTemplateName] = useState("");
  const reviewDates = useMemo(() => getWeekdayDatesInRange(reviewRange), [reviewRange]);
  const reviewTrades = useMemo(() => getReviewTrades(trades, reviewRange), [trades, reviewRange]);
  const savedPlaybookOptions = useMemo(
    () => loadPlaybooks().map((playbook) => playbook.name).filter(Boolean),
    []
  );
  const selectedCorePlaybooks = reflection.riskCheckMetrics.corePlaybooks ?? [];
  const riskDayDenominator = reviewDates.length > 0 ? reviewDates.length : timeLabels.length;
  const wakeUpPlanValue = wakeUpPlanAggregate
    ? String(wakeUpPlanAggregate.value)
    : reflection.riskCheckMetrics.wakeUpPlanFollowed;
  const wakeUpPlanDenominator = wakeUpPlanAggregate?.denominator ?? riskDayDenominator;
  const wakeUpPlanNumber = (() => {
    if (wakeUpPlanAggregate) {
      return wakeUpPlanAggregate.value;
    }

    const parsed = Number(reflection.riskCheckMetrics.wakeUpPlanFollowed.trim());
    return Number.isFinite(parsed) ? parsed : null;
  })();
  const wakeUpPlanPercent =
    wakeUpPlanNumber !== null && wakeUpPlanDenominator > 0
      ? `${((wakeUpPlanNumber / wakeUpPlanDenominator) * 100).toFixed(1)}%`
      : "-";
  const riskSessionMetricRows = useMemo(
    () =>
      settings.riskSessions.map((session) => {
        const followedDays = reviewDates.reduce((count, date) => {
          const sessionNet = trades
            .filter((trade) => normalizeTradeDate(trade.tradeDate) === date)
            .filter((trade) => isTimeWithinSession(trade.openTime || trade.openingExecutions[0]?.time || "", session))
            .reduce((sum, trade) => sum + (trade.netPnlUsd || 0), 0);
          return sessionNet >= -Math.abs(session.riskAllocationUsd || 0) ? count + 1 : count;
        }, 0);

        return {
          id: session.id,
          title: `${formatSessionName(session.name)} Risk Allocation`,
          label: getSessionScoreLabel(session.name),
          value: String(reviewDates.length > 0 ? followedDays : 0),
          suffix: `/ ${riskDayDenominator} days`,
          detail: `${formatTimeLabel(session.startTime)} to ${formatTimeLabel(session.endTime)} - ${formatUsd(session.riskAllocationUsd)} limit`
        };
      }),
    [reviewDates, riskDayDenominator, settings.riskSessions, trades]
  );
  const corePlaybookOptions = useMemo(
    () =>
      Array.from(new Set([...savedPlaybookOptions, ...getTradePlaybookOptions(trades), ...selectedCorePlaybooks]))
        .filter(Boolean)
        .sort((left, right) => left.localeCompare(right)),
    [savedPlaybookOptions, selectedCorePlaybooks, trades]
  );
  const availableCorePlaybookOptions = corePlaybookOptions.filter(
    (option) => !selectedCorePlaybooks.some((selected) => normalizeLinkedOptionKey(selected) === normalizeLinkedOptionKey(option))
  );
  const corePlaybookStats = useMemo(() => {
    if (reviewTrades.length === 0 || selectedCorePlaybooks.length === 0) {
      return { label: "-", detail: reviewTrades.length === 0 ? "No trades in range" : "Select core playbooks" };
    }

    const taggedTrades = reviewTrades.filter((trade) =>
      selectedCorePlaybooks.some((playbook) => tradeHasPlaybook(trade, playbook))
    ).length;
    const percent = (taggedTrades / reviewTrades.length) * 100;
    return {
      label: `${percent.toFixed(1)}%`,
      detail: `${taggedTrades}/${reviewTrades.length} trades`
    };
  }, [reviewTrades, selectedCorePlaybooks]);
  const riskCheckMetricCount = riskSessionMetricRows.length + 2;

  const setTakeaway = (takeaway: JSONContent) =>
    onChangeReflection((current) => ({ ...current, takeaway }));
  const setImprovementGoals = (improvementGoals: JSONContent) =>
    onChangeReflection((current) => ({ ...current, improvementGoals }));

  const setReadingRow = (index: number, updates: Partial<ReviewReflectionState["reading"][number]>) => {
    onChangeReflection((current) => {
      const rows = ensureTwoRows(current.reading);
      const next = rows.map((row, rowIndex) => (rowIndex === index ? { ...row, ...updates } : row));
      return { ...current, reading: next };
    });
  };

  const setReadingBook = (index: number, book: string) => {
    const linkedAuthor = bookAuthorByTitle[normalizeLinkedOptionKey(book)] ?? "";
    if (!book.trim()) {
      setReadingRow(index, { book, author: "" });
      return;
    }

    setReadingRow(index, linkedAuthor ? { book, author: linkedAuthor } : { book });
  };

  const removeReadingRow = (index: number) => {
    onChangeReflection((current) => {
      const rows = ensureTwoRows(current.reading);
      if (rows.length <= 2) {
        return current;
      }

      return { ...current, reading: rows.filter((_, rowIndex) => rowIndex !== index) };
    });
  };

  const addReadingRow = () =>
    onChangeReflection((current) => {
      const rows = ensureTwoRows(current.reading);
      return { ...current, reading: [...rows, { book: "", author: "", pages: "" }] };
    });

  const toggleChecklistCell = (groupKey: keyof ReviewReflectionState["checklist"], index: number) => {
    onChangeReflection((current) => {
      const row = Array.isArray(current.checklist[groupKey]) ? current.checklist[groupKey] : [];
      const nextRow = Array.from({ length: 5 }, (_, idx) => Boolean(row[idx]));
      nextRow[index] = !nextRow[index];

      return {
        ...current,
        checklist: {
          ...current.checklist,
          [groupKey]: nextRow
        }
      };
    });
  };

  const setRiskCheckMetric = (key: keyof ReviewReflectionState["riskCheckMetrics"], value: string) => {
    onChangeReflection((current) => ({
      ...current,
      riskCheckMetrics: {
        ...current.riskCheckMetrics,
        [key]: value
      }
    }));
  };

  const addCorePlaybook = (playbook: string) => {
    const normalized = playbook.trim();
    if (!normalized) {
      return;
    }

    onChangeReflection((current) => {
      const currentPlaybooks = current.riskCheckMetrics.corePlaybooks ?? [];
      if (currentPlaybooks.some((entry) => normalizeLinkedOptionKey(entry) === normalizeLinkedOptionKey(normalized))) {
        return current;
      }

      return {
        ...current,
        riskCheckMetrics: {
          ...current.riskCheckMetrics,
          corePlaybooks: [...currentPlaybooks, normalized]
        }
      };
    });
  };

  const removeCorePlaybook = (playbook: string) => {
    onChangeReflection((current) => ({
      ...current,
      riskCheckMetrics: {
        ...current.riskCheckMetrics,
        corePlaybooks: (current.riskCheckMetrics.corePlaybooks ?? []).filter(
          (entry) => normalizeLinkedOptionKey(entry) !== normalizeLinkedOptionKey(playbook)
        )
      }
    }));
  };

  const loadTemplate = () => {
    if (!selectedTemplate) {
      return;
    }

    const confirmed = window.confirm(`Load template \"${selectedTemplate.name}\" and overwrite the current reflection?`);
    if (!confirmed) {
      return;
    }

    onChangeReflection(cloneJson(selectedTemplate.content));
  };

  const overwriteTemplate = () => {
    if (!selectedTemplate) {
      return;
    }

    const confirmed = window.confirm(`Overwrite template \"${selectedTemplate.name}\" with the current reflection?`);
    if (!confirmed) {
      return;
    }

    onSaveTemplate(selectedTemplate.id, cloneJson(reflection));
  };

  const saveAsTemplate = () => {
    const defaultName = pendingTemplateName.trim() || (period === "weekly" ? "Weekly Template" : "Monthly Template");
    const templateName = window.prompt("Template name", defaultName)?.trim() ?? "";
    if (!templateName) {
      return;
    }

    setPendingTemplateName(templateName);
    onSaveTemplateAs(templateName, cloneJson(reflection));
  };

  const deleteTemplate = () => {
    if (!selectedTemplate) {
      return;
    }

    const confirmed = window.confirm(`Delete template \"${selectedTemplate.name}\"?`);
    if (!confirmed) {
      return;
    }

    onDeleteTemplate(selectedTemplate.id);
  };

  const handleSelectWithAdd = (
    value: string,
    addOption: (value: string) => string | null,
    onChange: (nextValue: string) => void,
    promptLabel: string
  ) => {
    if (value !== ADD_OPTION_VALUE) {
      onChange(value);
      return;
    }

    const next = window.prompt(`Add ${promptLabel}`)?.trim() ?? "";
    if (!next) {
      return;
    }

    const added = addOption(next);
    if (added) {
      onChange(added);
    }
  };

  return (
    <section className="review-reflection-area" aria-label={`${period} reflection`}>
      <section className="journal-writing-section review-writing-section review-template-toolbar">
        <div className="journal-writing-header">
          <div className="journal-writing-header-title">
            <WorkspaceIcon icon="checklist" alt="" className="mini-action-icon" />
            <strong>{period === "weekly" ? "Weekly Review Template" : "Monthly Review Template"}</strong>
          </div>
          <div className="journal-writing-header-actions">
            <select
              className="calendar-date-select"
              value={selectedTemplate?.id ?? ""}
              onChange={(event) => onSelectTemplateId(event.target.value)}
            >
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
            <button type="button" className="mini-action mini-action-soft" onClick={loadTemplate} disabled={!selectedTemplate}>
              Load Template
            </button>
            <button type="button" className="mini-action" onClick={overwriteTemplate} disabled={!selectedTemplate}>
              Save Template
            </button>
            <button type="button" className="mini-action" onClick={saveAsTemplate}>
              Save As
            </button>
            <button
              type="button"
              className="mini-action mini-action-danger"
              onClick={deleteTemplate}
              disabled={templates.length <= 1 || !selectedTemplate}
            >
              Delete Template
            </button>
          </div>
        </div>
      </section>

      <section className="journal-writing-section review-writing-section">
        <div className="journal-writing-header">
          <div className="journal-writing-header-title">
            <WorkspaceIcon icon="journal" alt="" className="mini-action-icon" />
            <strong>Takeaway</strong>
          </div>
        </div>
        <JournalRichTextEditor
          key={`${pageId}-takeaway`}
          content={reflection.takeaway}
          onChange={setTakeaway}
          onImageInsert={onTakeawayImageInsert}
          placeholder="Main takeaway / summary reflection"
          compact
        />
      </section>

      <section className="journal-writing-section review-writing-section">
        <div className="journal-writing-header">
          <div className="journal-writing-header-title">
            <WorkspaceIcon icon="library" alt="" className="mini-action-icon" />
            <strong>Reading</strong>
          </div>
          <div className="journal-writing-header-actions">
            <button type="button" className="mini-action" onClick={addReadingRow}>
              Add Row
            </button>
          </div>
        </div>

        <div className="review-reading-list" role="group" aria-label="Reading entries">
          {ensureTwoRows(reflection.reading).map((row, index) => (
            <div key={`reading-${index}`} className="review-reading-row">
              <label className="review-reading-field">
                <span>Book</span>
                <select
                  value={row.book}
                  onChange={(event) =>
                    handleSelectWithAdd(event.target.value, addBookOption, (book) => setReadingBook(index, book), "book")
                  }
                >
                  <option value="">Select...</option>
                  {bookOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                  <option value={ADD_OPTION_VALUE}>+ Add...</option>
                </select>
              </label>

              <label className="review-reading-field">
                <span>Author</span>
                <select
                  value={row.author}
                  onChange={(event) =>
                    handleSelectWithAdd(
                      event.target.value,
                      addAuthorOption,
                      (author) => setReadingRow(index, { author }),
                      "author"
                    )
                  }
                >
                  <option value="">Select...</option>
                  {authorOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                  <option value={ADD_OPTION_VALUE}>+ Add...</option>
                </select>
              </label>

              <label className="review-reading-field review-reading-field-pages">
                <span>Pages</span>
                <input
                  value={row.pages}
                  onChange={(event) => setReadingRow(index, { pages: event.target.value })}
                  placeholder="e.g. 22-40"
                />
              </label>

              {index >= 2 ? (
                <button
                  type="button"
                  className="mini-action mini-action-danger review-reading-remove"
                  onClick={() => removeReadingRow(index)}
                  aria-label="Remove reading row"
                  title="Remove row"
                >
                  Remove
                </button>
              ) : (
                <span className="review-reading-remove-spacer" aria-hidden="true" />
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="journal-writing-section review-writing-section">
        <div className="journal-writing-header">
          <div className="journal-writing-header-title">
            <WorkspaceIcon icon="checklist" alt="" className="mini-action-icon" />
            <strong>Checklist</strong>
          </div>
        </div>

        <div className="review-checklist-grid" role="group" aria-label="Checklist grid">
          {(Object.keys(checklistGroupLabels) as Array<keyof typeof checklistGroupLabels>).map((groupKey) => (
            <section key={groupKey} className="review-checklist-card" aria-label={checklistGroupLabels[groupKey]}>
              <div className="review-checklist-card-header">
                <strong>{checklistGroupLabels[groupKey]}</strong>
                <span>{groupKey === "riskCheck" ? `${riskCheckMetricCount} metrics` : `${timeLabels.length} checks`}</span>
              </div>
              {groupKey === "riskCheck" ? (
                <div className="review-risk-metric-list">
                  {riskSessionMetricRows.map((metric, index) => (
                    <div key={metric.id} className="review-risk-metric-row">
                      <div className="review-risk-metric-title">
                        <span>{index + 1}.</span>
                        <strong>{metric.title}</strong>
                      </div>
                      <div className="review-risk-metric-field review-risk-metric-field-readonly">
                        <span>{metric.label}</span>
                        <strong className="review-risk-metric-value">{metric.value}</strong>
                        <em>{metric.suffix}</em>
                      </div>
                      <small className="review-risk-metric-detail">{metric.detail}</small>
                    </div>
                  ))}
                  <div className="review-risk-metric-row">
                    <div className="review-risk-metric-title">
                      <span>{riskSessionMetricRows.length + 1}.</span>
                      <strong>Build Tall Then Wide</strong>
                    </div>
                    <div className="review-risk-core-playbooks">
                      <div className="review-risk-core-playbook-list" aria-label="Core playbooks for this review">
                        {selectedCorePlaybooks.length > 0 ? (
                          selectedCorePlaybooks.map((playbook) => (
                            <button
                              key={playbook}
                              type="button"
                              className="review-risk-core-playbook-pill"
                              onClick={() => removeCorePlaybook(playbook)}
                              title={`Remove ${playbook}`}
                            >
                              {playbook}
                            </button>
                          ))
                        ) : (
                          <span className="review-risk-core-playbook-empty">No core playbooks selected</span>
                        )}
                      </div>
                      <select
                        value=""
                        onChange={(event) => addCorePlaybook(event.target.value)}
                        disabled={availableCorePlaybookOptions.length === 0}
                        aria-label="Add core playbook"
                      >
                        <option value="">Add core playbook...</option>
                        {availableCorePlaybookOptions.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="review-risk-metric-field review-risk-metric-field-readonly">
                      <span>Trades tagged to core playbooks:</span>
                      <strong className="review-risk-metric-value">{corePlaybookStats.label}</strong>
                    </div>
                    <small className="review-risk-metric-detail">{corePlaybookStats.detail}</small>
                  </div>
                  <div className="review-risk-metric-row">
                    <div className="review-risk-metric-title">
                      <span>{riskSessionMetricRows.length + 2}.</span>
                      <strong>Wake-Up Time</strong>
                    </div>
                    <label className="review-risk-metric-field review-risk-wakeup-field">
                      <span>Wake-up plan followed:</span>
                      <input
                        value={wakeUpPlanValue}
                        onChange={
                          wakeUpPlanAggregate
                            ? undefined
                            : (event) => setRiskCheckMetric("wakeUpPlanFollowed", event.target.value)
                        }
                        readOnly={Boolean(wakeUpPlanAggregate)}
                        inputMode="numeric"
                        aria-label="Wake-up plan followed"
                      />
                      <em>/ {wakeUpPlanDenominator} days</em>
                      <strong className="review-risk-wakeup-percent">{wakeUpPlanPercent}</strong>
                    </label>
                  </div>
                </div>
              ) : (
                <div className="review-checklist-items">
                  {timeLabels.map((label, index) => (
                    <label
                      key={`${groupKey}-${label}`}
                      className={`journal-checklist-field review-checklist-item${
                        reflection.checklist[groupKey]?.[index] ? " journal-block-checked" : ""
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="journal-checklist-box"
                        checked={Boolean(reflection.checklist[groupKey]?.[index])}
                        onChange={() => toggleChecklistCell(groupKey, index)}
                      />
                      <div className="journal-block-input journal-block-input-checklist">{label}</div>
                    </label>
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>
      </section>

      <section className="journal-writing-section review-writing-section">
        <div className="journal-writing-header">
          <div className="journal-writing-header-title">
            <WorkspaceIcon icon="journal" alt="" className="mini-action-icon" />
            <strong>{improvementGoalsLabel}</strong>
          </div>
        </div>
        <JournalRichTextEditor
          key={`${pageId}-improvement-goals`}
          content={reflection.improvementGoals}
          onChange={setImprovementGoals}
          onImageInsert={onImprovementGoalsImageInsert}
          placeholder="Focus areas, goals, and habits to improve"
          compact
        />
      </section>
    </section>
  );
};
