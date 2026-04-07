interface AnalyticsColumn<T> {
  key: string;
  label: string;
  render: (row: T) => string | number;
  align?: "left" | "right";
}

interface AnalyticsTableProps<T> {
  columns: AnalyticsColumn<T>[];
  rows: T[];
  emptyMessage: string;
}

export const AnalyticsTable = <T,>({ columns, rows, emptyMessage }: AnalyticsTableProps<T>) => {
  return (
    <div className="analytics-table-shell">
      <table className="analytics-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} className={column.align === "right" ? "align-right" : ""}>
                {column.label}
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
            rows.map((row, index) => (
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
