import type { GameTag, GroupedTrade, TradeStatus } from "./trade";

export type EditableTradeTagField =
  | "status"
  | "mistake"
  | "playbook"
  | "catalyst"
  | "game"
  | "outTag"
  | "execution";

export interface TradeTagOverrideRecord {
  key: string;
  tradeDate: string;
  symbol: string;
  openTime: string;
  closeTime: string;
  status?: TradeStatus | null;
  // Legacy single-value field kept for backwards compatibility with saved overrides.
  mistake?: string | null;
  // New multi-select override for mistakes.
  mistakes?: string[] | null;
  playbook?: string | null;
  catalyst?: string[] | null;
  game?: GameTag | null;
  outTag?: string | null;
  execution?: string | null;
  updatedAt: string;
}

export interface EditableTradeRow extends GroupedTrade {
  overrideKey: string;
  manualTags: Partial<Record<EditableTradeTagField, boolean>>;
}

export type TradeTagOptionsRecord = Partial<Record<EditableTradeTagField, string[]>>;
