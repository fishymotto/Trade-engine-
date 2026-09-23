export type ChartInterval = "10s" | "1m" | "5m" | "15m" | "1h" | "1D" | "1W";

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
  tenSecondBars?: HistoricalBar[];
  tenSecondSourceFileName?: string;
  tenSecondUpdatedAt?: string;
  dailyBars?: HistoricalBar[];
  updatedAt: string;
}
