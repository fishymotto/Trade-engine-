import { useEffect, useRef } from "react";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  HistogramSeries,
  LineSeries,
  type IChartApi,
  type ISeriesMarkersPluginApi,
  type ISeriesApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp
} from "lightweight-charts";
import type { ChartInterval, HistoricalBar } from "../types/chart";
import type { GroupedTrade } from "../types/trade";

interface TradeChartProps {
  bars: HistoricalBar[];
  trade: GroupedTrade | null;
  height?: number;
  showMarkers?: boolean;
  showEma?: boolean;
  focusMode?: "trade" | "day";
  regularSessionOnly?: boolean;
  interval?: ChartInterval;
}

const FAST_EMA_PERIOD = 9;
const SLOW_EMA_PERIOD = 12;

const toTradeTimestamp = (tradeDate: string, time: string): number => {
  const parsed = new Date(`${tradeDate}T${time}`);
  return Math.floor(parsed.getTime() / 1000);
};

const getNearestBarTime = (bars: HistoricalBar[], targetTime: number): UTCTimestamp => {
  if (bars.length === 0) {
    return targetTime as UTCTimestamp;
  }

  let nearest = bars[0];
  let nearestDistance = Math.abs(bars[0].time - targetTime);

  for (const bar of bars) {
    const distance = Math.abs(bar.time - targetTime);
    if (distance < nearestDistance) {
      nearest = bar;
      nearestDistance = distance;
    }
  }

  return nearest.time as UTCTimestamp;
};

const buildEmaSeries = (bars: HistoricalBar[], period: number) => {
  const multiplier = 2 / (period + 1);
  let ema: number | null = null;

  return bars.map((bar, index) => {
    if (ema === null) {
      ema = bar.close;
    } else {
      ema = bar.close * multiplier + ema * (1 - multiplier);
    }

    return {
      time: bar.time as UTCTimestamp,
      value: Number((index === 0 ? bar.close : ema).toFixed(4))
    };
  });
};

const buildVwapSeries = (bars: HistoricalBar[]) => {
  let cumulativePriceVolume = 0;
  let cumulativeVolume = 0;

  return bars
    .filter((bar) => typeof bar.volume === "number" && bar.volume > 0)
    .map((bar) => {
      const typicalPrice = (bar.high + bar.low + bar.close) / 3;
      cumulativePriceVolume += typicalPrice * (bar.volume ?? 0);
      cumulativeVolume += bar.volume ?? 0;

      return {
        time: bar.time as UTCTimestamp,
        value: Number((cumulativePriceVolume / cumulativeVolume).toFixed(4))
      };
    });
};

const buildVolumeSeries = (bars: HistoricalBar[]) =>
  bars
    .filter((bar) => typeof bar.volume === "number")
    .map((bar) => ({
      time: bar.time as UTCTimestamp,
      value: bar.volume ?? 0,
      color: bar.close >= bar.open ? "rgba(46, 230, 214, 0.72)" : "rgba(180, 46, 255, 0.72)"
    }));

const isRegularSessionBar = (bar: HistoricalBar): boolean => {
  const date = new Date(bar.time * 1000);
  const totalMinutes = date.getHours() * 60 + date.getMinutes();
  const sessionOpen = 9 * 60 + 30;
  const sessionClose = 16 * 60;

  return totalMinutes >= sessionOpen && totalMinutes <= sessionClose;
};

const getMinuteBucketStart = (timestamp: number, minutes: number): number => {
  const date = new Date(timestamp * 1000);
  date.setSeconds(0, 0);
  const bucketMinutes = Math.floor(date.getMinutes() / minutes) * minutes;
  date.setMinutes(bucketMinutes, 0, 0);
  return Math.floor(date.getTime() / 1000);
};

const getHourBucketStart = (timestamp: number, hours: number): number => {
  const date = new Date(timestamp * 1000);
  date.setMinutes(0, 0, 0);
  const bucketHours = Math.floor(date.getHours() / hours) * hours;
  date.setHours(bucketHours, 0, 0, 0);
  return Math.floor(date.getTime() / 1000);
};

