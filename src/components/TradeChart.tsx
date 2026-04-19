import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  HistogramSeries,
  LineStyle,
  LineSeries,
  type MouseEventParams,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type Time,
  type UTCTimestamp
} from "lightweight-charts";
import {
  calculateRsiSeries,
  calculateBollingerBands,
  calculateMACD,
  calculateStochastic
} from "../lib/chartIndicators";
import type { ChartInterval, HistoricalBar } from "../types/chart";
import type { TradeChartDrawing } from "../types/review";
import type { GroupedTrade } from "../types/trade";

export interface TradeChartLayerVisibility {
  entry: boolean;
  addToWinner: boolean;
  averageDown: boolean;
  exit: boolean;
  ema9: boolean;
  ema12: boolean;
  open: boolean;
  hod: boolean;
  lod: boolean;
  vwap: boolean;
  volume: boolean;
  rsi: boolean;
  bollingerBands: boolean;
  macd: boolean;
  stochastic: boolean;
}

interface TradeChartProps {
  bars: HistoricalBar[];
  trade: GroupedTrade | null;
  height?: number;
  fillHeight?: boolean;
  showMarkers?: boolean;
  showEma?: boolean;
  focusMode?: "trade" | "day";
  regularSessionOnly?: boolean;
  interval?: ChartInterval;
  drawings?: TradeChartDrawing[];
  onDrawingsChange?: (drawings: TradeChartDrawing[]) => void;
  showDrawingTools?: boolean;
  layerVisibility?: TradeChartLayerVisibility;
  onToggleLayerVisibility?: (layer: keyof TradeChartLayerVisibility) => void;
  availableIntervals?: ChartInterval[];
  onChangeInterval?: (interval: ChartInterval) => void;
}

type DrawingTool = "cursor" | "trendline" | "horizontal" | "vertical" | "fibonacci" | "pitchfork" | "channel";

const drawingToolOptions: Array<{
  key: DrawingTool;
  label: string;
  railLabel: string;
  description: string;
  requiresBars?: boolean;
  category?: "basic" | "advanced";
}> = [
  {
    key: "cursor",
    label: "Cursor",
    railLabel: "Move",
    description: "Select or move around the chart",
    category: "basic"
  },
  {
    key: "trendline",
    label: "Trend line",
    railLabel: "/",
    description: "Click two points to draw a trend line",
    requiresBars: true,
    category: "basic"
  },
  {
    key: "horizontal",
    label: "Horizontal line",
    railLabel: "-",
    description: "Click one price level",
    requiresBars: true,
    category: "basic"
  },
  {
    key: "vertical",
    label: "Vertical line",
    railLabel: "|",
    description: "Click one time level",
    requiresBars: true,
    category: "basic"
  },
  {
    key: "fibonacci",
    label: "Fibonacci Retracement",
    railLabel: "Fib",
    description: "Click low, then high to draw Fibonacci levels",
    requiresBars: true,
    category: "advanced"
  },
  {
    key: "pitchfork",
    label: "Andrews Pitchfork",
    railLabel: "Fork",
    description: "Click 3 points: pivot, left, right",
    requiresBars: true,
    category: "advanced"
  },
  {
    key: "channel",
    label: "Parallel Channel",
    railLabel: "Chan",
    description: "Click 3 points to define parallel channel",
    requiresBars: true,
    category: "advanced"
  }
];

interface DrawingPoint {
  x: number;
  y: number;
  time: number;
  price: number;
}

interface ExecutionMarkerPoint {
  id: string;
  time: number;
  price: number;
  kind: "entry" | "addToWinner" | "averageDown" | "exit";
}

type DrawingDragTarget =
  | { id: string; type: "trendline-start" }
  | { id: string; type: "trendline-end" }
  | { id: string; type: "horizontal" }
  | { id: string; type: "vertical" };

interface IndicatorItem {
  key: keyof TradeChartLayerVisibility;
  label: string;
  colorClass: string;
  value?: string;
}

interface DrawingContextMenu {
  drawingId: string;
  x: number;
  y: number;
}

const FAST_EMA_PERIOD = 9;
const SLOW_EMA_PERIOD = 12;
const intervalLabels: Record<ChartInterval, string> = {
  "1m": "1m",
  "5m": "5m",
  "15m": "15m",
  "1h": "1h",
  "1D": "1D",
  "1W": "1W"
};

const defaultLayerVisibility: TradeChartLayerVisibility = {
  entry: true,
  addToWinner: true,
  averageDown: true,
  exit: true,
  ema9: true,
  ema12: true,
  open: true,
  hod: true,
  lod: true,
  vwap: true,
  volume: true,
  rsi: false,
  bollingerBands: false,
  macd: false,
  stochastic: false
};

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

const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

const normalizeBars = (bars: HistoricalBar[]): HistoricalBar[] => {
  const sortedBars = bars
    .filter(
      (bar) =>
        isFiniteNumber(bar.time) &&
        bar.time > 0 &&
        isFiniteNumber(bar.open) &&
        isFiniteNumber(bar.high) &&
        isFiniteNumber(bar.low) &&
        isFiniteNumber(bar.close)
    )
    .map((bar) => ({
      time: bar.time,
      open: bar.open,
      high: Math.max(bar.high, bar.open, bar.close, bar.low),
      low: Math.min(bar.low, bar.open, bar.close, bar.high),
      close: bar.close,
      volume: isFiniteNumber(bar.volume) ? Math.max(0, bar.volume) : undefined
    }))
    .sort((left, right) => left.time - right.time);

  const normalizedBars: HistoricalBar[] = [];

  for (const bar of sortedBars) {
    const previous = normalizedBars[normalizedBars.length - 1];

    if (previous?.time === bar.time) {
      previous.high = Math.max(previous.high, bar.high);
      previous.low = Math.min(previous.low, bar.low);
      previous.close = bar.close;
      previous.volume = (previous.volume ?? 0) + (bar.volume ?? 0);
      continue;
    }

    normalizedBars.push({ ...bar });
  }

  return normalizedBars;
};

const buildFlatPriceSeries = (bars: HistoricalBar[], value: number) =>
  bars.map((bar) => ({
    time: bar.time as UTCTimestamp,
    value: Number(value.toFixed(4))
  }));

const toUtcTimestamp = (time: Time | undefined): number | null => {
  if (typeof time === "number") {
    return time;
  }

  if (typeof time === "string") {
    return Math.floor(new Date(time).getTime() / 1000);
  }

  if (!time) {
    return null;
  }

  if (typeof time === "object" && "year" in time && "month" in time && "day" in time) {
    return Math.floor(Date.UTC(time.year, time.month - 1, time.day) / 1000);
  }

  return null;
};

const findBarByTime = (bars: HistoricalBar[], timestamp: number | null) => {
  if (timestamp === null) {
    return bars.length > 0 ? bars[bars.length - 1] : null;
  }

  return bars.find((bar) => bar.time === timestamp) ?? (bars.length > 0 ? bars[bars.length - 1] : null);
};

const formatVolume = (value?: number) => {
  if (typeof value !== "number") {
    return "--";
  }

  return value.toLocaleString();
};

const formatTimestampLabel = (timestamp: number, interval: ChartInterval) => {
  const date = new Date(timestamp * 1000);
  if (interval === "1D" || interval === "1W") {
    return date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric"
    });
  }

  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
};

const createDrawingId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

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

const buildExecutionMarkers = (
  bars: HistoricalBar[],
  trade: GroupedTrade | null,
  layerVisibility: TradeChartLayerVisibility
): ExecutionMarkerPoint[] => {
  if (!trade || bars.length === 0) {
    return [];
  }

  const markers: ExecutionMarkerPoint[] = [];

  if (layerVisibility.entry) {
    for (const [index, execution] of trade.openingExecutions.slice(0, 1).entries()) {
      markers.push({
        id: `entry-${execution.sourceIndex}-${index}`,
        time: getNearestBarTime(bars, toTradeTimestamp(execution.tradeDate, execution.time)),
        price: execution.price,
        kind: "entry"
      });
    }
  }

  trade.addSignals.forEach((signal, index) => {
    const execution = trade.openingExecutions[index + 1];
    if (!execution) {
      return;
    }

    if (signal.addedToWinner && !layerVisibility.addToWinner) {
      return;
    }

    if (!signal.addedToWinner && !layerVisibility.averageDown) {
      return;
    }

    markers.push({
      id: `${signal.addedToWinner ? "add-to-winner" : "average-down"}-${execution.sourceIndex}-${index}`,
      time: getNearestBarTime(bars, toTradeTimestamp(execution.tradeDate, execution.time)),
      price: execution.price,
      kind: signal.addedToWinner ? "addToWinner" : "averageDown"
    });
  });

  if (layerVisibility.exit) {
    for (const [index, execution] of trade.closingExecutions.entries()) {
      markers.push({
        id: `exit-${execution.sourceIndex}-${index}`,
        time: getNearestBarTime(bars, toTradeTimestamp(execution.tradeDate, execution.time)),
        price: execution.price,
        kind: "exit"
      });
    }
  }

  return markers;
};

