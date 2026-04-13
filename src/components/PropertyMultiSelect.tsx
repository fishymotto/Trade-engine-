import { useCallback, useEffect, useMemo, useRef, useState } from "react";

interface PropertyMultiSelectProps {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  predefinedOptions?: string[];
  placeholder?: string;
  allowCustom?: boolean;
}

export const PropertyMultiSelect = ({
  label,
  values,
  onChange,
  predefinedOptions = [],
  placeholder = "Add option",
  allowCustom = true
}: PropertyMultiSelectProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [allOptions, setAllOptions] = useState<string[]>(() => {
    const combined = new Set([...predefinedOptions, ...values]);
    return Array.from(combined).sort();
  });
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => {
        document.removeEventListener("mousedown", handleClickOutside);
      };
    }
  }, [isOpen]);

  const filteredOptions = useMemo(() => {
    const normalized = searchQuery.toLowerCase();
    return allOptions.filter(
      (option) =>
        option.toLowerCase().includes(normalized) && !values.includes(option)
    );
  }, [allOptions, searchQuery, values]);

  const handleAddOption = useCallback(
    (option: string) => {
      if (!values.includes(option)) {
        const newValues = [...values, option];
        onChange(newValues);
        if (!allOptions.includes(option)) {
          setAllOptions((prev) => [...prev, option].sort());
        }
      }
      setSearchQuery("");
      inputRef.current?.focus();
    },
    [values, onChange, allOptions]
  );

  const handleRemoveOption = useCallback(
    (option: string) => {
      onChange(values.filter((v) => v !== option));
    },
    [values, onChange]
  );

  const handleCreateNew = useCallback(() => {
    if (searchQuery.trim() && allowCustom) {
      handleAddOption(searchQuery.trim());
    }
  }, [searchQuery, allowCustom, handleAddOption]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (filteredOptions.length > 0) {
        handleAddOption(filteredOptions[0]);
      } else if (allowCustom && searchQuery.trim()) {
        handleCreateNew();
      }
    } else if (e.key === "Escape") {
      setIsOpen(false);
      setSearchQuery("");
    }
  };

  return (
    <div className="property-multi-select-container" ref={containerRef}>
      <label className="property-label">{label}</label>
      <div className="property-multi-select">
        <div className="property-tags">
          {values.map((value) => (
            <span key={value} className="property-tag">
              {value}
              <button
                type="button"
                className="property-tag-remove"
                onClick={() => handleRemoveOption(value)}
                aria-label={`Remove ${value}`}
              >
                ×
              </button>
            </span>
          ))}
          <input
            ref={inputRef}
            type="text"
            className="property-input"
            placeholder={values.length === 0 ? placeholder : ""}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => setIsOpen(true)}
            onClick={() => setIsOpen(true)}
          />
        </div>

        {isOpen && (
          <div className="property-dropdown">
            {filteredOptions.length > 0 ? (
              <div className="property-options">
                {filteredOptions.map((option) => (
                  <button
                    key={option}
                    type="button"
                    className="property-option"
                    onClick={() => handleAddOption(option)}
                  >
                    {option}
                  </button>
                ))}
              </div>
            ) : null}

            {allowCustom && searchQuery.trim() && !allOptions.includes(searchQuery.trim()) ? (
              <button
                type="button"
                className="property-option property-option-create"
                onClick={handleCreateNew}
              >
                Create "{searchQuery.trim()}"
              </button>
            ) : null}

            {filteredOptions.length === 0 && !searchQuery.trim() ? (
              <div className="property-empty">
                {values.length === 0
                  ? "No options. Start typing to add."
                  : "No more options."}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
};
