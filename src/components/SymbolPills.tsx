import { getTickerIcon, getTickerSector } from "../lib/tickers/tickerIcons";
import { WorkspaceIcon } from "./WorkspaceIcon";

interface SymbolPillsProps {
  symbols: string[];
  maxVisible?: number;
  overflowCount?: number;
  className?: string;
  emptyLabel?: string;
}

export const SymbolPills = ({
  symbols,
  maxVisible,
  overflowCount,
  className = "",
  emptyLabel = "-"
}: SymbolPillsProps) => {
  const cleanedSymbols = symbols
    .map((value) => value.trim().toUpperCase())
    .filter((value) => value.length > 0);

  if (cleanedSymbols.length === 0) {
    return <span className="symbol-pill-list-empty">{emptyLabel}</span>;
  }

  const visibleSymbols =
    typeof maxVisible === "number" && maxVisible > 0 ? cleanedSymbols.slice(0, maxVisible) : cleanedSymbols;
  const hiddenCount =
    typeof overflowCount === "number"
      ? Math.max(0, overflowCount)
      : Math.max(0, cleanedSymbols.length - visibleSymbols.length);

  return (
    <span className={`symbol-pill-list ${className}`.trim()}>
      {visibleSymbols.map((symbol, index) => {
        const icon = getTickerIcon(symbol);
        const sector = getTickerSector(symbol);

        return (
          <span key={`${symbol}-${index}`} className="symbol-pill">
            {icon ? (
              <img
                src={icon}
                alt={sector ? `${sector} sector icon` : `${symbol} ticker icon`}
                className="symbol-pill-icon"
              />
            ) : (
              <WorkspaceIcon icon="trades" alt={`${symbol} ticker icon`} className="symbol-pill-icon" />
            )}
            {symbol}
          </span>
        );
      })}
      {hiddenCount > 0 ? <span className="symbol-pill symbol-pill-overflow">+{hiddenCount}</span> : null}
    </span>
  );
};
