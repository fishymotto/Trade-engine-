import { invoke, isTauri } from "@tauri-apps/api/core";
import type { TradeSessionRecord } from "../../types/session";
import type { GroupedTrade } from "../../types/trade";
import { syncStores } from "../sync/syncStore";

const STORAGE_KEY = "trade-engine-trade-sessions";

const normalizeSessions = (value: unknown): TradeSessionRecord[] =>
  Array.isArray(value) ? (value as TradeSessionRecord[]) : [];

const loadTradeSessionsFromDesktopBackup = async (): Promise<TradeSessionRecord[] | null> => {
  if (!isTauri()) {
    return null;
  }

  try {
    const sessions = await invoke<TradeSessionRecord[]>("load_trade_sessions");
    const normalized = normalizeSessions(sessions);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    return normalized;
  } catch {
    return null;
  }
};

export const loadTradeSessions = async (): Promise<TradeSessionRecord[]> => {
  const localSessions = syncStores.tradeSessions.load<TradeSessionRecord[]>([]);
  if (!isTauri()) {
    return localSessions;
  }

  const localRaw = localStorage.getItem(STORAGE_KEY);
  if (!localRaw || localSessions.length === 0) {
    const desktopSessions = await loadTradeSessionsFromDesktopBackup();
    if (desktopSessions && desktopSessions.length > 0) {
      return desktopSessions;
    }
  }

  return localSessions;
};

export const saveTradeSessions = async (sessions: TradeSessionRecord[]): Promise<void> => {
  await syncStores.tradeSessions.save(sessions);

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
