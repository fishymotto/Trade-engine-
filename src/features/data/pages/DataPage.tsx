import { useEffect, useMemo, useState } from "react";
import { PageHero } from "../../../components/PageHero";
import { WorkspaceIcon } from "../../../components/WorkspaceIcon";
import type { TradeSessionRecord } from "../../../types/session";
import type { Settings } from "../../../types/trade";

interface DataPageProps {
  settings: Settings;
  sessions: TradeSessionRecord[];
  onLoadSession: (tradeDate: string) => void;
  onDeleteSession: (tradeDate: string) => void;
}

interface SessionLibraryRow {
  tradeDate: string;
  sourceFileName: string;
  trades: number;
  symbols: number;
  executions: number;
  netPnl: number;
  updatedAt: string;
}

const summarizeSession = (session: TradeSessionRecord): SessionLibraryRow => ({
  tradeDate: session.tradeDate,
  sourceFileName: session.sourceFileName,
  trades: session.trades.length,
  symbols: new Set(session.trades.map((trade) => trade.symbol)).size,
  executions: session.trades.reduce(
    (sum, trade) => sum + trade.openingExecutions.length + trade.closingExecutions.length,
    0
  ),
  netPnl: Number(session.trades.reduce((sum, trade) => sum + trade.netPnlUsd, 0).toFixed(2)),
  updatedAt: session.updatedAt
});

const formatMoney = (value: number) => `${value >= 0 ? "+" : ""}$${value.toFixed(2)}`;

const tradeDateLabelFormatter = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  timeZone: "UTC"
});

const tradeDateMetaFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC"
});

const formatTradeDate = (value: string, formatter: Intl.DateTimeFormat = tradeDateLabelFormatter) => {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) {
    return value;
  }

  return formatter.format(new Date(Date.UTC(year, month - 1, day)));
};

const formatDateTime = (value: string) => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
};

