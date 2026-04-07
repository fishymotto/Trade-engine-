export interface ParsedCsvResult<T> {
  rows: T[];
  warnings: string[];
}
