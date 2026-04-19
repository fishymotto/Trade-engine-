import { useMemo } from "react";
import type { LibraryPageRecord } from "../../../types/library";
import type { ReviewPeriod } from "../lib/reviewUtils";
import { getReviewRange, REVIEW_PROPERTY_KEYS } from "../lib/reviewUtils";

const renderStringValue = (value: unknown, fallback = "-"): string =>
  typeof value === "string" && value.trim().length > 0 ? value : fallback;

const renderStringList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];

const renderTickers = (value: unknown) => {
  const tickers = renderStringList(value);
  if (tickers.length === 0) {
    return <span className="review-empty">-</span>;
  }

  const visible = tickers.slice(0, 4);
  const remainder = tickers.length - visible.length;

  return (
    <span className="review-ticker-pills">
      {visible.map((ticker) => (
        <span key={ticker} className="review-ticker-pill">
          {ticker}
        </span>
      ))}
      {remainder > 0 ? (
        <span className="review-ticker-pill review-ticker-pill-more">+{remainder}</span>
      ) : null}
    </span>
  );
};

const renderScorePill = (value: unknown) => {
  const raw = typeof value === "string" ? value.trim() : "";
  const parsed = raw ? Number(raw) : NaN;
  const className = Number.isFinite(parsed)
    ? parsed >= 4.5
      ? "review-score-pill review-score-pill-strong"
      : parsed >= 3.5
        ? "review-score-pill review-score-pill-good"
        : parsed >= 2.5
          ? "review-score-pill review-score-pill-mid"
          : "review-score-pill review-score-pill-low"
    : "review-score-pill review-score-pill-empty";

  return <span className={className}>{raw || "-"}</span>;
};

const getPeriodLabel = (period: ReviewPeriod): string => (period === "weekly" ? "Week" : "Month");

export const ReviewDatabaseTable = ({
  pages,
  period,
  selectedPageId,
  onOpenPage
}: {
  pages: LibraryPageRecord[];
  period: ReviewPeriod;
  selectedPageId: string;
  onOpenPage: (pageId: string) => void;
}) => {
  const periodLabel = getPeriodLabel(period);
  const sortedPages = useMemo(() => {
    return [...pages].sort((left, right) => {
      const leftRange = getReviewRange(left.properties);
      const rightRange = getReviewRange(right.properties);
      const leftKey = leftRange?.start ?? "";
      const rightKey = rightRange?.start ?? "";

      if (leftKey && rightKey && leftKey !== rightKey) {
        return rightKey.localeCompare(leftKey);
      }

      if (leftKey !== rightKey) {
        return rightKey.localeCompare(leftKey);
      }

      return right.updatedAt.localeCompare(left.updatedAt);
    });
  }, [pages]);

  return (
    <div className="library-table-wrap review-table-wrap" aria-label={`${periodLabel} Review database`}>
      <table className="library-table review-table">
        <thead>
          <tr>
            <th>Title</th>
            <th>{periodLabel}</th>
            <th>Tickers Traded</th>
            <th># Trades</th>
            <th>Shares</th>
            <th>Win Rate</th>
            <th>Net</th>
            <th>Gross</th>
            <th>MPP</th>
            <th>Closed Orders</th>
            <th>Overall</th>
            <th>Risk</th>
            <th>Psych</th>
            <th>Plans</th>
            <th>Red</th>
            <th>Green</th>
          </tr>
        </thead>
        <tbody>
          {sortedPages.length > 0 ? (
            sortedPages.map((page) => {
              const rangeStart = renderStringValue(page.properties?.[REVIEW_PROPERTY_KEYS.rangeStart], "");
              const rangeEnd = renderStringValue(page.properties?.[REVIEW_PROPERTY_KEYS.rangeEnd], "");
              const range =
                rangeStart && rangeEnd ? `${rangeStart} → ${rangeEnd}` : rangeStart || rangeEnd || "-";

              return (
                <tr
                  key={page.id}
                  className={selectedPageId === page.id ? "library-table-row-active" : ""}
                  onClick={() => onOpenPage(page.id)}
                >
                  <td>
                    <button type="button" className="library-table-title" onClick={() => onOpenPage(page.id)}>
                      {page.title}
                    </button>
                  </td>
                  <td className="review-range-cell">{range}</td>
                  <td>{renderTickers(page.properties?.[REVIEW_PROPERTY_KEYS.tickersTraded])}</td>
                  <td>{renderStringValue(page.properties?.[REVIEW_PROPERTY_KEYS.trades])}</td>
                  <td>{renderStringValue(page.properties?.[REVIEW_PROPERTY_KEYS.shares])}</td>
                  <td>{renderStringValue(page.properties?.[REVIEW_PROPERTY_KEYS.winRate])}</td>
                  <td>{renderStringValue(page.properties?.[REVIEW_PROPERTY_KEYS.net])}</td>
                  <td>{renderStringValue(page.properties?.[REVIEW_PROPERTY_KEYS.gross])}</td>
                  <td>{renderStringValue(page.properties?.[REVIEW_PROPERTY_KEYS.mpp])}</td>
                  <td>{renderStringValue(page.properties?.[REVIEW_PROPERTY_KEYS.closedOrders])}</td>
                  <td>{renderScorePill(page.properties?.[REVIEW_PROPERTY_KEYS.overall])}</td>
                  <td>{renderScorePill(page.properties?.[REVIEW_PROPERTY_KEYS.risk])}</td>
                  <td>{renderScorePill(page.properties?.[REVIEW_PROPERTY_KEYS.psychology])}</td>
                  <td>{renderScorePill(page.properties?.[REVIEW_PROPERTY_KEYS.tradingPlans])}</td>
                  <td>{renderStringValue(page.properties?.[REVIEW_PROPERTY_KEYS.redDays])}</td>
                  <td>{renderStringValue(page.properties?.[REVIEW_PROPERTY_KEYS.greenDays])}</td>
                </tr>
              );
            })
          ) : (
            <tr>
              <td colSpan={16}>No entries yet. Create your first {periodLabel.toLowerCase()}ly review.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
};
