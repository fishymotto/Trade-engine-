export type ChartInterval = "1m" | "5m" | "15m" | "1h" | "1D" | "1W";

export interface HistoricalBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface HistoricalBarSet {
  key: string;
  symbol: string;
  tradeDate: string;
  sourceFileName: string;
  bars: HistoricalBar[];
  dailyBars?: HistoricalBar[];
  updatedAt: string;
}
