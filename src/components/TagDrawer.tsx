import { useEffect, useMemo, useRef } from "react";
import { WorkspaceIcon } from "./WorkspaceIcon";

interface TagDrawerProps {
  isOpen: boolean;
  title: string;
  options: string[];
  selectionMode?: "single" | "multi";
  currentValue?: string;
  currentValues?: string[];
  allowClear?: boolean;
  clearLabel?: string;
  searchValue: string;
  onSearchChange: (value: string) => void;
  onSelect: (value: string | string[] | null) => void;
  onCreateOption?: (value: string) => void;
  onClose: () => void;
}

export const TagDrawer = ({
  isOpen,
  title,
  options,
  selectionMode = "single",
  currentValue = "",
  currentValues = [],
  allowClear = false,
  clearLabel = "Clear value",
  searchValue,
  onSearchChange,
  onSelect,
  onCreateOption,
  onClose
}: TagDrawerProps) => {
  const drawerRef = useRef<HTMLDivElement | null>(null);
  const selectedValues = selectionMode === "multi" ? currentValues : currentValue ? [currentValue] : [];

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
        <span className="tag-drawer-subtitle">
          {selectionMode === "multi" ? "Select one or more options (you can keep adding)." : "Select an option or add a new one to this list."}
        </span>
        <div className="tag-drawer-content">
          {allowClear ? (
            <button
              type="button"
              className={`tag-drawer-option ${selectedValues.length > 0 ? "tag-option-selected" : ""}`}
              onClick={() => onSelect(selectionMode === "multi" ? [] : null)}
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
                  className={`tag-drawer-option ${selectedValues.includes(option) ? "tag-option-selected" : ""}`}
                  onClick={() => {
                    if (selectionMode === "multi") {
                      const nextValues = selectedValues.includes(option)
                        ? selectedValues.filter((value) => value !== option)
                        : [...selectedValues, option];
                      onSelect(nextValues);
                      return;
                    }

                    onSelect(option);
                  }}
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
