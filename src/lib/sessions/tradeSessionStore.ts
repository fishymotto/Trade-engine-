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

const stableStringify = (value: unknown): string => {
  if (value === null || value === undefined || typeof value !== "object") {
    return JSON.stringify(value) ?? "undefined";
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
};

const getSerializedSize = (value: unknown): number => {
  try {
    return stableStringify(value).length;
  } catch {
    return 0;
  }
};

const parseTimestamp = (value: string | undefined): number => {
  if (!value?.trim()) {
    return 0;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const pickOldestTimestamp = (left: string, right: string): string => {
  const leftTimestamp = parseTimestamp(left);
  const rightTimestamp = parseTimestamp(right);

  if (leftTimestamp > 0 && (rightTimestamp <= 0 || leftTimestamp <= rightTimestamp)) {
    return left;
  }

  return rightTimestamp > 0 ? right : left || right;
};

const pickNewestTimestamp = (left: string, right: string): string => {
  const leftTimestamp = parseTimestamp(left);
  const rightTimestamp = parseTimestamp(right);

  if (rightTimestamp > leftTimestamp) {
    return right;
  }

  return leftTimestamp > rightTimestamp ? left : right || left;
};

const countTextValues = (values: unknown): number =>
  Array.isArray(values) ? values.filter((value) => typeof value === "string" && value.trim()).length : 0;

const getTradeRichnessScore = (trade: GroupedTrade): number =>
  countTextValues(trade.setups) * 20 +
  countTextValues(trade.mistakes) * 10 +
  countTextValues(trade.catalyst) * 5 +
  countTextValues(trade.outTag) +
  countTextValues(trade.execution) +
  (trade.game ? 1 : 0);

const pickRicherTrade = (left: GroupedTrade, right: GroupedTrade): GroupedTrade => {
  const leftScore = getTradeRichnessScore(left);
  const rightScore = getTradeRichnessScore(right);

  if (rightScore > leftScore) {
    return right;
  }

  if (leftScore > rightScore) {
    return left;
  }

  return getSerializedSize(right) >= getSerializedSize(left) ? right : left;
};

const getTradeMergeKey = (trade: GroupedTrade): string =>
  trade.id?.trim() ||
  [trade.tradeDate, trade.symbol, trade.openTime, trade.closeTime, trade.name]
    .map((value) => value?.trim())
    .filter(Boolean)
    .join("|");

const sortTradesByTime = (trades: GroupedTrade[]): GroupedTrade[] =>
  [...trades].sort((left, right) =>
    `${left.tradeDate} ${left.openTime} ${left.closeTime} ${left.id}`.localeCompare(
      `${right.tradeDate} ${right.openTime} ${right.closeTime} ${right.id}`
    )
  );

const mergeSessionTrades = (
  existingTrades: GroupedTrade[],
  incomingTrades: GroupedTrade[]
): GroupedTrade[] => {
  const merged = new Map<string, GroupedTrade>();

  const upsert = (trade: GroupedTrade) => {
    const key = getTradeMergeKey(trade);
    if (!key) {
      return;
    }

    const current = merged.get(key);
    merged.set(key, current ? pickRicherTrade(current, trade) : trade);
  };

  existingTrades.forEach(upsert);
  incomingTrades.forEach(upsert);

  return sortTradesByTime(Array.from(merged.values()));
};

const mergeTradeSessionRecord = (
  existing: TradeSessionRecord,
  incoming: TradeSessionRecord
): TradeSessionRecord => ({
  ...existing,
  ...incoming,
  tradeDate: incoming.tradeDate || existing.tradeDate,
  sourceFileName: incoming.sourceFileName || existing.sourceFileName,
  importedAt: pickOldestTimestamp(existing.importedAt, incoming.importedAt),
  updatedAt: pickNewestTimestamp(existing.updatedAt, incoming.updatedAt),
  trades: mergeSessionTrades(existing.trades, incoming.trades)
});

const mergeTradeSessions = (...sets: TradeSessionRecord[][]): TradeSessionRecord[] => {
  const merged = new Map<string, TradeSessionRecord>();

  for (const sessions of sets) {
    for (const session of normalizeSessions(sessions)) {
      const tradeDate = session.tradeDate?.trim();
      if (!tradeDate) {
        continue;
      }

      const current = merged.get(tradeDate);
      merged.set(tradeDate, current ? mergeTradeSessionRecord(current, session) : session);
    }
  }

  return Array.from(merged.values()).sort((left, right) => right.tradeDate.localeCompare(left.tradeDate));
};

const areSessionsEqual = (left: TradeSessionRecord[], right: TradeSessionRecord[]): boolean =>
  stableStringify(left) === stableStringify(right);

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

  if (!allowLegacyDesktopBackup) {
    return localSessions;
  }

  const desktopSessions = await readTradeSessionsFromDesktopBackup();
  if (!desktopSessions) {
    return localSessions;
  }

  const mergedSessions = mergeTradeSessions(desktopSessions, localSessions);
  if (!areSessionsEqual(mergedSessions, localSessions)) {
    void syncStores.tradeSessions.save(mergedSessions);
  }

  if (!areSessionsEqual(mergedSessions, desktopSessions)) {
    void invoke("save_trade_sessions", { sessions: mergedSessions }).catch((error) => {
      if (isTauri()) {
        console.warn("[sessions] Failed to refresh merged desktop trade sessions backup.", error);
      }
    });
  }

  return mergedSessions;
};

interface SaveTradeSessionsOptions {
  mergeDesktopBackup?: boolean;
}

export const saveTradeSessions = async (
  sessions: TradeSessionRecord[],
  options: SaveTradeSessionsOptions = {}
): Promise<void> => {
  const activeUserId = syncStores.tradeSessions.getUserId();
  const allowLegacyDesktopBackup = canUseMachineLegacyData(activeUserId);
  const desktopSessions = allowLegacyDesktopBackup ? await readTradeSessionsFromDesktopBackup() : null;
  const sessionsForSave =
    options.mergeDesktopBackup && desktopSessions
      ? mergeTradeSessions(desktopSessions, sessions)
      : normalizeSessions(sessions);

  const syncPromise = syncStores.tradeSessions.save(sessionsForSave);

  if (!allowLegacyDesktopBackup) {
    await syncPromise;
    return;
  }

  try {
    await invoke("save_trade_sessions", { sessions: sessionsForSave });
  } catch (error) {
    if (isTauri()) {
      console.warn("[sessions] Failed to save desktop trade sessions backup.", error);
    }
  }

  await syncPromise;
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