const getWeekBucketStart = (timestamp: number): number => {
  const date = new Date(timestamp * 1000);
  date.setHours(0, 0, 0, 0);
  const day = date.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diffToMonday);
  return Math.floor(date.getTime() / 1000);
};

const aggregateBars = (bars: HistoricalBar[], interval: ChartInterval): HistoricalBar[] => {
  if (interval === "1m" || interval === "1D") {
    return bars;
  }

  const getBucketStart = (timestamp: number): number => {
    switch (interval) {
      case "5m":
        return getMinuteBucketStart(timestamp, 5);
      case "15m":
        return getMinuteBucketStart(timestamp, 15);
      case "1h":
        return getHourBucketStart(timestamp, 1);
      case "1W":
        return getWeekBucketStart(timestamp);
      default:
        return timestamp;
    }
  };

  const aggregated: HistoricalBar[] = [];

  for (const bar of bars) {
    const bucketTime = getBucketStart(bar.time);
    const previous = aggregated[aggregated.length - 1];

    if (!previous || previous.time !== bucketTime) {
      aggregated.push({
        time: bucketTime,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume
      });
      continue;
    }

    previous.high = Math.max(previous.high, bar.high);
    previous.low = Math.min(previous.low, bar.low);
    previous.close = bar.close;
    previous.volume = (previous.volume ?? 0) + (bar.volume ?? 0);
  }

  return aggregated;
};

const buildTradeMarkers = (bars: HistoricalBar[], trade: GroupedTrade | null): SeriesMarker<Time>[] => {
  if (!trade || bars.length === 0) {
    return [];
  }

  const isLong = trade.side === "Long";
  const markers: SeriesMarker<Time>[] = [];

  for (const execution of trade.openingExecutions.slice(0, 1)) {
    markers.push({
      time: getNearestBarTime(bars, toTradeTimestamp(execution.tradeDate, execution.time)),
      position: isLong ? "belowBar" : "aboveBar",
      shape: isLong ? "arrowUp" : "arrowDown",
      color: "#2ee6a6",
      text: "Entry"
    });
  }

  trade.addSignals.forEach((signal, index) => {
    const execution = trade.openingExecutions[index + 1];
    if (!execution) {
      return;
    }

    markers.push({
      time: getNearestBarTime(bars, toTradeTimestamp(execution.tradeDate, execution.time)),
      position: isLong ? "belowBar" : "aboveBar",
      shape: isLong ? "arrowUp" : "arrowDown",
      color: signal.addedToWinner ? "#5da8ff" : "#ffcf5a",
      text: signal.addedToWinner ? "Add+" : signal.averagedDown ? "Add-" : "Add"
    });
  });

  for (const execution of trade.closingExecutions) {
    markers.push({
      time: getNearestBarTime(bars, toTradeTimestamp(execution.tradeDate, execution.time)),
      position: isLong ? "aboveBar" : "belowBar",
      shape: isLong ? "arrowDown" : "arrowUp",
      color: "#ff7b7b",
      text: "Exit"
    });
  }

  return markers;
};

