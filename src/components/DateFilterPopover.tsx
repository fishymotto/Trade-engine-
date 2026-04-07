import { useEffect, useMemo, useRef, useState } from "react";

interface DateFilterPopoverSingleProps {
  mode?: "single";
  value: string;
  onChange: (value: string) => void;
  availableDates: string[];
  allValue?: string;
  allLabel?: string;
  emptyLabel?: string;
}

interface DateFilterPopoverRangeProps {
  mode: "range";
  startValue: string;
  endValue: string;
  onRangeChange: (startValue: string, endValue: string) => void;
  availableDates: string[];
  allLabel?: string;
  emptyLabel?: string;
}

type DateFilterPopoverProps = DateFilterPopoverSingleProps | DateFilterPopoverRangeProps;

interface CalendarCell {
  dateKey: string;
  day: number;
  isCurrentMonth: boolean;
  isAvailable: boolean;
}

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

const formatDateKey = (value: Date): string =>
  `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(
    value.getDate()
  ).padStart(2, "0")}`;

const getStartOfWeek = (value: Date): Date => {
  const result = new Date(value);
  const day = result.getDay();
  const delta = day === 0 ? -6 : 1 - day;
  result.setDate(result.getDate() + delta);
  result.setHours(0, 0, 0, 0);
  return result;
};

const getEndOfWeek = (value: Date): Date => {
  const result = getStartOfWeek(value);
  result.setDate(result.getDate() + 6);
  result.setHours(0, 0, 0, 0);
  return result;
};

const getTodayKey = (): string => {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(
    today.getDate()
  ).padStart(2, "0")}`;
};

const getMonthKey = (value: string): string => value.slice(0, 7);

const formatMonthLabel = (monthKey: string): string => {
  const [year, month] = monthKey.split("-");
  return new Date(Number(year), Number(month) - 1, 1).toLocaleDateString(undefined, {
    month: "short",
    year: "numeric"
  });
};

const formatDisplayDate = (value: string): string => {
  if (!value) {
    return "";
  }

  const [year, month, day] = value.split("-");
  return new Date(Number(year), Number(month) - 1, Number(day)).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
};

const shiftMonthKey = (monthKey: string, delta: number): string => {
  const [year, month] = monthKey.split("-");
  const shifted = new Date(Number(year), Number(month) - 1 + delta, 1);
  return `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, "0")}`;
};

const getInitialMonthKey = (value: string, availableDates: string[], allValue: string): string => {
  if (value && value !== allValue) {
    return getMonthKey(value);
  }

  return getMonthKey(getTodayKey());
};

const getYearOptions = (availableDates: string[]): number[] => {
  const currentYear = new Date().getFullYear();
  const availableYears = availableDates.map((dateKey) => Number(dateKey.slice(0, 4))).filter(Boolean);
  const minYear = Math.min(currentYear - 3, ...availableYears);
  const maxYear = Math.max(currentYear + 1, ...availableYears);

  return Array.from({ length: maxYear - minYear + 1 }, (_, index) => minYear + index);
};

const MONTH_OPTIONS = Array.from({ length: 12 }, (_, index) => ({
  value: String(index + 1).padStart(2, "0"),
  label: new Date(2026, index, 1).toLocaleDateString(undefined, { month: "short" })
}));

const buildMonthGrid = (monthKey: string, availableDates: Set<string>): CalendarCell[] => {
  const [year, month] = monthKey.split("-");
  const firstDay = new Date(Number(year), Number(month) - 1, 1);
  const mondayOffset = (firstDay.getDay() + 6) % 7;
  const gridStart = new Date(firstDay);
  gridStart.setDate(firstDay.getDate() - mondayOffset);

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
      date.getDate()
    ).padStart(2, "0")}`;

    return {
      dateKey,
      day: date.getDate(),
      isCurrentMonth: date.getMonth() === firstDay.getMonth(),
      isAvailable: availableDates.has(dateKey)
    };
  });
};

