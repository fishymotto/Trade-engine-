import { invoke, isTauri } from "@tauri-apps/api/core";
import type { TradeTagOverrideRecord } from "../../types/tradeTags";
import { canUseMachineLegacyData, syncStores } from "../sync/syncStore";

const STORAGE_KEY = "trade-engine-trade-tag-overrides";
const LOSSY_OVERRIDE_DROP_RATIO = 0.35;
const LOSSY_OVERRIDE_MIN_EXISTING = 200;
const LOSSY_OVERRIDE_NEWER_GRACE_MS = 1000 * 60 * 60 * 24 * 30;

const normalizeTradeTagOverrideRow = (row: TradeTagOverrideRecord): TradeTagOverrideRecord => {
  const rawMistakes = (row as { mistakes?: unknown }).mistakes;
  const mistakes = Array.isArray(rawMistakes)
    ? rawMistakes.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : typeof rawMistakes === "string"
      ? rawMistakes.trim()
        ? [rawMistakes.trim()]
        : []
      : row.mistake
        ? [row.mistake]
        : [];

  return {
    ...row,
    mistake: mistakes[0] ?? row.mistake ?? null,
    mistakes
  };
};

const normalizeTradeTagOverrides = (value: unknown): TradeTagOverrideRecord[] => {
  if (Array.isArray(value)) {
    return (value as TradeTagOverrideRecord[]).map(normalizeTradeTagOverrideRow);
  }

  if (
    value &&
    typeof value === "object" &&
    "value" in value &&
    Array.isArray((value as { value?: unknown }).value)
  ) {
    return (value as { value: TradeTagOverrideRecord[] }).value.map(normalizeTradeTagOverrideRow);
  }

  return [];
};

const loadTradeTagOverridesFromLocalStorage = (): TradeTagOverrideRecord[] => {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return [];
  }

  try {
    return normalizeTradeTagOverrides(JSON.parse(raw));
  } catch {
    return [];
  }
};

const readTradeTagOverridesFromDesktopBackup = async (): Promise<TradeTagOverrideRecord[] | null> => {
  try {
    const overrides = await invoke<unknown>("load_trade_tag_overrides");
    return normalizeTradeTagOverrides(overrides);
  } catch {
    return null;
  }
};

const parseTimestamp = (value: string | undefined): number => {
  if (!value || !value.trim()) {
    return 0;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const getLatestUpdatedAt = (rows: TradeTagOverrideRecord[]): number =>
  rows.reduce((latest, row) => Math.max(latest, parseTimestamp(row.updatedAt)), 0);

const countOverrideRichness = (rows: TradeTagOverrideRecord[]): number =>
  rows.reduce((total, row) => {
    const mistakes = Array.isArray(row.mistakes) ? row.mistakes.filter(Boolean).length : row.mistake ? 1 : 0;
    const catalyst = Array.isArray(row.catalyst) ? row.catalyst.filter(Boolean).length : 0;
    return (
      total +
      (row.playbook ? 20 : 0) +
      mistakes * 10 +
      catalyst * 5 +
      (row.status ? 2 : 0) +
      (row.game ? 1 : 0) +
      (row.outTag ? 1 : 0) +
      (row.execution ? 1 : 0)
    );
  }, 0);

const shouldProtectDesktopOverrideWrite = (
  nextOverrides: TradeTagOverrideRecord[],
  existingDesktopOverrides: TradeTagOverrideRecord[]
): boolean => {
  if (existingDesktopOverrides.length < LOSSY_OVERRIDE_MIN_EXISTING) {
    return false;
  }

  const existingRichness = countOverrideRichness(existingDesktopOverrides);
  const nextRichness = countOverrideRichness(nextOverrides);
  const isLargeRichnessDrop = existingRichness >= LOSSY_OVERRIDE_MIN_EXISTING && nextRichness <= existingRichness * 0.5;
  const isLargeSizeDrop =
    nextOverrides.length <= existingDesktopOverrides.length * LOSSY_OVERRIDE_DROP_RATIO;
  if (!isLargeSizeDrop && !isLargeRichnessDrop) {
    return false;
  }

  const existingLatest = getLatestUpdatedAt(existingDesktopOverrides);
  const nextLatest = getLatestUpdatedAt(nextOverrides);
  const hasMajorNewerLead = nextLatest >= existingLatest + LOSSY_OVERRIDE_NEWER_GRACE_MS;

  return !hasMajorNewerLead;
};

const shouldUseDesktopOverridesForRecovery = (
  localOverrides: TradeTagOverrideRecord[],
  desktopOverrides: TradeTagOverrideRecord[]
): boolean => {
  if (desktopOverrides.length === 0) {
    return false;
  }

  if (localOverrides.length === 0) {
    return true;
  }

  if (desktopOverrides.length > localOverrides.length) {
    return true;
  }

  if (desktopOverrides.length === localOverrides.length) {
    return countOverrideRichness(desktopOverrides) > countOverrideRichness(localOverrides);
  }

  // Emergency safety net for clobbered caches: prefer substantially richer desktop snapshots.
  return (
    desktopOverrides.length >= LOSSY_OVERRIDE_MIN_EXISTING &&
    (localOverrides.length <= Math.max(50, Math.floor(desktopOverrides.length * LOSSY_OVERRIDE_DROP_RATIO)) ||
      countOverrideRichness(desktopOverrides) > countOverrideRichness(localOverrides))
  );
};

export const loadTradeTagOverrides = async (): Promise<TradeTagOverrideRecord[]> => {
  const localOverrides = loadTradeTagOverridesFromLocalStorage();
  const activeUserId = syncStores.tradeTagOverrides.getUserId();
  const allowLegacyDesktopBackup = canUseMachineLegacyData(activeUserId);

  const desktopOverrides = await readTradeTagOverridesFromDesktopBackup();
  if (desktopOverrides && desktopOverrides.length > 0) {
    const shouldUseDesktopOverrides =
      allowLegacyDesktopBackup && shouldUseDesktopOverridesForRecovery(localOverrides, desktopOverrides);
    const shouldUseEmergencyRecovery =
      !allowLegacyDesktopBackup && shouldUseDesktopOverridesForRecovery(localOverrides, desktopOverrides);

    if (shouldUseDesktopOverrides || shouldUseEmergencyRecovery) {
      if (shouldUseEmergencyRecovery) {
        console.warn(
          "[tags] Using richer desktop trade-tag overrides snapshot for recovery despite legacy ownership guard."
        );
      }

      return desktopOverrides;
    }
  }

  return localOverrides;
};

export const saveTradeTagOverrides = async (
  overrides: TradeTagOverrideRecord[]
): Promise<void> => {
  await syncStores.tradeTagOverrides.save(overrides);

  const existingDesktopOverrides = await readTradeTagOverridesFromDesktopBackup();
  if (
    existingDesktopOverrides &&
    shouldProtectDesktopOverrideWrite(overrides, existingDesktopOverrides)
  ) {
    console.warn("[tags] Skipped lossy desktop trade-tag override write to protect richer backup.");
    return;
  }

  try {
    await invoke("save_trade_tag_overrides", { overrides });
  } catch (error) {
    if (isTauri()) {
      console.warn("[tags] Failed to save desktop trade tag overrides backup.", error);
    }
  }
};
