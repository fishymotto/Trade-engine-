import { buildCsvContent, toExportRows } from "./export/csvExporter";
import { groupExecutions } from "./grouping/groupingEngine";
import { parseTradeDetailCsv } from "./parser/csvParser";
import { applyTradeTags } from "./tags/tagEngine";
import type { GroupedTrade } from "../types/trade";

export interface ProcessedTradeFile {
  trades: GroupedTrade[];
  exportCsvContent: string;
}

export const processTradeFile = async (
  file: File,
  allowedSymbols: string[]
): Promise<ProcessedTradeFile> => {
  const parsed = await parseTradeDetailCsv(file);
  if (parsed.warnings.length > 0 && parsed.rows.length === 0) {
    throw new Error(parsed.warnings[0]);
  }

  const grouped = groupExecutions(parsed.rows);
  const tagged = applyTradeTags(grouped);
  const exportRows = toExportRows(tagged, allowedSymbols);

  return {
    trades: tagged,
    exportCsvContent: buildCsvContent(exportRows)
  };
};
