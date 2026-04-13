import { useMemo, useState } from "react";

interface AnalyticsColumn<T> {
  key: string;
  label: string;
  render: (row: T) => string | number;
  align?: "left" | "right";
  sortValue?: (row: T) => string | number | null | undefined;
}

interface AnalyticsTableProps<T> {
  columns: AnalyticsColumn<T>[];
  rows: T[];
  emptyMessage: string;
}

export const AnalyticsTable = <T,>({ columns, rows, emptyMessage }: AnalyticsTableProps<T>) => {
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: "asc" | "desc" } | null>(null);

  const sortedRows = useMemo(() => {
    if (!sortConfig) {
      return rows;
    }

    const activeColumn = columns.find((column) => column.key === sortConfig.key);

    if (!activeColumn) {
      return rows;
    }

    const getSortValue = (row: T) => {
      if (activeColumn.sortValue) {
        return activeColumn.sortValue(row);
      }

      if (typeof row === "object" && row !== null && activeColumn.key in row) {
        return (row as Record<string, unknown>)[activeColumn.key] as string | number | null | undefined;
      }

      return activeColumn.render(row);
    };

    return [...rows].sort((left, right) => {
      const leftValue = getSortValue(left);
      const rightValue = getSortValue(right);

      if (leftValue == null && rightValue == null) {
        return 0;
      }

      if (leftValue == null) {
        return sortConfig.direction === "asc" ? 1 : -1;
      }

      if (rightValue == null) {
        return sortConfig.direction === "asc" ? -1 : 1;
      }

      const comparison =
        typeof leftValue === "number" && typeof rightValue === "number"
          ? leftValue - rightValue
          : String(leftValue).localeCompare(String(rightValue), undefined, {
              numeric: true,
              sensitivity: "base"
            });

      return sortConfig.direction === "asc" ? comparison : -comparison;
    });
  }, [columns, rows, sortConfig]);

  const toggleSort = (key: string) => {
    setSortConfig((current) => {
      if (current?.key === key) {
        return { key, direction: current.direction === "asc" ? "desc" : "asc" };
      }

      return { key, direction: "asc" };
    });
  };

  return (
    <div className="analytics-table-shell">
      <table className="analytics-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} className={column.align === "right" ? "align-right" : ""}>
                <button
                  type="button"
                  className={`sortable-header-button ${column.align === "right" ? "sortable-header-button-right" : ""}`}
                  onClick={() => toggleSort(column.key)}
                >
                  <span>{column.label}</span>
                  <span className={`sort-indicator ${sortConfig?.key === column.key ? "sort-indicator-active" : ""}`}>
                    {sortConfig?.key === column.key ? sortConfig.direction : "sort"}
                  </span>
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="empty-state">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            sortedRows.map((row, index) => (
              <tr key={index}>
                {columns.map((column) => (
                  <td key={column.key} className={column.align === "right" ? "align-right" : ""}>
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
};