export const TradeChart = ({
  bars,
  trade,
  height = 500,
  showMarkers = true,
  showEma = true,
  focusMode = "trade",
  regularSessionOnly = false,
  interval = "1m"
}: TradeChartProps) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const fastEmaSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const slowEmaSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const vwapSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const chart = createChart(containerRef.current, {
      autoSize: true,
      height,
      layout: {
        background: { type: ColorType.Solid, color: "#05070b" },
        textColor: "#a1a8b8",
        attributionLogo: false
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.05)", style: 2 },
        horzLines: { color: "rgba(255,255,255,0.05)", style: 2 }
      },
      rightPriceScale: {
        borderColor: "rgba(255,255,255,0.12)"
      },
      timeScale: {
        borderColor: "rgba(255,255,255,0.12)",
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 8,
        barSpacing: 10
      },
      crosshair: {
        vertLine: { color: "rgba(255, 0, 191, 0.35)", style: 2, labelBackgroundColor: "#f000c0" },
        horzLine: { color: "rgba(255, 255, 255, 0.18)", style: 2, labelBackgroundColor: "#3c63ff" }
      }
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#2ee6d6",
      downColor: "#b42eff",
      wickUpColor: "#2ee6d6",
      wickDownColor: "#b42eff",
      borderVisible: false,
      priceLineVisible: false,
      lastValueVisible: true
    });

    const fastEmaSeries = chart.addSeries(LineSeries, {
      color: "#d3d7df",
      lineWidth: 2,
      crosshairMarkerVisible: false,
      priceLineVisible: false,
      lastValueVisible: false
    });

    const slowEmaSeries = chart.addSeries(LineSeries, {
      color: "#7bb6ff",
      lineWidth: 2,
      crosshairMarkerVisible: false,
      priceLineVisible: false,
      lastValueVisible: false
    });

    const vwapSeries = chart.addSeries(LineSeries, {
      color: "#d92d5b",
      lineWidth: 2,
      crosshairMarkerVisible: false,
      priceLineVisible: false,
      lastValueVisible: false
    });

    const volumeSeries = chart.addSeries(
      HistogramSeries,
      {
        priceFormat: {
          type: "volume"
        },
        priceLineVisible: false,
        lastValueVisible: false,
        base: 0
      },
      1
    );
    volumeSeries.priceScale().applyOptions({
      scaleMargins: {
        top: 0.12,
        bottom: 0
      }
    });
    series.priceScale().applyOptions({
      scaleMargins: {
        top: 0.08,
        bottom: 0.22
      }
    });

    chartRef.current = chart;
    seriesRef.current = series;
    fastEmaSeriesRef.current = fastEmaSeries;
    slowEmaSeriesRef.current = slowEmaSeries;
    vwapSeriesRef.current = vwapSeries;
    volumeSeriesRef.current = volumeSeries;
    markersRef.current = createSeriesMarkers(series, []);

    return () => {
      markersRef.current?.detach();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      fastEmaSeriesRef.current = null;
      slowEmaSeriesRef.current = null;
      vwapSeriesRef.current = null;
      volumeSeriesRef.current = null;
      markersRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (
      !seriesRef.current ||
      !fastEmaSeriesRef.current ||
      !slowEmaSeriesRef.current ||
      !vwapSeriesRef.current ||
      !volumeSeriesRef.current ||
      !chartRef.current
    ) {
      return;
    }

    const sourceBars = regularSessionOnly ? bars.filter(isRegularSessionBar) : bars;
    const displayBars = aggregateBars(sourceBars, interval);

    const formattedBars = displayBars.map((bar) => ({
      time: bar.time as UTCTimestamp,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close
    }));

    seriesRef.current.setData(formattedBars);
    fastEmaSeriesRef.current.setData(showEma ? buildEmaSeries(displayBars, FAST_EMA_PERIOD) : []);
    slowEmaSeriesRef.current.setData(showEma ? buildEmaSeries(displayBars, SLOW_EMA_PERIOD) : []);
    vwapSeriesRef.current.setData(buildVwapSeries(displayBars));
    volumeSeriesRef.current.setData(buildVolumeSeries(displayBars));
    markersRef.current?.setMarkers(showMarkers ? buildTradeMarkers(displayBars, trade) : []);

    if (displayBars.length === 0) {
      return;
    }

    if (!trade || focusMode === "day") {
      chartRef.current.timeScale().fitContent();
      return;
    }

    const from = toTradeTimestamp(trade.tradeDate, trade.openTime) - 15 * 60;
    const to = toTradeTimestamp(trade.tradeDate, trade.closeTime) + 15 * 60;
    chartRef.current.timeScale().setVisibleRange({
      from: getNearestBarTime(displayBars, from),
      to: getNearestBarTime(displayBars, to)
    });
  }, [bars, focusMode, height, interval, regularSessionOnly, showEma, showMarkers, trade]);

  return <div ref={containerRef} className="trade-chart-canvas" />;
};
