import { useEffect, useMemo, useRef, useState } from "react";

export interface FilterSelectOption {
  label: string;
  value: string;
}

interface FilterSelectProps {
  value: string;
  options: FilterSelectOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
}

export const FilterSelect = ({ value, options, onChange, ariaLabel }: FilterSelectProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [highlightedValue, setHighlightedValue] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const optionRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const selectedOption = useMemo(
    () => options.find((option) => option.value === value) ?? options[0],
    [options, value]
  );
  const isSearchEnabled = options.length >= 8;
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const filteredOptions = useMemo(() => {
    if (!isSearchEnabled || normalizedSearchQuery.length === 0) {
      return options;
    }

    return options.filter((option) => {
      const normalizedLabel = option.label.toLowerCase();
      const normalizedValue = option.value.toLowerCase();
      return (
        normalizedLabel.includes(normalizedSearchQuery) ||
        normalizedValue.includes(normalizedSearchQuery)
      );
    });
  }, [isSearchEnabled, normalizedSearchQuery, options]);

  const closeMenu = () => {
    setIsOpen(false);
    setSearchQuery("");
    setHighlightedValue(null);
  };

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        closeMenu();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMenu();
        triggerRef.current?.focus();
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const selectedFilteredOption =
      filteredOptions.find((option) => option.value === value) ?? filteredOptions[0] ?? null;
    setHighlightedValue(selectedFilteredOption?.value ?? null);
  }, [filteredOptions, isOpen, value]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const focusTarget = isSearchEnabled ? searchInputRef.current : menuRef.current;
    if (!focusTarget) {
      return;
    }

    const animationFrame = window.requestAnimationFrame(() => {
      focusTarget.focus();
    });

    return () => {
      window.cancelAnimationFrame(animationFrame);
    };
  }, [isOpen, isSearchEnabled]);

  useEffect(() => {
    if (!isOpen || !highlightedValue) {
      return;
    }

    optionRefs.current[highlightedValue]?.scrollIntoView({
      block: "nearest"
    });
  }, [highlightedValue, isOpen]);

  const moveHighlight = (direction: 1 | -1) => {
    if (filteredOptions.length === 0) {
      return;
    }

    const currentIndex = filteredOptions.findIndex((option) => option.value === highlightedValue);
    const fallbackIndex = filteredOptions.findIndex((option) => option.value === value);
    const startIndex = currentIndex >= 0 ? currentIndex : Math.max(fallbackIndex, 0);
    const nextIndex =
      currentIndex >= 0
        ? (startIndex + direction + filteredOptions.length) % filteredOptions.length
        : Math.max(fallbackIndex, 0);

    setHighlightedValue(filteredOptions[nextIndex]?.value ?? null);
  };

  const selectOption = (optionValue: string) => {
    onChange(optionValue);
    closeMenu();
    triggerRef.current?.focus();
  };

  const handleListKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement | HTMLDivElement>
  ) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveHighlight(1);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      moveHighlight(-1);
      return;
    }

    if (event.key === "Home") {
      event.preventDefault();
      setHighlightedValue(filteredOptions[0]?.value ?? null);
      return;
    }

    if (event.key === "End") {
      event.preventDefault();
      setHighlightedValue(filteredOptions[filteredOptions.length - 1]?.value ?? null);
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      if (highlightedValue) {
        selectOption(highlightedValue);
      }
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      closeMenu();
      triggerRef.current?.focus();
    }
  };

  return (
    <div ref={containerRef} className={`filter-select${isOpen ? " filter-select-open" : ""}`}>
      <button
        ref={triggerRef}
        type="button"
        className="filter-select-trigger"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={() => {
          setIsOpen((current) => {
            const nextIsOpen = !current;
            if (nextIsOpen) {
              setSearchQuery("");
            }
            return nextIsOpen;
          });
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setIsOpen(true);
          }
        }}
      >
        <span title={selectedOption?.label ?? "Select"}>{selectedOption?.label ?? "Select"}</span>
        <span className="filter-select-caret">{isOpen ? "^" : "v"}</span>
      </button>
      {isOpen ? (
        <div className="filter-select-menu">
          {isSearchEnabled ? (
            <div className="filter-select-search">
              <input
                ref={searchInputRef}
                type="search"
                className="filter-select-search-input"
                value={searchQuery}
                placeholder="Type to filter..."
                aria-label={`${ariaLabel} search`}
                onChange={(event) => setSearchQuery(event.target.value)}
                onKeyDown={handleListKeyDown}
              />
            </div>
          ) : null}
          <div
            ref={menuRef}
            className="filter-select-options"
            role="listbox"
            aria-label={ariaLabel}
            tabIndex={isSearchEnabled ? undefined : -1}
            onKeyDown={handleListKeyDown}
          >
            {filteredOptions.length > 0 ? (
              filteredOptions.map((option) => (
                <button
                  key={option.value}
                  ref={(node) => {
                    optionRefs.current[option.value] = node;
                  }}
                  type="button"
                  className={`filter-select-option${
                    option.value === value ? " filter-select-option-active" : ""
                  }${option.value === highlightedValue ? " filter-select-option-highlighted" : ""}`}
                  role="option"
                  aria-selected={option.value === value}
                  title={option.label}
                  onMouseEnter={() => setHighlightedValue(option.value)}
                  onClick={() => selectOption(option.value)}
                >
                  <span>{option.label}</span>
                  {option.value === value ? <span className="filter-select-check">Selected</span> : null}
                </button>
              ))
            ) : (
              <div className="filter-select-empty">No matches found.</div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
};
