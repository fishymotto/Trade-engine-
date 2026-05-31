import { memo, useMemo, useState } from "react";
import { TagDrawer } from "../../../components/TagDrawer";
import { WorkspaceIcon } from "../../../components/WorkspaceIcon";
import { createEmptyJournalDoc, hasJournalDocContent } from "../../../lib/journal/journalContent";
import { tradeTagOptionsByField as defaultTradeTagOptionsByField } from "../../../lib/trades/tradeTagCatalog";
import { saveWorkspaceInlineImage } from "../../../lib/workspace/workspaceAttachmentClient";
import type { JournalPageRecord, JournalScreenshotTradeLink, JournalTradeNoteRecord } from "../../../types/journal";
import type { EditableTradeRow, EditableTradeTagField } from "../../../types/tradeTags";
import { JournalRichTextEditor } from "./JournalRichTextEditor";

interface JournalTradeNotesPanelProps {
  page: JournalPageRecord;
  linkedTrades: EditableTradeRow[];
  tagOptionsByField: Record<EditableTradeTagField, string[]>;
  onUpdatePage: (pageId: string, updates: Partial<Pick<JournalPageRecord, "tradeNotes">>) => void;
  onSelectTrade: (tradeId: string, tradeDate: string) => void;
  onCreateTradeTagOption: (field: EditableTradeTagField, value: string) => void;
  onRenameTradeTagOption: (field: EditableTradeTagField, currentValue: string, nextValue: string) => void;
  onDeleteTradeTagOption: (field: EditableTradeTagField, value: string) => void;
}

const TRADE_LINK_SEPARATOR = "::";

const createTradeNoteId = (): string => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `trade-note-${Math.random().toString(36).slice(2, 10)}`;
};

const createTradeNoteRecord = (tradeDate: string): JournalTradeNoteRecord => {
  const timestamp = new Date().toISOString();

  return {
    id: createTradeNoteId(),
    title: "",
    content: createEmptyJournalDoc(),
    linkedTrades: [],
    linkedTradeId: "",
    linkedTradeDate: "",
    ticker: "",
    playbook: "",
    taggedDate: tradeDate,
    createdAt: timestamp,
    updatedAt: timestamp
  };
};

const serializeTradeLink = (tradeId: string, tradeDate: string): string =>
  tradeId && tradeDate ? `${tradeId}${TRADE_LINK_SEPARATOR}${tradeDate}` : "";

const parseTradeLink = (value: string): JournalScreenshotTradeLink | null => {
  const separatorIndex = value.indexOf(TRADE_LINK_SEPARATOR);
  if (separatorIndex <= 0) {
    return null;
  }

  const tradeId = value.slice(0, separatorIndex);
  const tradeDate = value.slice(separatorIndex + TRADE_LINK_SEPARATOR.length);
  if (!tradeId || !tradeDate) {
    return null;
  }

  return {
    tradeId,
    tradeDate
  };
};

const dedupeTradeLinks = (links: JournalScreenshotTradeLink[]): JournalScreenshotTradeLink[] => {
  const unique = new Map<string, JournalScreenshotTradeLink>();
  for (const link of links) {
    const tradeId = typeof link.tradeId === "string" ? link.tradeId.trim() : "";
    const tradeDate = typeof link.tradeDate === "string" ? link.tradeDate.trim() : "";
    if (!tradeId || !tradeDate) {
      continue;
    }

    unique.set(serializeTradeLink(tradeId, tradeDate), {
      tradeId,
      tradeDate
    });
  }

  return Array.from(unique.values());
};

const collectTradeNoteLinks = (note: JournalTradeNoteRecord): JournalScreenshotTradeLink[] =>
  dedupeTradeLinks([
    ...(Array.isArray(note.linkedTrades) ? note.linkedTrades : []),
    ...(note.linkedTradeId.trim() && note.linkedTradeDate.trim()
      ? [
          {
            tradeId: note.linkedTradeId.trim(),
            tradeDate: note.linkedTradeDate.trim()
          }
        ]
      : [])
  ]);

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

