import { invoke, isTauri } from "@tauri-apps/api/core";
import type { TradeSessionRecord } from "../../types/session";
import type { GroupedTrade } from "../../types/trade";

const STORAGE_KEY = "trade-engine-trade-sessions";

const loadTradeSessionsFromLocalStorage = (): TradeSessionRecord[] => {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as TradeSessionRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const loadTradeSessions = async (): Promise<TradeSessionRecord[]> => {
  if (isTauri()) {
    try {
      const sessions = await invoke<TradeSessionRecord[]>("load_trade_sessions");
      return Array.isArray(sessions) ? sessions : [];
    } catch {
      return loadTradeSessionsFromLocalStorage();
    }
  }

  return loadTradeSessionsFromLocalStorage();
};

export const saveTradeSessions = async (sessions: TradeSessionRecord[]): Promise<void> => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));

  if (isTauri()) {
    await invoke("save_trade_sessions", { sessions });
  }
};

export const mergeTradesIntoSessions = (
  currentSessions: TradeSessionRecord[],
  sourceFileName: string,
  groupedTrades: GroupedTrade[]
): TradeSessionRecord[] => {
  const now = new Date().toISOString();
  const nextSessions = new Map<string, TradeSessionRecord>(
    currentSessions.map((session) => [session.tradeDate, session])
  );

  const tradesByDate = new Map<string, GroupedTrade[]>();
  for (const trade of groupedTrades) {
    const current = tradesByDate.get(trade.tradeDate) ?? [];
    current.push(trade);
    tradesByDate.set(trade.tradeDate, current);
  }

  for (const [tradeDate, trades] of tradesByDate.entries()) {
    const existingSession = nextSessions.get(tradeDate);
    const sortedTrades = [...trades].sort((left, right) =>
      `${left.tradeDate} ${left.openTime}`.localeCompare(`${right.tradeDate} ${right.openTime}`)
    );

    if (!existingSession) {
      nextSessions.set(tradeDate, {
        tradeDate,
        trades: sortedTrades,
        sourceFileName,
        importedAt: now,
        updatedAt: now
      });
      continue;
    }

    nextSessions.set(tradeDate, {
      ...existingSession,
      sourceFileName,
      trades: sortedTrades,
      updatedAt: now
    });
  }

  return Array.from(nextSessions.values()).sort((left, right) => right.tradeDate.localeCompare(left.tradeDate));
};
