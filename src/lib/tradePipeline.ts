import { buildCsvContent, toExportRows } from "./export/csvExporter";
import { groupExecutions } from "./grouping/groupingEngine";
import { parseTradeDetailCsvWithOptions } from "./parser/csvParser";
import { applyTradeTags } from "./tags/tagEngine";
import type { GroupedTrade, Settings } from "../types/trade";

export interface ProcessedTradeFile {
  trades: GroupedTrade[];
  exportCsvContent: string;
  warnings: string[];
}

export const processTradeFile = async (
  file: File,
  allowedSymbols: string[],
  settings: Settings
): Promise<ProcessedTradeFile> => {
  const parsed = await parseTradeDetailCsvWithOptions(file, {
    brlToUsdRate: settings.brlToUsdRate,
    brlSymbols: settings.brlTickerList.split(/[\s,;]+/)
  });
  if (parsed.warnings.length > 0 && (parsed.rows.length === 0 || parsed.warnings.some((warning) => warning.includes("BRL to USD Rate is blank")))) {
    throw new Error(parsed.warnings[0]);
  }

  const grouped = groupExecutions(parsed.rows);
  const tagged = applyTradeTags(grouped);
  const exportRows = toExportRows(tagged, allowedSymbols);

  return {
    trades: tagged,
    exportCsvContent: buildCsvContent(exportRows),
    warnings: parsed.warnings
  };
};
