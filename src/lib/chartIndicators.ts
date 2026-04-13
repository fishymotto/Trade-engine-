import type { LineData, UTCTimestamp } from "lightweight-charts";
import type { HistoricalBar } from "../types/chart";

// Simple Moving Average helper
const calculateSMA = (values: number[], period: number): number[] => {
  const sma: number[] = [];
  for (let i = period - 1; i < values.length; i++) {
    const slice = values.slice(i - period + 1, i + 1);
    const avg = slice.reduce((a, b) => a + b, 0) / period;
    sma.push(avg);
  }
  return sma;
};

// Exponential Moving Average helper
const calculateEMA = (values: number[], period: number): number[] => {
  const ema: number[] = [];
  const multiplier = 2 / (period + 1);
  let currentEma = values.slice(0, period).reduce((a, b) => a + b, 0) / period;

  for (let i = period - 1; i < values.length; i++) {
    if (i === period - 1) {
      ema.push(currentEma);
    } else {
      currentEma = (values[i] - currentEma) * multiplier + currentEma;
      ema.push(currentEma);
    }
  }
  return ema;
};

// Standard Deviation helper
const calculateStdDev = (values: number[], period: number): number[] => {
  const stdDevs: number[] = [];
  for (let i = period - 1; i < values.length; i++) {
    const slice = values.slice(i - period + 1, i + 1);
    const avg = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((sum, val) => sum + Math.pow(val - avg, 2), 0) / period;
    stdDevs.push(Math.sqrt(variance));
  }
  return stdDevs;
};

export const calculateRsiSeries = (bars: HistoricalBar[], period = 14): LineData<UTCTimestamp>[] => {
  if (bars.length < period + 1) {
    return [];
  }

  const rsiData: LineData<UTCTimestamp>[] = [];
  const gains: number[] = [];
  const losses: number[] = [];

  for (let index = 1; index <= period; index += 1) {
    const change = bars[index].close - bars[index - 1].close;
    gains.push(change > 0 ? change : 0);
    losses.push(change < 0 ? Math.abs(change) : 0);
  }

  let averageGain = gains.reduce((sum, gain) => sum + gain, 0) / period;
  let averageLoss = losses.reduce((sum, loss) => sum + loss, 0) / period;

  for (let index = period; index < bars.length; index += 1) {
    if (index > period) {
      const change = bars[index].close - bars[index - 1].close;
      const gain = change > 0 ? change : 0;
      const loss = change < 0 ? Math.abs(change) : 0;

      averageGain = (averageGain * (period - 1) + gain) / period;
      averageLoss = (averageLoss * (period - 1) + loss) / period;
    }

    const relativeStrength = averageLoss === 0 ? 100 : averageGain / averageLoss;
    rsiData.push({
      time: bars[index].time as UTCTimestamp,
      value: Number((100 - 100 / (1 + relativeStrength)).toFixed(2))
    });
  }

  return rsiData;
};

export interface BollingerBandsData extends LineData<UTCTimestamp> {
  value: number;
  upper?: number;
  middle?: number;
  lower?: number;
}

export const calculateBollingerBands = (
  bars: HistoricalBar[],
  period = 20,
  stdDevMultiplier = 2
): BollingerBandsData[] => {
  if (bars.length < period) {
    return [];
  }

  const closes = bars.map((bar) => bar.close);
  const sma = calculateSMA(closes, period);
  const stdDev = calculateStdDev(closes, period);

  const result: BollingerBandsData[] = [];
  for (let i = period - 1; i < bars.length; i++) {
    const smaIndex = i - (period - 1);
    result.push({
      time: bars[i].time as UTCTimestamp,
      value: closes[i],
      middle: Number(sma[smaIndex].toFixed(2)),
      upper: Number((sma[smaIndex] + stdDev[smaIndex] * stdDevMultiplier).toFixed(2)),
      lower: Number((sma[smaIndex] - stdDev[smaIndex] * stdDevMultiplier).toFixed(2))
    });
  }

  return result;
};

export interface MACDData extends LineData<UTCTimestamp> {
  value: number;
  signal?: number;
  histogram?: number;
}

export const calculateMACD = (
  bars: HistoricalBar[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9
): MACDData[] => {
  if (bars.length < slowPeriod + signalPeriod - 1) {
    return [];
  }

  const closes = bars.map((bar) => bar.close);
  const fastEma = calculateEMA(closes, fastPeriod);
  const slowEma = calculateEMA(closes, slowPeriod);

  const macdLine: number[] = [];
  const startIndex = slowPeriod - 1;

  for (let i = startIndex; i < closes.length; i++) {
    const fastIndex = i - (fastPeriod - 1);
    const slowIndex = i - (slowPeriod - 1);
    if (fastIndex >= 0 && slowIndex >= 0) {
      macdLine.push(fastEma[fastIndex] - slowEma[slowIndex]);
    }
  }

  const signalLine = calculateEMA(macdLine, signalPeriod);
  const result: MACDData[] = [];

  for (let i = 0; i < macdLine.length; i++) {
    const barIndex = startIndex + i;
    const signalIndex = i - (signalPeriod - 1);
    const signal = signalIndex >= 0 ? signalLine[signalIndex] : undefined;

    result.push({
      time: bars[barIndex].time as UTCTimestamp,
      value: Number(macdLine[i].toFixed(4)),
      signal: signal ? Number(signal.toFixed(4)) : undefined,
      histogram: signal ? Number((macdLine[i] - signal).toFixed(4)) : undefined
    });
  }

  return result;
};

export interface StochasticData extends LineData<UTCTimestamp> {
  value: number;
  k?: number;
  d?: number;
}

export const calculateStochastic = (
  bars: HistoricalBar[],
  period = 14,
  kSmoothing = 3,
  dSmoothing = 3
): StochasticData[] => {
  if (bars.length < period) {
    return [];
  }

  const result: StochasticData[] = [];
  const kValues: number[] = [];

  // Calculate raw %K
  for (let i = period - 1; i < bars.length; i++) {
    const slice = bars.slice(i - period + 1, i + 1);
    const high = Math.max(...slice.map((bar) => bar.high));
    const low = Math.min(...slice.map((bar) => bar.low));
    const close = bars[i].close;

    const k = high === low ? 50 : ((close - low) / (high - low)) * 100;
    kValues.push(k);
  }

  // Smooth %K
  const smoothedK = calculateSMA(kValues, kSmoothing);

  // Calculate %D (SMA of smoothed %K)
  const smoothedD = calculateSMA(smoothedK, dSmoothing);

  for (let i = 0; i < smoothedK.length; i++) {
    const barIndex = period - 1 + kSmoothing - 1 + i;
    const dIndex = i - (dSmoothing - 1);

    if (barIndex < bars.length) {
      result.push({
        time: bars[barIndex].time as UTCTimestamp,
        value: Number(smoothedK[i].toFixed(2)),
        k: Number(smoothedK[i].toFixed(2)),
        d: dIndex >= 0 ? Number(smoothedD[dIndex].toFixed(2)) : undefined
      });
    }
  }

  return result;
};