const formatJournalDate = (tradeDate: string) => {
  if (!tradeDate) {
    return "No date";
  }

  const parsed = new Date(`${tradeDate}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return tradeDate;
  }

  return parsed.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
};

const formatSignedMoney = (value: number): string => `${value >= 0 ? "+" : "-"}$${Math.abs(value).toFixed(2)}`;

const formatTradePrice = (value: number): string => {
  if (!Number.isFinite(value)) {
    return "-";
  }

  return value.toFixed(Math.abs(value) >= 100 ? 2 : 4);
};

const getToneIndex = (value: string): number =>
  value.split("").reduce((sum, character) => sum + character.charCodeAt(0), 0) % 6;

const getPrimaryTradePlaybook = (trade: EditableTradeRow): string =>
  trade.setups
    .map((playbook) => playbook.trim())
    .find((playbook) => playbook && playbook !== "No Setup") ?? "";

const getTradePlaybooks = (trades: EditableTradeRow[], fallbackPlaybook: string): string[] => {
  if (trades.length > 0) {
    const seen = new Set<string>();
    const tradePlaybooks = trades
      .flatMap((trade) => trade.setups)
      .map((playbook) => playbook.trim())
      .filter((playbook) => playbook && playbook !== "No Setup")
      .filter((playbook) => {
        const key = playbook.toLowerCase();
        if (seen.has(key)) {
          return false;
        }

        seen.add(key);
        return true;
      });

    if (tradePlaybooks.length > 0) {
      return tradePlaybooks;
    }
  }

  return fallbackPlaybook.trim() ? [fallbackPlaybook.trim()] : [];
};

const getTradeNoteLabel = (
  note: JournalTradeNoteRecord,
  linkedTrades: EditableTradeRow[],
  index: number
): string => {
  const linkedSymbols = Array.from(new Set(linkedTrades.map((trade) => trade.symbol.trim()).filter(Boolean)));
  if (linkedSymbols.length > 0) {
    return `${linkedSymbols[0]} Note`;
  }

  if (note.ticker.trim()) {
    return `${note.ticker.trim().toUpperCase()} Note`;
  }

  return `Trade Note ${index + 1}`;
};

const getTradeNoteTickerValue = (linkedTrades: EditableTradeRow[], fallbackTicker: string): string => {
  const linkedSymbols = Array.from(new Set(linkedTrades.map((trade) => trade.symbol.trim()).filter(Boolean)));
  return linkedSymbols.join(", ") || fallbackTicker;
};

const buildTradeNoteWithLinks = (
  note: JournalTradeNoteRecord,
  nextLinks: JournalScreenshotTradeLink[],
  tradeLookup: Map<string, EditableTradeRow>,
  fallbackTradeDate: string
): JournalTradeNoteRecord => {
  const linkedTrades = dedupeTradeLinks(nextLinks);
  const primaryLinkedTrade = linkedTrades[0] ?? null;
  const resolvedTrades = linkedTrades
    .map((link) => tradeLookup.get(serializeTradeLink(link.tradeId, link.tradeDate)) ?? null)
    .filter((trade): trade is EditableTradeRow => trade !== null);
  const linkedSymbols = Array.from(new Set(resolvedTrades.map((trade) => trade.symbol.trim()).filter(Boolean)));
  const linkedPlaybooks = getTradePlaybooks(resolvedTrades, "");
  const currentPlaybook = note.playbook.trim();
  const matchingPlaybook =
    currentPlaybook.length > 0
      ? linkedPlaybooks.find((playbook) => playbook.toLowerCase() === currentPlaybook.toLowerCase())
      : undefined;

  return {
    ...note,
    linkedTrades,
    linkedTradeId: primaryLinkedTrade?.tradeId ?? "",
    linkedTradeDate: primaryLinkedTrade?.tradeDate ?? "",
    ticker: linkedSymbols.join(", ") || note.ticker,
    playbook: matchingPlaybook ?? linkedPlaybooks[0] ?? note.playbook,
    taggedDate: primaryLinkedTrade?.tradeDate ?? note.taggedDate ?? fallbackTradeDate
  };
};

const JournalTradeNotesPanelComponent = ({
  page,
  linkedTrades,
  tagOptionsByField,
  onUpdatePage,
  onSelectTrade,
  onCreateTradeTagOption,
  onRenameTradeTagOption,
  onDeleteTradeTagOption
}: JournalTradeNotesPanelProps) => {
  const [openTradePickerId, setOpenTradePickerId] = useState<string | null>(null);
  const [openPlaybookPickerId, setOpenPlaybookPickerId] = useState<string | null>(null);
  const [playbookSearchQuery, setPlaybookSearchQuery] = useState("");

  const tradeNotes = Array.isArray(page.tradeNotes) ? page.tradeNotes : [];

  const linkedTradeOptions = useMemo(
    () =>
      linkedTrades.map((trade) => ({
        value: serializeTradeLink(trade.id, trade.tradeDate),
        trade
      })),
    [linkedTrades]
  );

  const linkedTradeByKey = useMemo(
    () =>
      new Map(
        linkedTrades.map((trade) => [serializeTradeLink(trade.id, trade.tradeDate), trade])
      ),
    [linkedTrades]
  );

  const assignedTradeValuesByNoteId = useMemo(() => {
    const assigned = new Map<string, string[]>();
    for (const note of tradeNotes) {
      const values = collectTradeNoteLinks(note)
        .map((link) => serializeTradeLink(link.tradeId, link.tradeDate))
        .filter(Boolean);
      if (values.length > 0) {
        assigned.set(note.id, values);
      }
    }

    return assigned;
  }, [tradeNotes]);

  const usedTradeValueSet = useMemo(() => {
    const used = new Set<string>();
    for (const values of assignedTradeValuesByNoteId.values()) {
      for (const value of values) {
        used.add(value);
      }
    }

    return used;
  }, [assignedTradeValuesByNoteId]);

  const playbookOptions = useMemo(() => {
    const merged = [
      ...tagOptionsByField.playbook,
      ...linkedTrades.flatMap((trade) => trade.setups),
      ...tradeNotes.map((note) => note.playbook)
    ];

    const seen = new Set<string>();
    const output: string[] = [];
    for (const value of merged) {
      const trimmed = value.trim();
      if (!trimmed || trimmed === "No Setup") {
        continue;
      }

      const key = trimmed.toLowerCase();
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      output.push(trimmed);
    }

    return output.sort((left, right) => left.localeCompare(right));
  }, [linkedTrades, tagOptionsByField.playbook, tradeNotes]);

  const activePlaybookNote = useMemo(
    () => tradeNotes.find((note) => note.id === openPlaybookPickerId) ?? null,
    [openPlaybookPickerId, tradeNotes]
  );

  const updateTradeNotes = (nextTradeNotes: JournalTradeNoteRecord[]) => {
    onUpdatePage(page.id, { tradeNotes: nextTradeNotes });
  };

  const handleCreateTradeNote = (insertAfterIndex?: number) => {
    const nextTradeNote = createTradeNoteRecord(page.tradeDate);
    if (insertAfterIndex === undefined) {
      updateTradeNotes([...tradeNotes, nextTradeNote]);
      return;
    }

    updateTradeNotes([
      ...tradeNotes.slice(0, insertAfterIndex + 1),
      nextTradeNote,
      ...tradeNotes.slice(insertAfterIndex + 1)
    ]);
  };

  const updateTradeNote = (
    noteId: string,
    updater: (current: JournalTradeNoteRecord) => JournalTradeNoteRecord
  ) => {
    const updatedAt = new Date().toISOString();
    updateTradeNotes(
      tradeNotes.map((note) =>
        note.id === noteId
          ? {
              ...updater(note),
              updatedAt
            }
          : note
      )
    );
  };

  const handleDeleteTradeNote = (note: JournalTradeNoteRecord) => {
    const isMeaningful =
      collectTradeNoteLinks(note).length > 0 ||
      note.ticker.trim().length > 0 ||
      note.playbook.trim().length > 0 ||
      hasJournalDocContent(note.content);
    if (isMeaningful && !window.confirm(`Remove "${getTradeNoteLabel(note, [], 0)}"?`)) {
      return;
    }

    updateTradeNotes(tradeNotes.filter((current) => current.id !== note.id));
    if (openTradePickerId === note.id) {
      setOpenTradePickerId(null);
    }
    if (openPlaybookPickerId === note.id) {
      setOpenPlaybookPickerId(null);
      setPlaybookSearchQuery("");
    }
  };

  return (
    <section className="journal-writing-section journal-trade-note-section">
      <div className="journal-writing-header">
        <div className="journal-writing-header-title">
          <WorkspaceIcon icon="text" alt="Trade notes icon" className="mini-action-icon" />
          <div className="journal-screenshot-section-title">
            <strong>Trade Notes</strong>
            <span>Capture trade-specific text, then link each card to the matching trade when it is ready.</span>
          </div>
        </div>
        <div className="journal-writing-header-actions">
          <button
            type="button"
            className="mini-action"
            onClick={() => handleCreateTradeNote()}
          >
            + Add note
          </button>
        </div>
      </div>

      {tradeNotes.length === 0 ? (
        <div className="headline-empty journal-trade-note-empty">
          <div className="headline-empty-text">
            <strong>No trade notes yet.</strong>
            <span>Add card-based notes here, then attach them to the right trade once it lands from the backend.</span>
          </div>
          <button
            type="button"
            className="mini-action headline-mini-action headline-open-action"
            onClick={() => handleCreateTradeNote()}
          >
            + Add trade note
          </button>
        </div>
      ) : (
        <div className="journal-trade-note-grid">
          {tradeNotes.map((note, index) => {
            const selectedTradeValues = assignedTradeValuesByNoteId.get(note.id) ?? [];
            const selectedTradeValueSet = new Set(selectedTradeValues);
            const isTradePickerOpen = openTradePickerId === note.id;
            const linkedTradeLinks = collectTradeNoteLinks(note);
            const linkedTradeRecords = linkedTradeLinks
              .map((link) => linkedTradeByKey.get(serializeTradeLink(link.tradeId, link.tradeDate)) ?? null)
              .filter((trade): trade is EditableTradeRow => trade !== null);
            const linkedTradeCount = linkedTradeLinks.length;
            const missingLinkedTradeCount = linkedTradeCount - linkedTradeRecords.length;
            const primaryLinkedTrade = linkedTradeRecords[0] ?? null;
            const tradePickerSummary =
              linkedTradeCount === 0
                ? "Choose trade"
                : linkedTradeCount === 1 && primaryLinkedTrade
                  ? `${primaryLinkedTrade.symbol} - ${primaryLinkedTrade.name}`
                  : `${linkedTradeCount} trade${linkedTradeCount === 1 ? "" : "s"} linked`;
            const playbookPills = getTradePlaybooks(linkedTradeRecords, note.playbook);
            const tickerValue = getTradeNoteTickerValue(linkedTradeRecords, note.ticker);
            const noteLabel = getTradeNoteLabel(note, linkedTradeRecords, index);
            const updatedLabel = new Date(note.updatedAt).toLocaleString();

            return (
              <article key={note.id} className="journal-trade-note-card">
                <div className="journal-trade-note-card-header">
                  <div className="journal-trade-note-card-title">
                    <strong>{noteLabel}</strong>
                    <span>
                      {linkedTradeCount === 0
                        ? `Tagged ${formatJournalDate(note.taggedDate)}`
                        : linkedTradeCount === 1 && primaryLinkedTrade
                          ? `${primaryLinkedTrade.side} - ${primaryLinkedTrade.openTime} to ${primaryLinkedTrade.closeTime}`
                          : `${linkedTradeCount} linked trades`}
                    </span>
                  </div>
                  <span className="journal-trade-note-card-meta">Updated {updatedLabel}</span>
                </div>

                <div className="journal-screenshot-tag-grid">
                  <div className="journal-screenshot-tag-field journal-screenshot-tag-field-wide">
                    <span>Attach Trade</span>
                    <details className="journal-screenshot-trade-picker" open={isTradePickerOpen}>
                      <summary
                        className="journal-screenshot-trade-picker-summary"
                        onClick={(event) => {
                          event.preventDefault();
                          setOpenTradePickerId((current) => (current === note.id ? null : note.id));
                        }}
                      >
                        <span>{tradePickerSummary}</span>
                        <span className="journal-screenshot-trade-picker-caret" aria-hidden="true">
                          v
                        </span>
                      </summary>
                      {isTradePickerOpen ? (
                        <>
                          <div className="journal-screenshot-trade-picker-controls">
                            <button
                              type="button"
                              className="mini-action mini-action-soft"
                              disabled={selectedTradeValues.length === 0}
                              onClick={() =>
                                updateTradeNote(note.id, (current) =>
                                  buildTradeNoteWithLinks(current, [], linkedTradeByKey, page.tradeDate)
                                )
                              }
                            >
                              Clear
                            </button>
                          </div>
                          {linkedTradeOptions.length > 0 ? (
                            <div className="journal-screenshot-trade-picker-list">
                              {linkedTradeOptions.map(({ value, trade }) => {
                                const isChecked = selectedTradeValueSet.has(value);
                                const isUsedByAnotherNote = !isChecked && usedTradeValueSet.has(value);
                                const primaryPlaybook = getPrimaryTradePlaybook(trade);

                                return (
                                  <label
                                    key={`${note.id}-${value}`}
                                    className={`journal-screenshot-trade-option${isChecked ? " is-checked" : ""}${
                                      isUsedByAnotherNote ? " is-disabled" : ""
                                    }`}
                                  >
                                    <input
                                      type="checkbox"
                                      name={`trade-note-link-${note.id}`}
                                      checked={isChecked}
                                      disabled={isUsedByAnotherNote}
                                      onChange={() => {
                                        const nextValues = isChecked
                                          ? selectedTradeValues.filter((currentValue) => currentValue !== value)
                                          : [...selectedTradeValues, value];
                                        const nextLinks = nextValues
                                          .map((currentValue) => parseTradeLink(currentValue))
                                          .filter((link): link is JournalScreenshotTradeLink => link !== null);

                                        updateTradeNote(note.id, (current) =>
                                          buildTradeNoteWithLinks(current, nextLinks, linkedTradeByKey, page.tradeDate)
                                        );
                                      }}
                                    />
                                    <span className="journal-screenshot-trade-option-main">
                                      <span className="journal-screenshot-trade-option-title">
                                        <strong>{trade.symbol}</strong>
                                        <span className="journal-screenshot-trade-option-name">{trade.name}</span>
                                        <span className="journal-screenshot-trade-option-time">
                                          {trade.openTime} to {trade.closeTime}
                                        </span>
                                      </span>
                                      <span className="journal-screenshot-trade-option-tags">
                                        <span className="journal-screenshot-trade-option-chip">{trade.side}</span>
                                        {primaryPlaybook ? (
                                          <span
                                            className={`journal-screenshot-trade-option-chip journal-screenshot-trade-option-playbook tag-option-pill-${getToneIndex(
                                              primaryPlaybook
                                            )}`}
                                            title={primaryPlaybook}
                                          >
                                            {primaryPlaybook}
                                          </span>
                                        ) : (
                                          <span className="journal-screenshot-trade-option-empty">No playbook</span>
                                        )}
                                      </span>
                                    </span>
                                    <span className="journal-screenshot-trade-option-prices">
                                      <span>
                                        <em>Entry</em>
                                        <strong>{formatTradePrice(trade.entryPrice)}</strong>
                                      </span>
                                      <span>
                                        <em>Exit</em>
                                        <strong>{formatTradePrice(trade.exitPrice)}</strong>
                                      </span>
                                    </span>
                                    <span className="journal-screenshot-trade-option-meta">
                                      {isUsedByAnotherNote ? "Linked" : formatSignedMoney(trade.netPnlUsd)}
                                    </span>
                                  </label>
                                );
                              })}
                            </div>
                          ) : (
                            <div className="empty-inline-state">No trades found for this journal date yet.</div>
                          )}
                        </>
                      ) : null}
                    </details>
                  </div>

                  <label className="journal-screenshot-tag-field">
                    <span>Ticker</span>
                    <input
                      value={tickerValue}
                      disabled={linkedTradeCount > 0}
                      onChange={(event) =>
                        updateTradeNote(note.id, (current) => ({
                          ...current,
                          ticker: event.target.value.toUpperCase()
                        }))
                      }
                      placeholder="CVE"
                    />
                  </label>

                  <div className="journal-screenshot-tag-field">
                    <span>Playbook</span>
                    <button
                      type="button"
                      className={`journal-screenshot-playbook-trigger${playbookPills.length > 0 ? "" : " is-empty"}`}
                      onClick={() => {
                        setOpenPlaybookPickerId(note.id);
                        setPlaybookSearchQuery("");
                        setOpenTradePickerId(null);
                      }}
                    >
                      {playbookPills.length > 0 ? (
                        <span className="journal-screenshot-playbook-pill-row">
                          {playbookPills.map((playbook) => (
                            <span
                              key={`${note.id}-${playbook.toLowerCase()}`}
                              className={`tag-option-pill tag-option-pill-${getToneIndex(playbook)}`}
                            >
                              {playbook}
                            </span>
                          ))}
                        </span>
                      ) : (
                        <span>Select playbook</span>
                      )}
                    </button>
                  </div>

                  <label className="journal-screenshot-tag-field">
                    <span>Tagged Date</span>
                    <input
                      type="date"
                      value={normalizeDateForInput(note.taggedDate)}
                      onChange={(event) =>
                        updateTradeNote(note.id, (current) => ({
                          ...current,
                          taggedDate: normalizeDateForInput(event.target.value) || page.tradeDate
                        }))
                      }
                    />
                  </label>
                </div>

                <div className="journal-trade-note-editor">
                  <span>Text</span>
                  <JournalRichTextEditor
                    key={`${page.id}-${note.id}-trade-note`}
                    content={note.content}
                    onChange={(content) =>
                      updateTradeNote(note.id, (current) => ({
                        ...current,
                        content
                      }))
                    }
                    onImageInsert={(file) =>
                      saveWorkspaceInlineImage({
                        category: "journal-inline-images",
                        recordId: page.id,
                        slotKey: `trade-note-${note.id}`,
                        file
                      })
                    }
                    draftStorageKey={`${page.id}:trade-note:${note.id}`}
                    sourceUpdatedAt={note.updatedAt}
                    placeholder="Capture the trade text here. Type '/' for commands."
                    compact
                    autosize
                    heightPreset="short"
                    appearance="notion"
                    blockActionsVisibility="focus"
                  />
                </div>

                <div className="journal-screenshot-tag-actions">
                  <span className="journal-screenshot-link-status">
                    {linkedTradeCount === 0
                      ? "Not attached to a trade yet."
                      : missingLinkedTradeCount > 0
                        ? `${linkedTradeRecords.length} of ${linkedTradeCount} linked trades are available in this journal day.`
                        : linkedTradeCount === 1 && primaryLinkedTrade
                          ? `Synced to ${primaryLinkedTrade.symbol} ${primaryLinkedTrade.name}. Review notes stay aligned with this trade.`
                          : `Synced to ${linkedTradeCount} trades. Review notes stay aligned with each linked trade.`}
                  </span>
                  <div className="journal-trade-note-actions">
                    {linkedTradeRecords.map((trade) => (
                      <button
                        key={`${note.id}-${trade.id}`}
                        type="button"
                        className="mini-action mini-action-soft"
                        onClick={() => onSelectTrade(trade.id, trade.tradeDate)}
                      >
                        Open {trade.symbol} {trade.name}
                      </button>
                    ))}
                    <button
                      type="button"
                      className="mini-action mini-action-soft"
                      onClick={() => handleCreateTradeNote(index)}
                    >
                      + New trade note
                    </button>
                    <button
                      type="button"
                      className="mini-action mini-action-danger"
                      onClick={() => handleDeleteTradeNote(note)}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {activePlaybookNote ? (
        <TagDrawer
          isOpen
          title={`Playbook - ${getTradeNoteLabel(
            activePlaybookNote,
            collectTradeNoteLinks(activePlaybookNote)
              .map((link) => linkedTradeByKey.get(serializeTradeLink(link.tradeId, link.tradeDate)) ?? null)
              .filter((trade): trade is EditableTradeRow => trade !== null),
            0
          )}`}
          options={playbookOptions}
          currentValue={activePlaybookNote.playbook}
          allowClear
          clearLabel="Clear Playbook"
          searchValue={playbookSearchQuery}
          onSearchChange={setPlaybookSearchQuery}
          onSelect={(value) => {
            const nextValue = typeof value === "string" ? value : "";
            updateTradeNote(activePlaybookNote.id, (current) => ({
              ...current,
              playbook: nextValue
            }));
            setOpenPlaybookPickerId(null);
            setPlaybookSearchQuery("");
          }}
          onCreateOption={(value) => {
            onCreateTradeTagOption("playbook", value);
            updateTradeNote(activePlaybookNote.id, (current) => ({
              ...current,
              playbook: value
            }));
            setOpenPlaybookPickerId(null);
            setPlaybookSearchQuery("");
          }}
          onRenameOption={(currentValue, nextValue) => {
            onRenameTradeTagOption("playbook", currentValue, nextValue);
            updateTradeNote(activePlaybookNote.id, (current) => {
              if (current.playbook.trim().toLowerCase() !== currentValue.trim().toLowerCase()) {
                return current;
              }

              return {
                ...current,
                playbook: nextValue
              };
            });
          }}
          onDeleteOption={(value) => {
            onDeleteTradeTagOption("playbook", value);
            updateTradeNote(activePlaybookNote.id, (current) => {
              if (current.playbook.trim().toLowerCase() !== value.trim().toLowerCase()) {
                return current;
              }

              return {
                ...current,
                playbook: ""
              };
            });
          }}
          canManageOption={(value) =>
            !defaultTradeTagOptionsByField.playbook.some(
              (option) => option.toLowerCase() === value.toLowerCase()
            )
          }
          onClose={() => {
            setOpenPlaybookPickerId(null);
            setPlaybookSearchQuery("");
          }}
        />
      ) : null}
    </section>
  );
};

export const JournalTradeNotesPanel = memo(
  JournalTradeNotesPanelComponent,
  (previous, next) =>
    previous.page.id === next.page.id &&
    previous.page.tradeDate === next.page.tradeDate &&
    previous.page.tradeNotes === next.page.tradeNotes &&
    previous.linkedTrades === next.linkedTrades &&
    previous.tagOptionsByField === next.tagOptionsByField
);
