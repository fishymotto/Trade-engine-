import { useEffect, useMemo, useState } from "react";
import { JournalRichTextEditor } from "../components/journal/JournalRichTextEditor";
import { PageHero } from "../components/PageHero";
import { WorkspaceIcon } from "../components/WorkspaceIcon";
import type { JournalContentField, JournalPageRecord } from "../types/journal";
import type { GroupedTrade } from "../types/trade";

interface JournalPageProps {
  pages: JournalPageRecord[];
  selectedPageId: string;
  trades: GroupedTrade[];
  externalSelectedTradeDate: string;
  onSelectPage: (pageId: string) => void;
  onCreatePage: (tradeDate: string) => void;
  onUpdatePage: (
    pageId: string,
    updates: Partial<
      Pick<JournalPageRecord, "tradeDate" | "dayGrade" | "mpp">
    >
  ) => void;
  onUpdateContent: (pageId: string, field: JournalContentField, content: JournalPageRecord[JournalContentField]) => void;
}

const dayGradeOptions = ["", "A+", "A", "A-", "B+", "B", "B-", "C+", "C", "C-"];

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
  externalSelectedTradeDate,
  onSelectPage,
  onCreatePage,
  onUpdatePage,
  onUpdateContent
}: JournalPageProps) => {
  const [draftTradeDate, setDraftTradeDate] = useState(() => new Date().toISOString().slice(0, 10));

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

  useEffect(() => {
    if (!externalSelectedTradeDate) {
      return;
    }

    setDraftTradeDate(externalSelectedTradeDate);
    const matchingPage = sortedPages.find((page) => page.tradeDate === externalSelectedTradeDate);
    if (matchingPage && matchingPage.id !== selectedPage?.id) {
      onSelectPage(matchingPage.id);
    }
  }, [externalSelectedTradeDate, onSelectPage, selectedPage?.id, sortedPages]);

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
                          {ticker}
                        </span>
                      ))
                    )}
                  </div>
                </div>
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
                </div>
                <JournalRichTextEditor
                  key={`${selectedPage.id}-notes`}
                  content={selectedPage.notesContent}
                  onChange={(content) => onUpdateContent(selectedPage.id, "notesContent", content)}
                  placeholder="Type '/' for commands"
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
    </main>
  );
};
