import type { GroupedTrade, Settings } from "../../../types/trade";
import type { LibraryCollectionId, LibraryPageRecord } from "../../../types/library";

export type ReviewPeriod = "weekly" | "monthly";

export const getReviewPeriodForCollection = (collectionId: LibraryCollectionId): ReviewPeriod | null => {
  if (collectionId === "weekly-review") {
    return "weekly";
  }

  if (collectionId === "monthly-review") {
    return "monthly";
  }

  return null;
};

export const REVIEW_PROPERTY_KEYS = {
  rangeStart: "Range Start",
  rangeEnd: "Range End",
  tickersTraded: "Tickers Traded",
  trades: "Trades",
  shares: "Shares",
  winRate: "Win Rate",
  net: "Net",
  gross: "Gross",
  mpp: "MPP",
  closedOrders: "Closed Orders",
  breachDays: "Breach Days",
  overall: "Overall",
  risk: "Risk Management",
  psychology: "Psychology",
  tradingPlans: "Trading Plans",
  redDays: "Red Days",
  greenDays: "Green Days"
} as const;

const normalizeTradeDate = (value: string): string => {
  if (!value) {
    return "";
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toISOString().slice(0, 10);
};

const formatIsoDate = (value: Date): string => {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const parseIsoLocalDate = (value: string): Date | null => {
  const normalized = normalizeTradeDate(value);
  if (!normalized || !/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return null;
  }

  const parsed = new Date(`${normalized}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const getStartOfWeek = (value: Date): Date => {
  const result = new Date(value);
  const day = result.getDay();
  const delta = day === 0 ? -6 : 1 - day;
  result.setDate(result.getDate() + delta);
  result.setHours(0, 0, 0, 0);
  return result;
};

const addDays = (value: Date, days: number): Date => {
  const result = new Date(value);
  result.setDate(result.getDate() + days);
  return result;
};

const parseIsoDate = (value: unknown): string => {
  if (typeof value !== "string") {
    return "";
  }

  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : "";
};

export const getReviewRange = (
  properties: LibraryPageRecord["properties"]
): { start: string; end: string } | null => {
  const start = parseIsoDate(properties?.[REVIEW_PROPERTY_KEYS.rangeStart]);
  const end = parseIsoDate(properties?.[REVIEW_PROPERTY_KEYS.rangeEnd]);
  if (!start || !end) {
    return null;
  }

  return start <= end ? { start, end } : { start: end, end: start };
};

const formatSignedMoney = (value: number): string => `${value >= 0 ? "+" : "-"}$${Math.abs(value).toFixed(2)}`;

const formatPercent = (value: number): string => `${value.toFixed(1)}%`;

const toWholeNumberString = (value: number): string => String(Math.round(value));

const toFixedOrEmpty = (value: number, digits: number): string =>
  Number.isFinite(value) ? value.toFixed(digits) : "";

const parseScore = (value: unknown): number | null => {
  if (typeof value !== "string") {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  const clamped = Math.max(1, Math.min(5, parsed));
  return clamped;
};

export const computeOverallScore = (properties: LibraryPageRecord["properties"]): string => {
  const risk = parseScore(properties?.[REVIEW_PROPERTY_KEYS.risk]);
  const psych = parseScore(properties?.[REVIEW_PROPERTY_KEYS.psychology]);
  const plans = parseScore(properties?.[REVIEW_PROPERTY_KEYS.tradingPlans]);

  if (risk === null || psych === null || plans === null) {
    return "";
  }

  const average = (risk + psych + plans) / 3;
  return toFixedOrEmpty(average, 1);
};

export const computeReviewMetrics = ({
  trades,
  rangeStart,
  rangeEnd,
  dailyShutdownRiskUsd
}: {
  trades: GroupedTrade[];
  rangeStart: string;
  rangeEnd: string;
  dailyShutdownRiskUsd: number;
}) => {
  const start = normalizeTradeDate(rangeStart);
  const end = normalizeTradeDate(rangeEnd);

  const inRange = trades.filter((trade) => {
    const date = normalizeTradeDate(trade.tradeDate);
    return Boolean(date) && date >= start && date <= end;
  });

  const tickersTraded = Array.from(new Set(inRange.map((trade) => trade.symbol))).sort();
  const tradeCount = inRange.length;
  const shares = inRange.reduce((sum, trade) => sum + Math.abs(trade.size || 0), 0);
  const winners = inRange.filter((trade) => trade.netPnlUsd > 0).length;
  const winRate = tradeCount > 0 ? (winners / tradeCount) * 100 : 0;
  const net = inRange.reduce((sum, trade) => sum + (trade.netPnlUsd || 0), 0);
  const gross = inRange.reduce((sum, trade) => sum + (trade.grossPnlUsd || 0), 0);

  const dayNetMap = inRange.reduce<Map<string, number>>((acc, trade) => {
    const date = normalizeTradeDate(trade.tradeDate);
    if (!date) {
      return acc;
    }

    acc.set(date, (acc.get(date) ?? 0) + (trade.netPnlUsd || 0));
    return acc;
  }, new Map());

  const breachThreshold = Math.max(0, dailyShutdownRiskUsd || 0);
  const breachDays = Array.from(dayNetMap.entries())
    .filter(([, value]) => breachThreshold > 0 && value <= -breachThreshold)
    .map(([date]) => date)
    .sort();

  const redDays = Array.from(dayNetMap.values()).filter((value) => value < 0).length;
  const greenDays = Array.from(dayNetMap.values()).filter((value) => value > 0).length;

  return {
    tickersTraded,
    tradeCount,
    shares,
    winRate,
    net,
    gross,
    breachDays,
    redDays,
    greenDays
  };
};

export const buildReviewPropertiesPatch = ({
  metrics,
  existingProperties,
}: {
  metrics: ReturnType<typeof computeReviewMetrics>;
  existingProperties: LibraryPageRecord["properties"];
}) => {
  const next = {
    ...(existingProperties ?? {})
  } as NonNullable<LibraryPageRecord["properties"]>;

  next[REVIEW_PROPERTY_KEYS.tickersTraded] = metrics.tickersTraded;
  next[REVIEW_PROPERTY_KEYS.trades] = toWholeNumberString(metrics.tradeCount);
  next[REVIEW_PROPERTY_KEYS.shares] = toWholeNumberString(metrics.shares);
  next[REVIEW_PROPERTY_KEYS.winRate] = formatPercent(metrics.winRate);
  next[REVIEW_PROPERTY_KEYS.net] = formatSignedMoney(metrics.net);
  next[REVIEW_PROPERTY_KEYS.gross] = formatSignedMoney(metrics.gross);
  next[REVIEW_PROPERTY_KEYS.closedOrders] = toWholeNumberString(metrics.breachDays.length);
  next[REVIEW_PROPERTY_KEYS.breachDays] = metrics.breachDays;
  next[REVIEW_PROPERTY_KEYS.redDays] = toWholeNumberString(metrics.redDays);
  next[REVIEW_PROPERTY_KEYS.greenDays] = toWholeNumberString(metrics.greenDays);

  return next;
};

export const getDailyShutdownRiskFromSettings = (settings: Settings): number =>
  Number.isFinite(settings.dailyShutdownRiskUsd) ? settings.dailyShutdownRiskUsd : 0;

export const getReviewRangesFromTrades = (
  trades: GroupedTrade[],
  period: ReviewPeriod
): Array<{ start: string; end: string }> => {
  const startKeys = new Set<string>();

  for (const trade of trades) {
    const parsed = parseIsoLocalDate(trade.tradeDate);
    if (!parsed) {
      continue;
    }

    if (period === "weekly") {
      startKeys.add(formatIsoDate(getStartOfWeek(parsed)));
      continue;
    }

    startKeys.add(`${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-01`);
  }

  const starts = Array.from(startKeys.values()).sort((a, b) => b.localeCompare(a));

  return starts.map((start) => {
    if (period === "weekly") {
      const startDate = parseIsoLocalDate(start);
      const endDate = startDate ? addDays(startDate, 4) : null;
      return { start, end: endDate ? formatIsoDate(endDate) : start };
    }

    const parsedStart = parseIsoLocalDate(start);
    if (!parsedStart) {
      return { start, end: start };
    }

    const endDate = new Date(parsedStart.getFullYear(), parsedStart.getMonth() + 1, 0);
    endDate.setHours(0, 0, 0, 0);
    return { start, end: formatIsoDate(endDate) };
  });
};

export const getReviewTitleForRange = (period: ReviewPeriod, rangeStart: string, rangeEnd: string): string => {
  const startDate = parseIsoLocalDate(rangeStart);

  if (period === "monthly") {
    if (!startDate) {
      return "Monthly Review";
    }

    const label = startDate.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    return `${label} Review`;
  }

  if (!startDate) {
    return "Weekly Review";
  }

  const startLabel = startDate.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  const endDate = parseIsoLocalDate(rangeEnd);
  const endLabel = endDate
    ? endDate.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
    : "";

  return endLabel ? `Week: ${startLabel} - ${endLabel}` : `Week of ${startLabel}`;
};
