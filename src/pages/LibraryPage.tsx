import { useEffect, useMemo, useState } from "react";
import { JournalRichTextEditor } from "../components/journal/JournalRichTextEditor";
import { PageHero } from "../components/PageHero";
import { WorkspaceIcon } from "../components/WorkspaceIcon";
import { PropertyMultiSelect } from "../components/PropertyMultiSelect";
import {
  createLibraryPage,
  libraryCollections,
  loadLibraryPages,
  saveLibraryPages
} from "../lib/library/libraryStore";
import type { LibraryCollectionId, LibraryPageRecord } from "../types/library";

const statusOptions = ["Active", "Draft", "Review", "Archived"];

const formatUpdatedAt = (value: string): string => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "Just now";
  }

  return parsed.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
};

const parseTags = (value: string): string[] =>
  value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);

const renderPropertyValue = (
  page: LibraryPageRecord,
  propertyName: string,
  fallback = "-"
): string => {
  const value = page.properties?.[propertyName];
  if (Array.isArray(value)) {
    return value.length > 0 ? value.join(", ") : fallback;
  }

  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }

  return value || fallback;
};

const readFileAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }

      reject(new Error("The file could not be read."));
    };
    reader.onerror = () =>
      reject(reader.error ?? new Error("The file could not be read."));
    reader.readAsDataURL(file);
  });

const renderPropertyList = (page: LibraryPageRecord, propertyName: string): string[] => {
  const value = page.properties?.[propertyName];
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  }

  if (typeof value === "string" && value.trim()) {
    return [value.trim()];
  }

  return [];
};

const isBookRow = (page: LibraryPageRecord): boolean => page.tags.includes("book-row");

const getBookPreview = (page: LibraryPageRecord, field: "Review" | "Summary"): string =>
  renderPropertyValue(page, field, "").replace(/<br\s*\/?>/gi, " ").replace(/\*\*/g, "").trim();

const getBookFieldValue = (page: LibraryPageRecord, propertyName: string): string =>
  renderPropertyValue(page, propertyName, "");

