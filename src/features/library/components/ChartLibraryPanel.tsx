import { useMemo, useState } from "react";
import { DateFilterPopover } from "../../../components/DateFilterPopover";
import { FilterSelect } from "../../../components/FilterSelect";
import { WorkspaceIcon } from "../../../components/WorkspaceIcon";
import type { JournalPageRecord, JournalScreenshotTagRecord, JournalScreenshotTradeLink } from "../../../types/journal";
import type { GroupedTrade } from "../../../types/trade";

interface ChartLibraryPanelProps {
  journalPages: JournalPageRecord[];
  trades: GroupedTrade[];
  onSelectTrade: (tradeId: string, tradeDate: string) => void;
  onOpenJournalDate?: (tradeDate: string) => void;
}

type ChartEntryStatus = "win" | "loss" | "mixed" | "unlinked";

type ChartLibraryEntry = {
  id: string;
  screenshotUrl: string;
  journalTradeDate: string;
  taggedDate: string;
  tickers: string[];
  playbooks: string[];
  linkedTrades: GroupedTrade[];
  primaryTrade: GroupedTrade | null;
  status: ChartEntryStatus;
};

const TRADE_LINK_SEPARATOR = "::";

const normalizeIsoDate = (value: string): string => {
  if (!value) {
    return "";
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  return parsed.toISOString().slice(0, 10);
};

const formatDisplayDate = (value: string): string => {
  if (!value) {
    return "-";
  }

  const [year, month, day] = value.split("-");
  const parsed = new Date(Number(year), Number(month) - 1, Number(day));
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
};

const serializeTradeLink = (tradeId: string, tradeDate: string): string =>
  tradeId && tradeDate ? `${tradeId}${TRADE_LINK_SEPARATOR}${tradeDate}` : "";

const dedupeScreenshotTradeLinks = (links: JournalScreenshotTradeLink[]): JournalScreenshotTradeLink[] => {
  const unique = new Map<string, JournalScreenshotTradeLink>();

  for (const link of links) {
    if (!link.tradeId || !link.tradeDate) {
      continue;
    }

    unique.set(`${link.tradeId}${TRADE_LINK_SEPARATOR}${link.tradeDate}`, link);
  }

  return Array.from(unique.values());
};

const getScreenshotTradeLinks = (screenshotTag: JournalScreenshotTagRecord): JournalScreenshotTradeLink[] => {
  const normalizedLinkedTrades = Array.isArray(screenshotTag.linkedTrades)
    ? screenshotTag.linkedTrades
        .map((link) => ({
          tradeId: typeof link.tradeId === "string" ? link.tradeId.trim() : "",
          tradeDate: typeof link.tradeDate === "string" ? normalizeIsoDate(link.tradeDate) : ""
        }))
        .filter((link) => link.tradeId && link.tradeDate)
    : [];

  const legacyTradeDate = normalizeIsoDate(screenshotTag.linkedTradeDate);
  const legacyLink =
    screenshotTag.linkedTradeId?.trim() && legacyTradeDate
      ? [
          {
            tradeId: screenshotTag.linkedTradeId.trim(),
            tradeDate: legacyTradeDate
          }
        ]
      : [];

  return dedupeScreenshotTradeLinks([...normalizedLinkedTrades, ...legacyLink]);
};

const splitCsvTags = (value: string): string[] =>
  value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

const getStatusFromTrades = (linkedTrades: GroupedTrade[]): ChartEntryStatus => {
  if (linkedTrades.length === 0) {
    return "unlinked";
  }

  const uniqueStatuses = new Set(linkedTrades.map((trade) => trade.status));
  if (uniqueStatuses.size === 1) {
    return uniqueStatuses.has("Win") ? "win" : "loss";
  }

  return "mixed";
};

const buildChartEntries = (journalPages: JournalPageRecord[], trades: GroupedTrade[]): ChartLibraryEntry[] => {
  const tradeByLink = new Map<string, GroupedTrade>();
  const tradeById = new Map<string, GroupedTrade>();

  for (const trade of trades) {
    const tradeDate = normalizeIsoDate(trade.tradeDate);
    if (tradeDate) {
      tradeByLink.set(serializeTradeLink(trade.id, tradeDate), trade);
    }

    if (!tradeById.has(trade.id)) {
      tradeById.set(trade.id, trade);
    }
  }

  const entries: ChartLibraryEntry[] = [];

  for (const page of journalPages) {
    const pageDate = normalizeIsoDate(page.tradeDate);
    const pageTags = Array.isArray(page.screenshotTags) ? page.screenshotTags : [];

    page.screenshotUrls.forEach((screenshotUrl, index) => {
      if (!screenshotUrl || typeof screenshotUrl !== "string") {
        return;
      }

      const screenshotTag = pageTags[index];
      const links = screenshotTag ? getScreenshotTradeLinks(screenshotTag) : [];
      const linkedTrades = links
        .map((link) => tradeByLink.get(serializeTradeLink(link.tradeId, normalizeIsoDate(link.tradeDate))) ?? tradeById.get(link.tradeId))
        .filter((trade): trade is GroupedTrade => Boolean(trade));

      const tickerFromTrades = linkedTrades
        .map((trade) => trade.symbol.trim().toUpperCase())
        .filter(Boolean);
      const tickerFromTag = screenshotTag ? splitCsvTags(screenshotTag.ticker).map((ticker) => ticker.toUpperCase()) : [];
      const tickers = Array.from(new Set([...tickerFromTrades, ...tickerFromTag]));

      const playbooksFromTrades = linkedTrades
        .flatMap((trade) => trade.setups)
        .map((playbook) => playbook.trim())
        .filter((playbook) => Boolean(playbook) && playbook !== "No Setup");
      const playbooksFromTag = screenshotTag ? splitCsvTags(screenshotTag.playbook) : [];
      const playbooks = Array.from(new Set([...playbooksFromTrades, ...playbooksFromTag]));

      const taggedDate = normalizeIsoDate(screenshotTag?.taggedDate ?? "") || pageDate;
      const primaryTrade = linkedTrades[0] ?? null;

      entries.push({
        id: `${page.id}-${index}`,
        screenshotUrl,
        journalTradeDate: pageDate,
        taggedDate,
        tickers,
        playbooks,
        linkedTrades,
        primaryTrade,
        status: getStatusFromTrades(linkedTrades)
      });
    });
  }

  return entries.sort((left, right) => {
    const leftDate = left.taggedDate || left.journalTradeDate;
    const rightDate = right.taggedDate || right.journalTradeDate;
    return rightDate.localeCompare(leftDate);
  });
};

const statusFilterOptions = [
  { label: "All outcomes", value: "all" },
  { label: "Win", value: "win" },
  { label: "Loss", value: "loss" },
  { label: "Mixed", value: "mixed" },
  { label: "Unlinked", value: "unlinked" }
];

const sortOptions = [
  { label: "Newest first", value: "desc" },
  { label: "Oldest first", value: "asc" }
];

const getStatusLabel = (status: ChartEntryStatus): string => {
  switch (status) {
    case "win":
      return "Win";
    case "loss":
      return "Loss";
    case "mixed":
      return "Mixed";
    case "unlinked":
      return "Unlinked";
    default:
      return "Unlinked";
  }
};

export const ChartLibraryPanel = ({
  journalPages,
  trades,
  onSelectTrade,
  onOpenJournalDate
}: ChartLibraryPanelProps) => {
  const [tickerFilter, setTickerFilter] = useState("all");
  const [playbookFilter, setPlaybookFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [startDateFilter, setStartDateFilter] = useState("");
  const [endDateFilter, setEndDateFilter] = useState("");
  const [sortDirection, setSortDirection] = useState<"desc" | "asc">("desc");

  const entries = useMemo(() => buildChartEntries(journalPages, trades), [journalPages, trades]);

  const availableDates = useMemo(
    () =>
      Array.from(new Set(entries.map((entry) => entry.taggedDate || entry.journalTradeDate).filter(Boolean))).sort(
        (left, right) => right.localeCompare(left)
      ),
    [entries]
  );

  const tickerOptions = useMemo(
    () => [
      { label: "All tickers", value: "all" },
      ...Array.from(new Set(entries.flatMap((entry) => entry.tickers))).sort((left, right) => left.localeCompare(right)).map((ticker) => ({
        label: ticker,
        value: ticker
      }))
    ],
    [entries]
  );

  const playbookOptions = useMemo(
    () => [
      { label: "All playbooks", value: "all" },
      ...Array.from(new Set(entries.flatMap((entry) => entry.playbooks)))
        .sort((left, right) => left.localeCompare(right))
        .map((playbook) => ({
          label: playbook,
          value: playbook
        }))
    ],
    [entries]
  );

  const filteredEntries = useMemo(() => {
    const filtered = entries.filter((entry) => {
      if (tickerFilter !== "all" && !entry.tickers.includes(tickerFilter)) {
        return false;
      }

      if (playbookFilter !== "all" && !entry.playbooks.includes(playbookFilter)) {
        return false;
      }

      if (statusFilter !== "all" && entry.status !== statusFilter) {
        return false;
      }

      const entryDate = entry.taggedDate || entry.journalTradeDate;
      if (startDateFilter && entryDate < startDateFilter) {
        return false;
      }

      if (endDateFilter && entryDate > endDateFilter) {
        return false;
      }

      return true;
    });

    return [...filtered].sort((left, right) => {
      const leftDate = left.taggedDate || left.journalTradeDate;
      const rightDate = right.taggedDate || right.journalTradeDate;
      const compare = leftDate.localeCompare(rightDate);
      return sortDirection === "asc" ? compare : -compare;
    });
  }, [endDateFilter, entries, playbookFilter, sortDirection, startDateFilter, statusFilter, tickerFilter]);

  const hasActiveFilters =
    tickerFilter !== "all" ||
    playbookFilter !== "all" ||
    statusFilter !== "all" ||
    startDateFilter.length > 0 ||
    endDateFilter.length > 0;

  return (
    <div className="chart-library-panel">
      <div className="library-database-header chart-library-header">
        <div>
          <span className="page-eyebrow">Charts</span>
          <h2>Chart Library</h2>
          <p>Browse every tagged chart screenshot across your journals by ticker, playbook, date, and outcome.</p>
        </div>
        <div className="chart-library-header-meta">
          <span>{filteredEntries.length} charts</span>
          <span>{entries.length} total</span>
        </div>
      </div>

      <div className="chart-library-filter-grid">
        <label className="chart-library-filter">
          <span>Date Range</span>
          <DateFilterPopover
            mode="range"
            startValue={startDateFilter}
            endValue={endDateFilter}
            onRangeChange={(startValue, endValue) => {
              setStartDateFilter(startValue);
              setEndDateFilter(endValue);
            }}
            availableDates={availableDates}
            allLabel="All dates"
            emptyLabel="Choose range"
          />
        </label>
        <label className="chart-library-filter">
          <span>Ticker</span>
          <FilterSelect
            value={tickerFilter}
            options={tickerOptions}
            onChange={setTickerFilter}
            ariaLabel="Chart library ticker filter"
          />
        </label>
        <label className="chart-library-filter">
          <span>Playbook</span>
          <FilterSelect
            value={playbookFilter}
            options={playbookOptions}
            onChange={setPlaybookFilter}
            ariaLabel="Chart library playbook filter"
          />
        </label>
        <label className="chart-library-filter">
          <span>Outcome</span>
          <FilterSelect
            value={statusFilter}
            options={statusFilterOptions}
            onChange={setStatusFilter}
            ariaLabel="Chart library status filter"
          />
        </label>
        <label className="chart-library-filter">
          <span>Sort</span>
          <FilterSelect
            value={sortDirection}
            options={sortOptions}
            onChange={(value) => setSortDirection(value === "asc" ? "asc" : "desc")}
            ariaLabel="Chart library sort"
          />
        </label>
      </div>

      {hasActiveFilters ? (
        <div className="chart-library-filter-actions">
          <button
            type="button"
            className="mini-action"
            onClick={() => {
              setTickerFilter("all");
              setPlaybookFilter("all");
              setStatusFilter("all");
              setStartDateFilter("");
              setEndDateFilter("");
            }}
          >
            Clear Filters
          </button>
        </div>
      ) : null}

      {filteredEntries.length === 0 ? (
        <div className="chart-library-empty">
          <WorkspaceIcon icon="camera" alt="No charts icon" className="panel-header-icon" />
          <strong>No charts found for this filter set.</strong>
          <span>Try clearing filters or tag screenshots in Journal to populate the library.</span>
        </div>
      ) : (
        <div className="chart-library-grid">
          {filteredEntries.map((entry) => {
            const entryDate = entry.taggedDate || entry.journalTradeDate;
            const titleTicker = entry.tickers[0] ?? entry.primaryTrade?.symbol ?? "Chart";
            const linkedTradeCount = entry.linkedTrades.length;

            return (
              <article key={entry.id} className="chart-library-card">
                <div className="chart-library-card-header">
                  <div>
                    <strong>{titleTicker} Chart</strong>
                    <span>
                      Tagged {formatDisplayDate(entryDate)} {entry.journalTradeDate ? `· Journal ${formatDisplayDate(entry.journalTradeDate)}` : ""}
                    </span>
                  </div>
                  <span className={`chart-library-status-pill chart-library-status-pill-${entry.status}`}>
                    {getStatusLabel(entry.status)}
                  </span>
                </div>

                <button
                  type="button"
                  className="chart-library-preview"
                  onClick={() => window.open(entry.screenshotUrl, "_blank", "noopener,noreferrer")}
                >
                  <img src={entry.screenshotUrl} alt={`${titleTicker} chart screenshot`} loading="lazy" />
                </button>

                <div className="chart-library-chip-group">
                  {entry.tickers.length > 0 ? entry.tickers.map((ticker) => <span key={`${entry.id}-${ticker}`}>{ticker}</span>) : <span>No ticker</span>}
                </div>

                <div className="chart-library-chip-group chart-library-chip-group-playbook">
                  {entry.playbooks.length > 0
                    ? entry.playbooks.map((playbook) => <span key={`${entry.id}-${playbook}`}>{playbook}</span>)
                    : <span>No playbook</span>}
                </div>

                <div className="chart-library-card-actions">
                  {entry.primaryTrade ? (
                    <button
                      type="button"
                      className="mini-action"
                      onClick={() => onSelectTrade(entry.primaryTrade?.id ?? "", entry.primaryTrade?.tradeDate ?? "")}
                    >
                      Open Trade
                    </button>
                  ) : null}
                  {onOpenJournalDate && entry.journalTradeDate ? (
                    <button
                      type="button"
                      className="mini-action"
                      onClick={() => onOpenJournalDate(entry.journalTradeDate)}
                    >
                      Open Journal
                    </button>
                  ) : null}
                  <span className="chart-library-linked-meta">
                    {linkedTradeCount > 0 ? `${linkedTradeCount} linked trade${linkedTradeCount === 1 ? "" : "s"}` : "No linked trades"}
                  </span>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
};
