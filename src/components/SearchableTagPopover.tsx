import { useEffect, useMemo, useRef, useState } from "react";

interface SearchableTagPopoverProps {
  anchorRect: DOMRect;
  title: string;
  options: string[];
  currentValue: string;
  allowClear?: boolean;
  clearLabel?: string;
  onSelect: (value: string | null) => void;
  onCreateOption?: (value: string) => void;
  onClose: () => void;
}

export const SearchableTagPopover = ({
  anchorRect,
  title,
  options,
  currentValue,
  allowClear = false,
  clearLabel = "Clear value",
  onSelect,
  onCreateOption,
  onClose
}: SearchableTagPopoverProps) => {
  const [query, setQuery] = useState("");
  const popoverRef = useRef<HTMLDivElement | null>(null);

  const getToneIndex = (value: string): number =>
    value.split("").reduce((sum, character) => sum + character.charCodeAt(0), 0) % 6;

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!popoverRef.current?.contains(event.target as Node)) {
        onClose();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  const filteredOptions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return options;
    }

    return options.filter((option) => option.toLowerCase().includes(normalizedQuery));
  }, [options, query]);

  const normalizedQuery = query.trim();
  const canCreateOption =
    Boolean(onCreateOption) &&
    normalizedQuery.length > 0 &&
    !options.some((option) => option.toLowerCase() === normalizedQuery.toLowerCase());

  const left = Math.min(anchorRect.left, Math.max(window.innerWidth - 320, 12));
  const top = Math.min(anchorRect.bottom + 8, Math.max(window.innerHeight - 360, 12));

  return (
    <div
      ref={popoverRef}
      className="tag-popover"
      style={{ top, left }}
      role="dialog"
      aria-label={title}
    >
      <div className="tag-popover-header">
        <strong>{title}</strong>
        <button type="button" className="mini-action" onClick={onClose}>
          Close
        </button>
      </div>
      <input
        autoFocus
        className="tag-popover-search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search for an option..."
      />
      <span className="tag-popover-subtitle">Select an option or add a new one to this list.</span>
      {allowClear ? (
        <button
          type="button"
          className={`tag-option-button tag-option-clear ${currentValue ? "tag-option-selected" : ""}`}
          onClick={() => onSelect(null)}
        >
          {clearLabel}
        </button>
      ) : null}
      {canCreateOption ? (
        <button
          type="button"
          className="tag-option-button tag-option-create"
          onClick={() => onCreateOption?.(normalizedQuery)}
        >
          Add "{normalizedQuery}" to list
        </button>
      ) : null}
      <div className="tag-popover-options">
        {filteredOptions.length > 0 ? (
          filteredOptions.map((option) => (
            <button
              key={option}
              type="button"
              className={`tag-option-button ${option === currentValue ? "tag-option-selected" : ""}`}
              onClick={() => onSelect(option)}
            >
              <span className={`tag-option-pill tag-option-pill-${getToneIndex(option)}`}>{option}</span>
            </button>
          ))
        ) : (
          <div className="empty-inline-state">
            {canCreateOption ? "No matching tags yet." : "No matching tags."}
          </div>
        )}
      </div>
    </div>
  );
};
