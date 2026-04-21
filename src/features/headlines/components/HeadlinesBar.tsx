import { useEffect, useMemo, useRef, useState } from "react";
import type { HeadlineItem } from "../../../types/headline";
import {
  loadHeadlinesForTradeDate,
  migrateLegacyHeadlinesToTradeDate,
  saveHeadlinesForTradeDate
} from "../../../lib/headlines/headlineStore";
import { canOpenExternalUrl, openExternalUrl } from "../../../lib/links/openExternalUrl";
import { useEditableSelectOptions } from "../../../lib/select/useEditableSelectOptions";
import { SYNC_HYDRATED_EVENT } from "../../../lib/sync/syncStore";
import { TagDrawer } from "../../../components/TagDrawer";
import { WorkspaceIcon } from "../../../components/WorkspaceIcon";
import { formatTickerList, parseTickerList } from "../../../lib/tickers/tickerList";
import { getTickerIcon, getTickerSector, tickerIcons } from "../../../lib/tickers/tickerIcons";

interface HeadlinesBarProps {
  className?: string;
  journalDate: string;
}

type HeadlineDraft = {
  title: string;
  source: string;
  url: string;
  tickers: string[];
  active: boolean;
};

const createEmptyDraft = (): HeadlineDraft => ({
  title: "",
  source: "",
  url: "",
  tickers: [],
  active: true
});

const createId = (): string => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `headline_${Date.now()}_${Math.random().toString(16).slice(2)}`;
};

const normalizeSource = (value: string): string => value.trim() || "General";

const normalizeHeadlineUrl = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const withoutViewSource = trimmed.replace(/^view-source:/i, "").trim();

  try {
    const parsed = new URL(withoutViewSource);
    const protocol = parsed.protocol.toLowerCase();
    if (protocol !== "http:" && protocol !== "https:") {
      return null;
    }

    return parsed.toString();
  } catch {
    return null;
  }
};

const formatHeadlineTimestamp = (iso: string): string | null => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
};

