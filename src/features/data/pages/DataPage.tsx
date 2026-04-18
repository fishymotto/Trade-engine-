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

  return (
    <main className="page-shell data-storage-page">
      <PageHero
        eyebrow="Data"
        title="Storage Manager"
        description="A quiet cleanup page for saved CSV imports. Use it when a day was imported wrong and you need to load or remove that stored session."
      />

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
            <div>
              <WorkspaceIcon icon="data" alt="Saved imports icon" className="panel-header-icon" />
              <h2>Saved Imports</h2>
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
                      <span className="data-session-date">{session.tradeDate}</span>
                      <span>{session.trades} trades</span>
                      <span>{session.symbols} symbols</span>
                      <span>{session.executions} executions</span>
                      <strong className={session.netPnl >= 0 ? "positive" : "negative"}>
                        {formatMoney(session.netPnl)}
                      </strong>
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
            <div>
              <WorkspaceIcon icon="journal" alt="Selected import icon" className="panel-header-icon" />
              <h2>{selectedTradeDate || "Selected Import"}</h2>
            </div>
          </div>

          {selectedSession && selectedSummary ? (
            <>
              <div className="data-inspector-stats">
                <div>
                  <span>Net P&L</span>
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
                  <strong>{selectedSession.sourceFileName}</strong>
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
                    <strong>{settings.exportFolder}</strong>
                  </div>
                ) : null}
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

              <div className="data-inspector-preview">
                <span>Trade Preview</span>
                {selectedTrades.map((trade) => (
                  <div key={trade.id} className="data-inspector-trade">
                    <strong>{trade.name}</strong>
                    <span>{trade.symbol} · {trade.openTime} to {trade.closeTime}</span>
                    <span className={trade.netPnlUsd >= 0 ? "positive" : "negative"}>{formatMoney(trade.netPnlUsd)}</span>
                  </div>
                ))}
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