export const DateFilterPopover = (props: DateFilterPopoverProps) => {
  const mode = props.mode ?? "single";
  const availableDates = props.availableDates;
  const singleAllValue = props.mode !== "range" ? props.allValue ?? "all" : "all";
  const allValue = mode === "single" ? singleAllValue : "";
  const allLabel = props.allLabel ?? "All Dates";
  const emptyLabel = props.emptyLabel ?? "Pick a date";
  const value = props.mode !== "range" ? props.value : "";
  const startValue = props.mode === "range" ? props.startValue : "";
  const endValue = props.mode === "range" ? props.endValue : "";
  const [isOpen, setIsOpen] = useState(false);
  const [visibleMonthKey, setVisibleMonthKey] = useState(() =>
    getInitialMonthKey(
      mode === "range" ? endValue || startValue : value,
      availableDates,
      allValue
    )
  );
  const [activeField, setActiveField] = useState<"start" | "end">("start");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const availableDateSet = useMemo(() => new Set(availableDates), [availableDates]);
  const monthGrid = useMemo(() => buildMonthGrid(visibleMonthKey, availableDateSet), [availableDateSet, visibleMonthKey]);
  const sortedAvailableDates = useMemo(
    () => [...availableDates].sort((left, right) => right.localeCompare(left)),
    [availableDates]
  );
  const yearOptions = useMemo(() => getYearOptions(availableDates), [availableDates]);

  useEffect(() => {
    if (!isOpen) {
      const anchorValue = mode === "range" ? endValue || startValue : value;
      setVisibleMonthKey(getInitialMonthKey(anchorValue, availableDates, allValue));
    }
  }, [allValue, availableDates, endValue, isOpen, mode, startValue, value]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const triggerLabel =
    mode === "range"
      ? startValue && endValue
        ? `${formatDisplayDate(startValue)} - ${formatDisplayDate(endValue)}`
        : startValue
          ? `${formatDisplayDate(startValue)} - ...`
          : endValue
            ? `... - ${formatDisplayDate(endValue)}`
            : allLabel
      : value && value !== allValue
        ? formatDisplayDate(value)
        : value === allValue
          ? allLabel
          : emptyLabel;

  const applySingleValue = (nextValue: string) => {
    if (props.mode === "range") {
      return;
    }

    props.onChange(nextValue);
  };

  const applyRangeValue = (nextValue: string) => {
    if (props.mode !== "range") {
      return;
    }

    if (!startValue || (startValue && endValue)) {
      props.onRangeChange(nextValue, "");
      setActiveField("end");
      return;
    }

    const nextStart = startValue <= nextValue ? startValue : nextValue;
    const nextEnd = startValue <= nextValue ? nextValue : startValue;
    props.onRangeChange(nextStart, nextEnd);
    setIsOpen(false);
  };

  const applyRangePreset = (startDate: Date, endDate: Date) => {
    if (props.mode !== "range") {
      return;
    }

    const startKey = formatDateKey(startDate);
    const endKey = formatDateKey(endDate);
    props.onRangeChange(startKey, endKey);
    setVisibleMonthKey(endKey.slice(0, 7));
    setIsOpen(false);
  };

  return (
    <div ref={containerRef} className={`date-filter-popover${isOpen ? " date-filter-popover-open" : ""}`}>
      <button
        type="button"
        className="calendar-date-trigger"
        onClick={() => setIsOpen((current) => !current)}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
      >
        <span>{triggerLabel}</span>
        <span className="calendar-date-trigger-caret">{isOpen ? "˄" : "˅"}</span>
      </button>
      {isOpen ? (
        <div className="calendar-date-popover" role="dialog" aria-label="Date picker">
          <div className="calendar-date-popover-top">
            <button
              type="button"
              className="calendar-date-pill"
              onClick={() => {
                if (mode === "range") {
                  if (props.mode === "range") {
                    props.onRangeChange("", "");
                  }
                } else {
                  applySingleValue(allValue);
                }
                setIsOpen(false);
              }}
            >
              {allLabel}
            </button>
            <button
              type="button"
              className="calendar-date-pill"
              onClick={() => {
                const today = getTodayKey();
                if (mode === "range") {
                  if (props.mode === "range") {
                    props.onRangeChange(today, today);
                  }
                } else {
                  applySingleValue(today);
                }
                setVisibleMonthKey(getMonthKey(today));
                setIsOpen(false);
              }}
            >
              Today
            </button>
          </div>
          {mode === "range" ? (
            <div className="calendar-date-preset-row">
              <button
                type="button"
                className="calendar-date-pill"
                onClick={() => {
                  const yesterday = new Date();
                  yesterday.setDate(yesterday.getDate() - 1);
                  applyRangePreset(yesterday, yesterday);
                }}
              >
                Yesterday
              </button>
              <button
                type="button"
                className="calendar-date-pill"
                onClick={() => {
                  const today = new Date();
                  applyRangePreset(getStartOfWeek(today), getEndOfWeek(today));
                }}
              >
                This Week
              </button>
              <button
                type="button"
                className="calendar-date-pill"
                onClick={() => {
                  const currentWeekStart = getStartOfWeek(new Date());
                  const lastWeekEnd = new Date(currentWeekStart);
                  lastWeekEnd.setDate(lastWeekEnd.getDate() - 1);
                  applyRangePreset(getStartOfWeek(lastWeekEnd), getEndOfWeek(lastWeekEnd));
                }}
              >
                Last Week
              </button>
              <button
                type="button"
                className="calendar-date-pill"
                onClick={() => {
                  const today = new Date();
                  applyRangePreset(
                    new Date(today.getFullYear(), today.getMonth(), 1),
                    new Date(today.getFullYear(), today.getMonth() + 1, 0)
                  );
                }}
              >
                This Month
              </button>
            </div>
          ) : null}
          {mode === "range" ? (
            <div className="calendar-date-range-fields">
              <button
                type="button"
                className={`calendar-date-range-field${activeField === "start" ? " calendar-date-range-field-active" : ""}`}
                onClick={() => setActiveField("start")}
              >
                <span>Start</span>
                <strong>{startValue ? formatDisplayDate(startValue) : "Starting"}</strong>
              </button>
              <button
                type="button"
                className={`calendar-date-range-field${activeField === "end" ? " calendar-date-range-field-active" : ""}`}
                onClick={() => setActiveField("end")}
              >
                <span>End</span>
                <strong>{endValue ? formatDisplayDate(endValue) : "Ending"}</strong>
              </button>
            </div>
          ) : null}
          <div className="calendar-date-popover-header">
            <button
              type="button"
              className="calendar-nav-button"
              onClick={() => setVisibleMonthKey((current) => shiftMonthKey(current, -1))}
            >
              Prev
            </button>
            <div className="calendar-date-header-selects">
              <select
                className="calendar-date-header-select"
                value={visibleMonthKey.slice(5, 7)}
                onChange={(event) =>
                  setVisibleMonthKey(`${visibleMonthKey.slice(0, 4)}-${event.target.value}`)
                }
              >
                {MONTH_OPTIONS.map((month) => (
                  <option key={month.value} value={month.value}>
                    {month.label}
                  </option>
                ))}
              </select>
              <select
                className="calendar-date-header-select"
                value={visibleMonthKey.slice(0, 4)}
                onChange={(event) =>
                  setVisibleMonthKey(`${event.target.value}-${visibleMonthKey.slice(5, 7)}`)
                }
              >
                {yearOptions.map((year) => (
                  <option key={year} value={String(year)}>
                    {year}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              className="calendar-nav-button"
              onClick={() => setVisibleMonthKey((current) => shiftMonthKey(current, 1))}
            >
              Next
            </button>
          </div>
          <div className="calendar-date-grid">
            {WEEKDAYS.map((weekday) => (
              <span key={weekday} className="calendar-date-weekday">
                {weekday}
              </span>
            ))}
            {monthGrid.map((cell) => (
              <button
                key={cell.dateKey}
                type="button"
                className={`calendar-date-cell${cell.isCurrentMonth ? "" : " calendar-date-cell-muted"}${
                  cell.isAvailable ? " calendar-date-cell-available" : ""
                }${
                  (mode === "single" && cell.dateKey === value) ||
                  (mode === "range" &&
                    ((startValue && cell.dateKey === startValue) ||
                      (endValue && cell.dateKey === endValue)))
                    ? " calendar-date-cell-selected"
                    : ""
                }${
                  mode === "range" &&
                  startValue &&
                  endValue &&
                  cell.dateKey >= startValue &&
                  cell.dateKey <= endValue
                    ? " calendar-date-cell-in-range"
                    : ""
                }`}
                onClick={() => {
                  if (mode === "range") {
                    applyRangeValue(cell.dateKey);
                    return;
                  }

                  applySingleValue(cell.dateKey);
                  setIsOpen(false);
                }}
              >
                {cell.day}
              </button>
            ))}
          </div>
          {sortedAvailableDates.length > 0 ? (
            <div className="calendar-date-saved-list">
              <span className="calendar-date-saved-label">Saved dates</span>
              <div className="calendar-date-saved-items">
                {sortedAvailableDates.slice(0, 8).map((dateKey) => (
                  <button
                    key={dateKey}
                    type="button"
                    className={`calendar-date-saved-item${
                      (mode === "single" && dateKey === value) ||
                      (mode === "range" && (dateKey === startValue || dateKey === endValue))
                        ? " calendar-date-saved-item-selected"
                        : ""
                    }`}
                    onClick={() => {
                      if (mode === "range") {
                        applyRangeValue(dateKey);
                      } else {
                        applySingleValue(dateKey);
                        setIsOpen(false);
                      }
                      setVisibleMonthKey(getMonthKey(dateKey));
                    }}
                  >
                    {formatDisplayDate(dateKey)}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};