export const HeadlinesBar = ({ className = "", journalDate }: HeadlinesBarProps) => {
  const { options: categoryOptions, addOption: addCategoryOption } = useEditableSelectOptions("headlineCategories", [
    "General",
    "Macro",
    "Earnings",
    "News",
    "Technical"
  ]);
  const { options: tickerOptionsBase, addOption: addTickerOption } = useEditableSelectOptions(
    "headlineTickers",
    Object.keys(tickerIcons).sort()
  );
  const [headlines, setHeadlines] = useState<HeadlineItem[]>(() => loadHeadlinesForTradeDate(journalDate));
  const skipNextSaveRef = useRef(true);
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<HeadlineDraft>(() => createEmptyDraft());
  const [isCategoryDrawerOpen, setIsCategoryDrawerOpen] = useState(false);
  const [categorySearch, setCategorySearch] = useState("");
  const [isTickerDrawerOpen, setIsTickerDrawerOpen] = useState(false);
  const [tickerSearch, setTickerSearch] = useState("");

  useEffect(() => {
    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false;
      return;
    }

    void saveHeadlinesForTradeDate(journalDate, headlines);
  }, [headlines, journalDate]);

  useEffect(() => {
    setIsAdding(false);
    setEditingId(null);
    setDraft(createEmptyDraft());
    skipNextSaveRef.current = true;
    setHeadlines(loadHeadlinesForTradeDate(journalDate));

    void (async () => {
      const migrated = await migrateLegacyHeadlinesToTradeDate(journalDate);
      if (migrated) {
        skipNextSaveRef.current = true;
        setHeadlines(migrated);
      }
    })();
  }, [journalDate]);

  useEffect(() => {
    const handleHydrated = () => {
      skipNextSaveRef.current = true;
      setHeadlines(loadHeadlinesForTradeDate(journalDate));
    };

    window.addEventListener(SYNC_HYDRATED_EVENT, handleHydrated);
    return () => window.removeEventListener(SYNC_HYDRATED_EVENT, handleHydrated);
  }, [journalDate]);

  const activeHeadlines = useMemo(() => {
    return headlines
      .filter((headline) => headline.active)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [headlines]);

  const handleStartAdd = () => {
    setEditingId(null);
    setDraft(createEmptyDraft());
    setIsAdding(true);
  };

  const handleCancel = () => {
    setIsAdding(false);
    setEditingId(null);
    setDraft(createEmptyDraft());
    setIsCategoryDrawerOpen(false);
    setCategorySearch("");
    setIsTickerDrawerOpen(false);
    setTickerSearch("");
  };

  const handleStartEdit = (headline: HeadlineItem) => {
    setIsAdding(false);
    setEditingId(headline.id);
    setDraft({
      title: headline.title,
      source: headline.source,
      url: headline.url,
      tickers: parseTickerList(headline.ticker),
      active: headline.active
    });
  };

  const handleSaveNew = () => {
    const title = draft.title.trim();
    const normalizedUrl = normalizeHeadlineUrl(draft.url);
    if (!title || !normalizedUrl) {
      return;
    }

    const now = new Date().toISOString();
    const next: HeadlineItem = {
      id: createId(),
      journalDate,
      title,
      source: normalizeSource(draft.source),
      url: normalizedUrl,
      ticker: formatTickerList(draft.tickers) || undefined,
      active: draft.active,
      createdAt: now,
      updatedAt: now
    };

    setHeadlines((current) => [next, ...current]);
    handleCancel();
  };

  const handleSaveEdit = () => {
    if (!editingId) {
      return;
    }

    const title = draft.title.trim();
    const normalizedUrl = normalizeHeadlineUrl(draft.url);
    if (!title || !normalizedUrl) {
      return;
    }

    const now = new Date().toISOString();
    setHeadlines((current) =>
      current.map((headline) =>
        headline.id === editingId
          ? {
              ...headline,
              title,
              source: normalizeSource(draft.source),
              url: normalizedUrl,
              ticker: formatTickerList(draft.tickers) || undefined,
              active: draft.active,
              updatedAt: now
            }
          : headline
      )
    );

    handleCancel();
  };

  const handleDelete = (headline: HeadlineItem) => {
    const confirmed = window.confirm(`Delete headline "${headline.title}"?`);
    if (!confirmed) {
      return;
    }

    setHeadlines((current) => current.filter((item) => item.id !== headline.id));
    if (editingId === headline.id) {
      handleCancel();
    }
  };

  const showValidationHint = Boolean(draft.url.trim() && !normalizeHeadlineUrl(draft.url));
  const categoryLabel = normalizeSource(draft.source);

  const tickerOptions = useMemo(() => {
    const fromHeadlines = headlines.flatMap((headline) => parseTickerList(headline.ticker));
    const merged = [...tickerOptionsBase, ...fromHeadlines];

    const seen = new Set<string>();
    const output: string[] = [];
    for (const value of merged) {
      const normalized = value.trim().toUpperCase();
      if (!normalized) {
        continue;
      }

      const key = normalized.toLowerCase();
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      output.push(normalized);
    }

    return output.sort((a, b) => a.localeCompare(b));
  }, [headlines, tickerOptionsBase]);

  return (
    <section className={`headline-bar ${className}`.trim()} aria-label="Headlines bar">
      <header className="headline-bar-header">
        <div className="headline-bar-title">
          <div className="headline-bar-title-row">
            <strong>Headlines</strong>
            <span className="headline-count">{activeHeadlines.length} active</span>
          </div>
          <span className="headline-bar-subtitle">Quick links to keep news context close to your journal.</span>
        </div>
        <div className="headline-bar-actions">
          {!isAdding && !editingId ? (
            <button type="button" className="mini-action headline-mini-action" onClick={handleStartAdd}>
              + Add
            </button>
          ) : null}
        </div>
      </header>

      {(isAdding || editingId) && (
        <form
          className="headline-editor"
          aria-label={isAdding ? "Add headline" : "Edit headline"}
          onSubmit={(event) => {
            event.preventDefault();
            if (isAdding) {
              handleSaveNew();
              return;
            }

            handleSaveEdit();
          }}
        >
          <div className="headline-editor-grid">
            <label className="headline-editor-field">
              <span>Title</span>
              <input
                className="headline-input"
                value={draft.title}
                onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
                placeholder="Headline title"
              />
            </label>
            <label className="headline-editor-field">
              <span>Category</span>
              <button
                type="button"
                className="headline-input headline-select"
                onClick={() => {
                  setCategorySearch("");
                  setIsCategoryDrawerOpen(true);
                }}
                title="Choose category"
              >
                {categoryLabel}
              </button>
            </label>
            <label className="headline-editor-field headline-editor-field-wide">
              <span>Link</span>
              <input
                className={`headline-input ${showValidationHint ? "headline-input-invalid" : ""}`.trim()}
                value={draft.url}
                onChange={(event) => setDraft((current) => ({ ...current, url: event.target.value }))}
                placeholder="https://..."
              />
            </label>
            <label className="headline-editor-field">
              <span>Tickers</span>
              <button
                type="button"
                className="headline-input headline-select headline-ticker-select"
                onClick={() => {
                  setTickerSearch("");
                  setIsTickerDrawerOpen(true);
                }}
                title="Choose tickers"
              >
                {draft.tickers.length === 0 ? (
                  <span className="headline-ticker-placeholder">Select tickers…</span>
                ) : (
                  <span className="headline-ticker-pills" aria-label={`Selected tickers: ${draft.tickers.join(", ")}`}>
                    {draft.tickers.map((ticker) => {
                      const tickerIcon = getTickerIcon(ticker);
                      const tickerSector = getTickerSector(ticker);

                      return (
                        <span key={ticker} className="symbol-pill headline-symbol-pill">
                          {tickerIcon ? (
                            <img
                              src={tickerIcon}
                              alt={tickerSector ? `${tickerSector} sector icon` : `${ticker} ticker icon`}
                              className="symbol-pill-icon"
                            />
                          ) : (
                            <WorkspaceIcon icon="trades" alt={`${ticker} ticker icon`} className="symbol-pill-icon" />
                          )}
                          {ticker}
                        </span>
                      );
                    })}
                  </span>
                )}
              </button>
            </label>
            <label className="headline-editor-toggle">
              <input
                type="checkbox"
                checked={draft.active}
                onChange={(event) => setDraft((current) => ({ ...current, active: event.target.checked }))}
              />
              Active
            </label>
          </div>
          <div className="headline-editor-actions">
            {showValidationHint ? (
              <span className="headline-editor-hint">Use a valid http(s) link (local file paths are rejected).</span>
            ) : (
              <span className="headline-editor-hint headline-editor-hint-neutral">
                Tip: paste a normal article link, not a view-source or cached file.
              </span>
            )}
            <div className="headline-editor-buttons">
              <button type="button" className="mini-action mini-action-soft headline-mini-action" onClick={handleCancel}>
                Cancel
              </button>
              <button
                type="submit"
                className="mini-action headline-mini-action headline-open-action"
                disabled={!draft.title.trim() || !draft.url.trim() || showValidationHint}
              >
                Save
              </button>
            </div>
          </div>
        </form>
      )}

      {activeHeadlines.length === 0 ? (
        <div className="headline-empty">
          <div className="headline-empty-text">
            <strong>No headlines yet.</strong>
            <span>Add quick links for the main news items that shaped today’s tape.</span>
          </div>
          <button type="button" className="mini-action headline-mini-action headline-open-action" onClick={handleStartAdd}>
            + Add headline
          </button>
        </div>
      ) : (
        <div className="headline-grid" role="list" aria-label="Headline cards">
          {activeHeadlines.map((headline) => {
            const isEditing = editingId === headline.id;
            const isActionLocked = isAdding || Boolean(editingId && !isEditing);
            const canOpen = canOpenExternalUrl(headline.url);
            const updatedLabel = formatHeadlineTimestamp(headline.updatedAt);

            return (
              <article
                key={headline.id}
                className={`headline-card${isEditing ? " headline-card-editing" : ""}`}
                aria-label={`Headline: ${headline.title}`}
                role="listitem"
              >
                <div className="headline-card-top">
                  <div className="headline-card-tags">
                    {parseTickerList(headline.ticker).map((ticker) => {
                      const tickerIcon = getTickerIcon(ticker);
                      const tickerSector = getTickerSector(ticker);

                      return (
                        <span key={`${headline.id}-${ticker}`} className="symbol-pill headline-symbol-pill headline-card-ticker">
                          {tickerIcon ? (
                            <img
                              src={tickerIcon}
                              alt={tickerSector ? `${tickerSector} sector icon` : `${ticker} ticker icon`}
                              className="symbol-pill-icon"
                            />
                          ) : (
                            <WorkspaceIcon icon="trades" alt={`${ticker} ticker icon`} className="symbol-pill-icon" />
                          )}
                          {ticker}
                        </span>
                      );
                    })}
                    <span className="headline-source">{headline.source}</span>
                  </div>
                  {updatedLabel ? (
                    <span className="headline-meta" title={`Last updated: ${updatedLabel}`}>
                      {updatedLabel}
                    </span>
                  ) : (
                    <span />
                  )}
                </div>

                <div className="headline-title" title={headline.title}>
                  {headline.title}
                </div>

                <div className="headline-card-bottom">
                  <button
                    type="button"
                    className="mini-action headline-mini-action headline-open-action"
                    onClick={() => void openExternalUrl(headline.url)}
                    disabled={!canOpen || isActionLocked}
                    title={!canOpen ? "Invalid link. Edit the headline to fix it." : "Open article"}
                  >
                    Open
                  </button>

                  <div className="headline-card-controls">
                    <button
                      type="button"
                      className="mini-action mini-action-soft headline-mini-action"
                      onClick={() => handleStartEdit(headline)}
                      disabled={isActionLocked}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="mini-action mini-action-soft headline-mini-action headline-delete-action"
                      onClick={() => handleDelete(headline)}
                      disabled={isActionLocked}
                      title="Delete headline"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <TagDrawer
        isOpen={isCategoryDrawerOpen}
        title="Headline - Category"
        options={categoryOptions}
        selectionMode="single"
        currentValue={categoryLabel}
        searchValue={categorySearch}
        onSearchChange={setCategorySearch}
        onSelect={(value) => {
          const nextValue = typeof value === "string" ? value : "General";
          setDraft((current) => ({ ...current, source: nextValue }));
          setIsCategoryDrawerOpen(false);
          setCategorySearch("");
        }}
        onCreateOption={(value) => {
          const normalized = addCategoryOption(value);
          if (!normalized) {
            return;
          }

          setDraft((current) => ({ ...current, source: normalized }));
          setIsCategoryDrawerOpen(false);
          setCategorySearch("");
        }}
        onClose={() => {
          setIsCategoryDrawerOpen(false);
          setCategorySearch("");
        }}
      />

      <TagDrawer
        isOpen={isTickerDrawerOpen}
        title="Headline - Tickers"
        options={tickerOptions}
        selectionMode="multi"
        currentValues={draft.tickers}
        allowClear
        clearLabel="Clear tickers"
        searchValue={tickerSearch}
        onSearchChange={(value) => setTickerSearch(value.toUpperCase())}
        onSelect={(value) => {
          const next = Array.isArray(value) ? value.map((item) => item.trim().toUpperCase()).filter(Boolean) : [];
          setDraft((current) => ({ ...current, tickers: parseTickerList(next.join(", ")) }));
        }}
        onCreateOption={(value) => {
          const parsed = parseTickerList(value);
          if (parsed.length === 0) {
            return;
          }

          const additions = parsed
            .map((ticker) => addTickerOption(ticker))
            .filter((ticker): ticker is string => Boolean(ticker))
            .map((ticker) => ticker.toUpperCase());

          setDraft((current) => {
            const merged = parseTickerList([...current.tickers, ...additions].join(", "));
            return { ...current, tickers: merged };
          });

          setTickerSearch("");
        }}
        onClose={() => {
          setIsTickerDrawerOpen(false);
          setTickerSearch("");
        }}
      />
    </section>
  );
};