export const TradeChart = ({
  bars,
  trade,
  height = 500,
  fillHeight = false,
  showMarkers = true,
  showEma = true,
  focusMode = "trade",
  regularSessionOnly = false,
  interval = "1m",
  drawings = [],
  onDrawingsChange,
  showDrawingTools = false,
  layerVisibility = defaultLayerVisibility,
  onToggleLayerVisibility,
  availableIntervals,
  onChangeInterval
}: TradeChartProps) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const fastEmaSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const slowEmaSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const vwapSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const openSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const hodSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const lodSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const rsiSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const bollingerBandsSeriesRefs = useRef<{
    upper: ISeriesApi<"Line"> | null;
    middle: ISeriesApi<"Line"> | null;
    lower: ISeriesApi<"Line"> | null;
  }>({ upper: null, middle: null, lower: null });
  const macdLineSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const macdSignalSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const macdHistogramSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const stochasticKSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const stochasticDSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const rsiPriceLineRefs = useRef<IPriceLine[]>([]);
  const rsiPaneIndexRef = useRef<number | null>(null);
  const displayBarsRef = useRef<HistoricalBar[]>([]);
  const [hoveredBar, setHoveredBar] = useState<HistoricalBar | null>(null);
  const [drawingTool, setDrawingTool] = useState<DrawingTool>("cursor");
  const [draftPoint, setDraftPoint] = useState<DrawingPoint | null>(null);
  const [hoverPoint, setHoverPoint] = useState<DrawingPoint | null>(null);
  const [selectedDrawingId, setSelectedDrawingId] = useState<string | null>(null);
  const [drawingDragTarget, setDrawingDragTarget] = useState<DrawingDragTarget | null>(null);
  const [drawingContextMenu, setDrawingContextMenu] = useState<DrawingContextMenu | null>(null);
  const [showIndicatorStrip, setShowIndicatorStrip] = useState(true);
  const [showIndicatorMenu, setShowIndicatorMenu] = useState(false);
  const [showDrawingMenu, setShowDrawingMenu] = useState(false);
  const [overlayVersion, setOverlayVersion] = useState(0);
  const [overlaySize, setOverlaySize] = useState({ width: 0, height: 0 });

  const sourceBars = useMemo(() => {
    const normalizedBars = normalizeBars(bars);
    return regularSessionOnly ? normalizedBars.filter(isRegularSessionBar) : normalizedBars;
  }, [bars, regularSessionOnly]);
  const displayBars = useMemo(() => aggregateBars(sourceBars, interval), [interval, sourceBars]);
  const vwapData = useMemo(() => buildVwapSeries(displayBars), [displayBars]);
  const fastEmaData = useMemo(() => buildEmaSeries(displayBars, FAST_EMA_PERIOD), [displayBars]);
  const slowEmaData = useMemo(() => buildEmaSeries(displayBars, SLOW_EMA_PERIOD), [displayBars]);
  const rsiData = useMemo(() => calculateRsiSeries(displayBars, 14), [displayBars]);
  const bollingerBandsData = useMemo(() => calculateBollingerBands(displayBars, 20, 2), [displayBars]);
  const macdData = useMemo(() => calculateMACD(displayBars, 12, 26, 9), [displayBars]);
  const stochasticData = useMemo(() => calculateStochastic(displayBars, 14, 3, 3), [displayBars]);
  const canDraw = showDrawingTools && Boolean(onDrawingsChange) && displayBars.length > 0;

  const refreshOverlay = useCallback(() => {
    setOverlayVersion((current) => current + 1);
  }, []);

  const fitTradeRange = useCallback(() => {
    if (!chartRef.current || displayBarsRef.current.length === 0) {
      return;
    }

    if (!trade || focusMode === "day") {
      chartRef.current.timeScale().fitContent();
      return;
    }

    const from = toTradeTimestamp(trade.tradeDate, trade.openTime) - 15 * 60;
    const to = toTradeTimestamp(trade.tradeDate, trade.closeTime) + 15 * 60;
    chartRef.current.timeScale().setVisibleRange({
      from: getNearestBarTime(displayBarsRef.current, from),
      to: getNearestBarTime(displayBarsRef.current, to)
    });
    requestAnimationFrame(refreshOverlay);
  }, [focusMode, refreshOverlay, trade]);

  const fitDayRange = useCallback(() => {
    chartRef.current?.timeScale().fitContent();
    requestAnimationFrame(refreshOverlay);
  }, [refreshOverlay]);

  const resetChartView = useCallback(() => {
    chartRef.current?.timeScale().fitContent();
    requestAnimationFrame(refreshOverlay);
  }, [refreshOverlay]);

  const removeRsiPane = useCallback(() => {
    const chart = chartRef.current;
    const rsiSeries = rsiSeriesRef.current;

    if (!chart) {
      rsiSeriesRef.current = null;
      rsiPriceLineRefs.current = [];
      rsiPaneIndexRef.current = null;
      return;
    }

    if (rsiSeries) {
      rsiPriceLineRefs.current.forEach((priceLine) => rsiSeries.removePriceLine(priceLine));
      chart.removeSeries(rsiSeries);
    }

    const rsiPaneIndex = rsiPaneIndexRef.current;
    rsiSeriesRef.current = null;
    rsiPriceLineRefs.current = [];
    rsiPaneIndexRef.current = null;

    if (typeof rsiPaneIndex === "number" && chart.panes().some((pane) => pane.paneIndex() === rsiPaneIndex)) {
      chart.removePane(rsiPaneIndex);
    }

    requestAnimationFrame(refreshOverlay);
  }, [refreshOverlay]);

  const ensureRsiPane = useCallback(() => {
    if (rsiSeriesRef.current || !chartRef.current) {
      return rsiSeriesRef.current;
    }

    const rsiPane = chartRef.current.addPane(true);
    rsiPane.setStretchFactor(1);
    rsiPane.priceScale("right").applyOptions({
      borderColor: "rgba(255,255,255,0.12)",
      scaleMargins: {
        top: 0.12,
        bottom: 0.12
      }
    });
    rsiPane.priceScale("left").applyOptions({
      visible: false
    });

    const rsiSeries = rsiPane.addSeries(LineSeries, {
      color: "#ff8bd4",
      lineWidth: 2,
      crosshairMarkerVisible: false,
      priceLineVisible: false,
      lastValueVisible: true
    });

    rsiPriceLineRefs.current = [
      rsiSeries.createPriceLine({
        price: 70,
        color: "rgba(255, 123, 123, 0.62)",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: "RSI 70"
      }),
      rsiSeries.createPriceLine({
        price: 30,
        color: "rgba(46, 230, 214, 0.62)",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: "RSI 30"
      })
    ];

    rsiSeriesRef.current = rsiSeries;
    rsiPaneIndexRef.current = rsiPane.paneIndex();
    requestAnimationFrame(refreshOverlay);
    return rsiSeries;
  }, [refreshOverlay]);

  const resetDrawingDraft = useCallback(() => {
    setDraftPoint(null);
    setHoverPoint(null);
  }, []);

  const handleSelectDrawingTool = useCallback(
    (tool: DrawingTool) => {
      setDrawingTool((current) => (current === tool ? "cursor" : tool));
      setSelectedDrawingId(null);
      setDrawingDragTarget(null);
      resetDrawingDraft();
    },
    [resetDrawingDraft]
  );

  useEffect(() => {
    resetDrawingDraft();
    setSelectedDrawingId(null);
    setDrawingContextMenu(null);
  }, [interval, resetDrawingDraft, trade?.id]);

  useEffect(() => {
    if (!selectedDrawingId) {
      setDrawingDragTarget(null);
      return;
    }

    if (!drawings.some((drawing) => drawing.id === selectedDrawingId)) {
      setSelectedDrawingId(null);
      setDrawingDragTarget(null);
    }
  }, [drawings, selectedDrawingId]);

  const handleDeleteDrawing = useCallback(
    (drawingId: string) => {
      if (!onDrawingsChange) {
        return;
      }

      onDrawingsChange(drawings.filter((drawing) => drawing.id !== drawingId));
      setSelectedDrawingId((current) => (current === drawingId ? null : current));
      setDrawingDragTarget((current) => (current?.id === drawingId ? null : current));
      setDrawingContextMenu(null);
      setDrawingTool("cursor");
      resetDrawingDraft();
    },
    [drawings, onDrawingsChange, resetDrawingDraft]
  );

  const handleDeleteSelectedDrawing = useCallback(() => {
    if (!selectedDrawingId) {
      return;
    }

    handleDeleteDrawing(selectedDrawingId);
  }, [handleDeleteDrawing, selectedDrawingId]);

  useEffect(() => {
    if (!canDraw) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.key === "Delete" || event.key === "Backspace") && selectedDrawingId) {
        const activeElement = document.activeElement;
        const tagName = activeElement?.tagName?.toLowerCase();
        const isTypingTarget =
          activeElement instanceof HTMLInputElement ||
          activeElement instanceof HTMLTextAreaElement ||
          activeElement instanceof HTMLSelectElement ||
          tagName === "button" ||
          activeElement?.getAttribute("contenteditable") === "true";

        if (!isTypingTarget) {
          event.preventDefault();
          handleDeleteSelectedDrawing();
          return;
        }
      }

      if (event.key !== "Escape") {
        return;
      }

      if (draftPoint || hoverPoint || drawingTool !== "cursor" || selectedDrawingId || drawingContextMenu) {
        event.preventDefault();
        setDrawingTool("cursor");
        setSelectedDrawingId(null);
        setDrawingDragTarget(null);
        setDrawingContextMenu(null);
        resetDrawingDraft();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    canDraw,
    draftPoint,
    drawingContextMenu,
    drawingTool,
    handleDeleteSelectedDrawing,
    hoverPoint,
    resetDrawingDraft,
    selectedDrawingId
  ]);

  useEffect(() => {
    if (!overlayRef.current) {
      return;
    }

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }

      setOverlaySize({
        width: entry.contentRect.width,
        height: entry.contentRect.height
      });
      refreshOverlay();
    });

    resizeObserver.observe(overlayRef.current);
    return () => resizeObserver.disconnect();
  }, [refreshOverlay]);

  const resolveDrawingPoint = useCallback(
    (clientX: number, clientY: number): DrawingPoint | null => {
      if (!overlayRef.current || !chartRef.current || !seriesRef.current || displayBars.length === 0) {
        return null;
      }

      const rect = overlayRef.current.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      const pricePaneHeight = chartRef.current.paneSize(0).height;

      if (x < 0 || x > rect.width || y < 0 || y > pricePaneHeight) {
        return null;
      }

      const rawTime = chartRef.current.timeScale().coordinateToTime(x) ?? undefined;
      const time = toUtcTimestamp(rawTime);
      const price = seriesRef.current.coordinateToPrice(y);

      if (time === null || typeof price !== "number") {
        return null;
      }

      return {
        x,
        y,
        time: getNearestBarTime(displayBars, time),
        price
      };
    },
    [displayBars]
  );

  const handleOverlayPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!canDraw) {
        return;
      }

      const point = resolveDrawingPoint(event.clientX, event.clientY);

      if (drawingDragTarget && point && onDrawingsChange) {
        event.preventDefault();
        onDrawingsChange(
          drawings.map((drawing) => {
            if (drawing.id !== drawingDragTarget.id) {
              return drawing;
            }

            switch (drawingDragTarget.type) {
              case "trendline-start":
                return drawing.type === "trendline"
                  ? {
                      ...drawing,
                      startTime: point.time,
                      startPrice: point.price
                    }
                  : drawing;
              case "trendline-end":
                return drawing.type === "trendline"
                  ? {
                      ...drawing,
                      endTime: point.time,
                      endPrice: point.price
                    }
                  : drawing;
              case "horizontal":
                return drawing.type === "horizontal"
                  ? {
                      ...drawing,
                      price: point.price
                    }
                  : drawing;
              case "vertical":
                return drawing.type === "vertical"
                  ? {
                      ...drawing,
                      time: point.time
                    }
                  : drawing;
              default:
                return drawing;
            }
          })
        );
        return;
      }

      if (drawingTool === "cursor") {
        return;
      }

      setHoverPoint(point);
    },
    [canDraw, drawingDragTarget, drawingTool, drawings, onDrawingsChange, resolveDrawingPoint]
  );

  const handleOverlayPointerLeave = useCallback(() => {
    setDrawingDragTarget(null);
    setHoverPoint(null);
  }, []);

  const handleOverlayPointerUp = useCallback(() => {
    setDrawingDragTarget(null);
  }, []);

  const handleOverlayPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!canDraw || drawingTool === "cursor" || !onDrawingsChange) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      setDrawingContextMenu(null);

      const point = resolveDrawingPoint(event.clientX, event.clientY);
      if (!point) {
        return;
      }

      if (drawingTool === "horizontal") {
        const id = createDrawingId();
        onDrawingsChange([
          ...drawings,
          {
            id,
            type: "horizontal",
            price: point.price
          }
        ]);
        setSelectedDrawingId(id);
        setDrawingTool("cursor");
        resetDrawingDraft();
        return;
      }

      if (drawingTool === "vertical") {
        const id = createDrawingId();
        onDrawingsChange([
          ...drawings,
          {
            id,
            type: "vertical",
            time: point.time
          }
        ]);
        setSelectedDrawingId(id);
        setDrawingTool("cursor");
        resetDrawingDraft();
        return;
      }

      if (drawingTool === "fibonacci") {
        if (!draftPoint) {
          setDraftPoint(point);
          return;
        }

        const id = createDrawingId();
        onDrawingsChange([
          ...drawings,
          {
            id,
            type: "fibonacci",
            startTime: draftPoint.time,
            startPrice: draftPoint.price,
            endTime: point.time,
            endPrice: point.price
          }
        ]);
        setSelectedDrawingId(id);
        setDrawingTool("cursor");
        resetDrawingDraft();
        return;
      }

      if (drawingTool === "pitchfork") {
        if (!draftPoint) {
          setDraftPoint(point);
          return;
        }

        if (draftPoint && !hoverPoint?.x) {
          setHoverPoint(point);
          return;
        }

        if (draftPoint && hoverPoint) {
          const id = createDrawingId();
          onDrawingsChange([
            ...drawings,
            {
              id,
              type: "pitchfork",
              pivotTime: draftPoint.time,
              pivotPrice: draftPoint.price,
              leftTime: hoverPoint.time,
              leftPrice: hoverPoint.price,
              rightTime: point.time,
              rightPrice: point.price
            }
          ]);
          setSelectedDrawingId(id);
          setDrawingTool("cursor");
          resetDrawingDraft();
          return;
        }
      }

      if (drawingTool === "channel") {
        if (!draftPoint) {
          setDraftPoint(point);
          return;
        }

        if (draftPoint && !hoverPoint?.x) {
          setHoverPoint(point);
          return;
        }

        if (draftPoint && hoverPoint) {
          const id = createDrawingId();
          onDrawingsChange([
            ...drawings,
            {
              id,
              type: "channel",
              startTime: draftPoint.time,
              startPrice: draftPoint.price,
              endTime: hoverPoint.time,
              endPrice: hoverPoint.price,
              parallelTime: point.time,
              parallelPrice: point.price
            }
          ]);
          setSelectedDrawingId(id);
          setDrawingTool("cursor");
          resetDrawingDraft();
          return;
        }
      }

      if (!draftPoint) {
        setDraftPoint(point);
        return;
      }

      const id = createDrawingId();
      onDrawingsChange([
        ...drawings,
        {
          id,
          type: "trendline",
          startTime: draftPoint.time,
          startPrice: draftPoint.price,
          endTime: point.time,
          endPrice: point.price
        }
      ]);
      setSelectedDrawingId(id);
      setDrawingTool("cursor");
      resetDrawingDraft();
    },
    [canDraw, draftPoint, drawingTool, drawings, onDrawingsChange, resetDrawingDraft, resolveDrawingPoint, hoverPoint]
  );

  const handleUndoDrawing = useCallback(() => {
    if (!onDrawingsChange || drawings.length === 0) {
      return;
    }

    onDrawingsChange(drawings.slice(0, -1));
    setSelectedDrawingId(null);
    setDrawingContextMenu(null);
    setDrawingTool("cursor");
    resetDrawingDraft();
  }, [drawings, onDrawingsChange, resetDrawingDraft]);

  const handleClearDrawings = useCallback(() => {
    if (!onDrawingsChange || drawings.length === 0) {
      return;
    }

    onDrawingsChange([]);
    setSelectedDrawingId(null);
    setDrawingContextMenu(null);
    setDrawingTool("cursor");
    resetDrawingDraft();
  }, [drawings.length, onDrawingsChange, resetDrawingDraft]);

  const handleSelectDrawing = useCallback(
    (event: React.PointerEvent<SVGElement>, drawingId: string) => {
      if (!canDraw) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      setDrawingTool("cursor");
      setSelectedDrawingId(drawingId);
      setDrawingContextMenu(null);
      resetDrawingDraft();
    },
    [canDraw, resetDrawingDraft]
  );

  const handleOpenDrawingContextMenu = useCallback(
    (event: React.MouseEvent<SVGElement>, drawingId: string) => {
      if (!canDraw || !overlayRef.current) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      const rect = overlayRef.current.getBoundingClientRect();
      setDrawingTool("cursor");
      setDrawingDragTarget(null);
      setSelectedDrawingId(drawingId);
      resetDrawingDraft();
      setDrawingContextMenu({
        drawingId,
        x: event.clientX - rect.left,
        y: event.clientY - rect.top
      });
    },
    [canDraw, resetDrawingDraft]
  );

  const handleStartDrawingDrag = useCallback(
    (event: React.PointerEvent<SVGElement>, target: DrawingDragTarget) => {
      if (!canDraw) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      setDrawingTool("cursor");
      setSelectedDrawingId(target.id);
      setDrawingDragTarget(target);
      setDrawingContextMenu(null);
      resetDrawingDraft();
    },
    [canDraw, resetDrawingDraft]
  );

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
        attributionLogo: false,
        panes: {
          enableResize: true,
          separatorColor: "rgba(255,255,255,0.16)",
          separatorHoverColor: "rgba(93, 168, 255, 0.18)"
        }
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

    const [pricePane] = chart.panes();
    const volumePane = chart.addPane();
    pricePane?.setStretchFactor(3);
    volumePane.setStretchFactor(1);

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

    const openSeries = chart.addSeries(LineSeries, {
      color: "rgba(255,255,255,0.34)",
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      crosshairMarkerVisible: false,
      priceLineVisible: false,
      lastValueVisible: false
    });

    const hodSeries = chart.addSeries(LineSeries, {
      color: "rgba(46,230,214,0.52)",
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      crosshairMarkerVisible: false,
      priceLineVisible: false,
      lastValueVisible: false
    });

    const lodSeries = chart.addSeries(LineSeries, {
      color: "rgba(180,46,255,0.52)",
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      crosshairMarkerVisible: false,
      priceLineVisible: false,
      lastValueVisible: false
    });

    const volumeSeries = volumePane.addSeries(HistogramSeries, {
      priceFormat: {
        type: "volume"
      },
      priceLineVisible: false,
      lastValueVisible: false,
      base: 0
    });
    volumePane.priceScale("right").applyOptions({
      scaleMargins: {
        top: 0.08,
        bottom: 0
      },
      borderColor: "rgba(255,255,255,0.12)"
    });
    volumePane.priceScale("left").applyOptions({
      visible: false
    });
    pricePane?.priceScale("right").applyOptions({
      borderColor: "rgba(255,255,255,0.12)",
      scaleMargins: {
        top: 0.08,
        bottom: 0.05
      }
    });
    series.priceScale().applyOptions({
      scaleMargins: {
        top: 0.08,
        bottom: 0.05
      }
    });

    // Bollinger Bands
    const bbUpperSeries = chart.addSeries(LineSeries, {
      color: "rgba(100, 200, 255, 0.5)",
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      crosshairMarkerVisible: false,
      priceLineVisible: false,
      lastValueVisible: false
    });

    const bbMiddleSeries = chart.addSeries(LineSeries, {
      color: "rgba(200, 200, 200, 0.6)",
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      crosshairMarkerVisible: false,
      priceLineVisible: false,
      lastValueVisible: false
    });

    const bbLowerSeries = chart.addSeries(LineSeries, {
      color: "rgba(100, 200, 255, 0.5)",
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      crosshairMarkerVisible: false,
      priceLineVisible: false,
      lastValueVisible: false
    });

    // MACD - create separate pane
    const macdPane = chart.addPane(true);
    macdPane.setStretchFactor(1);

    const macdLineSeries = macdPane.addSeries(LineSeries, {
      color: "#2962FF",
      lineWidth: 2,
      crosshairMarkerVisible: false,
      priceLineVisible: false,
      lastValueVisible: false
    });

    const macdSignalSeries = macdPane.addSeries(LineSeries, {
      color: "#FF6A00",
      lineWidth: 2,
      crosshairMarkerVisible: false,
      priceLineVisible: false,
      lastValueVisible: false
    });

    const macdHistogramSeries = macdPane.addSeries(HistogramSeries, {
      priceFormat: {
        type: "volume"
      },
      priceLineVisible: false,
      lastValueVisible: false,
      base: 0
    });
    macdPane.priceScale("right").applyOptions({
      scaleMargins: {
        top: 0.1,
        bottom: 0.1
      },
      borderColor: "rgba(255,255,255,0.12)"
    });
    macdPane.priceScale("left").applyOptions({
      visible: false
    });

    // Stochastic - create separate pane
    const stochPane = chart.addPane(true);
    stochPane.setStretchFactor(1);

    const stochKSeries = stochPane.addSeries(LineSeries, {
      color: "#2962FF",
      lineWidth: 2,
      crosshairMarkerVisible: false,
      priceLineVisible: false,
      lastValueVisible: false
    });

    const stochDSeries = stochPane.addSeries(LineSeries, {
      color: "#FF6A00",
      lineWidth: 2,
      crosshairMarkerVisible: false,
      priceLineVisible: false,
      lastValueVisible: false
    });

    // Add reference lines to stochastic pane (20, 50, 80)
    stochPane.priceScale("right").applyOptions({
      scaleMargins: {
        top: 0.1,
        bottom: 0.1
      },
      borderColor: "rgba(255,255,255,0.12)"
    });
    stochPane.priceScale("left").applyOptions({
      visible: false
    });

    chartRef.current = chart;
    seriesRef.current = series;
    fastEmaSeriesRef.current = fastEmaSeries;
    slowEmaSeriesRef.current = slowEmaSeries;
    vwapSeriesRef.current = vwapSeries;
    openSeriesRef.current = openSeries;
    hodSeriesRef.current = hodSeries;
    lodSeriesRef.current = lodSeries;
    volumeSeriesRef.current = volumeSeries;
    bollingerBandsSeriesRefs.current = { upper: bbUpperSeries, middle: bbMiddleSeries, lower: bbLowerSeries };
    macdLineSeriesRef.current = macdLineSeries;
    macdSignalSeriesRef.current = macdSignalSeries;
    macdHistogramSeriesRef.current = macdHistogramSeries;
    stochasticKSeriesRef.current = stochKSeries;
    stochasticDSeriesRef.current = stochDSeries;
    const handleCrosshairMove = (param: MouseEventParams<Time>) => {
      setHoveredBar(findBarByTime(displayBarsRef.current, toUtcTimestamp(param.time)));
    };
    const handleVisibleRangeChange = () => refreshOverlay();

    chart.subscribeCrosshairMove(handleCrosshairMove);
    chart.timeScale().subscribeVisibleLogicalRangeChange(handleVisibleRangeChange);

    return () => {
      chart.unsubscribeCrosshairMove(handleCrosshairMove);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(handleVisibleRangeChange);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      fastEmaSeriesRef.current = null;
      slowEmaSeriesRef.current = null;
      vwapSeriesRef.current = null;
      openSeriesRef.current = null;
      hodSeriesRef.current = null;
      lodSeriesRef.current = null;
      volumeSeriesRef.current = null;
      rsiSeriesRef.current = null;
      bollingerBandsSeriesRefs.current = { upper: null, middle: null, lower: null };
      macdLineSeriesRef.current = null;
      macdSignalSeriesRef.current = null;
      macdHistogramSeriesRef.current = null;
      stochasticKSeriesRef.current = null;
      stochasticDSeriesRef.current = null;
      rsiPriceLineRefs.current = [];
      rsiPaneIndexRef.current = null;
    };
  }, [refreshOverlay]);

  useEffect(() => {
    if (fillHeight) {
      requestAnimationFrame(refreshOverlay);
      return;
    }

    chartRef.current?.applyOptions({ height });
    requestAnimationFrame(refreshOverlay);
  }, [fillHeight, height, refreshOverlay]);

  useEffect(() => {
    if (
      !seriesRef.current ||
      !fastEmaSeriesRef.current ||
      !slowEmaSeriesRef.current ||
      !vwapSeriesRef.current ||
      !openSeriesRef.current ||
      !hodSeriesRef.current ||
      !lodSeriesRef.current ||
      !volumeSeriesRef.current ||
      !chartRef.current
    ) {
      return;
    }

    displayBarsRef.current = displayBars;
    setHoveredBar(displayBars.length > 0 ? displayBars[displayBars.length - 1] : null);

    const formattedBars = displayBars.map((bar) => ({
      time: bar.time as UTCTimestamp,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close
    }));

    seriesRef.current.setData(formattedBars);
    fastEmaSeriesRef.current.setData(showEma && layerVisibility.ema9 ? fastEmaData : []);
    slowEmaSeriesRef.current.setData(showEma && layerVisibility.ema12 ? slowEmaData : []);
    vwapSeriesRef.current.setData(layerVisibility.vwap ? vwapData : []);
    volumeSeriesRef.current.setData(layerVisibility.volume ? buildVolumeSeries(displayBars) : []);
    
    // Bollinger Bands
    if (layerVisibility.bollingerBands && bollingerBandsSeriesRefs.current.upper && bollingerBandsSeriesRefs.current.middle && bollingerBandsSeriesRefs.current.lower) {
      const bbUpper = bollingerBandsData.map(d => ({ time: d.time, value: d.upper ?? 0 }));
      const bbMiddle = bollingerBandsData.map(d => ({ time: d.time, value: d.middle ?? 0 }));
      const bbLower = bollingerBandsData.map(d => ({ time: d.time, value: d.lower ?? 0 }));
      bollingerBandsSeriesRefs.current.upper.setData(bbUpper);
      bollingerBandsSeriesRefs.current.middle.setData(bbMiddle);
      bollingerBandsSeriesRefs.current.lower.setData(bbLower);
    } else if (bollingerBandsSeriesRefs.current.upper && bollingerBandsSeriesRefs.current.middle && bollingerBandsSeriesRefs.current.lower) {
      bollingerBandsSeriesRefs.current.upper.setData([]);
      bollingerBandsSeriesRefs.current.middle.setData([]);
      bollingerBandsSeriesRefs.current.lower.setData([]);
    }
    
    const dayOpen = displayBars[0]?.open;
    const dayHigh = displayBars.length > 0 ? Math.max(...displayBars.map((bar) => bar.high)) : undefined;
    const dayLow = displayBars.length > 0 ? Math.min(...displayBars.map((bar) => bar.low)) : undefined;
    openSeriesRef.current.setData(
      layerVisibility.open && typeof dayOpen === "number" ? buildFlatPriceSeries(displayBars, dayOpen) : []
    );
    hodSeriesRef.current.setData(
      layerVisibility.hod && typeof dayHigh === "number" ? buildFlatPriceSeries(displayBars, dayHigh) : []
    );
    lodSeriesRef.current.setData(
      layerVisibility.lod && typeof dayLow === "number" ? buildFlatPriceSeries(displayBars, dayLow) : []
    );

  }, [displayBars, fastEmaData, layerVisibility, showEma, slowEmaData, vwapData, bollingerBandsData]);

  useEffect(() => {
    if (!macdLineSeriesRef.current || !macdSignalSeriesRef.current || !macdHistogramSeriesRef.current) {
      return;
    }

    if (layerVisibility.macd && macdData.length > 0) {
      const macdLine = macdData.map(d => ({ time: d.time, value: d.value }));
      const macdSignal = macdData
        .filter(d => d.signal !== undefined)
        .map(d => ({ time: d.time, value: d.signal ?? 0 }));
      const macdHistogram = macdData
        .filter(d => d.histogram !== undefined)
        .map(d => ({ time: d.time, value: d.histogram ?? 0 }));

      macdLineSeriesRef.current.setData(macdLine);
      macdSignalSeriesRef.current.setData(macdSignal);
      macdHistogramSeriesRef.current.setData(macdHistogram);
    } else {
      macdLineSeriesRef.current.setData([]);
      macdSignalSeriesRef.current.setData([]);
      macdHistogramSeriesRef.current.setData([]);
    }
  }, [layerVisibility.macd, macdData]);

  useEffect(() => {
    if (!stochasticKSeriesRef.current || !stochasticDSeriesRef.current) {
      return;
    }

    if (layerVisibility.stochastic && stochasticData.length > 0) {
      const stochK = stochasticData.map(d => ({ time: d.time, value: d.k ?? d.value }));
      const stochD = stochasticData
        .filter(d => d.d !== undefined)
        .map(d => ({ time: d.time, value: d.d ?? 0 }));

      stochasticKSeriesRef.current.setData(stochK);
      stochasticDSeriesRef.current.setData(stochD);
    } else {
      stochasticKSeriesRef.current.setData([]);
      stochasticDSeriesRef.current.setData([]);
    }
  }, [layerVisibility.stochastic, stochasticData]);

  useEffect(() => {
    if (!chartRef.current || !layerVisibility.rsi || rsiData.length === 0) {
      removeRsiPane();
      return;
    }

    const rsiSeries = ensureRsiPane();
    rsiSeries?.setData(rsiData);
  }, [ensureRsiPane, layerVisibility.rsi, removeRsiPane, rsiData]);

  useEffect(() => {
    if (!chartRef.current || displayBars.length === 0) {
      return;
    }

    if (!trade || focusMode === "day") {
      fitDayRange();
      return;
    }

    fitTradeRange();
  }, [displayBars, fitDayRange, fitTradeRange, focusMode, interval, trade?.id]);

  const headerBar = hoveredBar ?? (displayBars.length > 0 ? displayBars[displayBars.length - 1] : null);
  const previousBar = useMemo(() => {
    if (!headerBar) {
      return null;
    }

    const index = displayBars.findIndex((bar) => bar.time === headerBar.time);
    return index > 0 ? displayBars[index - 1] : null;
  }, [displayBars, headerBar]);

  const hoveredVwap = useMemo(() => {
    if (!headerBar) {
      return null;
    }

    const point = vwapData.find((bar) => bar.time === (headerBar.time as UTCTimestamp));
    return point?.value ?? null;
  }, [headerBar, vwapData]);

  const dayOpen = displayBars[0]?.open ?? null;
  const dayHigh = displayBars.length > 0 ? Math.max(...displayBars.map((bar) => bar.high)) : null;
  const dayLow = displayBars.length > 0 ? Math.min(...displayBars.map((bar) => bar.low)) : null;
  const latestFastEma = fastEmaData.length > 0 ? fastEmaData[fastEmaData.length - 1]?.value ?? null : null;
  const latestSlowEma = slowEmaData.length > 0 ? slowEmaData[slowEmaData.length - 1]?.value ?? null : null;
  const latestVwap = vwapData.length > 0 ? vwapData[vwapData.length - 1]?.value ?? null : null;
  const latestRsi = rsiData.length > 0 ? rsiData[rsiData.length - 1]?.value ?? null : null;
  const latestBollingerBands = bollingerBandsData.length > 0 ? bollingerBandsData[bollingerBandsData.length - 1] : null;
  const latestMACD = macdData.length > 0 ? macdData[macdData.length - 1] : null;
  const latestStochastic = stochasticData.length > 0 ? stochasticData[stochasticData.length - 1] : null;

  const change = headerBar && previousBar ? headerBar.close - previousBar.close : 0;
  const changePct = headerBar && previousBar && previousBar.close !== 0 ? (change / previousBar.close) * 100 : 0;
  const indicatorItems = useMemo(() => {
    if (!onToggleLayerVisibility) {
      return [];
    }

    const items: IndicatorItem[] = [];

    if (showMarkers) {
      items.push({ key: "entry", label: "Entry", colorClass: "legend-entry" });
      items.push({ key: "addToWinner", label: "Add to winner", colorClass: "legend-add" });
      items.push({ key: "averageDown", label: "Average down", colorClass: "legend-average" });
      items.push({ key: "exit", label: "Exit", colorClass: "legend-exit" });
    }

    if (showEma) {
      items.push({ key: "ema9", label: "EMA 9", colorClass: "legend-ema", value: latestFastEma?.toFixed(2) });
      items.push({ key: "ema12", label: "EMA 12", colorClass: "legend-ema-slow", value: latestSlowEma?.toFixed(2) });
    }

    items.push({ key: "open", label: "Open", colorClass: "legend-open", value: dayOpen?.toFixed(2) });
    items.push({ key: "hod", label: "HOD", colorClass: "legend-hod", value: dayHigh?.toFixed(2) });
    items.push({ key: "lod", label: "LOD", colorClass: "legend-lod", value: dayLow?.toFixed(2) });
    items.push({ key: "vwap", label: "VWAP", colorClass: "legend-vwap", value: latestVwap?.toFixed(2) });
    items.push({
      key: "volume",
      label: "Volume",
      colorClass: "legend-volume",
      value: headerBar?.volume ? formatVolume(headerBar.volume) : undefined
    });
    items.push({ key: "rsi", label: "RSI 14", colorClass: "legend-rsi", value: latestRsi?.toFixed(2) });
    items.push({
      key: "bollingerBands",
      label: "Bollinger Bands",
      colorClass: "legend-bollinger",
      value: latestBollingerBands?.middle ? `${latestBollingerBands.middle.toFixed(2)}` : undefined
    });
    items.push({
      key: "macd",
      label: "MACD",
      colorClass: "legend-macd",
      value: latestMACD?.value ? `${latestMACD.value.toFixed(4)}` : undefined
    });
    items.push({
      key: "stochastic",
      label: "Stochastic",
      colorClass: "legend-stochastic",
      value: latestStochastic?.k ? `${latestStochastic.k.toFixed(2)}` : undefined
    });

    return items;
  }, [
    dayHigh,
    dayLow,
    dayOpen,
    headerBar?.volume,
    latestFastEma,
    latestRsi,
    latestSlowEma,
    latestVwap,
    latestBollingerBands,
    latestMACD,
    latestStochastic,
    onToggleLayerVisibility,
    showEma,
    showMarkers
  ]);

  const handleSetAllLayers = useCallback(
    (visible: boolean) => {
      if (!onToggleLayerVisibility) {
        return;
      }

      indicatorItems.forEach((item) => {
        if (layerVisibility[item.key] !== visible) {
          onToggleLayerVisibility(item.key);
        }
      });
    },
    [indicatorItems, layerVisibility, onToggleLayerVisibility]
  );

  const indicatorSections = useMemo(() => {
    const findItems = (keys: Array<keyof TradeChartLayerVisibility>) =>
      keys
        .map((key) => indicatorItems.find((item) => item.key === key))
        .filter((item): item is IndicatorItem => Boolean(item));

    return [
      {
        title: "Trade Executions",
        note: "Entry, add, average, and exit markers",
        items: findItems(["entry", "addToWinner", "averageDown", "exit"])
      },
      {
        title: "Moving Averages",
        note: "Trend and mean reference overlays",
        items: findItems(["ema9", "ema12", "vwap"])
      },
      {
        title: "Levels",
        note: "Session reference lines",
        items: findItems(["open", "hod", "lod"])
      },
      {
        title: "Panes",
        note: "Volume and lower indicators",
        items: findItems(["volume", "rsi", "macd", "stochastic"])
      },
      {
        title: "Overlays",
        note: "Price chart overlays",
        items: findItems(["bollingerBands"])
      }
    ].filter((section) => section.items.length > 0);
  }, [indicatorItems]);

  const activeIndicatorItems = useMemo(
    () => indicatorItems.filter((item) => layerVisibility[item.key]),
    [indicatorItems, layerVisibility]
  );

  const projectedDrawings = useMemo(() => {
    if (!chartRef.current || !seriesRef.current || overlaySize.width === 0 || overlaySize.height === 0) {
      return [];
    }

    return drawings
      .map((drawing) => {
        if (drawing.type === "trendline" || drawing.type === "fibonacci") {
          const x1 = chartRef.current?.timeScale().timeToCoordinate(drawing.startTime as UTCTimestamp);
          const y1 = seriesRef.current?.priceToCoordinate(drawing.startPrice);
          const x2 = chartRef.current?.timeScale().timeToCoordinate(drawing.endTime as UTCTimestamp);
          const y2 = seriesRef.current?.priceToCoordinate(drawing.endPrice);

          if (
            typeof x1 !== "number" ||
            typeof y1 !== "number" ||
            typeof x2 !== "number" ||
            typeof y2 !== "number"
          ) {
            return null;
          }

          return {
            id: drawing.id,
            type: drawing.type,
            x1,
            y1,
            x2,
            y2
          };
        }

        if (drawing.type === "horizontal") {
          const y = seriesRef.current?.priceToCoordinate(drawing.price);
          if (typeof y !== "number") {
            return null;
          }

          return {
            id: drawing.id,
            type: drawing.type,
            y
          };
        }

        if (drawing.type === "vertical") {
          const x = chartRef.current?.timeScale().timeToCoordinate(drawing.time as UTCTimestamp);
          if (typeof x !== "number") {
            return null;
          }

          return {
            id: drawing.id,
            type: drawing.type,
            x
          };
        }

        if (drawing.type === "pitchfork") {
          const pivotX = chartRef.current?.timeScale().timeToCoordinate(drawing.pivotTime as UTCTimestamp);
          const pivotY = seriesRef.current?.priceToCoordinate(drawing.pivotPrice);
          const leftX = chartRef.current?.timeScale().timeToCoordinate(drawing.leftTime as UTCTimestamp);
          const leftY = seriesRef.current?.priceToCoordinate(drawing.leftPrice);
          const rightX = chartRef.current?.timeScale().timeToCoordinate(drawing.rightTime as UTCTimestamp);
          const rightY = seriesRef.current?.priceToCoordinate(drawing.rightPrice);

          if (
            typeof pivotX !== "number" ||
            typeof pivotY !== "number" ||
            typeof leftX !== "number" ||
            typeof leftY !== "number" ||
            typeof rightX !== "number" ||
            typeof rightY !== "number"
          ) {
            return null;
          }

          return {
            id: drawing.id,
            type: drawing.type,
            pivotX,
            pivotY,
            leftX,
            leftY,
            rightX,
            rightY
          };
        }

        if (drawing.type === "channel") {
          const x1 = chartRef.current?.timeScale().timeToCoordinate(drawing.startTime as UTCTimestamp);
          const y1 = seriesRef.current?.priceToCoordinate(drawing.startPrice);
          const x2 = chartRef.current?.timeScale().timeToCoordinate(drawing.endTime as UTCTimestamp);
          const y2 = seriesRef.current?.priceToCoordinate(drawing.endPrice);
          const x3 = chartRef.current?.timeScale().timeToCoordinate(drawing.parallelTime as UTCTimestamp);
          const y3 = seriesRef.current?.priceToCoordinate(drawing.parallelPrice);

          if (
            typeof x1 !== "number" ||
            typeof y1 !== "number" ||
            typeof x2 !== "number" ||
            typeof y2 !== "number" ||
            typeof x3 !== "number" ||
            typeof y3 !== "number"
          ) {
            return null;
          }

          return {
            id: drawing.id,
            type: drawing.type,
            x1,
            y1,
            x2,
            y2,
            x3,
            y3
          };
        }

        return null;
      })
      .filter((drawing): drawing is NonNullable<typeof drawing> => drawing !== null);
  }, [drawings, overlaySize.height, overlaySize.width, overlayVersion]);

  const projectedExecutionMarkers = useMemo(() => {
    if (
      !showMarkers ||
      !trade ||
      !chartRef.current ||
      !seriesRef.current ||
      overlaySize.width === 0 ||
      overlaySize.height === 0
    ) {
      return [];
    }

    return buildExecutionMarkers(displayBars, trade, layerVisibility)
      .map((marker) => {
        const x = chartRef.current?.timeScale().timeToCoordinate(marker.time as UTCTimestamp);
        const y = seriesRef.current?.priceToCoordinate(marker.price);

        if (typeof x !== "number" || typeof y !== "number") {
          return null;
        }

        return {
          ...marker,
          x,
          y
        };
      })
      .filter((marker): marker is NonNullable<typeof marker> => marker !== null);
  }, [displayBars, layerVisibility, overlaySize.height, overlaySize.width, overlayVersion, showMarkers, trade]);

  const getExecutionMarkerFill = useCallback((kind: ExecutionMarkerPoint["kind"]) => {
    switch (kind) {
      case "entry":
        return "#2ee6a6";
      case "addToWinner":
        return "#5da8ff";
      case "averageDown":
        return "#ffcf5a";
      case "exit":
        return "#ff7b7b";
      default:
        return "#ffffff";
    }
  }, []);

  const getExecutionMarkerPoints = useCallback(
    (x: number, y: number, kind: ExecutionMarkerPoint["kind"]) => {
      const size = 8;

      if (kind === "exit") {
        return `${x},${y} ${x + size},${y - size * 0.78} ${x + size},${y + size * 0.78}`;
      }

      return `${x},${y} ${x - size},${y - size * 0.78} ${x - size},${y + size * 0.78}`;
    },
    []
  );

  const draftTrendLine =
    draftPoint && hoverPoint && drawingTool === "trendline"
      ? {
          x1: draftPoint.x,
          y1: draftPoint.y,
          x2: hoverPoint.x,
          y2: hoverPoint.y
        }
      : null;

  const draftHorizontalLine =
    hoverPoint && drawingTool === "horizontal"
      ? {
          y: hoverPoint.y
        }
      : null;

  const draftVerticalLine =
    hoverPoint && drawingTool === "vertical"
      ? {
          x: hoverPoint.x
        }
      : null;

  const draftFibonacci =
    draftPoint && hoverPoint && drawingTool === "fibonacci"
      ? {
          x1: draftPoint.x,
          y1: draftPoint.y,
          x2: hoverPoint.x,
          y2: hoverPoint.y
        }
      : null;

  const activeDrawingTool = drawingToolOptions.find((option) => option.key === drawingTool) ?? drawingToolOptions[0];
  const drawingInstruction =
    !canDraw && drawingTool !== "cursor"
      ? "Load bars before drawing"
      : drawingTool === "trendline"
        ? draftPoint
          ? "Click the second anchor point"
          : "Click the first anchor point"
        : drawingTool === "horizontal"
          ? "Click the price level to place a horizontal line"
          : drawingTool === "vertical"
            ? "Click the time level to place a vertical line"
            : drawingTool === "fibonacci"
              ? draftPoint
                ? "Click high or low to complete Fibonacci retracement"
                : "Click the low point (start)"
              : drawingTool === "pitchfork"
                ? draftPoint && hoverPoint
                  ? "Click the right pivot point"
                  : draftPoint
                    ? "Click the left pivot point"
                    : "Click the center pivot point"
                : drawingTool === "channel"
                  ? draftPoint && hoverPoint
                    ? "Click a point for the parallel line"
                    : draftPoint
                      ? "Click the end of the base line"
                      : "Click the start point"
                  : selectedDrawingId
                    ? "Drag a handle or line to adjust. Press Delete to remove."
                    : "Choose a drawing tool or click a line to select it";
  const overlayModeClass =
    drawingTool !== "cursor" && canDraw
      ? " trade-chart-overlay-active"
      : canDraw && drawings.length > 0
        ? " trade-chart-overlay-editing"
        : "";

  const intervalToolbar = availableIntervals && onChangeInterval ? (
    <div className="trade-chart-command-group trade-chart-command-group-intervals" aria-label="Chart timeframe">
      {availableIntervals.map((intervalOption) => (
        <button
          key={intervalOption}
          type="button"
          className={`trade-chart-command-chip trade-chart-timeframe-chip${interval === intervalOption ? " is-active" : ""}`}
          onClick={() => onChangeInterval(intervalOption)}
        >
          {intervalOption}
        </button>
      ))}
    </div>
  ) : null;

  return (
    <div className={`trade-chart-shell${fillHeight ? " is-fill" : ""}`}>
      <div className="trade-chart-command-bar" role="toolbar" aria-label="Chart controls">
        <div className="trade-chart-command-group trade-chart-command-group-main">
          <button type="button" className="trade-chart-symbol-pill">
            <span className="trade-chart-symbol-avatar">{(trade?.symbol ?? "C").slice(0, 1)}</span>
            <strong>{trade?.symbol ?? "Chart"}</strong>
          </button>
          <button type="button" className="trade-chart-command-chip trade-chart-command-chip-icon" title="Add comparison" disabled>
            +
          </button>
          <span className="trade-chart-command-separator" />
          {intervalToolbar}
          <span className="trade-chart-command-separator" />
          {onToggleLayerVisibility ? (
            <button
              type="button"
              className={`trade-chart-command-chip trade-chart-command-chip-menu${showIndicatorMenu ? " is-active" : ""}`}
              onClick={() => {
                setShowIndicatorMenu((current) => !current);
                setShowDrawingMenu(false);
              }}
            >
              <span className="trade-chart-command-icon trade-chart-command-icon-indicators" />
              <span>Indicators</span>
              <span className="trade-chart-command-caret">v</span>
            </button>
          ) : null}
          {showDrawingTools ? (
            <button
              type="button"
              className={`trade-chart-command-chip trade-chart-command-chip-menu${showDrawingMenu || drawingTool !== "cursor" ? " is-active" : ""}`}
              onClick={() => {
                setShowDrawingMenu((current) => !current);
                setShowIndicatorMenu(false);
              }}
            >
              <span className="trade-chart-command-icon trade-chart-command-icon-draw" />
              <span>Draw{drawingTool !== "cursor" ? `: ${activeDrawingTool.label}` : ""}</span>
              <span className="trade-chart-command-caret">v</span>
            </button>
          ) : null}
        </div>
        <div className="trade-chart-command-group trade-chart-command-group-actions">
          <button type="button" className="trade-chart-command-chip trade-chart-command-chip-muted" disabled>
            Alert
          </button>
          <button type="button" className="trade-chart-command-chip trade-chart-command-chip-muted" disabled>
            Replay
          </button>
          <button type="button" className="trade-chart-command-chip trade-chart-command-chip-menu" onClick={resetChartView}>
            Reset
          </button>
        </div>
      </div>
      {showIndicatorMenu || showDrawingMenu ? (
        <div className="trade-chart-menu-tray">
          {showIndicatorMenu && onToggleLayerVisibility ? (
            <div className="trade-chart-popover trade-chart-popover-indicators" aria-label="Indicator menu">
              <div className="trade-chart-popover-header">
                <strong>Indicators and layers</strong>
                <span>Toggle what stays on the chart</span>
              </div>
              <div className="trade-chart-popover-actions trade-chart-popover-actions-compact">
                <button type="button" onClick={() => handleSetAllLayers(true)}>
                  Show all
                </button>
                <button type="button" onClick={() => handleSetAllLayers(false)}>
                  Hide all
                </button>
                <button type="button" onClick={() => setShowIndicatorStrip((current) => !current)}>
                  {showIndicatorStrip ? "Hide strip" : "Show strip"}
                </button>
              </div>
              <div className="trade-chart-indicator-menu-sections">
                {indicatorSections.map((section) => (
                  <section key={section.title} className="trade-chart-indicator-menu-section">
                    <div className="trade-chart-indicator-menu-section-header">
                      <strong>{section.title}</strong>
                      <span>{section.note}</span>
                    </div>
                    <div className="trade-chart-menu-grid">
                      {section.items.map((item) => (
                        <button
                          key={item.key}
                          type="button"
                          className={`trade-chart-menu-option trade-chart-menu-option-indicator${layerVisibility[item.key] ? " is-active" : ""}`}
                          onClick={() => onToggleLayerVisibility(item.key)}
                        >
                          <i className={`trade-chart-indicator-swatch ${item.colorClass}`} />
                          <span>{item.label}</span>
                          {item.value ? <strong>{item.value}</strong> : null}
                        </button>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </div>
          ) : null}
          {showDrawingMenu ? (
            <div className="trade-chart-popover trade-chart-popover-draw" aria-label="Drawing menu">
              <div className="trade-chart-popover-header">
                <strong>Drawing tools</strong>
                <span>{drawingInstruction}</span>
              </div>
              <div className="trade-chart-menu-grid">
                {drawingToolOptions.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    className={`trade-chart-menu-option trade-chart-menu-option-tool${drawingTool === option.key ? " is-active" : ""}`}
                    onClick={() => handleSelectDrawingTool(option.key)}
                    disabled={Boolean(option.requiresBars && !canDraw)}
                  >
                    <span className="trade-chart-menu-tool-mark">{option.railLabel}</span>
                    <span>
                      <strong>{option.label}</strong>
                      <small>{option.description}</small>
                    </span>
                  </button>
                ))}
              </div>
              <div className="trade-chart-popover-actions">
                <button type="button" onClick={handleUndoDrawing} disabled={drawings.length === 0}>
                  Undo
                </button>
                <button type="button" onClick={handleDeleteSelectedDrawing} disabled={!selectedDrawingId}>
                  Delete selected
                </button>
                <button type="button" onClick={handleClearDrawings} disabled={drawings.length === 0}>
                  Clear drawings
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
      {showDrawingTools ? (
        <div className={`trade-chart-tool-status${drawingTool !== "cursor" ? " is-active" : ""}`} role="status">
          <strong>{activeDrawingTool.label}</strong>
          <span>{drawingInstruction}</span>
        </div>
      ) : null}
      <div className="trade-chart-header">
        <div className="trade-chart-title-group">
          <strong>{trade?.symbol ?? "Chart"}</strong>
          <span>{trade ? `${trade.tradeDate} - ${intervalLabels[interval]}` : intervalLabels[interval]}</span>
        </div>
        <div className="trade-chart-readout">
          {headerBar ? (
            <>
              <span>{formatTimestampLabel(headerBar.time, interval)}</span>
              <span>O {headerBar.open.toFixed(2)}</span>
              <span>H {headerBar.high.toFixed(2)}</span>
              <span>L {headerBar.low.toFixed(2)}</span>
              <span>C {headerBar.close.toFixed(2)}</span>
              <span>V {formatVolume(headerBar.volume)}</span>
              {hoveredVwap !== null ? <span>VWAP {hoveredVwap.toFixed(2)}</span> : null}
              {dayOpen !== null ? <span>Open {dayOpen.toFixed(2)}</span> : null}
              {dayHigh !== null ? <span>HOD {dayHigh.toFixed(2)}</span> : null}
              {dayLow !== null ? <span>LOD {dayLow.toFixed(2)}</span> : null}
              <span className={change >= 0 ? "trade-chart-positive" : "trade-chart-negative"}>
                {change >= 0 ? "+" : ""}
                {change.toFixed(2)} ({changePct >= 0 ? "+" : ""}
                {changePct.toFixed(2)}%)
              </span>
            </>
          ) : (
            <span>No bars loaded</span>
          )}
        </div>
        <div className="trade-chart-quick-actions">
          <button type="button" className="chart-quick-chip" onClick={fitTradeRange} disabled={!trade || focusMode === "day"}>
            Fit Trade
          </button>
          <button type="button" className="chart-quick-chip" onClick={fitDayRange}>
            Fit Day
          </button>
          <button type="button" className="chart-quick-chip" onClick={resetChartView}>
            Reset
          </button>
        </div>
      </div>
      {showIndicatorStrip && activeIndicatorItems.length > 0 ? (
        <div className="trade-chart-indicator-strip">
          <span className="trade-chart-indicator-strip-label">Active</span>
          {activeIndicatorItems.map((item) => (
            <button
              key={item.key}
              type="button"
              className="trade-chart-indicator-chip"
              onClick={() => onToggleLayerVisibility?.(item.key)}
              aria-pressed={layerVisibility[item.key]}
              title={`Hide ${item.label}`}
            >
              <i className={`trade-chart-indicator-swatch ${item.colorClass}`} />
              <span>{item.label}</span>
              {item.value ? <strong className="trade-chart-indicator-value">{item.value}</strong> : null}
            </button>
          ))}
        </div>
      ) : null}
      <div className="trade-chart-stage">
        {showDrawingTools ? (
          <div className="trade-chart-tool-rail" aria-label="Drawing tools">
            {drawingToolOptions.map((option) => (
              <button
                key={option.key}
                type="button"
                className={`trade-chart-tool-button${drawingTool === option.key ? " is-active" : ""}`}
                onClick={() => handleSelectDrawingTool(option.key)}
                disabled={Boolean(option.requiresBars && !canDraw)}
                title={`${option.label}: ${option.description}`}
                aria-label={option.label}
              >
                <span className={`trade-chart-tool-glyph${option.railLabel.length > 2 ? " trade-chart-tool-glyph-text" : ""}`}>
                  {option.railLabel}
                </span>
              </button>
            ))}
            <span className="trade-chart-tool-divider" />
            <button
              type="button"
              className="trade-chart-tool-button trade-chart-tool-button-muted"
              onClick={handleUndoDrawing}
              disabled={drawings.length === 0}
              title="Undo"
            >
              <span className="trade-chart-tool-glyph trade-chart-tool-glyph-text">Undo</span>
            </button>
            <button
              type="button"
              className="trade-chart-tool-button trade-chart-tool-button-muted"
              onClick={handleDeleteSelectedDrawing}
              disabled={!selectedDrawingId}
              title="Delete selected"
            >
              <span className="trade-chart-tool-glyph trade-chart-tool-glyph-text">Del</span>
            </button>
            <button
              type="button"
              className="trade-chart-tool-button trade-chart-tool-button-muted"
              onClick={handleClearDrawings}
              disabled={drawings.length === 0}
              title="Clear"
            >
              <span className="trade-chart-tool-glyph">X</span>
            </button>
          </div>
        ) : null}
        <div className="trade-chart-canvas-wrap" style={{ minHeight: height }}>
          <div
            ref={containerRef}
            className="trade-chart-canvas"
            style={fillHeight ? undefined : { height }}
          />
          {showDrawingTools && drawingTool !== "cursor" ? (
            <div className="trade-chart-drawing-help">
              <strong>{activeDrawingTool.label}</strong>
              <span>{drawingInstruction}</span>
            </div>
          ) : null}
          <div
            ref={overlayRef}
            className={`trade-chart-overlay${overlayModeClass}${drawingDragTarget ? " is-dragging" : ""}`}
            onPointerMove={handleOverlayPointerMove}
            onPointerLeave={handleOverlayPointerLeave}
            onPointerDown={handleOverlayPointerDown}
            onPointerUp={handleOverlayPointerUp}
            onPointerCancel={handleOverlayPointerUp}
          >
            <svg className="trade-chart-drawings" width="100%" height="100%">
            {projectedExecutionMarkers.map((marker) => (
              <polygon
                key={marker.id}
                points={getExecutionMarkerPoints(marker.x, marker.y, marker.kind)}
                className="trade-chart-execution-marker"
                fill={getExecutionMarkerFill(marker.kind)}
              />
            ))}
            {projectedDrawings.map((drawing) => {
              const isSelected = drawing.id === selectedDrawingId;

              if (drawing.type === "trendline") {
                return (
                  <g key={drawing.id}>
                    <line
                      x1={drawing.x1}
                      y1={drawing.y1}
                      x2={drawing.x2}
                      y2={drawing.y2}
                      className="trade-chart-drawing-hit-area"
                      onPointerDown={(event) => handleSelectDrawing(event, drawing.id)}
                      onContextMenu={(event) => handleOpenDrawingContextMenu(event, drawing.id)}
                    />
                    <line
                      x1={drawing.x1}
                      y1={drawing.y1}
                      x2={drawing.x2}
                      y2={drawing.y2}
                      className={`trade-chart-drawing-line${isSelected ? " is-selected" : ""}`}
                    />
                    {isSelected ? (
                      <>
                        <circle
                          cx={drawing.x1}
                          cy={drawing.y1}
                          r={4}
                          className="trade-chart-drawing-handle"
                          onPointerDown={(event) =>
                            handleStartDrawingDrag(event, { id: drawing.id, type: "trendline-start" })
                          }
                        />
                        <circle
                          cx={drawing.x2}
                          cy={drawing.y2}
                          r={4}
                          className="trade-chart-drawing-handle"
                          onPointerDown={(event) =>
                            handleStartDrawingDrag(event, { id: drawing.id, type: "trendline-end" })
                          }
                        />
                      </>
                    ) : null}
                  </g>
                );
              }

              if (drawing.type === "horizontal") {
                return (
                  <g key={drawing.id}>
                    <line
                      x1={0}
                      y1={drawing.y}
                      x2={overlaySize.width}
                      y2={drawing.y}
                      className="trade-chart-drawing-hit-area"
                      onPointerDown={(event) => handleStartDrawingDrag(event, { id: drawing.id, type: "horizontal" })}
                      onContextMenu={(event) => handleOpenDrawingContextMenu(event, drawing.id)}
                    />
                    <line
                      x1={0}
                      y1={drawing.y}
                      x2={overlaySize.width}
                      y2={drawing.y}
                      className={`trade-chart-drawing-line trade-chart-drawing-line-horizontal${isSelected ? " is-selected" : ""}`}
                    />
                  </g>
                );
              }

              return (
                <g key={drawing.id}>
                  <line
                    x1={drawing.x}
                    y1={0}
                    x2={drawing.x}
                    y2={overlaySize.height}
                    className="trade-chart-drawing-hit-area"
                    onPointerDown={(event) => handleStartDrawingDrag(event, { id: drawing.id, type: "vertical" })}
                    onContextMenu={(event) => handleOpenDrawingContextMenu(event, drawing.id)}
                  />
                  <line
                    x1={drawing.x}
                    y1={0}
                    x2={drawing.x}
                    y2={overlaySize.height}
                    className={`trade-chart-drawing-line trade-chart-drawing-line-vertical${isSelected ? " is-selected" : ""}`}
                  />
                </g>
              );
            })}
              {draftTrendLine ? (
                <line
                  x1={draftTrendLine.x1}
                y1={draftTrendLine.y1}
                x2={draftTrendLine.x2}
                y2={draftTrendLine.y2}
                  className="trade-chart-drawing-line trade-chart-drawing-line-draft"
                />
              ) : null}
              {draftHorizontalLine ? (
                <line
                  x1={0}
                  y1={draftHorizontalLine.y}
                  x2={overlaySize.width}
                  y2={draftHorizontalLine.y}
                  className="trade-chart-drawing-line trade-chart-drawing-line-horizontal trade-chart-drawing-line-draft"
                />
              ) : null}
              {draftVerticalLine ? (
                <line
                  x1={draftVerticalLine.x}
                  y1={0}
                  x2={draftVerticalLine.x}
                  y2={overlaySize.height}
                  className="trade-chart-drawing-line trade-chart-drawing-line-vertical trade-chart-drawing-line-draft"
                />
              ) : null}
            </svg>
            {drawingContextMenu ? (
              <div
                className="trade-chart-context-menu"
                style={{
                  left: Math.min(drawingContextMenu.x, Math.max(0, overlaySize.width - 190)),
                  top: Math.min(drawingContextMenu.y, Math.max(0, overlaySize.height - 64))
                }}
                onPointerDown={(event) => event.stopPropagation()}
                onContextMenu={(event) => event.preventDefault()}
              >
                <button type="button" onClick={() => handleDeleteDrawing(drawingContextMenu.drawingId)}>
                  Delete drawing
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
};
