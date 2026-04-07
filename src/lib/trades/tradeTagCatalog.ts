import type { EditableTradeTagField, TradeTagOptionsRecord } from "../../types/tradeTags";

export const playbookOptions = [
  "6/12 EMA Cross",
  "Added to Position",
  "Broker Imbalance Numbers",
  "Buy Imbalance",
  "Counter Trend",
  "Data Dump",
  "Day High Break",
  "Day Low Break",
  "Down Trend",
  "Forced Trade",
  "Gap Fill",
  "Gap Give and Go",
  "Key Level Support",
  "Miss Punch",
  "Momentum Scalping",
  "Opening Drive",
  "Opening Drive Pre market High",
  "Opening Drive Wide Spread",
  "Pending Order",
  "Range Break",
  "Range Trade",
  "Round Level",
  "Sell Imbalance",
  "Spread Capture",
  "Stair Stepping",
  "Support Bounce",
  "Trend Trade",
  "Up Trend",
  "VWAP Bounce",
  "VWAP Breakdown",
  "VWAP Reject",
  "Volume push",
  "Whole Number Bounce",
  "Whole Number Break",
  "Whole Number Reject",
  "Wide Spread",
  "Wiggle and Jiggle"
];

export const mistakeOptions = [
  "Added to the Position",
  "Anticipation",
  "Bad Risk management",
  "Chased Price",
  "Early",
  "Early Exit",
  "Exit Hesitation",
  "Fifth Attempt",
  "Forced Trade",
  "Fourth Attempt",
  "Held Though the Number",
  "Imbalance Flip",
  "Imbalance Flipped",
  "In Range",
  "Late Entry",
  "Light Numbers",
  "Long Hold",
  "Miss Punch",
  "Only Got filled for Half",
  "PP8 Crash",
  "Paired off into Close",
  "Pending Order",
  "Pulled Down Target",
  "Scaled Out",
  "Second Attempt",
  "Small Buy Imbalance",
  "Small Size",
  "Smaller Notional Value For the Imbalance",
  "Spicy Tape",
  "Swiped",
  "Thin Book",
  "Third Attempt",
  "Too Fast of Tape",
  "Too Volatile",
  "Wrong Side",
  "Wrong Size on Locator"
];

export const statusOptions = ["Win", "Loss"];

export const gameOptions = ["A Game", "B+ Game", "B Game", "B- Game", "C Game"];

export const outTagOptions = ["Passive", "Aggressive", "Mixed"];

export const executionOptions = [
  "One Clip",
  "Scaled In",
  "Scaled Out",
  "Added to Winner",
  "Average Down"
];

export const tradeTagOptionsByField: Record<EditableTradeTagField, string[]> = {
  status: statusOptions,
  mistake: mistakeOptions,
  playbook: playbookOptions,
  game: gameOptions,
  outTag: outTagOptions,
  execution: executionOptions
};

export const buildTradeTagOptionsByField = (
  customOptions: TradeTagOptionsRecord = {}
): Record<EditableTradeTagField, string[]> => ({
  status: Array.from(new Set([...(tradeTagOptionsByField.status ?? []), ...(customOptions.status ?? [])])),
  mistake: Array.from(new Set([...(tradeTagOptionsByField.mistake ?? []), ...(customOptions.mistake ?? [])])),
  playbook: Array.from(new Set([...(tradeTagOptionsByField.playbook ?? []), ...(customOptions.playbook ?? [])])),
  game: Array.from(new Set([...(tradeTagOptionsByField.game ?? []), ...(customOptions.game ?? [])])),
  outTag: Array.from(new Set([...(tradeTagOptionsByField.outTag ?? []), ...(customOptions.outTag ?? [])])),
  execution: Array.from(new Set([...(tradeTagOptionsByField.execution ?? []), ...(customOptions.execution ?? [])]))
});

export const tradeTagFieldLabels: Record<EditableTradeTagField, string> = {
  status: "Status",
  mistake: "Mistakes",
  playbook: "Playbook",
  game: "Game",
  outTag: "Out Tag",
  execution: "Execution"
};
