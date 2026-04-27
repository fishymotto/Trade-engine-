import { useEffect, useMemo, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { JournalRichTextEditor } from "../../journal/components/JournalRichTextEditor";
import { WorkspaceIcon } from "../../../components/WorkspaceIcon";
import { createEmptyJournalDoc } from "../../../lib/journal/journalContent";
import {
  addPlaybookAPlusExample,
  removePlaybookAPlusExample,
  updatePlaybookAPlusExample
} from "../../../lib/playbooks/playbookStore";
import {
  deletePlaybookAttachment,
  pickAndSavePlaybookAttachment,
  resolvePlaybookAttachmentSrc
} from "../../../lib/playbooks/playbookAttachmentClient";
import type { PlaybookExampleRating, PlaybookRecord } from "../../../types/playbook";
import type { GroupedTrade } from "../../../types/trade";

type ExampleRecord = PlaybookRecord["aPlusExamples"][number];

const ratingOptions: PlaybookExampleRating[] = ["A+", "A", "B+"];
const eligibleGameTags = new Set(["A Game", "B+ Game"]);

const getSyncedExampleRating = (trade: GroupedTrade): PlaybookExampleRating | null => {
  if (trade.game === "A Game") {
    return "A+";
  }
  if (trade.game === "B+ Game") {
    return "B+";
  }
  return null;
};

const createExampleId = (): string => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `example-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const formatSignedMoney = (value: number): string =>
  `${value >= 0 ? "+" : "-"}$${Math.abs(value).toFixed(2)}`;

const formatCurrency = (value: number): string => `$${Math.abs(value).toFixed(2)}`;

const formatPrice = (value: number): string => {
  if (!Number.isFinite(value)) {
    return "-";
  }
  return `$${value.toFixed(Math.abs(value) >= 100 ? 2 : 4)}`;
};

const formatSize = (value: number): string =>
  Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "-";

const formatSignedPerShare = (value: number): string =>
  `${value >= 0 ? "+" : "-"}$${Math.abs(value).toFixed(4)}`;

const getSignedValueClassName = (value: number): "positive-value" | "negative-value" =>
  value >= 0 ? "positive-value" : "negative-value";

const toComparableScreenshotPath = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed.startsWith("data:")) {
    return trimmed;
  }

  let normalized = trimmed;
  try {
    const url = new URL(normalized);
    if (url.pathname) {
      normalized = url.pathname;
    }
  } catch {
    // Keep raw string when value is not a URL.
  }

  if (normalized.includes("?")) {
    normalized = normalized.split("?")[0] ?? normalized;
  }
  if (normalized.includes("#")) {
    normalized = normalized.split("#")[0] ?? normalized;
  }

  try {
    normalized = decodeURIComponent(normalized);
  } catch {
    // Keep original when decode fails.
  }

  return normalized.replace(/\\/g, "/").toLowerCase();
};

const mergeScreenshotPaths = (primary: string[], secondary: string[]): string[] => {
  const merged: string[] = [];
  const seen = new Set<string>();
  for (const path of [...primary, ...secondary]) {
    const comparable = toComparableScreenshotPath(path);
    if (!comparable || seen.has(comparable)) {
      continue;
    }
    seen.add(comparable);
    merged.push(path);
  }
  return merged;
};

const hasScreenshotPathOverlap = (left: string[], right: string[]): boolean => {
  if (left.length === 0 || right.length === 0) {
    return false;
  }
  const rightComparable = new Set(right.map((value) => toComparableScreenshotPath(value)).filter(Boolean));
  return left.some((value) => rightComparable.has(toComparableScreenshotPath(value)));
};

const parseDismissedTradeIds = (raw: string | null): string[] => {
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  } catch {
    return [];
  }
};

const readFileAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }

      reject(new Error("File could not be read."));
    };
    reader.onerror = () => reject(reader.error ?? new Error("File could not be read."));
    reader.readAsDataURL(file);
  });

interface APlusExampleLibraryProps {
  playbook: PlaybookRecord;
  matchedTrades: GroupedTrade[];
  taggedCharts: {
    screenshotUrl: string;
    linkedTrades: GroupedTrade[];
  }[];
  onSelectTrade: (tradeId: string, tradeDate: string) => void;
  onExpandImage: (src: string) => void;
  setPlaybooks: React.Dispatch<React.SetStateAction<PlaybookRecord[]>>;
}

export const APlusExampleLibrary = ({
  playbook,
  matchedTrades,
  taggedCharts,
  onSelectTrade,
  onExpandImage,
  setPlaybooks
}: APlusExampleLibraryProps) => {
  const dismissedTradeIdsStorageKey = `playbook-aplus-dismissed:${playbook.id}`;
  const [pendingAttachmentExampleId, setPendingAttachmentExampleId] = useState("");
  const [pendingAttachmentKind, setPendingAttachmentKind] = useState<"screenshot" | "recording">(
    "screenshot"
  );
  const [dismissedTradeIds, setDismissedTradeIds] = useState<string[]>([]);
  const screenshotInputRef = useRef<HTMLInputElement | null>(null);
  const dismissedTradeIdSet = useMemo(() => new Set(dismissedTradeIds), [dismissedTradeIds]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const nextDismissedTradeIds = parseDismissedTradeIds(window.localStorage.getItem(dismissedTradeIdsStorageKey));
    setDismissedTradeIds(nextDismissedTradeIds);
  }, [dismissedTradeIdsStorageKey]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(dismissedTradeIdsStorageKey, JSON.stringify(dismissedTradeIds));
  }, [dismissedTradeIds, dismissedTradeIdsStorageKey]);

  const tradeById = useMemo(() => new Map(matchedTrades.map((trade) => [trade.id, trade])), [matchedTrades]);

  const autoExampleScreenshotsByTrade = useMemo(() => {
    const grouped = new Map<string, { trade: GroupedTrade; screenshotPaths: string[] }>();
    for (const chart of taggedCharts) {
      const screenshotPath = chart.screenshotUrl;
      if (!screenshotPath) {
        continue;
      }

      for (const trade of chart.linkedTrades) {
        if (!eligibleGameTags.has(trade.game)) {
          continue;
        }

        const current = grouped.get(trade.id);
        if (current) {
          if (!current.screenshotPaths.includes(screenshotPath)) {
            current.screenshotPaths.push(screenshotPath);
          }
          continue;
        }

        grouped.set(trade.id, {
          trade,
          screenshotPaths: [screenshotPath]
        });
      }
    }

    return grouped;
  }, [taggedCharts]);

  const eligibleTrades = useMemo(
    () =>
      matchedTrades
        .filter((trade) => eligibleGameTags.has(trade.game))
        .sort(
          (left, right) =>
            right.tradeDate.localeCompare(left.tradeDate) || left.openTime.localeCompare(right.openTime)
        ),
    [matchedTrades]
  );

  const existingTradeIds = useMemo(
    () => new Set((playbook.aPlusExamples ?? []).map((entry) => entry.tradeId)),
    [playbook.aPlusExamples]
  );

  const availableEligibleTrades = useMemo(
    () => eligibleTrades.filter((trade) => !existingTradeIds.has(trade.id)),
    [eligibleTrades, existingTradeIds]
  );

  useEffect(() => {
    if (autoExampleScreenshotsByTrade.size === 0) {
      return;
    }

    setPlaybooks((current) => {
      const targetPlaybook = current.find((candidate) => candidate.id === playbook.id);
      if (!targetPlaybook) {
        return current;
      }

      const now = new Date().toISOString();
      let hasChanges = false;
      let nextExamples = [...(targetPlaybook.aPlusExamples ?? [])];

      for (const [tradeId, candidate] of autoExampleScreenshotsByTrade) {
        if (candidate.screenshotPaths.length === 0) {
          continue;
        }
        if (dismissedTradeIdSet.has(tradeId)) {
          continue;
        }

        const existingIndex = nextExamples.findIndex((entry) => entry.tradeId === tradeId);
        if (existingIndex >= 0) {
          const trade = tradeById.get(tradeId) ?? candidate.trade;
          let targetIndex = existingIndex;
          const existing = nextExamples[targetIndex];
          let mergedScreenshotPaths = mergeScreenshotPaths(existing.screenshotPaths ?? [], candidate.screenshotPaths);

          // Clean up stale orphan examples that point to the same screenshot(s).
          const orphanIndex = nextExamples.findIndex(
            (entry, index) =>
              index !== targetIndex &&
              !tradeById.has(entry.tradeId) &&
              hasScreenshotPathOverlap(entry.screenshotPaths, mergedScreenshotPaths)
          );
          if (orphanIndex >= 0) {
            const orphan = nextExamples[orphanIndex];
            mergedScreenshotPaths = mergeScreenshotPaths(mergedScreenshotPaths, orphan.screenshotPaths);
            nextExamples.splice(orphanIndex, 1);
            if (orphanIndex < targetIndex) {
              targetIndex -= 1;
            }
            hasChanges = true;
          }

          const syncedRating = getSyncedExampleRating(trade) ?? existing.rating;
          const shouldUpdateExisting =
            mergedScreenshotPaths.length !== (existing.screenshotPaths ?? []).length ||
            existing.tradeDate !== trade.tradeDate ||
            existing.rating !== syncedRating;
          if (shouldUpdateExisting) {
            nextExamples[targetIndex] = {
              ...existing,
              tradeDate: trade.tradeDate,
              rating: syncedRating,
              screenshotPaths: mergedScreenshotPaths,
              updatedAt: now
            };
            hasChanges = true;
          }
          continue;
        }

        let relinkIndex = nextExamples.findIndex(
          (entry) =>
            !tradeById.has(entry.tradeId) &&
            hasScreenshotPathOverlap(entry.screenshotPaths, candidate.screenshotPaths)
        );
        if (relinkIndex < 0) {
          const tradeDateMatches = nextExamples
            .map((entry, index) => ({ entry, index }))
            .filter(
              ({ entry }) =>
                !tradeById.has(entry.tradeId) &&
                entry.tradeDate === candidate.trade.tradeDate
            );
          if (tradeDateMatches.length === 1) {
            relinkIndex = tradeDateMatches[0].index;
          }
        }
        if (relinkIndex >= 0) {
          const trade = tradeById.get(tradeId) ?? candidate.trade;
          const existing = nextExamples[relinkIndex];
          const mergedScreenshotPaths = mergeScreenshotPaths(existing.screenshotPaths ?? [], candidate.screenshotPaths);
          const syncedRating = getSyncedExampleRating(trade) ?? existing.rating;
          nextExamples[relinkIndex] = {
            ...existing,
            tradeId,
            tradeDate: trade.tradeDate,
            rating: syncedRating,
            screenshotPaths: mergedScreenshotPaths,
            updatedAt: now
          };
          hasChanges = true;
          continue;
        }

        const trade = tradeById.get(tradeId) ?? candidate.trade;
        const inferredRating = getSyncedExampleRating(trade) ?? "A+";
        nextExamples = [
          {
            id: createExampleId(),
            tradeId,
            tradeDate: trade.tradeDate,
            rating: inferredRating,
            notes: createEmptyJournalDoc(),
            screenshotPaths: [...candidate.screenshotPaths],
            recordingPath: "",
            createdAt: now,
            updatedAt: now
          },
          ...nextExamples
        ];
        hasChanges = true;
      }

      if (!hasChanges) {
        return current;
      }

      return current.map((candidate) =>
        candidate.id === playbook.id
          ? {
              ...candidate,
              updatedAt: now,
              aPlusExamples: nextExamples
            }
          : candidate
      );
    });
  }, [autoExampleScreenshotsByTrade, dismissedTradeIdSet, playbook.id, setPlaybooks, tradeById]);

  useEffect(() => {
    if (playbook.aPlusExamples.length === 0) {
      return;
    }

    setPlaybooks((current) => {
      const targetPlaybook = current.find((candidate) => candidate.id === playbook.id);
      if (!targetPlaybook) {
        return current;
      }

      const now = new Date().toISOString();
      let hasChanges = false;
      const nextExamples = targetPlaybook.aPlusExamples.map((entry) => {
        const trade = tradeById.get(entry.tradeId);
        if (!trade) {
          return entry;
        }

        const syncedRating = getSyncedExampleRating(trade);
        if (!syncedRating || entry.rating === syncedRating) {
          return entry;
        }

        hasChanges = true;
        return {
          ...entry,
          rating: syncedRating,
          updatedAt: now
        };
      });

      if (!hasChanges) {
        return current;
      }

      return current.map((candidate) =>
        candidate.id === playbook.id
          ? {
              ...candidate,
              updatedAt: now,
              aPlusExamples: nextExamples
            }
          : candidate
      );
    });
  }, [playbook.aPlusExamples.length, playbook.id, setPlaybooks, tradeById]);

  const getEntryFromState = (playbooks: PlaybookRecord[], exampleId: string): ExampleRecord | undefined =>
    playbooks.find((candidate) => candidate.id === playbook.id)?.aPlusExamples.find((entry) => entry.id === exampleId);

  const dismissTradeIds = (tradeIds: string[]) => {
    const uniqueIds = Array.from(new Set(tradeIds.filter((value) => value.trim().length > 0)));
    if (uniqueIds.length === 0) {
      return;
    }
    setDismissedTradeIds((current) => Array.from(new Set([...current, ...uniqueIds])));
  };

  const clearDismissedTradeId = (tradeId: string) => {
    const trimmed = tradeId.trim();
    if (!trimmed) {
      return;
    }
    setDismissedTradeIds((current) => current.filter((value) => value !== trimmed));
  };

  const addExampleFromTrade = (trade: GroupedTrade) => {
    clearDismissedTradeId(trade.id);
    const now = new Date().toISOString();
    const example: ExampleRecord = {
      id: createExampleId(),
      tradeId: trade.id,
      tradeDate: trade.tradeDate,
      rating: getSyncedExampleRating(trade) ?? "A+",
      notes: createEmptyJournalDoc(),
      screenshotPaths: [],
      recordingPath: "",
      createdAt: now,
      updatedAt: now
    };

    setPlaybooks((current) => addPlaybookAPlusExample(current, playbook.id, example));
  };

  const pickScreenshot = (exampleId: string) => {
    setPendingAttachmentExampleId(exampleId);
    setPendingAttachmentKind("screenshot");

    if (isTauri()) {
      void pickAndSavePlaybookAttachment(playbook.id, exampleId, "screenshot")
        .then((path) => {
          if (!path) {
            return;
          }
          setPlaybooks((current) => {
            const entry = getEntryFromState(current, exampleId);
            const nextPaths = entry ? [...entry.screenshotPaths, path] : [path];
            return updatePlaybookAPlusExample(current, playbook.id, exampleId, { screenshotPaths: nextPaths });
          });
        })
        .finally(() => setPendingAttachmentExampleId(""));
      return;
    }

    screenshotInputRef.current?.click();
  };

  const pickRecording = (exampleId: string) => {
    setPendingAttachmentExampleId(exampleId);
    setPendingAttachmentKind("recording");

    if (!isTauri()) {
      return;
    }

    void pickAndSavePlaybookAttachment(playbook.id, exampleId, "recording")
      .then((path) => {
        if (!path) {
          return;
        }

        setPlaybooks((current) =>
          updatePlaybookAPlusExample(current, playbook.id, exampleId, { recordingPath: path })
        );
      })
      .finally(() => setPendingAttachmentExampleId(""));
  };

  const removeScreenshot = (exampleId: string, path: string) => {
    if (path && !path.startsWith("data:")) {
      void deletePlaybookAttachment(path).catch(() => undefined);
    }
    setPlaybooks((current) => {
      const entry = getEntryFromState(current, exampleId);
      const nextPaths = entry ? entry.screenshotPaths.filter((candidate) => candidate !== path) : [];
      return updatePlaybookAPlusExample(current, playbook.id, exampleId, { screenshotPaths: nextPaths });
    });
  };

  const clearRecording = (exampleId: string, path: string) => {
    if (path && !path.startsWith("data:")) {
      void deletePlaybookAttachment(path).catch(() => undefined);
    }
    setPlaybooks((current) =>
      updatePlaybookAPlusExample(current, playbook.id, exampleId, { recordingPath: "" })
    );
  };

  const removeExample = (exampleId: string) => {
    const entry = playbook.aPlusExamples.find((candidate) => candidate.id === exampleId);
    if (entry) {
      const tradeIdsToDismiss = new Set<string>();
      if (entry.tradeId.trim().length > 0) {
        tradeIdsToDismiss.add(entry.tradeId);
      }

      for (const [tradeId, candidate] of autoExampleScreenshotsByTrade) {
        if (hasScreenshotPathOverlap(entry.screenshotPaths, candidate.screenshotPaths)) {
          tradeIdsToDismiss.add(tradeId);
        }
      }

      for (const screenshotPath of entry.screenshotPaths) {
        if (screenshotPath && !screenshotPath.startsWith("data:")) {
          void deletePlaybookAttachment(screenshotPath).catch(() => undefined);
        }
      }
      if (entry.recordingPath) {
        if (!entry.recordingPath.startsWith("data:")) {
          void deletePlaybookAttachment(entry.recordingPath).catch(() => undefined);
        }
      }

      dismissTradeIds(Array.from(tradeIdsToDismiss));
    }

    setPlaybooks((current) => removePlaybookAPlusExample(current, playbook.id, exampleId));
  };

  return (
    <div className="playbook-sections-column">
      <input
        ref={screenshotInputRef}
        type="file"
        accept="image/png,image/jpeg,image/jpg,image/webp,image/gif"
        className="drop-zone-input"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          const exampleId = pendingAttachmentExampleId;
          if (!exampleId || pendingAttachmentKind !== "screenshot" || files.length === 0) {
            event.currentTarget.value = "";
            return;
          }

          void readFileAsDataUrl(files[0])
            .then((dataUrl) => {
              setPlaybooks((current) => {
                const entry = getEntryFromState(current, exampleId);
                const nextPaths = entry ? [...entry.screenshotPaths, dataUrl] : [dataUrl];
                return updatePlaybookAPlusExample(current, playbook.id, exampleId, { screenshotPaths: nextPaths });
              });
            })
            .catch(() => undefined);

          setPendingAttachmentExampleId("");
          event.currentTarget.value = "";
        }}
      />

      <article className="placeholder-panel playbook-section-card playbook-aplus-panel">
        <div className="panel-header">
          <WorkspaceIcon icon="library" alt="A+ example library icon" className="panel-header-icon" />
          <h2>A+ Example Library</h2>
        </div>
        <span className="playbook-example-subtitle">
          Curate your best B+ and A game trades with screenshots, recordings, and notes. Tagged chart screenshots for
          B+ and A game trades are added here automatically.
        </span>

        <div className="playbook-aplus-entry-list">
          {playbook.aPlusExamples.length === 0 ? (
            <div className="empty-state">
              No examples yet. Add a tagged B+ or A game trade below to start building your A+ library.
            </div>
          ) : (
            playbook.aPlusExamples.map((entry) => {
              const trade = tradeById.get(entry.tradeId);
              const screenshotSrcs = entry.screenshotPaths.map((path) =>
                path.startsWith("data:") ? path : resolvePlaybookAttachmentSrc(path)
              );
              const recordingSrc = entry.recordingPath
                ? entry.recordingPath.startsWith("data:")
                  ? entry.recordingPath
                  : resolvePlaybookAttachmentSrc(entry.recordingPath)
                : "";
              const executionCount = trade
                ? trade.openingExecutions.length + trade.closingExecutions.length
                : 0;
              const addCount = trade ? trade.addSignals.length : 0;
              const averagedDownCount = trade
                ? trade.addSignals.filter((signal) => signal.averagedDown).length
                : 0;
              const addedToWinnerCount = trade
                ? trade.addSignals.filter((signal) => signal.addedToWinner).length
                : 0;
              const setupLabel =
                trade?.setups.find((candidate) => candidate.trim().length > 0)?.trim() ?? playbook.name;
              const priceEdgePerShare = trade
                ? trade.side === "Long"
                  ? trade.exitPrice - trade.entryPrice
                  : trade.entryPrice - trade.exitPrice
                : 0;

              return (
                <section key={entry.id} className="playbook-aplus-entry">
                  <header className="playbook-aplus-entry-header">
                    <div className="playbook-aplus-entry-title">
                      <strong>{trade ? trade.name : "Unlinked Example"}</strong>
                      <span className="playbook-aplus-entry-subtitle">
                        {trade ? `${trade.symbol} - ${trade.tradeDate}` : `Trade date ${entry.tradeDate} - link missing`}
                      </span>
                    </div>
                    <div className="playbook-aplus-entry-actions">
                      <label className="playbook-aplus-rating">
                        <span>Rating</span>
                        <select
                          className="journal-header-select"
                          value={entry.rating}
                          onChange={(event) =>
                            setPlaybooks((current) =>
                              updatePlaybookAPlusExample(current, playbook.id, entry.id, {
                                rating: event.target.value as PlaybookExampleRating
                              })
                            )
                          }
                        >
                          {ratingOptions.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      </label>
                      {trade ? (
                        <button
                          type="button"
                          className="mini-action mini-action-soft"
                          onClick={() => onSelectTrade(trade.id, trade.tradeDate)}
                        >
                          Open Trade
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="mini-action mini-action-danger"
                        onClick={() => removeExample(entry.id)}
                      >
                        Remove
                      </button>
                    </div>
                  </header>

                  <div className="playbook-aplus-attachment-row">
                    <button
                      type="button"
                      className="mini-action"
                      disabled={pendingAttachmentExampleId === entry.id}
                      onClick={() => pickScreenshot(entry.id)}
                    >
                      <WorkspaceIcon icon="camera" alt="Add screenshot icon" className="mini-action-icon" />
                      Add Screenshot
                    </button>
                    <button
                      type="button"
                      className="mini-action"
                      disabled={!isTauri() || pendingAttachmentExampleId === entry.id}
                      onClick={() => pickRecording(entry.id)}
                    >
                      <WorkspaceIcon icon="plan" alt="Add recording icon" className="mini-action-icon" />
                      Add Recording
                    </button>
                    {!isTauri() ? (
                      <span className="playbook-aplus-hint">
                        Recording uploads require the desktop app.
                      </span>
                    ) : null}
                  </div>

                  <div className="playbook-aplus-highlight-grid">
                    <section className="playbook-aplus-media-panel" aria-label="Example media">
                      {screenshotSrcs.length > 0 ? (
                        <div className="playbook-aplus-screenshot-grid">
                          {screenshotSrcs.map((src, index) => (
                            <div key={`${entry.id}-shot-${index}`} className="playbook-aplus-screenshot-card">
                              <button
                                type="button"
                                className="journal-screenshot-preview-button playbook-aplus-screenshot-button"
                                style={{ backgroundImage: `url("${src}")` }}
                                onClick={() => onExpandImage(src)}
                              >
                                <img
                                  className="journal-screenshot-image playbook-aplus-screenshot-image"
                                  src={src}
                                  alt="Example screenshot"
                                />
                              </button>
                              <div className="journal-screenshot-actions">
                                <button
                                  type="button"
                                  className="mini-action mini-action-danger"
                                  onClick={() => removeScreenshot(entry.id, entry.screenshotPaths[index])}
                                >
                                  Remove
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="playbook-aplus-media-empty">
                          Add a screenshot to highlight your best execution for this trade.
                        </div>
                      )}

                      {recordingSrc ? (
                        <div className="playbook-aplus-recording">
                          <video className="playbook-aplus-recording-player" controls src={recordingSrc} />
                          <button
                            type="button"
                            className="mini-action mini-action-danger"
                            onClick={() => clearRecording(entry.id, entry.recordingPath)}
                          >
                            Remove Recording
                          </button>
                        </div>
                      ) : null}
                    </section>

                    <section
                      className={`playbook-aplus-trade-stats${trade ? "" : " playbook-aplus-trade-stats-missing"}`}
                      aria-label="Trade stats snapshot"
                    >
                      {trade ? (
                        <>
                          <div className="playbook-aplus-trade-stats-header">
                            <strong>Trade Stats</strong>
                            <span>
                              {trade.status} - {trade.side} - {trade.game || "No game tag"}
                            </span>
                          </div>
                          <div className="playbook-aplus-meta-grid">
                            <div className="playbook-aplus-meta-tile">
                              <span>Symbol</span>
                              <strong>{trade.symbol || "-"}</strong>
                            </div>
                            <div className="playbook-aplus-meta-tile">
                              <span>Setup</span>
                              <strong>{setupLabel}</strong>
                            </div>
                            <div className="playbook-aplus-meta-tile">
                              <span>Win / Loss</span>
                              <strong>{trade.status}</strong>
                            </div>
                          </div>
                          <div className="playbook-aplus-stat-grid">
                            <div className="playbook-aplus-stat-tile">
                              <span>Net PnL</span>
                              <strong className={getSignedValueClassName(trade.netPnlUsd)}>
                                {formatSignedMoney(trade.netPnlUsd)}
                              </strong>
                            </div>
                            <div className="playbook-aplus-stat-tile">
                              <span>Return / Share</span>
                              <strong className={getSignedValueClassName(trade.returnPerShare)}>
                                {formatSignedPerShare(trade.returnPerShare)}
                              </strong>
                            </div>
                            <div className="playbook-aplus-stat-tile">
                              <span>Price Edge / Share</span>
                              <strong className={getSignedValueClassName(priceEdgePerShare)}>
                                {formatSignedPerShare(priceEdgePerShare)}
                              </strong>
                            </div>
                            <div className="playbook-aplus-stat-tile">
                              <span>Size</span>
                              <strong>{formatSize(trade.size)}</strong>
                            </div>
                            <div className="playbook-aplus-stat-tile">
                              <span>Entry</span>
                              <strong>{formatPrice(trade.entryPrice)}</strong>
                            </div>
                            <div className="playbook-aplus-stat-tile">
                              <span>Exit</span>
                              <strong>{formatPrice(trade.exitPrice)}</strong>
                            </div>
                            <div className="playbook-aplus-stat-tile">
                              <span>Hold Time</span>
                              <strong>{trade.holdTime || "-"}</strong>
                            </div>
                            <div className="playbook-aplus-stat-tile">
                              <span>Executions</span>
                              <strong>{executionCount}</strong>
                            </div>
                            <div className="playbook-aplus-stat-tile">
                              <span>Adds</span>
                              <strong>
                                {addCount} total ({averagedDownCount} avg down / {addedToWinnerCount} winner)
                              </strong>
                            </div>
                            <div className="playbook-aplus-stat-tile">
                              <span>Fees</span>
                              <strong>{formatCurrency(trade.feesUsd)}</strong>
                            </div>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="playbook-aplus-trade-stats-header">
                            <strong>Trade Stats</strong>
                            <span>Linked trade unavailable</span>
                          </div>
                          <div className="playbook-aplus-meta-grid">
                            <div className="playbook-aplus-meta-tile">
                              <span>Status</span>
                              <strong>Link missing</strong>
                            </div>
                            <div className="playbook-aplus-meta-tile">
                              <span>Trade Date</span>
                              <strong>{entry.tradeDate || "-"}</strong>
                            </div>
                            <div className="playbook-aplus-meta-tile">
                              <span>Rating</span>
                              <strong>{entry.rating}</strong>
                            </div>
                          </div>
                          <p className="playbook-aplus-missing-copy">
                            This example is still saved, but its original trade record is no longer in the library.
                          </p>
                        </>
                      )}
                    </section>
                  </div>

                  <div className="playbook-aplus-notes">
                    <JournalRichTextEditor
                      content={entry.notes}
                      onChange={(content) =>
                        setPlaybooks((current) =>
                          updatePlaybookAPlusExample(current, playbook.id, entry.id, { notes: content })
                        )
                      }
                      onImageInsert={readFileAsDataUrl}
                      placeholder="Add why this is an A+ example, execution notes, and what to repeat."
                    />
                  </div>
                </section>
              );
            })
          )}
        </div>
      </article>

      <article className="placeholder-panel playbook-section-card playbook-aplus-panel">
        <div className="panel-header">
          <WorkspaceIcon icon="trades" alt="Tagged trades icon" className="panel-header-icon" />
          <h2>Eligible Trades (B+ and A Game)</h2>
        </div>
        <span className="playbook-example-subtitle">
          Trades are eligible when they match this playbook and have a game tag of B+ Game or A Game.
        </span>
        <div className="playbook-aplus-eligible-list">
          {availableEligibleTrades.length === 0 ? (
            <div className="empty-state">
              No eligible trades found. Tag more trades with {playbook.name} and make sure their game score is B+ or A.
            </div>
          ) : (
            availableEligibleTrades.slice(0, 24).map((trade) => (
              <div key={trade.id} className="playbook-aplus-eligible-row">
                <div className="playbook-aplus-eligible-copy">
                  <strong>{trade.name}</strong>
                  <span>
                    {trade.symbol} · {trade.tradeDate} · {trade.game} · {formatSignedMoney(trade.netPnlUsd)}
                  </span>
                </div>
                <div className="playbook-aplus-eligible-actions">
                  <button type="button" className="mini-action" onClick={() => addExampleFromTrade(trade)}>
                    Add To Library
                  </button>
                  <button
                    type="button"
                    className="mini-action mini-action-soft"
                    onClick={() => onSelectTrade(trade.id, trade.tradeDate)}
                  >
                    Review
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </article>
    </div>
  );
};
