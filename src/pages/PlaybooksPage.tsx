import { useEffect, useMemo, useRef, useState } from "react";
import { JournalRichTextEditor } from "../components/journal/JournalRichTextEditor";
import { PageHero } from "../components/PageHero";
import { WorkspaceIcon } from "../components/WorkspaceIcon";
import { getTradeSummary } from "../lib/analytics/tradeAnalytics";
import {
  addPlaybookRecord,
  loadPlaybooks,
  savePlaybooks,
  updatePlaybookSectionContent,
  updatePlaybookScreenshotUrls
} from "../lib/playbooks/playbookStore";
import type { PlaybookRecord } from "../types/playbook";
import type { GroupedTrade } from "../types/trade";

interface PlaybooksPageProps {
  trades: GroupedTrade[];
  onSelectTrade: (tradeId: string, tradeDate: string) => void;
}

interface PlaybookCardData {
  playbook: PlaybookRecord;
  trades: GroupedTrade[];
}

const playbookScreenshotColumnLabels = ["Open Example", "Close Example", "Context Chart"] as const;

const formatSignedMoney = (value: number): string =>
  `${value >= 0 ? "+" : "-"}$${Math.abs(value).toFixed(2)}`;

const normalizePlaybookName = (value: string): string => value.trim().toLowerCase();

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
    reader.onerror = () =>
      reject(reader.error ?? new Error("The screenshot file could not be read."));
    reader.readAsDataURL(file);
  });

const getPlaybookScreenshotSlotMeta = (index: number) => {
  const rowNumber = Math.floor(index / 3) + 1;
  return {
    label: playbookScreenshotColumnLabels[index % 3],
    rowLabel: rowNumber === 1 ? "Primary Set" : `Set ${rowNumber}`
  };
};

const getTopSymbols = (trades: GroupedTrade[]): string[] =>
  Array.from(
    trades.reduce<Map<string, number>>((acc, trade) => {
      acc.set(trade.symbol, (acc.get(trade.symbol) ?? 0) + 1);
      return acc;
    }, new Map())
  )
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 4)
    .map(([symbol]) => symbol);

const getAverageWinner = (trades: GroupedTrade[]): number => {
  const winners = trades.filter((trade) => trade.netPnlUsd > 0);
  if (winners.length === 0) {
    return 0;
  }

  return winners.reduce((sum, trade) => sum + trade.netPnlUsd, 0) / winners.length;
};

const getAverageLoser = (trades: GroupedTrade[]): number => {
  const losers = trades.filter((trade) => trade.netPnlUsd < 0);
  if (losers.length === 0) {
    return 0;
  }

  return losers.reduce((sum, trade) => sum + trade.netPnlUsd, 0) / losers.length;
};

const matchesPlaybook = (trade: GroupedTrade, playbook: PlaybookRecord): boolean =>
  trade.setups.some((setup) =>
    playbook.aliases.some(
      (alias) => normalizePlaybookName(alias) === normalizePlaybookName(setup)
    )
  );

