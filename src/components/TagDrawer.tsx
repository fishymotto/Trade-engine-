import { useEffect, useMemo, useRef, useState } from "react";
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
  onRenameOption?: (currentValue: string, nextValue: string) => void;
  onDeleteOption?: (value: string) => void;
  canManageOption?: (value: string) => boolean;
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
  onRenameOption,
  onDeleteOption,
  canManageOption,
  onClose
}: TagDrawerProps) => {
  const drawerRef = useRef<HTMLDivElement | null>(null);
  const selectedValues = selectionMode === "multi" ? currentValues : currentValue ? [currentValue] : [];
  const [isManageMode, setIsManageMode] = useState(false);

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

  useEffect(() => {
    if (!isOpen) {
      setIsManageMode(false);
    }
  }, [isOpen]);

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

  const canManageAnyOptions = Boolean(onRenameOption || onDeleteOption);

  const isOptionManageable = (value: string): boolean =>
    canManageAnyOptions && (canManageOption ? canManageOption(value) : true);

  if (!isOpen) {
    return null;
  }

  return (
    <>
      <div className="tag-drawer-overlay" onClick={onClose} />
      <div ref={drawerRef} className="tag-drawer" role="dialog" aria-label={title}>
        <div className="tag-drawer-header">
          <strong>{title}</strong>
          <div className="tag-drawer-header-actions">
            {canManageAnyOptions ? (
              <button
                type="button"
                className={`mini-action tag-drawer-manage-toggle ${isManageMode ? "tag-drawer-manage-toggle-active" : ""}`}
                onClick={() => setIsManageMode((current) => !current)}
              >
                {isManageMode ? "Done" : "Manage"}
              </button>
            ) : null}
            <button type="button" className="mini-action" onClick={onClose}>
              <WorkspaceIcon icon="trades" alt="Close drawer" />
            </button>
          </div>
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
              filteredOptions.map((option) => {
                const manageable = isOptionManageable(option);

                return (
                  <div key={option} className="tag-drawer-option-row">
                    <button
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
                    {manageable && isManageMode ? (
                      <div className="tag-drawer-option-actions">
                        {onRenameOption ? (
                          <button
                            type="button"
                            className="tag-drawer-option-action"
                            onClick={(event) => {
                              event.stopPropagation();
                              const nextValue = window.prompt("Rename option:", option)?.trim() ?? "";
                              if (!nextValue || nextValue === option) {
                                return;
                              }
                              onRenameOption(option, nextValue);
                            }}
                          >
                            Rename
                          </button>
                        ) : null}
                        {onDeleteOption ? (
                          <button
                            type="button"
                            className="tag-drawer-option-action tag-drawer-option-action-danger"
                            onClick={(event) => {
                              event.stopPropagation();
                              if (!window.confirm(`Delete option "${option}"?`)) {
                                return;
                              }
                              onDeleteOption(option);
                            }}
                          >
                            Delete
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })
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
