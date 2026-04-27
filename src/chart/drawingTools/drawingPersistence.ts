import type { ChartInterval } from "../../types/chart";
import type { TradeChartDrawing } from "../../types/review";
import { normalizeTradeDrawings } from "./drawingTypes";

export interface DrawingScope {
  ticker: string;
  timeframe: ChartInterval;
  tradeId?: string | null;
  journalEntryId?: string | null;
}

export interface ScopedDrawingPayload {
  scopeKey: string;
  drawings: TradeChartDrawing[];
  updatedAt: string;
}

const safeScopePart = (value: string | null | undefined, fallback: string): string => {
  if (!value) {
    return fallback;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized.toLowerCase() : fallback;
};

export const buildDrawingScopeKey = (scope: DrawingScope): string => {
  const ticker = safeScopePart(scope.ticker, "unknown");
  const timeframe = safeScopePart(scope.timeframe, "unknown");
  const tradeId = safeScopePart(scope.tradeId ?? undefined, "none");
  const journalEntryId = safeScopePart(scope.journalEntryId ?? undefined, "none");

  return `ticker:${ticker}|timeframe:${timeframe}|trade:${tradeId}|journal:${journalEntryId}`;
};

export const serializeScopedDrawings = (scope: DrawingScope, drawings: TradeChartDrawing[]): ScopedDrawingPayload => ({
  scopeKey: buildDrawingScopeKey(scope),
  drawings: normalizeTradeDrawings(drawings),
  updatedAt: new Date().toISOString()
});

export const parseScopedDrawings = (raw: unknown): ScopedDrawingPayload | null => {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const candidate = raw as Partial<ScopedDrawingPayload>;
  if (typeof candidate.scopeKey !== "string") {
    return null;
  }

  return {
    scopeKey: candidate.scopeKey,
    drawings: normalizeTradeDrawings(candidate.drawings),
    updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : new Date(0).toISOString()
  };
};
