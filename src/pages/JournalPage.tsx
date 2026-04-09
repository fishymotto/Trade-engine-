import { useEffect, useMemo, useRef, useState } from "react";
import { JournalRichTextEditor } from "../components/journal/JournalRichTextEditor";
import { PageHero } from "../components/PageHero";
import { WorkspaceIcon } from "../components/WorkspaceIcon";
import { getDatabaseStats, getTradeSummary } from "../lib/analytics/tradeAnalytics";
import type { JournalChecklistTemplates, NamedChecklistTemplate } from "../lib/journal/journalTemplateStore";
import type { JournalContentField, JournalPageRecord } from "../types/journal";
import type { GroupedTrade } from "../types/trade";

interface JournalPageProps {
  pages: JournalPageRecord[];
  selectedPageId: string;
  trades: GroupedTrade[];
  checklistTemplates: JournalChecklistTemplates;
  externalSelectedTradeDate: string;
  onSelectPage: (pageId: string) => void;
  onCreatePage: (tradeDate: string) => void;
  onUpdatePage: (
    pageId: string,
    updates: Partial<
      Pick<JournalPageRecord, "tradeDate" | "dayGrade" | "mpp" | "screenshotUrls">
    >
  ) => void;
  onUpdateContent: (pageId: string, field: JournalContentField, content: JournalPageRecord[JournalContentField]) => void;
  onSaveChecklistTemplateAs: (
    type: "morning" | "closing",
    name: string,
    content: NamedChecklistTemplate["content"]
  ) => void;
  onDeleteChecklistTemplate: (type: "morning" | "closing", templateId: string) => void;
}

const dayGradeOptions = ["", "A+", "A", "A-", "B+", "B", "B-", "C+", "C", "C-"];

const getTickerIcon = (_ticker: string) => "trades" as const;

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

