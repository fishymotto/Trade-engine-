import { useEffect, useMemo, useState } from "react";
import type { HeadlineItem } from "../../../types/headline";
import { loadHeadlines, saveHeadlines } from "../../../lib/headlines/headlineStore";
import { openExternalUrl } from "../../../lib/links/openExternalUrl";

interface HeadlinesBarProps {
  className?: string;
}

type HeadlineDraft = {
  title: string;
  source: string;
  url: string;
  ticker: string;
  active: boolean;
};

const createEmptyDraft = (): HeadlineDraft => ({
  title: "",
  source: "",
  url: "",
  ticker: "",
  active: true
});

const createId = (): string => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `headline_${Date.now()}_${Math.random().toString(16).slice(2)}`;
};

const normalizeSource = (value: string): string => value.trim() || "General";

const isProbablyValidUrl = (value: string): boolean => {
  try {
    // eslint-disable-next-line no-new
    new URL(value);
    return true;
  } catch {
    return false;
  }
};

export const HeadlinesBar = ({ className = "" }: HeadlinesBarProps) => {
  const [headlines, setHeadlines] = useState<HeadlineItem[]>(() => loadHeadlines());
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<HeadlineDraft>(() => createEmptyDraft());

  useEffect(() => {
    saveHeadlines(headlines);
  }, [headlines]);

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
  };

  const handleStartEdit = (headline: HeadlineItem) => {
    setIsAdding(false);
    setEditingId(headline.id);
    setDraft({
      title: headline.title,
      source: headline.source,
      url: headline.url,
      ticker: headline.ticker ?? "",
      active: headline.active
    });
  };

  const handleSaveNew = () => {
    const title = draft.title.trim();
    const url = draft.url.trim();
    if (!title || !url) {
      return;
    }

    if (!isProbablyValidUrl(url)) {
      return;
    }

    const now = new Date().toISOString();
    const next: HeadlineItem = {
      id: createId(),
      title,
      source: normalizeSource(draft.source),
      url,
      ticker: draft.ticker.trim() || undefined,
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
    const url = draft.url.trim();
    if (!title || !url) {
      return;
    }

    if (!isProbablyValidUrl(url)) {
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
              url,
              ticker: draft.ticker.trim() || undefined,
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

  const showValidationHint = (draft.url.trim() && !isProbablyValidUrl(draft.url.trim())) || false;

  return (
    <section className={`headline-bar ${className}`.trim()} aria-label="Headlines bar">
      <div className="headline-bar-header">
        <div className="headline-bar-title">
          <strong>Headlines</strong>
          <span>{activeHeadlines.length} active</span>
        </div>
        <div className="headline-bar-actions">
          {!isAdding && !editingId ? (
            <button type="button" className="mini-action headline-mini-action" onClick={handleStartAdd}>
              + Add
            </button>
          ) : (
            <button type="button" className="mini-action mini-action-soft headline-mini-action" onClick={handleCancel}>
              Cancel
            </button>
          )}
        </div>
      </div>

      <div className="headline-bar-scroll" role="region" aria-label="Headline cards" tabIndex={0}>
        {(isAdding || editingId) && (
          <article className="headline-card headline-card-edit" aria-label={isAdding ? "Add headline" : "Edit headline"}>
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
                <span>Source</span>
                <input
                  className="headline-input"
                  value={draft.source}
                  onChange={(event) => setDraft((current) => ({ ...current, source: event.target.value }))}
                  placeholder="Reuters, TradingView, Macro..."
                />
              </label>
              <label className="headline-editor-field">
                <span>Link</span>
                <input
                  className={`headline-input ${showValidationHint ? "headline-input-invalid" : ""}`.trim()}
                  value={draft.url}
                  onChange={(event) => setDraft((current) => ({ ...current, url: event.target.value }))}
                  placeholder="https://..."
                />
              </label>
              <label className="headline-editor-field">
                <span>Ticker</span>
                <input
                  className="headline-input"
                  value={draft.ticker}
                  onChange={(event) => setDraft((current) => ({ ...current, ticker: event.target.value.toUpperCase() }))}
                  placeholder="CVE"
                />
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
              {showValidationHint ? <span className="headline-editor-hint">Enter a valid link.</span> : <span />}
              <button
                type="button"
                className="mini-action headline-mini-action"
                onClick={isAdding ? handleSaveNew : handleSaveEdit}
                disabled={!draft.title.trim() || !draft.url.trim() || showValidationHint}
              >
                Save
              </button>
            </div>
          </article>
        )}

        {activeHeadlines.length === 0 ? (
          <div className="headline-empty">
            <span>No headlines yet.</span>
            <button type="button" className="mini-action mini-action-soft headline-mini-action" onClick={handleStartAdd}>
              Add your first headline
            </button>
          </div>
        ) : (
          activeHeadlines.map((headline) => {
            const isEditing = editingId === headline.id;
            return (
              <article
                key={headline.id}
                className={`headline-card${isEditing ? " headline-card-editing" : ""}`}
                aria-label={`Headline: ${headline.title}`}
              >
                <div className="headline-card-top">
                  {headline.ticker ? <span className="headline-ticker">{headline.ticker}</span> : <span />}
                  <span className="headline-source">{headline.source}</span>
                </div>
                <div className="headline-title" title={headline.title}>
                  {headline.title}
                </div>
                <div className="headline-card-bottom">
                  <button
                    type="button"
                    className="mini-action mini-action-soft headline-mini-action"
                    onClick={() => void openExternalUrl(headline.url)}
                  >
                    Open
                  </button>
                  <div className="headline-card-controls">
                    <button
                      type="button"
                      className="mini-action mini-action-soft headline-mini-action"
                      onClick={() => handleStartEdit(headline)}
                      disabled={isAdding || Boolean(editingId && !isEditing)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="mini-action mini-action-danger headline-mini-action"
                      onClick={() => handleDelete(headline)}
                      disabled={isAdding || Boolean(editingId && !isEditing)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </article>
            );
          })
        )}
      </div>
    </section>
  );
};