export const PlaybooksPage = ({ trades, onSelectTrade }: PlaybooksPageProps) => {
  const [playbooks, setPlaybooks] = useState<PlaybookRecord[]>(() => loadPlaybooks());
  const [selectedPlaybookId, setSelectedPlaybookId] = useState<string | null>(null);
  const [visibleScreenshotRows, setVisibleScreenshotRows] = useState(1);
  const [expandedScreenshotUrl, setExpandedScreenshotUrl] = useState("");
  const [pendingScreenshotSlotIndex, setPendingScreenshotSlotIndex] = useState<number | null>(null);
  const screenshotInputRef = useRef<HTMLInputElement | null>(null);

  const handleImageInsert = async (file: File): Promise<string> => {
    return readFileAsDataUrl(file);
  };

  useEffect(() => {
    savePlaybooks(playbooks);
  }, [playbooks]);

  const playbookCards = useMemo<PlaybookCardData[]>(
    () =>
      playbooks.map((playbook) => ({
        playbook,
        trades: trades.filter((trade) => matchesPlaybook(trade, playbook))
      })),
    [playbooks, trades]
  );

  const selectedPlaybook = useMemo(
    () => playbookCards.find((entry) => entry.playbook.id === selectedPlaybookId) ?? null,
    [playbookCards, selectedPlaybookId]
  );

  const visibleScreenshotSlots = useMemo(() => {
    const requiredSlots = Math.max(3, selectedPlaybook?.playbook.screenshotUrls.length ?? 0);
    return Math.max(requiredSlots, visibleScreenshotRows * 3);
  }, [selectedPlaybook?.playbook.screenshotUrls.length, visibleScreenshotRows]);

  const totalTaggedTrades = useMemo(
    () => playbookCards.reduce((sum, entry) => sum + entry.trades.length, 0),
    [playbookCards]
  );

  const handleAddPlaybook = () => {
    const nextName = window.prompt("New playbook name");
    if (!nextName) {
      return;
    }

    const result = addPlaybookRecord(playbooks, nextName);
    if (!result.playbookId) {
      return;
    }

    setPlaybooks(result.playbooks);
    setSelectedPlaybookId(result.playbookId);
  };

  useEffect(() => {
    const imageCount = selectedPlaybook?.playbook.screenshotUrls.length ?? 0;
    setVisibleScreenshotRows(Math.max(1, Math.ceil(Math.max(imageCount, 3) / 3)));
    setExpandedScreenshotUrl("");
    setPendingScreenshotSlotIndex(null);
  }, [selectedPlaybook?.playbook.id, selectedPlaybook?.playbook.screenshotUrls.length]);

  if (!selectedPlaybook) {
    return (
      <main className="page-shell">
        <PageHero
          eyebrow="Playbooks"
          title="Setup Library"
          description="Define your setups clearly, connect them to tagged trades, and review examples in one place."
        >
          <div className="page-hero-stat-grid">
            <div className="page-hero-stat-card">
              <span>Playbooks</span>
              <strong>{playbookCards.length}</strong>
            </div>
            <div className="page-hero-stat-card">
              <span>Tagged Trades</span>
              <strong>{totalTaggedTrades}</strong>
            </div>
            <div className="page-hero-stat-card">
              <span>Starter Focus</span>
              <strong>Wide Spread Open Drive</strong>
            </div>
            <div className="page-hero-stat-card">
              <span>Build Path</span>
              <strong>Landing page first, deeper library next</strong>
            </div>
          </div>
        </PageHero>

        <section className="playbook-card-grid">
          {playbookCards.map(({ playbook, trades: matchedTrades }) => {
            const summary = getTradeSummary(matchedTrades);
            const symbols = new Set(matchedTrades.map((trade) => trade.symbol)).size;

            return (
              <button
                key={playbook.id}
                type="button"
                className="playbook-card"
                onClick={() => setSelectedPlaybookId(playbook.id)}
              >
                <div className="playbook-card-header">
                  <div className="panel-header">
                    <WorkspaceIcon
                      icon="playbooks"
                      alt={`${playbook.name} icon`}
                      className="panel-header-icon"
                    />
                    <h2>{playbook.name}</h2>
                  </div>
                  <span className="playbook-card-badge">{matchedTrades.length} tagged trades</span>
                </div>
                <p>{playbook.description}</p>
                <div className="playbook-card-meta">
                  <span>
                    <strong>{summary.winRate.toFixed(1)}%</strong>
                    Win rate
                  </span>
                  <span>
                    <strong>{formatSignedMoney(summary.totalNetPnl)}</strong>
                    Net P&amp;L
                  </span>
                  <span>
                    <strong>{symbols}</strong>
                    Symbols
                  </span>
                </div>
                <div className="playbook-card-link">Open Playbook</div>
              </button>
            );
          })}

          <button
            type="button"
            className="playbook-card playbook-card-add"
            onClick={handleAddPlaybook}
          >
            <div className="playbook-card-header">
              <div className="panel-header">
                <WorkspaceIcon
                  icon="playbooks"
                  alt="Add playbook icon"
                  className="panel-header-icon"
                />
                <h2>Add Playbook</h2>
              </div>
              <span className="playbook-card-badge">New</span>
            </div>
            <p>Create a new setup page and start building the library out as your process grows.</p>
            <div className="playbook-card-meta">
              <span>
                <strong>Template</strong>
                Blank starter sections
              </span>
              <span>
                <strong>Flow</strong>
                Create and open
              </span>
              <span>
                <strong>Use</strong>
                Add notes, stats, examples
              </span>
            </div>
            <div className="playbook-card-link">Create Playbook</div>
          </button>
        </section>
      </main>
    );
  }

  const summary = getTradeSummary(selectedPlaybook.trades);
  const symbolCount = new Set(selectedPlaybook.trades.map((trade) => trade.symbol)).size;
  const topSymbols = getTopSymbols(selectedPlaybook.trades);
  const averageWinner = getAverageWinner(selectedPlaybook.trades);
  const averageLoser = getAverageLoser(selectedPlaybook.trades);
  const recentMatchLabel =
    selectedPlaybook.trades.length > 0
      ? ([...selectedPlaybook.trades].sort(
          (left, right) => right.tradeDate.localeCompare(left.tradeDate)
        )[0]?.tradeDate ?? "No matches yet")
      : "No matches yet";
  const exampleTrades = [...selectedPlaybook.trades]
    .sort(
      (left, right) =>
        right.tradeDate.localeCompare(left.tradeDate) ||
        left.openTime.localeCompare(right.openTime)
    )
    .slice(0, 10);

  return (
    <main className="page-shell">
      <PageHero
        eyebrow="Playbooks"
        title={selectedPlaybook.playbook.name}
        description={selectedPlaybook.playbook.focus}
      >
        <div className="page-hero-stat-grid">
          <div className="page-hero-stat-card">
            <span>Tagged Trades</span>
            <strong>{summary.totalTrades}</strong>
          </div>
          <div className="page-hero-stat-card">
            <span>Win Rate</span>
            <strong>{summary.winRate.toFixed(1)}%</strong>
          </div>
          <div className="page-hero-stat-card">
            <span>Net P&amp;L</span>
            <strong>{formatSignedMoney(summary.totalNetPnl)}</strong>
          </div>
          <div className="page-hero-stat-card">
            <span>Avg Trade</span>
            <strong>{formatSignedMoney(summary.avgTrade)}</strong>
          </div>
          <div className="page-hero-stat-card">
            <span>Fees</span>
            <strong>${summary.totalFees.toFixed(2)}</strong>
          </div>
          <div className="page-hero-stat-card">
            <span>Shares</span>
            <strong>{summary.totalSharesTraded.toLocaleString()}</strong>
          </div>
        </div>
      </PageHero>

      <section className="playbook-toolbar">
        <button type="button" className="mini-action" onClick={() => setSelectedPlaybookId(null)}>
          Back To Playbooks
        </button>
        <span>
          {symbolCount} symbol{symbolCount === 1 ? "" : "s"} matched across tagged examples.
        </span>
      </section>

      <section className="playbook-detail-layout">
        <div className="playbook-sections-column">
          {selectedPlaybook.playbook.sections.map((section) => (
            <article key={section.id} className="placeholder-panel journal-writing-section playbook-section-card">
              <div className="journal-writing-header">
                <div className="journal-writing-header-title">
                  <WorkspaceIcon
                    icon="text"
                    alt={`${section.title} icon`}
                    className="mini-action-icon"
                  />
                  <strong>{section.title}</strong>
                </div>
              </div>
              <JournalRichTextEditor
                content={section.content}
                onChange={(content) =>
                  setPlaybooks((current) =>
                    updatePlaybookSectionContent(
                      current,
                      selectedPlaybook.playbook.id,
                      section.id,
                      content
                    )
                  )
                }
                onImageInsert={handleImageInsert}
                placeholder="Type '/' for commands"
              />
            </article>
          ))}

        </div>

        <aside className="playbook-aside-column">
          <article className="placeholder-panel playbook-aside-card">
            <div className="panel-header">
              <WorkspaceIcon
                icon="dashboard"
                alt="Playbook stats icon"
                className="panel-header-icon"
              />
              <h2>Playbook Performance</h2>
            </div>
            <div className="playbook-aside-stat-grid">
              <div className="playbook-aside-stat-tile">
                <span>Wins / Losses</span>
                <strong>
                  {summary.winCount}W · {summary.lossCount}L
                </strong>
              </div>
              <div className="playbook-aside-stat-tile">
                <span>Recent Match</span>
                <strong>{recentMatchLabel}</strong>
              </div>
              <div className="playbook-aside-stat-tile">
                <span>Top Symbols</span>
                <strong>{topSymbols.length > 0 ? topSymbols.join(", ") : "None yet"}</strong>
              </div>
              <div className="playbook-aside-stat-tile">
                <span>Avg Winner / Loser</span>
                <strong>
                  {formatSignedMoney(averageWinner)} / {formatSignedMoney(averageLoser)}
                </strong>
              </div>
            </div>
            <div className="playbook-metric-list">
              <div className="playbook-metric-row">
                <span>Net P&amp;L</span>
                <strong>{formatSignedMoney(summary.totalNetPnl)}</strong>
              </div>
              <div className="playbook-metric-row">
                <span>Gross P&amp;L</span>
                <strong>{formatSignedMoney(summary.totalGrossPnl)}</strong>
              </div>
              <div className="playbook-metric-row">
                <span>Fees</span>
                <strong>${summary.totalFees.toFixed(2)}</strong>
              </div>
              <div className="playbook-metric-row">
                <span>Shares Traded</span>
                <strong>{summary.totalSharesTraded.toLocaleString()}</strong>
              </div>
              <div className="playbook-metric-row">
                <span>Profit Factor</span>
                <strong>{summary.profitFactor.toFixed(2)}</strong>
              </div>
              <div className="playbook-metric-row">
                <span>Symbols</span>
                <strong>{symbolCount}</strong>
              </div>
              <div className="playbook-metric-row">
                <span>Avg Hold</span>
                <strong>{summary.avgHoldMinutes.toFixed(1)}m</strong>
              </div>
            </div>
          </article>

          <article className="placeholder-panel playbook-aside-card">
              <div className="panel-header">
                <WorkspaceIcon
                  icon="journal"
                  alt="Chart examples icon"
                  className="panel-header-icon"
                />
                <h2>Chart Examples</h2>
              </div>
              <span className="playbook-example-subtitle">
                Save open, close, and context examples directly on the playbook.
              </span>
              <div className="journal-writing-header-actions playbook-chart-example-actions">
                <input
                  ref={screenshotInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/jpg,image/webp,image/gif"
                  multiple
                  className="drop-zone-input"
                  onChange={(event) => {
                    const files = Array.from(event.target.files ?? []);
                    if (!selectedPlaybook || files.length === 0) {
                      event.currentTarget.value = "";
                      return;
                    }

                    void Promise.all(files.map((file) => readFileAsDataUrl(file)))
                      .then((dataUrls) => {
                        if (pendingScreenshotSlotIndex !== null) {
                          const nextScreenshotUrls = [...selectedPlaybook.playbook.screenshotUrls];
                          nextScreenshotUrls[pendingScreenshotSlotIndex] = dataUrls[0];
                          if (dataUrls.length > 1) {
                            nextScreenshotUrls.splice(
                              pendingScreenshotSlotIndex + 1,
                              0,
                              ...dataUrls.slice(1)
                            );
                          }
                          setPlaybooks((current) =>
                            updatePlaybookScreenshotUrls(
                              current,
                              selectedPlaybook.playbook.id,
                              nextScreenshotUrls
                            )
                          );
                          setVisibleScreenshotRows((current) =>
                            Math.max(current, Math.ceil(Math.max(nextScreenshotUrls.length, 3) / 3))
                          );
                          setPendingScreenshotSlotIndex(null);
                          return;
                        }

                        setPlaybooks((current) =>
                          updatePlaybookScreenshotUrls(current, selectedPlaybook.playbook.id, [
                            ...selectedPlaybook.playbook.screenshotUrls,
                            ...dataUrls
                          ])
                        );
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
                  disabled={selectedPlaybook.playbook.screenshotUrls.length === 0}
                  onClick={() =>
                    setPlaybooks((current) =>
                      updatePlaybookScreenshotUrls(current, selectedPlaybook.playbook.id, [])
                    )
                  }
                >
                  <WorkspaceIcon icon="data" alt="Clear screenshots icon" className="mini-action-icon" />
                  Clear All
                </button>
              </div>
              <div className="journal-screenshot-gallery playbook-screenshot-gallery">
                {Array.from({ length: visibleScreenshotSlots }).map((_, index) => {
                  const screenshotUrl = selectedPlaybook.playbook.screenshotUrls[index];
                  const slotMeta = getPlaybookScreenshotSlotMeta(index);

                  if (!screenshotUrl) {
                    return (
                      <button
                        key={`${selectedPlaybook.playbook.id}-slot-${index}`}
                        type="button"
                        className="journal-screenshot-slot"
                        onClick={() => {
                          setPendingScreenshotSlotIndex(index);
                          screenshotInputRef.current?.click();
                        }}
                      >
                        <WorkspaceIcon
                          icon="camera"
                          alt="Empty playbook screenshot slot icon"
                          className="journal-screenshot-slot-icon"
                        />
                        <strong>{slotMeta.label}</strong>
                        <span>{slotMeta.rowLabel}</span>
                        <em>Add Screenshot</em>
                      </button>
                    );
                  }

                  return (
                    <div
                      key={`${selectedPlaybook.playbook.id}-shot-${index}`}
                      className="journal-screenshot-card"
                    >
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
                          alt={`${selectedPlaybook.playbook.name} screenshot ${index + 1}`}
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
                            setPlaybooks((current) =>
                              updatePlaybookScreenshotUrls(
                                current,
                                selectedPlaybook.playbook.id,
                                selectedPlaybook.playbook.screenshotUrls.filter(
                                  (_, screenshotIndex) => screenshotIndex !== index
                                )
                              )
                            )
                          }
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
          </article>

          <article className="placeholder-panel playbook-aside-card">
            <div className="panel-header">
              <WorkspaceIcon
                icon="trades"
                alt="Example trades icon"
                className="panel-header-icon"
              />
              <h2>Example Trades</h2>
            </div>
            <span className="playbook-example-subtitle">
              Click any trade to jump straight into the review station.
            </span>
            <div className="playbook-example-list">
              {exampleTrades.length > 0 ? (
                exampleTrades.map((trade) => (
                  <button
                    key={trade.id}
                    type="button"
                    className="playbook-example-card"
                    onClick={() => onSelectTrade(trade.id, trade.tradeDate)}
                  >
                    <div className="playbook-example-card-top">
                      <strong>{trade.name}</strong>
                      <span className={trade.netPnlUsd >= 0 ? "positive-value" : "negative-value"}>
                        {formatSignedMoney(trade.netPnlUsd)}
                      </span>
                    </div>
                    <span>
                      {trade.symbol} · {trade.openTime} to {trade.closeTime}
                    </span>
                    <span>
                      {trade.side} · {trade.status}
                    </span>
                  </button>
                ))
              ) : (
                <div className="empty-state">
                  Tag trades with {selectedPlaybook.playbook.name} to see examples here.
                </div>
              )}
            </div>
          </article>
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
            <img
              className="journal-lightbox-image"
              src={expandedScreenshotUrl}
              alt="Expanded playbook screenshot"
            />
          </div>
        </div>
      ) : null}
    </main>
  );
};
