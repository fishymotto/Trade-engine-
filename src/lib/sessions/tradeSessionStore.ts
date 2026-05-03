import { invoke, isTauri } from "@tauri-apps/api/core";
import type { TradeSessionRecord } from "../../types/session";
import type { GroupedTrade } from "../../types/trade";
import { canUseMachineLegacyData, syncStores } from "../sync/syncStore";

const normalizeSessions = (value: unknown): TradeSessionRecord[] => {
  const normalizeTradeMistakes = <T extends TradeSessionRecord>(session: T): T => ({
    ...session,
    trades: session.trades.map((trade) => ({
      ...trade,
      mistakes: (() => {
        const rawMistakes = (trade as { mistakes?: unknown }).mistakes;
        if (Array.isArray(rawMistakes)) {
          return rawMistakes.filter(
            (item): item is string => typeof item === "string" && item.trim().length > 0
          );
        }

        if (typeof rawMistakes === "string") {
          return rawMistakes.trim().length > 0 ? [rawMistakes.trim()] : [];
        }

        return [];
      })()
    }))
  });

  if (Array.isArray(value)) {
    return (value as TradeSessionRecord[]).map(normalizeTradeMistakes);
  }

  if (value && typeof value === "object" && "value" in value && Array.isArray((value as { value?: unknown }).value)) {
    return (value as { value: TradeSessionRecord[] }).value.map(normalizeTradeMistakes);
  }

  return [];
};

const countTradeTags = (sessions: TradeSessionRecord[]): number =>
  sessions.reduce(
    (sessionTotal, session) =>
      sessionTotal +
      session.trades.reduce((tradeTotal, trade) => {
        const playbookCount = Array.isArray(trade.setups) ? trade.setups.filter(Boolean).length : 0;
        const mistakeCount = Array.isArray(trade.mistakes) ? trade.mistakes.filter(Boolean).length : 0;
        const catalystCount = Array.isArray(trade.catalyst) ? trade.catalyst.filter(Boolean).length : 0;
        const outTagCount = Array.isArray(trade.outTag) ? trade.outTag.filter(Boolean).length : 0;
        const executionCount = Array.isArray(trade.execution) ? trade.execution.filter(Boolean).length : 0;
        const gameCount = trade.game ? 1 : 0;
        return tradeTotal + playbookCount * 20 + mistakeCount * 10 + catalystCount * 5 + outTagCount + executionCount + gameCount;
      }, 0),
    0
  );

const countTrades = (sessions: TradeSessionRecord[]): number =>
  sessions.reduce((total, session) => total + session.trades.length, 0);

const shouldUseDesktopSessionsForRecovery = (
  localSessions: TradeSessionRecord[],
  desktopSessions: TradeSessionRecord[]
): boolean => {
  if (desktopSessions.length === 0) {
    return false;
  }

  const localTradeCount = countTrades(localSessions);
  const desktopTradeCount = countTrades(desktopSessions);
  if (desktopTradeCount > localTradeCount) {
    return true;
  }

  if (desktopTradeCount < localTradeCount) {
    return false;
  }

  return countTradeTags(desktopSessions) > countTradeTags(localSessions);
};

const readTradeSessionsFromDesktopBackup = async (): Promise<TradeSessionRecord[] | null> => {
  try {
    const sessions = await invoke<unknown>("load_trade_sessions");
    return normalizeSessions(sessions);
  } catch {
    return null;
  }
};

export const loadTradeSessions = async (): Promise<TradeSessionRecord[]> => {
  const localSessions = normalizeSessions(syncStores.tradeSessions.load<unknown>([]));
  const activeUserId = syncStores.tradeSessions.getUserId();
  const allowLegacyDesktopBackup = canUseMachineLegacyData(activeUserId);

  const desktopSessions = await readTradeSessionsFromDesktopBackup();
  if (
    desktopSessions &&
    (allowLegacyDesktopBackup || shouldUseDesktopSessionsForRecovery(localSessions, desktopSessions)) &&
    shouldUseDesktopSessionsForRecovery(localSessions, desktopSessions)
  ) {
    return desktopSessions;
  }

  return localSessions;
};

export const saveTradeSessions = async (sessions: TradeSessionRecord[]): Promise<void> => {
  await syncStores.tradeSessions.save(sessions);

  const desktopSessions = await readTradeSessionsFromDesktopBackup();
  if (desktopSessions && shouldUseDesktopSessionsForRecovery(sessions, desktopSessions)) {
    console.warn("[sessions] Skipped lossy desktop session write to protect richer backup.");
    return;
  }

  try {
    await invoke("save_trade_sessions", { sessions });
  } catch (error) {
    if (isTauri()) {
      console.warn("[sessions] Failed to save desktop trade sessions backup.", error);
    }
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
