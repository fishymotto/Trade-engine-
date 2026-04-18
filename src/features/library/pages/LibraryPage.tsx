import { useEffect, useMemo, useState } from "react";
import { JournalRichTextEditor } from "../../journal/components/JournalRichTextEditor";
import { PageHero } from "../../../components/PageHero";
import { WorkspaceIcon } from "../../../components/WorkspaceIcon";
import { PropertyMultiSelect } from "../../../components/PropertyMultiSelect";
import { FilterSelect } from "../../../components/FilterSelect";
import { TagDrawer } from "../../../components/TagDrawer";
import {
  createLibraryBookRow,
  createLibraryPage,
  libraryCollections,
  loadLibraryPages,
  saveLibraryPages
} from "../../../lib/library/libraryStore";
import type { LibraryCollectionId, LibraryPageRecord } from "../../../types/library";

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

const bookReadingStatusOptions = ["To Read", "In Progress", "Completed", "Abandoned", "Imported"];

const getBookFieldValue = (page: LibraryPageRecord, propertyName: string): string =>
  renderPropertyValue(page, propertyName, "");

const getReadingStatusToneClass = (value: string): string => {
  switch (value) {
    case "Completed":
      return "library-status-pill-completed";
    case "In Progress":
      return "library-status-pill-progress";
    case "Abandoned":
      return "library-status-pill-abandoned";
    case "To Read":
      return "library-status-pill-toread";
    default:
      return "";
  }
};

type BookCellEditorState = {
  pageId: string;
  field: "Reading Status" | "Genre";
};

type BookSortKey = "title" | "author" | "rating" | "readingStatus";

type BookSortConfig = {
  key: BookSortKey;
  direction: "asc" | "desc";
};

const toggleSortDirection = (direction: "asc" | "desc") => (direction === "asc" ? "desc" : "asc");

const normalizeForSearch = (value: string): string => value.trim().toLowerCase();

const ratingSortValue = (value: string): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : -Infinity;
};