export const JournalPage = ({
  pages,
  selectedPageId,
  trades,
  checklistTemplates,
  externalSelectedTradeDate,
  onSelectPage,
  onCreatePage,
  onUpdatePage,
  onUpdateContent,
  onSaveChecklistTemplateAs,
  onDeleteChecklistTemplate
}: JournalPageProps) => {
  const [draftTradeDate, setDraftTradeDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [visibleScreenshotRows, setVisibleScreenshotRows] = useState(1);
  const [expandedScreenshotUrl, setExpandedScreenshotUrl] = useState("");
  const [pendingScreenshotSlotIndex, setPendingScreenshotSlotIndex] = useState<number | null>(null);
  const [selectedMorningTemplateId, setSelectedMorningTemplateId] = useState("");
  const [selectedClosingTemplateId, setSelectedClosingTemplateId] = useState("");
  const lastExternalSyncRef = useRef("");
  const screenshotInputRef = useRef<HTMLInputElement | null>(null);

  const selectedPage = useMemo(
    () => pages.find((page) => page.id === selectedPageId) ?? pages[0] ?? null,
    [pages, selectedPageId]
  );

  const sortedPages = useMemo(
    () => [...pages].sort((left, right) => right.tradeDate.localeCompare(left.tradeDate)),
    [pages]
  );

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

  const linkedTradeSummary = useMemo(() => getTradeSummary(linkedTrades), [linkedTrades]);
  const linkedDatabaseStats = useMemo(() => getDatabaseStats(linkedTrades), [linkedTrades]);
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

  useEffect(() => {
    if (!externalSelectedTradeDate) {
      lastExternalSyncRef.current = "";
      return;
    }

    if (lastExternalSyncRef.current === externalSelectedTradeDate) {
      return;
    }

    lastExternalSyncRef.current = externalSelectedTradeDate;
    setDraftTradeDate(externalSelectedTradeDate);
    const matchingPage = sortedPages.find((page) => page.tradeDate === externalSelectedTradeDate);
    if (matchingPage) {
      onSelectPage(matchingPage.id);
    }
  }, [externalSelectedTradeDate, onSelectPage, sortedPages]);

  useEffect(() => {
    const imageCount = selectedPage?.screenshotUrls.length ?? 0;
    setVisibleScreenshotRows(Math.max(1, Math.ceil(Math.max(imageCount, 3) / 3)));
    setExpandedScreenshotUrl("");
    setPendingScreenshotSlotIndex(null);
  }, [selectedPage?.id, selectedPage?.screenshotUrls.length]);

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

  const promptForTemplateName = (type: "morning" | "closing") => {
    const suggestion = `${type === "morning" ? "Morning" : "Closing"} Template`;
    const response = window.prompt("Template name", suggestion);
    const trimmed = response?.trim();
    return trimmed || "";
  };

  const confirmDeleteTemplate = (type: "morning" | "closing", template: NamedChecklistTemplate | null) => {
    if (!template) {
      return;
    }

    const templateCount =
      type === "morning" ? checklistTemplates.morningTemplates.length : checklistTemplates.closingTemplates.length;

    if (templateCount <= 1) {
      return;
    }

    const confirmed = window.confirm(`Delete the ${type} checklist template "${template.name}"?`);
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
            <label className="journal-date-label">
              <span>Journal Date</span>
              <input
                type="date"
                value={draftTradeDate}
                onChange={(event) => setDraftTradeDate(event.target.value)}
                className="journal-date-input"
              />
            </label>
            <button type="button" className="mini-action" onClick={() => onCreatePage(draftTradeDate)}>
              <WorkspaceIcon icon="journal" alt="Create journal icon" className="mini-action-icon" />
              New Daily Journal
            </button>
          </div>
          <div className="journal-page-section">
            <div className="journal-section-heading">Entries</div>
            <div className="journal-page-list">
              {sortedPages.length === 0 ? (
                <span className="empty-inline-state">Create your first daily journal page.</span>
              ) : (
                sortedPages.map((page) => (
                <button
                  key={page.id}
                  type="button"
                  className={`journal-page-item ${page.id === selectedPage?.id ? "journal-page-item-active" : ""}`}
                  onClick={() => onSelectPage(page.id)}
                >
                  <div className="journal-page-title">
                    <WorkspaceIcon icon="journal" alt="Journal page icon" className="journal-page-icon" />
                    <strong>{formatJournalDate(page.tradeDate)}</strong>
                  </div>
                  <span>Daily Journal</span>
                </button>
                ))
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
                    </div>
                  </div>
                  <div className="journal-header-stat-group">
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
                <label className="journal-property-card">
                  <span>Date</span>
                  <input
                    type="date"
                    className="journal-property-input"
                    value={selectedPage.tradeDate}
                    onChange={(event) => onUpdatePage(selectedPage.id, { tradeDate: event.target.value })}
                  />
                </label>
                <div className="journal-property-card journal-property-card-wide">
                  <span>Tickers</span>
                  <div className="journal-ticker-pills">
                    {linkedTickers.length === 0 ? (
                      <span className="empty-inline-state">No linked tickers for this date yet.</span>
                    ) : (
                      linkedTickers.map((ticker) => (
                        <span key={ticker} className="symbol-pill">
                          <WorkspaceIcon
                            icon={getTickerIcon(ticker)}
                            alt={`${ticker} ticker icon`}
                            className="symbol-pill-icon"
                          />
                          {ticker}
                        </span>
                      ))
                    )}
                  </div>
                </div>
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
                          <strong>{linkedTradeSummary.totalNetPnl >= 0 ? "+" : ""}${linkedTradeSummary.totalNetPnl.toFixed(2)}</strong>
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
                          <span>Avg Trade</span>
                          <strong>{linkedTradeSummary.avgTrade >= 0 ? "+" : ""}${linkedTradeSummary.avgTrade.toFixed(2)}</strong>
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
                          <span>Sessions</span>
                          <strong>{linkedDatabaseStats.sessions}</strong>
                        </div>
                        <div>
                          <span>Symbols</span>
                          <strong>{linkedDatabaseStats.symbols}</strong>
                        </div>
                      </div>
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
                    placeholder="Type '/' for commands"
                  />
                </section>

                <section className="journal-writing-section">
                  <div className="journal-writing-header">
                    <WorkspaceIcon icon="text" alt="Morning journal icon" className="mini-action-icon" />
                    <strong>Morning Journal</strong>
                  </div>
                  <JournalRichTextEditor
                    key={`${selectedPage.id}-morning`}
                    content={selectedPage.morningContent}
                    onChange={(content) => onUpdateContent(selectedPage.id, "morningContent", content)}
                    placeholder="Type '/' for commands"
                  />
                </section>
              </section>

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
                    placeholder="Type '/' for commands"
                  />
                </section>

                <section className="journal-writing-section">
                  <div className="journal-writing-header">
                    <WorkspaceIcon icon="text" alt="Closing journal icon" className="mini-action-icon" />
                    <strong>Closing Journal</strong>
                  </div>
                  <JournalRichTextEditor
                    key={`${selectedPage.id}-closing`}
                    content={selectedPage.closingContent}
                    onChange={(content) => onUpdateContent(selectedPage.id, "closingContent", content)}
                    placeholder="Type '/' for commands"
                  />
                </section>
              </section>

              <section className="journal-writing-section">
                <div className="journal-writing-header">
                  <WorkspaceIcon icon="plan" alt="MPP plan icon" className="mini-action-icon" />
                  <strong>MPP Plan</strong>
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
                  <WorkspaceIcon icon="journal" alt="Additional notes icon" className="mini-action-icon" />
                  <strong>Additional Notes</strong>
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
                <JournalRichTextEditor
                  key={`${selectedPage.id}-notes`}
                  content={selectedPage.notesContent}
                  onChange={(content) => onUpdateContent(selectedPage.id, "notesContent", content)}
                  placeholder="Type '/' for commands"
                />
                <div className="journal-screenshot-gallery">
                  {Array.from({ length: visibleScreenshotSlots }).map((_, index) => {
                    const screenshotUrl = selectedPage.screenshotUrls[index];

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
                          <strong>Add Screenshot</strong>
                          <span>Slot {index + 1}</span>
                        </button>
                      );
                    }

                    return (
                      <div key={`${selectedPage.id}-shot-${index}`} className="journal-screenshot-card">
                        <div className="journal-screenshot-card-header">
                          <strong>Screenshot {index + 1}</strong>
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
              linkedTrades.map((trade) => (
                <div key={trade.id} className="linked-trade-card">
                  <div className="linked-trade-title">
                    <WorkspaceIcon icon="trades" alt="Linked trade icon" className="linked-trade-icon" />
                    <strong>{trade.name}</strong>
                  </div>
                  <span>
                    {trade.symbol} - {trade.side} - {trade.status}
                  </span>
                  <span>{trade.openTime} to {trade.closeTime}</span>
                  <span>{trade.netPnlUsd >= 0 ? "+" : ""}{trade.netPnlUsd.toFixed(2)} net</span>
                </div>
              ))
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