export const LibraryPage = () => {
  const [pages, setPages] = useState<LibraryPageRecord[]>(() => loadLibraryPages());
  const [selectedCollectionId, setSelectedCollectionId] =
    useState<LibraryCollectionId>("idea-inbox");
  const [selectedPageId, setSelectedPageId] = useState("");

  const handleImageInsert = async (file: File): Promise<string> => {
    return readFileAsDataUrl(file);
  };

  useEffect(() => {
    saveLibraryPages(pages);
  }, [pages]);

  const selectedCollection = useMemo(
    () =>
      libraryCollections.find((collection) => collection.id === selectedCollectionId) ??
      libraryCollections[0],
    [selectedCollectionId]
  );

  const collectionPages = useMemo(
    () => pages.filter((page) => page.collectionId === selectedCollectionId),
    [pages, selectedCollectionId]
  );

  const isBookClub = selectedCollectionId === "book-club";

  const bookRows = useMemo(
    () => collectionPages.filter(isBookRow),
    [collectionPages]
  );

  const databasePages = useMemo(
    () => (isBookClub && bookRows.length > 0 ? bookRows : collectionPages),
    [bookRows, collectionPages, isBookClub]
  );

  const allGenres = useMemo(
    () =>
      Array.from(
        new Set(
          collectionPages
            .flatMap((page) => renderPropertyList(page, "Genre"))
            .filter(Boolean)
        )
      ).sort(),
    [collectionPages]
  );

  const selectedPage = useMemo(
    () => pages.find((page) => page.id === selectedPageId) ?? databasePages[0] ?? null,
    [databasePages, pages, selectedPageId]
  );

  useEffect(() => {
    if (selectedPage && selectedPage.collectionId === selectedCollectionId) {
      return;
    }

    setSelectedPageId(databasePages[0]?.id ?? "");
  }, [databasePages, selectedCollectionId, selectedPage]);

  const totalTags = useMemo(
    () => new Set(pages.flatMap((page) => page.tags.map((tag) => tag.toLowerCase()))).size,
    [pages]
  );

  const updatePage = (pageId: string, updates: Partial<LibraryPageRecord>) => {
    setPages((current) =>
      current.map((page) =>
        page.id === pageId
          ? {
              ...page,
              ...updates,
              updatedAt: new Date().toISOString()
            }
          : page
      )
    );
  };

  const updatePageProperty = (
    page: LibraryPageRecord,
    propertyName: string,
    value: string | string[]
  ) => {
    updatePage(page.id, {
      properties: {
        ...page.properties,
        [propertyName]: value
      }
    });
  };

  const handleCreatePage = () => {
    const newPage = createLibraryPage(selectedCollectionId);
    setPages((current) => [newPage, ...current]);
    setSelectedPageId(newPage.id);
  };

  const handleDeletePage = (pageId: string) => {
    const targetPage = pages.find((page) => page.id === pageId);
    if (!targetPage) {
      return;
    }

    if (!window.confirm(`Delete "${targetPage.title}" from the library?`)) {
      return;
    }

    setPages((current) => current.filter((page) => page.id !== pageId));
    setSelectedPageId("");
  };

  return (
    <main className="page-shell library-page">
      <PageHero
        eyebrow="Library"
        title="Knowledge Library"
        description="A Notion-style home for books, trading notes, replay reviews, signal mapping, and raw ideas."
      >
        <div className="page-hero-stat-grid">
          <div className="page-hero-stat-card">
            <span>Collections</span>
            <strong>{libraryCollections.length}</strong>
          </div>
          <div className="page-hero-stat-card">
            <span>Pages</span>
            <strong>{pages.length}</strong>
          </div>
          <div className="page-hero-stat-card">
            <span>Tags</span>
            <strong>{totalTags}</strong>
          </div>
          <div className="page-hero-stat-card">
            <span>Current View</span>
            <strong>{selectedCollection.name}</strong>
          </div>
        </div>
      </PageHero>

      <section className="library-layout">
        <aside className="library-collection-panel">
          <div className="panel-header">
            <WorkspaceIcon icon="library" alt="Library collections icon" className="panel-header-icon" />
            <h2>Collections</h2>
          </div>
          <div className="library-collection-list">
            {libraryCollections.map((collection) => {
              const collectionCount = pages.filter((page) => page.collectionId === collection.id).length;
              return (
                <button
                  key={collection.id}
                  type="button"
                  className={`library-collection-button${
                    collection.id === selectedCollectionId ? " library-collection-button-active" : ""
                  }`}
                  onClick={() => {
                    setSelectedCollectionId(collection.id);
                    setSelectedPageId("");
                  }}
                >
                  <span>{collection.accent}</span>
                  <strong>{collection.name}</strong>
                  <small>{collectionCount} page{collectionCount === 1 ? "" : "s"}</small>
                </button>
              );
            })}
          </div>
        </aside>

        <section className="library-database-panel">
          <div className="library-database-header">
            <div>
              <span className="page-eyebrow">{selectedCollection.accent}</span>
              <h2>{selectedCollection.name}</h2>
              <p>{selectedCollection.description}</p>
            </div>
            <button className="button button-primary" type="button" onClick={handleCreatePage}>
              New Page
            </button>
          </div>

          {isBookClub && bookRows.length > 0 ? (
            <div className="library-table-wrap library-book-table-wrap" aria-label="Trading and Poker Books database">
              <div className="library-book-table-title">
                <WorkspaceIcon icon="library" alt="" className="panel-header-icon" />
                <div>
                  <h3>Trading and Poker Books</h3>
                  <span>{bookRows.length} imported book rows</span>
                </div>
              </div>
              <table className="library-table library-book-table">
                <thead>
                  <tr>
                    <th>Book Name</th>
                    <th>Author</th>
                    <th>Reading Status</th>
                    <th>Rating</th>
                    <th>Genre</th>
                    <th>Review</th>
                    <th>Summary</th>
                  </tr>
                </thead>
                <tbody>
                  {bookRows.map((page) => {
                    const review = getBookPreview(page, "Review");
                    const summary = getBookPreview(page, "Summary");
                    return (
                      <tr
                        key={page.id}
                        className={selectedPage?.id === page.id ? "library-table-row-active" : ""}
                        onClick={() => setSelectedPageId(page.id)}
                      >
                        <td>
                          <button
                            type="button"
                            className="library-table-title library-book-title"
                            onClick={() => setSelectedPageId(page.id)}
                          >
                            <span className="library-book-icon" aria-hidden="true" />
                            {page.title}
                          </button>
                        </td>
                        <td>{renderPropertyValue(page, "Author", "")}</td>
                        <td>
                          <span className="library-status-pill">
                            {renderPropertyValue(page, "Reading Status", page.status)}
                          </span>
                        </td>
                        <td>
                          {renderPropertyValue(page, "Rating", "") ? (
                            <span className="library-rating-pill">{renderPropertyValue(page, "Rating")}</span>
                          ) : null}
                        </td>
                        <td>
                          <div className="library-genre-list">
                            {renderPropertyList(page, "Genre").slice(0, 4).map((genre) => (
                              <span key={genre}>{genre}</span>
                            ))}
                          </div>
                        </td>
                        <td className="library-book-preview">{review || "Add review notes"}</td>
                        <td className="library-book-preview">{summary || "Add summary notes"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="library-table-wrap" aria-label={`${selectedCollection.name} database view`}>
              <table className="library-table">
                <thead>
                  <tr>
                    <th>Page</th>
                    <th>Status</th>
                    <th>Author</th>
                    <th>Rating</th>
                    <th>Tags</th>
                    <th>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {databasePages.length > 0 ? (
                    databasePages.map((page) => (
                      <tr
                        key={page.id}
                        className={selectedPage?.id === page.id ? "library-table-row-active" : ""}
                        onClick={() => setSelectedPageId(page.id)}
                      >
                        <td>
                          <button
                            type="button"
                            className="library-table-title"
                            onClick={() => setSelectedPageId(page.id)}
                          >
                            {page.title}
                          </button>
                        </td>
                        <td>{renderPropertyValue(page, "Reading Status", page.status)}</td>
                        <td>{renderPropertyValue(page, "Author")}</td>
                        <td>{renderPropertyValue(page, "Rating")}</td>
                        <td>{page.tags.slice(0, 3).join(", ") || "-"}</td>
                        <td>{formatUpdatedAt(page.updatedAt)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={6}>No pages yet. Create the first page in this collection.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {!isBookClub ? (
            <div className="library-page-grid" aria-label={`${selectedCollection.name} cards`}>
              {collectionPages.length > 0 ? (
              collectionPages.map((page) => (
                <button
                  key={page.id}
                  type="button"
                  className={`library-page-card${
                    selectedPage?.id === page.id ? " library-page-card-active" : ""
                  }`}
                  onClick={() => setSelectedPageId(page.id)}
                >
                  <div className="library-page-card-topline">
                    <strong>{page.title}</strong>
                    <span>{page.status}</span>
                  </div>
                  <p>Updated {formatUpdatedAt(page.updatedAt)}</p>
                  <div className="library-page-tags">
                    {page.tags.length > 0 ? (
                      page.tags.slice(0, 4).map((tag) => <span key={tag}>{tag}</span>)
                    ) : (
                      <span>No tags</span>
                    )}
                  </div>
                </button>
              ))
            ) : (
              <div className="library-empty-state">
                <strong>No pages yet</strong>
                <span>Create the first page in {selectedCollection.name}.</span>
              </div>
              )}
            </div>
          ) : null}
        </section>
      </section>

      {selectedPage ? (
        <section className={`library-detail-card${isBookClub && isBookRow(selectedPage) ? " library-open-page-card" : ""}`}>
          <div className="library-detail-header">
            <div className="library-title-stack">
              <span className="page-eyebrow">
                {isBookClub && isBookRow(selectedPage) ? "Open Book Page" : selectedCollection.name}
              </span>
              <input
                className="library-title-input"
                value={selectedPage.title}
                onChange={(event) => updatePage(selectedPage.id, { title: event.target.value })}
                placeholder="Untitled"
              />
            </div>
            <button
              type="button"
              className="button button-danger"
              onClick={() => handleDeletePage(selectedPage.id)}
            >
              Delete Page
            </button>
          </div>

          {isBookClub && isBookRow(selectedPage) ? (
            <>
              <div className="library-open-page-properties">
                <label className="library-open-page-property">
                  <span>Author</span>
                  <input
                    value={getBookFieldValue(selectedPage, "Author")}
                    onChange={(event) => updatePageProperty(selectedPage, "Author", event.target.value)}
                    placeholder="Author"
                  />
                </label>
                <label className="library-open-page-property">
                  <span>Status</span>
                  <select
                    value={getBookFieldValue(selectedPage, "Reading Status") || selectedPage.status}
                    onChange={(event) => updatePageProperty(selectedPage, "Reading Status", event.target.value)}
                  >
                    {["To Read", "In Progress", "Completed", "Abandoned", "Imported"].map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="library-open-page-property">
                  <span>Rating</span>
                  <input
                    value={getBookFieldValue(selectedPage, "Rating")}
                    onChange={(event) => updatePageProperty(selectedPage, "Rating", event.target.value)}
                    placeholder="Optional rating"
                  />
                </label>
                <PropertyMultiSelect
                  label="Genres"
                  values={renderPropertyList(selectedPage, "Genre")}
                  onChange={(genres) => updatePageProperty(selectedPage, "Genre", genres)}
                  predefinedOptions={allGenres}
                  placeholder="Add genre"
                  allowCustom
                />
                <label className="library-open-page-property library-open-page-property-wide">
                  <span>Source URL</span>
                  <input
                    value={selectedPage.sourceUrl}
                    onChange={(event) => updatePage(selectedPage.id, { sourceUrl: event.target.value })}
                    placeholder="Paste source, video, article, or Notion link"
                  />
                </label>
              </div>

              <div className="library-open-page-section-grid">
                <label className="library-open-page-note">
                  <span>Review</span>
                  <textarea
                    value={getBookFieldValue(selectedPage, "Review")}
                    onChange={(event) => updatePageProperty(selectedPage, "Review", event.target.value)}
                    placeholder="What stood out, what mattered, and how it applies to trading."
                  />
                </label>
                <label className="library-open-page-note">
                  <span>Summary</span>
                  <textarea
                    value={getBookFieldValue(selectedPage, "Summary")}
                    onChange={(event) => updatePageProperty(selectedPage, "Summary", event.target.value)}
                    placeholder="Key ideas, takeaways, and notes from the book."
                  />
                </label>
              </div>

              <div className="library-open-page-editor-block">
                <div className="library-open-page-editor-heading">
                  <span>Page Notes</span>
                  <small>Use this like your Notion page body.</small>
                </div>
                <JournalRichTextEditor
                  content={selectedPage.content}
                  onChange={(content) => updatePage(selectedPage.id, { content })}
                  onImageInsert={handleImageInsert}
                  placeholder="Type '/' for commands"
                />
              </div>
            </>
          ) : (
            <>
              <div className="library-property-grid">
                <label>
                  <span>Status</span>
                  <select
                    value={selectedPage.status}
                    onChange={(event) => updatePage(selectedPage.id, { status: event.target.value })}
                  >
                    {statusOptions.map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Tags</span>
                  <input
                    value={selectedPage.tags.join(", ")}
                    onChange={(event) => updatePage(selectedPage.id, { tags: parseTags(event.target.value) })}
                    placeholder="mental-game, replay, lesson"
                  />
                </label>
                <label>
                  <span>Source URL</span>
                  <input
                    value={selectedPage.sourceUrl}
                    onChange={(event) => updatePage(selectedPage.id, { sourceUrl: event.target.value })}
                    placeholder="Paste source, video, article, or Notion link"
                  />
                </label>
                <label>
                  <span>Author / Owner</span>
                  <input
                    value={renderPropertyValue(selectedPage, "Author", "")}
                    onChange={(event) => updatePageProperty(selectedPage, "Author", event.target.value)}
                    placeholder="Author, creator, or owner"
                  />
                </label>
                <label>
                  <span>Rating</span>
                  <input
                    value={renderPropertyValue(selectedPage, "Rating", "")}
                    onChange={(event) => updatePageProperty(selectedPage, "Rating", event.target.value)}
                    placeholder="Optional rating"
                  />
                </label>
              </div>

              <JournalRichTextEditor
                content={selectedPage.content}
                onChange={(content) => updatePage(selectedPage.id, { content })}
                onImageInsert={handleImageInsert}
                placeholder="Type '/' for commands"
              />
            </>
          )}
        </section>
      ) : null}
    </main>
  );
};
