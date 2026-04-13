import { useEffect, useMemo, useRef } from "react";
import { WorkspaceIcon } from "./WorkspaceIcon";

interface TagDrawerProps {
  isOpen: boolean;
  title: string;
  options: string[];
  currentValue: string;
  allowClear?: boolean;
  clearLabel?: string;
  searchValue: string;
  onSearchChange: (value: string) => void;
  onSelect: (value: string | null) => void;
  onCreateOption?: (value: string) => void;
  onClose: () => void;
}

export const TagDrawer = ({
  isOpen,
  title,
  options,
  currentValue,
  allowClear = false,
  clearLabel = "Clear value",
  searchValue,
  onSearchChange,
  onSelect,
  onCreateOption,
  onClose
}: TagDrawerProps) => {
  const drawerRef = useRef<HTMLDivElement | null>(null);

  const getToneIndex = (value: string): number =>
    value.split("").reduce((sum, character) => sum + character.charCodeAt(0), 0) % 6;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    if (isOpen) {
      window.addEventListener("keydown", handleKeyDown);
      return () => {
        window.removeEventListener("keydown", handleKeyDown);
      };
    }
  }, [isOpen, onClose]);

  const filteredOptions = useMemo(() => {
    const normalizedQuery = searchValue.trim().toLowerCase();
    if (!normalizedQuery) {
      return options;
    }

    return options.filter((option) => option.toLowerCase().includes(normalizedQuery));
  }, [options, searchValue]);

  const normalizedQuery = searchValue.trim();
  const canCreateOption =
    Boolean(onCreateOption) &&
    normalizedQuery.length > 0 &&
    !options.some((option) => option.toLowerCase() === normalizedQuery.toLowerCase());

  if (!isOpen) {
    return null;
  }

  return (
    <>
      <div className="tag-drawer-overlay" onClick={onClose} />
      <div ref={drawerRef} className="tag-drawer" role="dialog" aria-label={title}>
        <div className="tag-drawer-header">
          <strong>{title}</strong>
          <button type="button" className="mini-action" onClick={onClose}>
            <WorkspaceIcon icon="trades" alt="Close drawer" />
          </button>
        </div>
        <input
          autoFocus
          className="tag-drawer-search"
          value={searchValue}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search for an option..."
        />
        <span className="tag-drawer-subtitle">Select an option or add a new one to this list.</span>
        <div className="tag-drawer-content">
          {allowClear ? (
            <button
              type="button"
              className={`tag-drawer-option ${currentValue ? "tag-option-selected" : ""}`}
              onClick={() => onSelect(null)}
            >
              {clearLabel}
            </button>
          ) : null}
          {canCreateOption ? (
            <button
              type="button"
              className="tag-drawer-option tag-option-create"
              onClick={() => onCreateOption?.(normalizedQuery)}
            >
              <span className="tag-option-create-label">Add "{normalizedQuery}" to list</span>
            </button>
          ) : null}
          <div className="tag-drawer-options">
            {filteredOptions.length > 0 ? (
              filteredOptions.map((option) => (
                <button
                  key={option}
                  type="button"
                  className={`tag-drawer-option ${option === currentValue ? "tag-option-selected" : ""}`}
                  onClick={() => onSelect(option)}
                >
                  <span className={`tag-option-pill tag-option-pill-${getToneIndex(option)}`}>
                    {option}
                  </span>
                </button>
              ))
            ) : (
              <div className="empty-inline-state">
                {canCreateOption ? "No matching tags yet." : "No matching tags."}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
};