export const DataPage = ({ settings, sessions, onLoadSession, onDeleteSession }: DataPageProps) => {
  const sessionRows = useMemo(
    () => sessions.map(summarizeSession).sort((left, right) => right.tradeDate.localeCompare(left.tradeDate)),
    [sessions]
  );
  const [selectedTradeDate, setSelectedTradeDate] = useState(sessionRows[0]?.tradeDate ?? "");

  useEffect(() => {
    if (sessionRows.length === 0) {
      setSelectedTradeDate("");
      return;
    }

    const selectedStillExists = sessionRows.some((row) => row.tradeDate === selectedTradeDate);
    if (!selectedStillExists) {
      setSelectedTradeDate(sessionRows[0].tradeDate);
    }
  }, [sessionRows, selectedTradeDate]);

  const selectedSession = sessions.find((session) => session.tradeDate === selectedTradeDate) ?? null;
  const selectedSummary = selectedSession ? summarizeSession(selectedSession) : null;
  const selectedTrades = selectedSession
    ? [...selectedSession.trades].sort((left, right) => left.openTime.localeCompare(right.openTime)).slice(0, 8)
    : [];
  const totalTrades = sessionRows.reduce((sum, session) => sum + session.trades, 0);
  const totalExecutions = sessionRows.reduce((sum, session) => sum + session.executions, 0);
  const totalSymbols = new Set(sessions.flatMap((session) => session.trades.map((trade) => trade.symbol))).size;
  const totalNetPnl = sessionRows.reduce((sum, session) => sum + session.netPnl, 0);
  const latestSession = sessionRows[0] ?? null;
  const selectedTradeDateLabel = selectedSummary ? formatTradeDate(selectedSummary.tradeDate) : "No import selected";

  return (
    <main className="page-shell data-storage-page">
      <PageHero
        eyebrow="Data"
        title="Storage Manager"
        description="Review saved CSV imports, load a stored day back into the workspace, or remove a bad import without touching the rest of your data."
        className="page-hero-data-storage"
        content={
          <div className="data-storage-hero-tags">
            <span className="data-storage-hero-tag">{sessionRows.length} saved days</span>
            <span className="data-storage-hero-tag">
              {latestSession ? `Latest ${formatTradeDate(latestSession.tradeDate, tradeDateMetaFormatter)}` : "No saved sessions"}
            </span>
            <span className="data-storage-hero-tag">
              {settings.exportFolder ? "Export folder connected" : "Export folder not set"}
            </span>
          </div>
        }
      >
        <div className="data-storage-hero-focus">
          <span>Current Selection</span>
          <strong>{selectedTradeDateLabel}</strong>
          <p>
            {selectedSummary
              ? `${selectedSummary.trades} trades across ${selectedSummary.symbols} symbols and ${selectedSummary.executions} executions.`
              : "Choose a saved import from the list to inspect its file, stats, and trade preview."}
          </p>
          {selectedSummary ? (
            <div className="data-storage-hero-focus-stats">
              <div>
                <small>Net P&amp;L</small>
                <strong className={selectedSummary.netPnl >= 0 ? "positive" : "negative"}>
                  {formatMoney(selectedSummary.netPnl)}
                </strong>
              </div>
              <div>
                <small>Source</small>
                <strong title={selectedSummary.sourceFileName}>{selectedSummary.sourceFileName}</strong>
              </div>
            </div>
          ) : null}
        </div>
      </PageHero>

      <section className="data-storage-summary" aria-label="Storage summary">
        <div>
          <span>Saved Days</span>
          <strong>{sessionRows.length}</strong>
        </div>
        <div>
          <span>Trades</span>
          <strong>{totalTrades}</strong>
        </div>
        <div>
          <span>Executions</span>
          <strong>{totalExecutions}</strong>
        </div>
        <div>
          <span>Symbols</span>
          <strong>{totalSymbols}</strong>
        </div>
        <div>
          <span>Stored Net</span>
          <strong>{formatMoney(totalNetPnl)}</strong>
        </div>
      </section>

      <section className="data-storage-layout">
        <article className="placeholder-panel data-storage-panel">
          <div className="panel-header data-storage-panel-header">
            <div className="data-storage-panel-heading">
              <WorkspaceIcon icon="data" alt="Saved imports icon" className="panel-header-icon" />
              <div className="data-storage-panel-heading-copy">
                <h2>Saved Imports</h2>
                <p>Pick a saved day, then load it or remove it.</p>
              </div>
            </div>
            <span>{sessionRows.length} saved</span>
          </div>

          {sessionRows.length > 0 ? (
            <div className="data-session-list">
              {sessionRows.map((session) => {
                const isSelected = session.tradeDate === selectedTradeDate;
                return (
                  <div key={session.tradeDate} className={`data-session-row ${isSelected ? "is-selected" : ""}`}>
                    <button
                      type="button"
                      className="data-session-row-main"
                      onClick={() => setSelectedTradeDate(session.tradeDate)}
                    >
                      <div className="data-session-row-top">
                        <div className="data-session-heading">
                          <span className="data-session-date">{formatTradeDate(session.tradeDate)}</span>
                          <span className="data-session-date-meta">{session.tradeDate}</span>
                        </div>
                        <strong className={session.netPnl >= 0 ? "positive" : "negative"}>
                          {formatMoney(session.netPnl)}
                        </strong>
                      </div>

                      <div className="data-session-metrics">
                        <span className="data-session-chip">{session.trades} trades</span>
                        <span className="data-session-chip">{session.symbols} symbols</span>
                        <span className="data-session-chip">{session.executions} executions</span>
                      </div>

                      <span className="data-session-file" title={session.sourceFileName}>
                        {session.sourceFileName}
                      </span>
                    </button>

                    <div className="data-session-actions">
                      <button
                        type="button"
                        className="mini-action"
                        onClick={() => {
                          setSelectedTradeDate(session.tradeDate);
                          onLoadSession(session.tradeDate);
                        }}
                      >
                        Load
                      </button>
                      <button
                        type="button"
                        className="mini-action mini-action-danger"
                        onClick={() => onDeleteSession(session.tradeDate)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="empty-state">No saved imports yet. Save a CSV from the Import page and it will show here.</div>
          )}
        </article>

        <aside className="placeholder-panel data-storage-panel data-storage-inspector">
          <div className="panel-header data-storage-panel-header">
            <div className="data-storage-panel-heading">
              <WorkspaceIcon icon="journal" alt="Selected import icon" className="panel-header-icon" />
              <div className="data-storage-panel-heading-copy">
                <h2>Selected Import</h2>
              </div>
            </div>
            {selectedSummary ? <span>{selectedSummary.tradeDate}</span> : null}
          </div>

          {selectedSession && selectedSummary ? (
            <>
              <div className="data-inspector-lead">
                <span>Trade Date</span>
                <h3>{formatTradeDate(selectedSummary.tradeDate, tradeDateMetaFormatter)}</h3>
                <p>
                  {selectedSummary.trades} trades, {selectedSummary.symbols} symbols, {selectedSummary.executions} executions.
                </p>
              </div>

              <div className="data-inspector-actions">
                <button type="button" className="mini-action" onClick={() => onLoadSession(selectedSession.tradeDate)}>
                  Load This Day
                </button>
                <button
                  type="button"
                  className="mini-action mini-action-danger"
                  onClick={() => onDeleteSession(selectedSession.tradeDate)}
                >
                  Delete This Import
                </button>
              </div>

              <div className="data-inspector-stats">
                <div>
                  <span>Net P&amp;L</span>
                  <strong className={selectedSummary.netPnl >= 0 ? "positive" : "negative"}>
                    {formatMoney(selectedSummary.netPnl)}
                  </strong>
                </div>
                <div>
                  <span>Trades</span>
                  <strong>{selectedSummary.trades}</strong>
                </div>
                <div>
                  <span>Symbols</span>
                  <strong>{selectedSummary.symbols}</strong>
                </div>
                <div>
                  <span>Executions</span>
                  <strong>{selectedSummary.executions}</strong>
                </div>
              </div>

              <div className="data-inspector-meta">
                <div>
                  <span>Source File</span>
                  <strong title={selectedSession.sourceFileName}>{selectedSession.sourceFileName}</strong>
                </div>
                <div>
                  <span>Imported</span>
                  <strong>{formatDateTime(selectedSession.importedAt)}</strong>
                </div>
                <div>
                  <span>Last Updated</span>
                  <strong>{formatDateTime(selectedSession.updatedAt)}</strong>
                </div>
                {settings.exportFolder ? (
                  <div>
                    <span>Export Folder</span>
                    <strong title={settings.exportFolder}>{settings.exportFolder}</strong>
                  </div>
                ) : null}
              </div>

              <div className="data-inspector-preview">
                <div className="data-inspector-preview-header">
                  <span>Trade Preview</span>
                  <small>
                    Showing {selectedTrades.length} of {selectedSummary.trades}
                  </small>
                </div>
                {selectedTrades.length > 0 ? (
                  selectedTrades.map((trade) => (
                    <div key={trade.id} className="data-inspector-trade">
                      <div className="data-inspector-trade-copy">
                        <strong>{trade.name.trim() || trade.symbol}</strong>
                        <span>
                          {trade.symbol} | {trade.openTime} to {trade.closeTime}
                        </span>
                      </div>
                      <span className={trade.netPnlUsd >= 0 ? "positive" : "negative"}>
                        {formatMoney(trade.netPnlUsd)}
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="empty-state data-storage-empty-state-compact">
                    No trades were stored in this session.
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="empty-state">Pick a saved import to see its source file and delete controls.</div>
          )}
        </aside>
      </section>
    </main>
  );
};
