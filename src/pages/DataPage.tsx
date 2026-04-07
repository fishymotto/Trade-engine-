import { useEffect, useMemo, useState } from "react";
import { AnalyticsTable } from "../components/AnalyticsTable";
import { PageHero } from "../components/PageHero";
import { PlaceholderPanel } from "../components/PlaceholderPanel";
import { WorkspaceIcon } from "../components/WorkspaceIcon";
import type { TradeSessionRecord } from "../types/session";
import type { Settings } from "../types/trade";

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

export const DataPage = ({ settings, sessions, onLoadSession, onDeleteSession }: DataPageProps) => {
  const sessionRows = useMemo(() => sessions.map(summarizeSession), [sessions]);
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
  const totalTrades = sessionRows.reduce((sum, session) => sum + session.trades, 0);
  const totalExecutions = sessionRows.reduce((sum, session) => sum + session.executions, 0);
  const totalSymbols = new Set(sessions.flatMap((session) => session.trades.map((trade) => trade.symbol))).size;

  const selectedTrades = selectedSession
    ? [...selectedSession.trades].sort((left, right) => left.openTime.localeCompare(right.openTime))
    : [];

  return (
    <main className="page-shell">
      <PageHero
        eyebrow="Data"
        title="Connections And Storage"
        description="This page is now the session library for your local trade database. You can inspect what is stored, check the makeup of each saved day, and load or delete sessions when you need to."
      />
      <section className="placeholder-grid">
        <PlaceholderPanel
          title="Export Location"
          description={settings.exportFolder || "No export folder selected yet"}
          icon="data"
        />
        <PlaceholderPanel
          title="Notion Database"
          description={settings.notionDatabaseUrl || "No Notion database URL saved yet"}
          icon="import"
        />
        <PlaceholderPanel
          title="Saved Sessions"
          description={String(sessions.length)}
          detail={`${totalTrades} grouped trades stored locally`}
          icon="dashboard"
        />
        <PlaceholderPanel
          title="Database Footprint"
          description={`${totalExecutions} executions`}
          detail={`${totalSymbols} symbols across saved sessions`}
          icon="journal"
        />
      </section>
      <section className="data-library-layout">
        <article className="placeholder-panel analytics-panel">
          <div className="panel-header">
            <WorkspaceIcon icon="data" alt="Saved sessions icon" className="panel-header-icon" />
            <h2>Saved Session Library</h2>
          </div>
          <AnalyticsTable
            rows={sessionRows}
            emptyMessage="Drop a CSV file and save it to the database to create your first session."
            columns={[
              { key: "tradeDate", label: "Date", render: (row) => row.tradeDate },
              { key: "trades", label: "Trades", render: (row) => row.trades, align: "right" },
              { key: "symbols", label: "Symbols", render: (row) => row.symbols, align: "right" },
              { key: "executions", label: "Executions", render: (row) => row.executions, align: "right" },
              {
                key: "netPnl",
                label: "Net P&L",
                render: (row) => `${row.netPnl >= 0 ? "+" : ""}$${row.netPnl.toFixed(2)}`,
                align: "right"
              }
            ]}
          />
          <div className="session-library-list">
            {sessionRows.map((session) => (
              <button
                key={session.tradeDate}
                type="button"
                className={`session-library-item ${session.tradeDate === selectedTradeDate ? "session-library-item-selected" : ""}`}
                onClick={() => setSelectedTradeDate(session.tradeDate)}
              >
                <div className="session-library-item-header">
                  <strong>{session.tradeDate}</strong>
                  <span>{session.netPnl >= 0 ? "+" : ""}$${session.netPnl.toFixed(2)}</span>
                </div>
                <span>{session.trades} trades · {session.symbols} symbols · {session.executions} executions</span>
                <span>{session.sourceFileName}</span>
              </button>
            ))}
          </div>
        </article>
        <aside className="placeholder-panel analytics-panel data-session-inspector">
          <div className="panel-header">
            <WorkspaceIcon icon="journal" alt="Session inspector icon" className="panel-header-icon" />
            <h2>{selectedTradeDate || "No Session Selected"}</h2>
          </div>
          {selectedSession && selectedSummary ? (
            <>
              <div className="session-detail-stats">
                <div>
                  <strong>Net P&L</strong>
                  <span>{selectedSummary.netPnl >= 0 ? "+" : ""}$${selectedSummary.netPnl.toFixed(2)}</span>
                </div>
                <div>
                  <strong>Trades</strong>
                  <span>{selectedSummary.trades}</span>
                </div>
                <div>
                  <strong>Symbols</strong>
                  <span>{selectedSummary.symbols}</span>
                </div>
                <div>
                  <strong>Executions</strong>
                  <span>{selectedSummary.executions}</span>
                </div>
              </div>
              <div className="dashboard-line-stat-list">
                <div>
                  <span>Source File</span>
                  <strong>{selectedSession.sourceFileName}</strong>
                </div>
                <div>
                  <span>Imported</span>
                  <strong>{new Date(selectedSession.importedAt).toLocaleString()}</strong>
                </div>
                <div>
                  <span>Last Updated</span>
                  <strong>{new Date(selectedSession.updatedAt).toLocaleString()}</strong>
                </div>
              </div>
              <div className="session-action-buttons">
                <button type="button" className="mini-action" onClick={() => onLoadSession(selectedSession.tradeDate)}>
                  Load Session
                </button>
                <button
                  type="button"
                  className="mini-action mini-action-danger"
                  onClick={() => onDeleteSession(selectedSession.tradeDate)}
                >
                  Delete Session
                </button>
              </div>
              <div className="selected-session-list">
                {selectedTrades.map((trade) => (
                  <div key={trade.id} className="selected-session-item">
                    <strong>{trade.name}</strong>
                    <span>{trade.symbol} · {trade.openTime} to {trade.closeTime}</span>
                    <span>{trade.status} · {trade.side}</span>
                    <span>{trade.netPnlUsd >= 0 ? "+" : ""}$${trade.netPnlUsd.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="empty-state">Choose a saved session to inspect its stored trades and metadata.</div>
          )}
        </aside>
      </section>
    </main>
  );
};