export const LibraryPage = () => {
  const [pages, setPages] = useState<LibraryPageRecord[]>(() => loadLibraryPages());
  const [selectedCollectionId, setSelectedCollectionId] =
    useState<LibraryCollectionId>("idea-inbox");
  const [selectedPageId, setSelectedPageId] = useState("");
  const [bookSearchQuery, setBookSearchQuery] = useState("");
  const [bookStatusFilter, setBookStatusFilter] = useState("");
  const [bookGenreFilter, setBookGenreFilter] = useState<string[]>([]);
  const [bookSortConfig, setBookSortConfig] = useState<BookSortConfig>({
    key: "title",
    direction: "asc"
  });
  const [bookCellEditor, setBookCellEditor] = useState<BookCellEditorState | null>(null);
  const [bookCellEditorSearchQuery, setBookCellEditorSearchQuery] = useState("");
  const [isBookGenreFilterOpen, setIsBookGenreFilterOpen] = useState(false);
  const [bookGenreFilterSearchQuery, setBookGenreFilterSearchQuery] = useState("");

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

  const bookStatusFilterOptions = useMemo(
    () => [
      { label: "All statuses", value: "" },
      ...bookReadingStatusOptions.map((status) => ({ label: status, value: status }))
    ],
    []
  );

  const filteredBookRows = useMemo(() => {
    const normalizedQuery = normalizeForSearch(bookSearchQuery);

    const filtered = bookRows.filter((page) => {
      if (normalizedQuery) {
        const matchesTitle = normalizeForSearch(page.title).includes(normalizedQuery);
        const matchesAuthor = normalizeForSearch(getBookFieldValue(page, "Author")).includes(normalizedQuery);
        if (!matchesTitle && !matchesAuthor) {
          return false;
        }
      }

      if (bookStatusFilter) {
        const statusValue = getBookFieldValue(page, "Reading Status") || page.status;
        if (statusValue !== bookStatusFilter) {
          return false;
        }
      }

      if (bookGenreFilter.length > 0) {
        const genres = renderPropertyList(page, "Genre");
        const hasAnyGenre = bookGenreFilter.some((genre) => genres.includes(genre));
        if (!hasAnyGenre) {
          return false;
        }
      }

      return true;
    });

    const sorted = [...filtered].sort((left, right) => {
      const directionMultiplier = bookSortConfig.direction === "asc" ? 1 : -1;

      const compareStrings = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base" });
      const compareNumbers = (a: number, b: number) => (a === b ? 0 : a > b ? 1 : -1);

      switch (bookSortConfig.key) {
        case "title":
          return directionMultiplier * compareStrings(left.title, right.title);
        case "author":
          return (
            directionMultiplier *
            compareStrings(getBookFieldValue(left, "Author"), getBookFieldValue(right, "Author"))
          );
        case "readingStatus":
          return (
            directionMultiplier *
            compareStrings(getBookFieldValue(left, "Reading Status"), getBookFieldValue(right, "Reading Status"))
          );
        case "rating":
          return (
            directionMultiplier *
            compareNumbers(ratingSortValue(getBookFieldValue(left, "Rating")), ratingSortValue(getBookFieldValue(right, "Rating")))
          );
        default:
          return 0;
      }
    });

    return sorted;
  }, [bookGenreFilter, bookRows, bookSearchQuery, bookSortConfig, bookStatusFilter]);

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

  const bookCellEditorPage = useMemo(() => {
    if (!bookCellEditor) {
      return null;
    }

    return pages.find((page) => page.id === bookCellEditor.pageId) ?? null;
  }, [bookCellEditor, pages]);

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

  const handleCreateBookRow = () => {
    const newPage = createLibraryBookRow();
    setPages((current) => [newPage, ...current]);
    setSelectedPageId(newPage.id);
    setBookSearchQuery("");
    setBookStatusFilter("");
    setBookGenreFilter([]);
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

  const toggleBookSort = (key: BookSortKey) => {
    setBookSortConfig((current) => {
      if (current.key === key) {
        return { key, direction: toggleSortDirection(current.direction) };
      }

      return { key, direction: key === "rating" ? "desc" : "asc" };
    });
  };

  const getBookValidation = (page: LibraryPageRecord) => {
    const titleInvalid = page.title.trim().length === 0;
    const authorInvalid = getBookFieldValue(page, "Author").trim().length === 0;
    const ratingValue = getBookFieldValue(page, "Rating").trim();
    const ratingNumber = ratingValue ? Number(ratingValue) : NaN;
    const ratingInvalid =
      Boolean(ratingValue) &&
      (!Number.isFinite(ratingNumber) || !Number.isInteger(ratingNumber) || ratingNumber < 1 || ratingNumber > 5);

    return { titleInvalid, authorInvalid, ratingInvalid };
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
                    setBookSearchQuery("");
                    setBookStatusFilter("");
                    setBookGenreFilter([]);
                    setBookCellEditor(null);
                    setBookCellEditorSearchQuery("");
                    setIsBookGenreFilterOpen(false);
                    setBookGenreFilterSearchQuery("");
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
                  <span>
                    {filteredBookRows.length}
                    {bookSearchQuery.trim() || bookStatusFilter || bookGenreFilter.length > 0 ? ` of ${bookRows.length}` : ""}{" "}
                    books
                  </span>
                </div>
              </div>
              <div className="library-book-controls" aria-label="Book database controls">
                <input
                  className="library-book-search"
                  value={bookSearchQuery}
                  onChange={(event) => setBookSearchQuery(event.target.value)}
                  placeholder="Search by book name or author"
                />
                <FilterSelect
                  value={bookStatusFilter}
                  options={bookStatusFilterOptions}
                  ariaLabel="Filter books by reading status"
                  onChange={setBookStatusFilter}
                />
                <button
                  type="button"
                  className={`library-book-genre-trigger${bookGenreFilter.length > 0 ? " library-book-genre-trigger-active" : ""}`}
                  onClick={() => {
                    setIsBookGenreFilterOpen(true);
                    setBookGenreFilterSearchQuery("");
                  }}
                >
                  {bookGenreFilter.length > 0 ? `Genre: ${bookGenreFilter[0]}${bookGenreFilter.length > 1 ? ` +${bookGenreFilter.length - 1}` : ""}` : "Filter genre"}
                </button>
                <button className="button button-primary" type="button" onClick={handleCreateBookRow}>
                  New Book
                </button>
              </div>
              <table className="library-table library-book-table">
                <thead>
                  <tr>
                    <th>
                      <button type="button" className="sortable-header-button" onClick={() => toggleBookSort("title")}>
                        <span>Book Name</span>
                        <span
                          className={`sort-indicator ${bookSortConfig.key === "title" ? "sort-indicator-active" : ""}`}
                        >
                          {bookSortConfig.key === "title" ? bookSortConfig.direction : "sort"}
                        </span>
                      </button>
                    </th>
                    <th>
                      <button type="button" className="sortable-header-button" onClick={() => toggleBookSort("author")}>
                        <span>Author</span>
                        <span
                          className={`sort-indicator ${bookSortConfig.key === "author" ? "sort-indicator-active" : ""}`}
                        >
                          {bookSortConfig.key === "author" ? bookSortConfig.direction : "sort"}
                        </span>
                      </button>
                    </th>
                    <th>
                      <button
                        type="button"
                        className="sortable-header-button"
                        onClick={() => toggleBookSort("readingStatus")}
                      >
                        <span>Reading Status</span>
                        <span
                          className={`sort-indicator ${bookSortConfig.key === "readingStatus" ? "sort-indicator-active" : ""}`}
                        >
                          {bookSortConfig.key === "readingStatus" ? bookSortConfig.direction : "sort"}
                        </span>
                      </button>
                    </th>
                    <th>
                      <button type="button" className="sortable-header-button" onClick={() => toggleBookSort("rating")}>
                        <span>Rating</span>
                        <span
                          className={`sort-indicator ${bookSortConfig.key === "rating" ? "sort-indicator-active" : ""}`}
                        >
                          {bookSortConfig.key === "rating" ? bookSortConfig.direction : "sort"}
                        </span>
                      </button>
                    </th>
                    <th>Genre</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredBookRows.length > 0 ? (
                    filteredBookRows.map((page) => {
                      const statusValue = getBookFieldValue(page, "Reading Status") || page.status;
                      const genres = renderPropertyList(page, "Genre");
                      const { titleInvalid, authorInvalid, ratingInvalid } = getBookValidation(page);

                      return (
                        <tr
                          key={page.id}
                          className={selectedPage?.id === page.id ? "library-table-row-active" : ""}
                          onClick={() => setSelectedPageId(page.id)}
                        >
                          <td>
                            <div className="library-book-title-cell">
                              <span className="library-book-icon" aria-hidden="true" />
                              <input
                                className={`library-cell-input${titleInvalid ? " library-cell-input-invalid" : ""}`}
                                value={page.title}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setSelectedPageId(page.id);
                                }}
                                onChange={(event) => updatePage(page.id, { title: event.target.value })}
                                placeholder="Book name"
                              />
                            </div>
                          </td>
                          <td>
                            <input
                              className={`library-cell-input${authorInvalid ? " library-cell-input-invalid" : ""}`}
                              value={getBookFieldValue(page, "Author")}
                              onClick={(event) => {
                                event.stopPropagation();
                                setSelectedPageId(page.id);
                              }}
                              onChange={(event) => updatePageProperty(page, "Author", event.target.value)}
                              placeholder="Author"
                            />
                          </td>
                          <td>
                            <button
                              type="button"
                              className={`library-status-pill ${getReadingStatusToneClass(statusValue)}`}
                              onClick={(event) => {
                                event.stopPropagation();
                                setSelectedPageId(page.id);
                                setBookCellEditor({ pageId: page.id, field: "Reading Status" });
                                setBookCellEditorSearchQuery("");
                              }}
                            >
                              {statusValue || "Set status"}
                            </button>
                          </td>
                          <td>
                            <select
                              className={`library-cell-select${ratingInvalid ? " library-cell-select-invalid" : ""}`}
                              value={getBookFieldValue(page, "Rating")}
                              onClick={(event) => {
                                event.stopPropagation();
                                setSelectedPageId(page.id);
                              }}
                              onChange={(event) => updatePageProperty(page, "Rating", event.target.value)}
                            >
                              <option value="">-</option>
                              {[1, 2, 3, 4, 5].map((value) => (
                                <option key={value} value={String(value)}>
                                  {value}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <button
                              type="button"
                              className="library-genre-cell"
                              onClick={(event) => {
                                event.stopPropagation();
                                setSelectedPageId(page.id);
                                setBookCellEditor({ pageId: page.id, field: "Genre" });
                                setBookCellEditorSearchQuery("");
                              }}
                            >
                              <div className="library-genre-list">
                                {genres.length > 0 ? (
                                  <>
                                    {genres.slice(0, 4).map((genre) => (
                                      <span key={genre}>{genre}</span>
                                    ))}
                                    {genres.length > 4 ? (
                                      <span className="library-genre-more">+{genres.length - 4}</span>
                                    ) : null}
                                  </>
                                ) : (
                                  <span className="library-genre-empty">Add genre</span>
                                )}
                              </div>
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={5} className="empty-state">
                        No books match the current filters.
                      </td>
                    </tr>
                  )}
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

              <div className="library-open-page-notes">
                <label className="library-open-page-note">
                  <span>Summary</span>
                  <textarea
                    value={getBookFieldValue(selectedPage, "Summary")}
                    onChange={(event) => updatePageProperty(selectedPage, "Summary", event.target.value)}
                    placeholder="Key ideas, takeaways, and notes from the book."
                  />
                </label>
                <label className="library-open-page-note">
                  <span>Review</span>
                  <textarea
                    value={getBookFieldValue(selectedPage, "Review")}
                    onChange={(event) => updatePageProperty(selectedPage, "Review", event.target.value)}
                    placeholder="What stood out, what mattered, and how it applies to trading."
                  />
                </label>
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
      {bookCellEditor && bookCellEditorPage ? (
        <TagDrawer
          isOpen={!!bookCellEditor}
          title={`${bookCellEditor.field} - ${bookCellEditorPage.title}`}
          options={bookCellEditor.field === "Reading Status" ? bookReadingStatusOptions : allGenres}
          selectionMode={bookCellEditor.field === "Genre" ? "multi" : "single"}
          currentValue={
            bookCellEditor.field === "Reading Status"
              ? getBookFieldValue(bookCellEditorPage, "Reading Status") || bookCellEditorPage.status
              : ""
          }
          currentValues={bookCellEditor.field === "Genre" ? renderPropertyList(bookCellEditorPage, "Genre") : []}
          allowClear={bookCellEditor.field === "Genre"}
          clearLabel={bookCellEditor.field === "Genre" ? "Clear genres" : undefined}
          searchValue={bookCellEditorSearchQuery}
          onSearchChange={setBookCellEditorSearchQuery}
          onSelect={(value) => {
            if (bookCellEditor.field === "Genre") {
              updatePageProperty(bookCellEditorPage, "Genre", Array.isArray(value) ? value : []);
              return;
            }

            if (typeof value === "string") {
              updatePageProperty(bookCellEditorPage, "Reading Status", value);
            }

            setBookCellEditor(null);
            setBookCellEditorSearchQuery("");
          }}
          onCreateOption={
            bookCellEditor.field === "Genre"
              ? (value) => {
                  const current = renderPropertyList(bookCellEditorPage, "Genre");
                  const next = current.includes(value) ? current : [...current, value];
                  updatePageProperty(bookCellEditorPage, "Genre", next);
                }
              : undefined
          }
          onClose={() => {
            setBookCellEditor(null);
            setBookCellEditorSearchQuery("");
          }}
        />
      ) : null}
      {isBookGenreFilterOpen ? (
        <TagDrawer
          isOpen={isBookGenreFilterOpen}
          title="Filter: Genre"
          options={allGenres}
          selectionMode="multi"
          currentValues={bookGenreFilter}
          allowClear
          clearLabel="All genres"
          searchValue={bookGenreFilterSearchQuery}
          onSearchChange={setBookGenreFilterSearchQuery}
          onSelect={(value) => setBookGenreFilter(Array.isArray(value) ? value : [])}
          onClose={() => {
            setIsBookGenreFilterOpen(false);
            setBookGenreFilterSearchQuery("");
          }}
        />
      ) : null}
    </main>
  );
};
