import { useMemo, useRef, useState } from "react";
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

const createExampleId = (): string => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `example-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const formatSignedMoney = (value: number): string =>
  `${value >= 0 ? "+" : "-"}$${Math.abs(value).toFixed(2)}`;

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
  onSelectTrade: (tradeId: string, tradeDate: string) => void;
  onExpandImage: (src: string) => void;
  setPlaybooks: React.Dispatch<React.SetStateAction<PlaybookRecord[]>>;
}

export const APlusExampleLibrary = ({
  playbook,
  matchedTrades,
  onSelectTrade,
  onExpandImage,
  setPlaybooks
}: APlusExampleLibraryProps) => {
  const [pendingAttachmentExampleId, setPendingAttachmentExampleId] = useState("");
  const [pendingAttachmentKind, setPendingAttachmentKind] = useState<"screenshot" | "recording">(
    "screenshot"
  );
  const screenshotInputRef = useRef<HTMLInputElement | null>(null);

  const tradeById = useMemo(() => new Map(matchedTrades.map((trade) => [trade.id, trade])), [matchedTrades]);

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

  const getEntryFromState = (playbooks: PlaybookRecord[], exampleId: string): ExampleRecord | undefined =>
    playbooks.find((candidate) => candidate.id === playbook.id)?.aPlusExamples.find((entry) => entry.id === exampleId);

  const addExampleFromTrade = (trade: GroupedTrade) => {
    const now = new Date().toISOString();
    const example: ExampleRecord = {
      id: createExampleId(),
      tradeId: trade.id,
      tradeDate: trade.tradeDate,
      rating: "A+",
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
          Curate your best B+ and A game trades with screenshots, recordings, and notes.
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

              return (
                <section key={entry.id} className="playbook-aplus-entry">
                  <header className="playbook-aplus-entry-header">
                    <div className="playbook-aplus-entry-title">
                      <strong>{trade ? trade.name : "Missing trade"}</strong>
                      <span className="playbook-aplus-entry-subtitle">
                        {trade ? `${trade.symbol} · ${trade.tradeDate}` : entry.tradeDate}
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

                  {screenshotSrcs.length > 0 ? (
                    <div className="playbook-aplus-screenshot-grid">
                      {screenshotSrcs.map((src, index) => (
                        <div key={`${entry.id}-shot-${index}`} className="playbook-aplus-screenshot-card">
                          <button
                            type="button"
                            className="journal-screenshot-preview-button"
                            onClick={() => onExpandImage(src)}
                          >
                            <img className="journal-screenshot-image" src={src} alt="Example screenshot" />
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
                  ) : null}

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
