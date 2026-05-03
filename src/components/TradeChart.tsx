import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  TickMarkType,
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
import {
  isAdapterManagedNativeTool,
  isAdapterManagedTradeDrawingType,
  resolveDrawingEngine
} from "../chart/drawingTools/drawingTypes";
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
  executionSide: "Buy" | "Sell";
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

interface DrawingAdapter {
  attach(args: { chart: IChartApi; series: ISeriesApi<"Candlestick">; container: HTMLElement }): void;
  detach(): void;
  destroy(): void;
  isAttached(): boolean;
  setOnDrawingsChange(handler: ((drawings: TradeChartDrawing[]) => void) | undefined): void;
  setOnSelectionChange(handler: ((drawingId: string | null) => void) | undefined): void;
  setReferencePoint(time: number | undefined, price: number | undefined): void;
  syncFromApp(drawings: TradeChartDrawing[]): void;
  setActiveTool(tool: DrawingTool): void;
  clearActiveTool(): void;
  selectAtPoint(point: { x: number; y: number }): string | null;
  addTrendLine(start: DrawingPoint, end: DrawingPoint): string;
  addHorizontalLine(price: number): string;
  addVerticalLine(time: number): string;
  addFibRetracement(start: DrawingPoint, end: DrawingPoint): string;
  deleteSelectedDrawing(): boolean;
  undoLast(): boolean;
  clearAll(): void;
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

const formatChartCrosshairTime = (time: Time): string => {
  const timestamp = toUtcTimestamp(time);
  if (timestamp === null) {
    return "";
  }

  return new Date(timestamp * 1000).toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
};

const formatChartTickMark = (time: Time, tickMarkType: TickMarkType, locale: string): string | null => {
  const timestamp = toUtcTimestamp(time);
  if (timestamp === null) {
    return null;
  }

  const date = new Date(timestamp * 1000);

  if (tickMarkType === TickMarkType.Year) {
    return new Intl.DateTimeFormat(locale, { year: "numeric" }).format(date);
  }

  if (tickMarkType === TickMarkType.Month) {
    return new Intl.DateTimeFormat(locale, { month: "short" }).format(date);
  }

  if (tickMarkType === TickMarkType.DayOfMonth) {
    return new Intl.DateTimeFormat(locale, {
      month: "short",
      day: "2-digit"
    }).format(date);
  }

  if (tickMarkType === TickMarkType.TimeWithSeconds) {
    return new Intl.DateTimeFormat(locale, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    }).format(date);
  }

  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
};

const createDrawingId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const FIBONACCI_LEVELS: Array<{ key: string; ratio: number; label: string }> = [
  { key: "fib-0", ratio: 0, label: "0" },
  { key: "fib-236", ratio: 0.236, label: "0.236" },
  { key: "fib-382", ratio: 0.382, label: "0.382" },
  { key: "fib-500", ratio: 0.5, label: "0.5" },
  { key: "fib-618", ratio: 0.618, label: "0.618" },
  { key: "fib-786", ratio: 0.786, label: "0.786" },
  { key: "fib-1000", ratio: 1, label: "1" }
];

interface ProjectedLineSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

const projectInfiniteLine = (
  anchorX: number,
  anchorY: number,
  directionX: number,
  directionY: number,
  width: number,
  height: number
): ProjectedLineSegment | null => {
  const epsilon = 0.0001;

  if (
    width <= 0 ||
    height <= 0 ||
    (Math.abs(directionX) < epsilon && Math.abs(directionY) < epsilon)
  ) {
    return null;
  }

  const candidates: number[] = [];

  if (Math.abs(directionX) >= epsilon) {
    const tAtLeft = (0 - anchorX) / directionX;
    const yAtLeft = anchorY + tAtLeft * directionY;
    if (yAtLeft >= 0 && yAtLeft <= height) {
      candidates.push(tAtLeft);
    }

    const tAtRight = (width - anchorX) / directionX;
    const yAtRight = anchorY + tAtRight * directionY;
    if (yAtRight >= 0 && yAtRight <= height) {
      candidates.push(tAtRight);
    }
  }

  if (Math.abs(directionY) >= epsilon) {
    const tAtTop = (0 - anchorY) / directionY;
    const xAtTop = anchorX + tAtTop * directionX;
    if (xAtTop >= 0 && xAtTop <= width) {
      candidates.push(tAtTop);
    }

    const tAtBottom = (height - anchorY) / directionY;
    const xAtBottom = anchorX + tAtBottom * directionX;
    if (xAtBottom >= 0 && xAtBottom <= width) {
      candidates.push(tAtBottom);
    }
  }

  if (candidates.length < 2) {
    return null;
  }

  const minT = Math.min(...candidates);
  const maxT = Math.max(...candidates);

  return {
    x1: anchorX + minT * directionX,
    y1: anchorY + minT * directionY,
    x2: anchorX + maxT * directionX,
    y2: anchorY + maxT * directionY
  };
};

const isTextInputLikeElement = (element: Element | null): boolean => {
  if (!element) {
    return false;
  }

  const tagName = element.tagName.toLowerCase();

  return (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement ||
    tagName === "button" ||
    element.getAttribute("contenteditable") === "true"
  );
};

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
        kind: "entry",
        executionSide: execution.side
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
      kind: signal.addedToWinner ? "addToWinner" : "averageDown",
      executionSide: execution.side
    });
  });

  if (layerVisibility.exit) {
    for (const [index, execution] of trade.closingExecutions.entries()) {
      markers.push({
        id: `exit-${execution.sourceIndex}-${index}`,
        time: getNearestBarTime(bars, toTradeTimestamp(execution.tradeDate, execution.time)),
        price: execution.price,
        kind: "exit",
        executionSide: execution.side
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
  const macdPaneIndexRef = useRef<number | null>(null);
  const stochasticPaneIndexRef = useRef<number | null>(null);
  const rsiPriceLineRefs = useRef<IPriceLine[]>([]);
  const rsiPaneIndexRef = useRef<number | null>(null);
  const displayBarsRef = useRef<HistoricalBar[]>([]);
  const drawingAdapterRef = useRef<DrawingAdapter | null>(null);
  const drawingsRef = useRef<TradeChartDrawing[]>(drawings);
  const [hoveredBar, setHoveredBar] = useState<HistoricalBar | null>(null);
  const [drawingTool, setDrawingTool] = useState<DrawingTool>("cursor");
  const [draftPoint, setDraftPoint] = useState<DrawingPoint | null>(null);
  const [secondaryDraftPoint, setSecondaryDraftPoint] = useState<DrawingPoint | null>(null);
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
  const drawingEngine = resolveDrawingEngine(showDrawingTools);
  const shouldUseDrawingAdapter = drawingEngine === "lightweight-adapter" && Boolean(onDrawingsChange);
  const adapterManagedDrawings = useMemo(
    () => drawings.filter((drawing) => isAdapterManagedTradeDrawingType(drawing.type)),
    [drawings]
  );
  const nativeOverlayDrawings = useMemo(
    () =>
      shouldUseDrawingAdapter
        ? drawings.filter((drawing) => !isAdapterManagedTradeDrawingType(drawing.type))
        : drawings,
    [drawings, shouldUseDrawingAdapter]
  );
  const isAdapterToolActive = shouldUseDrawingAdapter && isAdapterManagedNativeTool(drawingTool);

  const refreshOverlay = useCallback(() => {
    setOverlayVersion((current) => current + 1);
  }, []);

  const handleAdapterDrawingsChange = useCallback(
    (nextManagedDrawings: TradeChartDrawing[]) => {
      if (!onDrawingsChange) {
        return;
      }

      const unmanagedDrawings = drawingsRef.current.filter(
        (drawing) => !isAdapterManagedTradeDrawingType(drawing.type)
      );
      onDrawingsChange([...unmanagedDrawings, ...nextManagedDrawings]);
    },
    [onDrawingsChange]
  );

  useEffect(() => {
    drawingsRef.current = drawings;
  }, [drawings]);

  useEffect(() => {
    if (!shouldUseDrawingAdapter || !onDrawingsChange) {
      drawingAdapterRef.current?.destroy();
      drawingAdapterRef.current = null;
      return;
    }

    if (!chartRef.current || !seriesRef.current || !overlayRef.current || overlaySize.width === 0) {
      return;
    }

    let cancelled = false;

    const attachAdapter = async () => {
      try {
        let adapter = drawingAdapterRef.current;

        if (!adapter) {
          const module = await import("../chart/drawingTools/lightweightDrawingAdapter");
          if (cancelled) {
            return;
          }

          adapter = new module.LightweightDrawingAdapter({
            onDrawingsChange: handleAdapterDrawingsChange,
            onSelectionChange: setSelectedDrawingId
          });
          drawingAdapterRef.current = adapter;
        }

        adapter.setOnDrawingsChange(handleAdapterDrawingsChange);
        adapter.setOnSelectionChange(setSelectedDrawingId);
        if (!adapter.isAttached()) {
          adapter.attach({
            chart: chartRef.current!,
            series: seriesRef.current!,
            container: overlayRef.current!
          });
        }
      } catch (error) {
        console.error("Failed to initialize lightweight drawing adapter. Falling back to native drawings.", error);
      }
    };

    void attachAdapter();

    return () => {
      cancelled = true;
    };
  }, [handleAdapterDrawingsChange, onDrawingsChange, overlaySize.width, shouldUseDrawingAdapter]);

  useEffect(() => {
    return () => {
      drawingAdapterRef.current?.destroy();
      drawingAdapterRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!shouldUseDrawingAdapter || !drawingAdapterRef.current) {
      return;
    }

    const anchorBar = displayBars[displayBars.length - 1];
    drawingAdapterRef.current.setReferencePoint(anchorBar?.time, anchorBar?.close);
    drawingAdapterRef.current.syncFromApp(adapterManagedDrawings);
  }, [adapterManagedDrawings, displayBars, shouldUseDrawingAdapter]);

  useEffect(() => {
    if (!shouldUseDrawingAdapter || !drawingAdapterRef.current) {
      return;
    }

    if (isAdapterManagedNativeTool(drawingTool)) {
      drawingAdapterRef.current.setActiveTool(drawingTool);
      return;
    }

    drawingAdapterRef.current.clearActiveTool();
  }, [drawingTool, shouldUseDrawingAdapter]);

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

  const removeMacdPane = useCallback(() => {
    const chart = chartRef.current;

    if (!chart) {
      macdLineSeriesRef.current = null;
      macdSignalSeriesRef.current = null;
      macdHistogramSeriesRef.current = null;
      macdPaneIndexRef.current = null;
      return;
    }

    if (macdLineSeriesRef.current) {
      chart.removeSeries(macdLineSeriesRef.current);
    }
    if (macdSignalSeriesRef.current) {
      chart.removeSeries(macdSignalSeriesRef.current);
    }
    if (macdHistogramSeriesRef.current) {
      chart.removeSeries(macdHistogramSeriesRef.current);
    }

    const paneIndex = macdPaneIndexRef.current;
    macdLineSeriesRef.current = null;
    macdSignalSeriesRef.current = null;
    macdHistogramSeriesRef.current = null;
    macdPaneIndexRef.current = null;

    if (typeof paneIndex === "number" && chart.panes().some((pane) => pane.paneIndex() === paneIndex)) {
      chart.removePane(paneIndex);
    }

    requestAnimationFrame(refreshOverlay);
  }, [refreshOverlay]);

  const ensureMacdPane = useCallback(() => {
    if (
      macdLineSeriesRef.current &&
      macdSignalSeriesRef.current &&
      macdHistogramSeriesRef.current
    ) {
      return {
        line: macdLineSeriesRef.current,
        signal: macdSignalSeriesRef.current,
        histogram: macdHistogramSeriesRef.current
      };
    }

    if (!chartRef.current) {
      return null;
    }

    const macdPane = chartRef.current.addPane(true);
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

    macdLineSeriesRef.current = macdLineSeries;
    macdSignalSeriesRef.current = macdSignalSeries;
    macdHistogramSeriesRef.current = macdHistogramSeries;
    macdPaneIndexRef.current = macdPane.paneIndex();
    requestAnimationFrame(refreshOverlay);

    return {
      line: macdLineSeries,
      signal: macdSignalSeries,
      histogram: macdHistogramSeries
    };
  }, [refreshOverlay]);

  const removeStochasticPane = useCallback(() => {
    const chart = chartRef.current;

    if (!chart) {
      stochasticKSeriesRef.current = null;
      stochasticDSeriesRef.current = null;
      stochasticPaneIndexRef.current = null;
      return;
    }

    if (stochasticKSeriesRef.current) {
      chart.removeSeries(stochasticKSeriesRef.current);
    }
    if (stochasticDSeriesRef.current) {
      chart.removeSeries(stochasticDSeriesRef.current);
    }

    const paneIndex = stochasticPaneIndexRef.current;
    stochasticKSeriesRef.current = null;
    stochasticDSeriesRef.current = null;
    stochasticPaneIndexRef.current = null;

    if (typeof paneIndex === "number" && chart.panes().some((pane) => pane.paneIndex() === paneIndex)) {
      chart.removePane(paneIndex);
    }

    requestAnimationFrame(refreshOverlay);
  }, [refreshOverlay]);

  const ensureStochasticPane = useCallback(() => {
    if (stochasticKSeriesRef.current && stochasticDSeriesRef.current) {
      return {
        k: stochasticKSeriesRef.current,
        d: stochasticDSeriesRef.current
      };
    }

    if (!chartRef.current) {
      return null;
    }

    const stochPane = chartRef.current.addPane(true);
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

    stochasticKSeriesRef.current = stochKSeries;
    stochasticDSeriesRef.current = stochDSeries;
    stochasticPaneIndexRef.current = stochPane.paneIndex();
    requestAnimationFrame(refreshOverlay);

    return {
      k: stochKSeries,
      d: stochDSeries
    };
  }, [refreshOverlay]);

  const resetDrawingDraft = useCallback(() => {
    setDraftPoint(null);
    setSecondaryDraftPoint(null);
    setHoverPoint(null);
  }, []);

  const handleSelectDrawingTool = useCallback(
    (tool: DrawingTool) => {
      setDrawingTool(tool);
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
      resetDrawingDraft();
    },
    [drawings, onDrawingsChange, resetDrawingDraft]
  );

  const handleDeleteSelectedDrawing = useCallback(() => {
    if (!selectedDrawingId) {
      return;
    }

    const selectedDrawing = drawings.find((drawing) => drawing.id === selectedDrawingId);
    const shouldUseAdapterForSelection =
      shouldUseDrawingAdapter &&
      selectedDrawing !== undefined &&
      isAdapterManagedTradeDrawingType(selectedDrawing.type) &&
      Boolean(drawingAdapterRef.current);

    if (shouldUseAdapterForSelection && drawingAdapterRef.current?.deleteSelectedDrawing()) {
      setDrawingContextMenu(null);
      resetDrawingDraft();
      return;
    }

    handleDeleteDrawing(selectedDrawingId);
  }, [drawings, handleDeleteDrawing, resetDrawingDraft, selectedDrawingId, shouldUseDrawingAdapter]);

  useEffect(() => {
    if (!canDraw) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      const activeElement = document.activeElement;
      const isTypingTarget = isTextInputLikeElement(activeElement);

      if (!isTypingTarget) {
        const shortcutTool = (() => {
          switch (event.key.toLowerCase()) {
            case "v":
              return "cursor" as const;
            case "1":
              return "trendline" as const;
            case "2":
              return "horizontal" as const;
            case "3":
              return "vertical" as const;
            case "4":
              return "fibonacci" as const;
            case "5":
              return "pitchfork" as const;
            case "6":
              return "channel" as const;
            default:
              return null;
          }
        })();

        if (shortcutTool) {
          event.preventDefault();
          handleSelectDrawingTool(shortcutTool);
          return;
        }

        if ((event.key === "Delete" || event.key === "Backspace") && selectedDrawingId) {
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
        drawingAdapterRef.current?.clearActiveTool();
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
    handleSelectDrawingTool,
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
      if (!canDraw || !onDrawingsChange) {
        return;
      }

      if (drawingTool === "cursor") {
        if (!shouldUseDrawingAdapter || !drawingAdapterRef.current || !overlayRef.current) {
          return;
        }

        const rect = overlayRef.current.getBoundingClientRect();
        const selectedId = drawingAdapterRef.current.selectAtPoint({
          x: event.clientX - rect.left,
          y: event.clientY - rect.top
        });
        setSelectedDrawingId(selectedId);
        return;
      }

      if (isAdapterToolActive && drawingAdapterRef.current) {
        event.preventDefault();
        event.stopPropagation();
        setDrawingContextMenu(null);

        const point = resolveDrawingPoint(event.clientX, event.clientY);
        if (!point) {
          return;
        }

        if (drawingTool === "horizontal") {
          const id = drawingAdapterRef.current.addHorizontalLine(point.price);
          setSelectedDrawingId(id);
          resetDrawingDraft();
          return;
        }

        if (drawingTool === "vertical") {
          const id = drawingAdapterRef.current.addVerticalLine(point.time);
          setSelectedDrawingId(id);
          resetDrawingDraft();
          return;
        }

        if (drawingTool === "fibonacci") {
          if (!draftPoint) {
            setDraftPoint(point);
            return;
          }

          const id = drawingAdapterRef.current.addFibRetracement(draftPoint, point);
          setSelectedDrawingId(id);
          resetDrawingDraft();
          return;
        }

        if (!draftPoint) {
          setDraftPoint(point);
          return;
        }

        const id = drawingAdapterRef.current.addTrendLine(draftPoint, point);
        setSelectedDrawingId(id);
        resetDrawingDraft();
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
        resetDrawingDraft();
        return;
      }

      if (drawingTool === "pitchfork") {
        if (!draftPoint) {
          setDraftPoint(point);
          return;
        }

        if (!secondaryDraftPoint) {
          setSecondaryDraftPoint(point);
          return;
        }

        const id = createDrawingId();
        onDrawingsChange([
          ...drawings,
          {
            id,
            type: "pitchfork",
            pivotTime: draftPoint.time,
            pivotPrice: draftPoint.price,
            leftTime: secondaryDraftPoint.time,
            leftPrice: secondaryDraftPoint.price,
            rightTime: point.time,
            rightPrice: point.price
          }
        ]);
        setSelectedDrawingId(id);
        resetDrawingDraft();
        return;
      }

      if (drawingTool === "channel") {
        if (!draftPoint) {
          setDraftPoint(point);
          return;
        }

        if (!secondaryDraftPoint) {
          setSecondaryDraftPoint(point);
          return;
        }

        const id = createDrawingId();
        onDrawingsChange([
          ...drawings,
          {
            id,
            type: "channel",
            startTime: draftPoint.time,
            startPrice: draftPoint.price,
            endTime: secondaryDraftPoint.time,
            endPrice: secondaryDraftPoint.price,
            parallelTime: point.time,
            parallelPrice: point.price
          }
        ]);
        setSelectedDrawingId(id);
        resetDrawingDraft();
        return;
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
      resetDrawingDraft();
    },
    [
      canDraw,
      draftPoint,
      drawingTool,
      drawings,
      isAdapterToolActive,
      onDrawingsChange,
      resetDrawingDraft,
      resolveDrawingPoint,
      shouldUseDrawingAdapter,
      secondaryDraftPoint
    ]
  );

  const handleUndoDrawing = useCallback(() => {
    if (!onDrawingsChange || drawings.length === 0) {
      return;
    }

    const lastDrawing = drawings[drawings.length - 1];
    if (
      shouldUseDrawingAdapter &&
      lastDrawing &&
      isAdapterManagedTradeDrawingType(lastDrawing.type) &&
      drawingAdapterRef.current?.undoLast()
    ) {
      setSelectedDrawingId(null);
      setDrawingContextMenu(null);
      resetDrawingDraft();
      return;
    }

    onDrawingsChange(drawings.slice(0, -1));
    setSelectedDrawingId(null);
    setDrawingContextMenu(null);
    resetDrawingDraft();
  }, [drawings, onDrawingsChange, resetDrawingDraft, shouldUseDrawingAdapter]);

  const handleClearDrawings = useCallback(() => {
    if (!onDrawingsChange || drawings.length === 0) {
      return;
    }

    if (shouldUseDrawingAdapter && drawingAdapterRef.current) {
      drawingAdapterRef.current.clearAll();
    }

    onDrawingsChange([]);
    setSelectedDrawingId(null);
    setDrawingContextMenu(null);
    resetDrawingDraft();
  }, [drawings.length, onDrawingsChange, resetDrawingDraft, shouldUseDrawingAdapter]);

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
        barSpacing: 10,
        tickMarkFormatter: formatChartTickMark
      },
      localization: {
        timeFormatter: formatChartCrosshairTime
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
    macdLineSeriesRef.current = null;
    macdSignalSeriesRef.current = null;
    macdHistogramSeriesRef.current = null;
    stochasticKSeriesRef.current = null;
    stochasticDSeriesRef.current = null;
    macdPaneIndexRef.current = null;
    stochasticPaneIndexRef.current = null;
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
      macdPaneIndexRef.current = null;
      stochasticPaneIndexRef.current = null;
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
    if (!chartRef.current || !layerVisibility.macd || macdData.length === 0) {
      removeMacdPane();
      return;
    }

    const macdSeries = ensureMacdPane();
    if (!macdSeries) {
      return;
    }

    const macdLine = macdData.map((d) => ({ time: d.time, value: d.value }));
    const macdSignal = macdData
      .filter((d) => d.signal !== undefined)
      .map((d) => ({ time: d.time, value: d.signal ?? 0 }));
    const macdHistogram = macdData
      .filter((d) => d.histogram !== undefined)
      .map((d) => ({ time: d.time, value: d.histogram ?? 0 }));

    macdSeries.line.setData(macdLine);
    macdSeries.signal.setData(macdSignal);
    macdSeries.histogram.setData(macdHistogram);
  }, [ensureMacdPane, layerVisibility.macd, macdData, removeMacdPane]);

  useEffect(() => {
    if (!chartRef.current || !layerVisibility.stochastic || stochasticData.length === 0) {
      removeStochasticPane();
      return;
    }

    const stochSeries = ensureStochasticPane();
    if (!stochSeries) {
      return;
    }

    const stochK = stochasticData.map((d) => ({ time: d.time, value: d.k ?? d.value }));
    const stochD = stochasticData
      .filter((d) => d.d !== undefined)
      .map((d) => ({ time: d.time, value: d.d ?? 0 }));

    stochSeries.k.setData(stochK);
    stochSeries.d.setData(stochD);
  }, [ensureStochasticPane, layerVisibility.stochastic, removeStochasticPane, stochasticData]);

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

    const markerEntryColorClass = trade?.side === "Short" ? "legend-sell" : "legend-buy";
    const markerExitColorClass = trade?.side === "Short" ? "legend-buy" : "legend-sell";
    const items: IndicatorItem[] = [];

    if (showMarkers) {
      items.push({ key: "entry", label: "Entry", colorClass: markerEntryColorClass });
      items.push({ key: "addToWinner", label: "Add to winner", colorClass: "legend-add" });
      items.push({ key: "averageDown", label: "Average down", colorClass: "legend-average" });
      items.push({ key: "exit", label: "Exit", colorClass: markerExitColorClass });
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
    showMarkers,
    trade?.side
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
    const chart = chartRef.current;
    const series = seriesRef.current;

    if (!chart || !series || overlaySize.width === 0 || overlaySize.height === 0) {
      return [];
    }

    return nativeOverlayDrawings
      .map((drawing) => {
        if (drawing.type === "trendline") {
          const x1 = chart.timeScale().timeToCoordinate(drawing.startTime as UTCTimestamp);
          const y1 = series.priceToCoordinate(drawing.startPrice);
          const x2 = chart.timeScale().timeToCoordinate(drawing.endTime as UTCTimestamp);
          const y2 = series.priceToCoordinate(drawing.endPrice);

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

        if (drawing.type === "fibonacci") {
          const x1 = chart.timeScale().timeToCoordinate(drawing.startTime as UTCTimestamp);
          const y1 = series.priceToCoordinate(drawing.startPrice);
          const x2 = chart.timeScale().timeToCoordinate(drawing.endTime as UTCTimestamp);
          const y2 = series.priceToCoordinate(drawing.endPrice);

          if (
            typeof x1 !== "number" ||
            typeof y1 !== "number" ||
            typeof x2 !== "number" ||
            typeof y2 !== "number"
          ) {
            return null;
          }

          const levelStartX = Math.min(x1, x2);
          const levelEndX = Math.max(x1, x2);
          const deltaY = y2 - y1;

          return {
            id: drawing.id,
            type: drawing.type,
            x1,
            y1,
            x2,
            y2,
            levelStartX,
            levelEndX,
            levels: FIBONACCI_LEVELS.map((level) => ({
              key: level.key,
              label: level.label,
              y: y1 + deltaY * level.ratio
            }))
          };
        }

        if (drawing.type === "horizontal") {
          const y = series.priceToCoordinate(drawing.price);
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
          const x = chart.timeScale().timeToCoordinate(drawing.time as UTCTimestamp);
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
          const pivotX = chart.timeScale().timeToCoordinate(drawing.pivotTime as UTCTimestamp);
          const pivotY = series.priceToCoordinate(drawing.pivotPrice);
          const leftX = chart.timeScale().timeToCoordinate(drawing.leftTime as UTCTimestamp);
          const leftY = series.priceToCoordinate(drawing.leftPrice);
          const rightX = chart.timeScale().timeToCoordinate(drawing.rightTime as UTCTimestamp);
          const rightY = series.priceToCoordinate(drawing.rightPrice);

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

          const middleX = (leftX + rightX) / 2;
          const middleY = (leftY + rightY) / 2;
          const directionX = middleX - pivotX;
          const directionY = middleY - pivotY;

          const centerLine = projectInfiniteLine(
            pivotX,
            pivotY,
            directionX,
            directionY,
            overlaySize.width,
            overlaySize.height
          );
          const leftLine = projectInfiniteLine(
            leftX,
            leftY,
            directionX,
            directionY,
            overlaySize.width,
            overlaySize.height
          );
          const rightLine = projectInfiniteLine(
            rightX,
            rightY,
            directionX,
            directionY,
            overlaySize.width,
            overlaySize.height
          );

          if (!centerLine || !leftLine || !rightLine) {
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
            rightY,
            middleX,
            middleY,
            rails: [centerLine, leftLine, rightLine]
          };
        }

        if (drawing.type === "channel") {
          const x1 = chart.timeScale().timeToCoordinate(drawing.startTime as UTCTimestamp);
          const y1 = series.priceToCoordinate(drawing.startPrice);
          const x2 = chart.timeScale().timeToCoordinate(drawing.endTime as UTCTimestamp);
          const y2 = series.priceToCoordinate(drawing.endPrice);
          const x3 = chart.timeScale().timeToCoordinate(drawing.parallelTime as UTCTimestamp);
          const y3 = series.priceToCoordinate(drawing.parallelPrice);

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

          const directionX = x2 - x1;
          const directionY = y2 - y1;
          const offsetX = x3 - x1;
          const offsetY = y3 - y1;

          const mainLine = projectInfiniteLine(x1, y1, directionX, directionY, overlaySize.width, overlaySize.height);
          const parallelLine = projectInfiniteLine(
            x3,
            y3,
            directionX,
            directionY,
            overlaySize.width,
            overlaySize.height
          );

          if (!mainLine || !parallelLine) {
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
            y3,
            x4: x2 + offsetX,
            y4: y2 + offsetY,
            rails: [mainLine, parallelLine]
          };
        }

        return null;
      })
      .filter((drawing): drawing is NonNullable<typeof drawing> => drawing !== null);
  }, [nativeOverlayDrawings, overlaySize.height, overlaySize.width, overlayVersion]);

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

  const getExecutionMarkerFill = useCallback((marker: ExecutionMarkerPoint) => {
    if (marker.executionSide === "Buy") {
      return "#4CFFB1";
    }

    if (marker.executionSide === "Sell") {
      return "#FF6B7A";
    }

    const { kind } = marker;
    switch (kind) {
      case "entry":
        return "#4CFFB1";
      case "addToWinner":
        return "#5da8ff";
      case "averageDown":
        return "#ffcf5a";
      case "exit":
        return "#FF6B7A";
      default:
        return "#ffffff";
    }
  }, []);

  const getExecutionMarkerPoints = useCallback(
    (x: number, y: number, executionSide: ExecutionMarkerPoint["executionSide"]) => {
      const size = 10;

      if (executionSide === "Sell") {
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
          y2: hoverPoint.y,
          levelStartX: Math.min(draftPoint.x, hoverPoint.x),
          levelEndX: Math.max(draftPoint.x, hoverPoint.x),
          levels: FIBONACCI_LEVELS.map((level) => ({
            key: level.key,
            label: level.label,
            y: draftPoint.y + (hoverPoint.y - draftPoint.y) * level.ratio
          }))
        }
      : null;

  const draftPitchfork = useMemo(() => {
    if (drawingTool !== "pitchfork" || !draftPoint) {
      return null;
    }

    if (!secondaryDraftPoint) {
      if (!hoverPoint) {
        return null;
      }

      return {
        rails: null,
        base: null,
        guideLine: {
          x1: draftPoint.x,
          y1: draftPoint.y,
          x2: hoverPoint.x,
          y2: hoverPoint.y
        },
        anchors: [draftPoint, hoverPoint]
      };
    }

    const rightPoint = hoverPoint ?? secondaryDraftPoint;
    const middleX = (secondaryDraftPoint.x + rightPoint.x) / 2;
    const middleY = (secondaryDraftPoint.y + rightPoint.y) / 2;
    const directionX = middleX - draftPoint.x;
    const directionY = middleY - draftPoint.y;
    const centerLine = projectInfiniteLine(
      draftPoint.x,
      draftPoint.y,
      directionX,
      directionY,
      overlaySize.width,
      overlaySize.height
    );
    const leftLine = projectInfiniteLine(
      secondaryDraftPoint.x,
      secondaryDraftPoint.y,
      directionX,
      directionY,
      overlaySize.width,
      overlaySize.height
    );
    const rightLine = projectInfiniteLine(
      rightPoint.x,
      rightPoint.y,
      directionX,
      directionY,
      overlaySize.width,
      overlaySize.height
    );

    if (!centerLine || !leftLine || !rightLine) {
      return null;
    }

    return {
      guideLine: null,
      rails: [centerLine, leftLine, rightLine],
      base: {
        x1: secondaryDraftPoint.x,
        y1: secondaryDraftPoint.y,
        x2: rightPoint.x,
        y2: rightPoint.y
      },
      anchors: [draftPoint, secondaryDraftPoint, rightPoint]
    };
  }, [drawingTool, draftPoint, hoverPoint, overlaySize.height, overlaySize.width, secondaryDraftPoint]);

  const draftChannel = useMemo(() => {
    if (drawingTool !== "channel" || !draftPoint) {
      return null;
    }

    if (!secondaryDraftPoint) {
      if (!hoverPoint) {
        return null;
      }

      return {
        rails: null,
        connectorA: null,
        connectorB: null,
        guideLine: {
          x1: draftPoint.x,
          y1: draftPoint.y,
          x2: hoverPoint.x,
          y2: hoverPoint.y
        },
        anchors: [draftPoint, hoverPoint]
      };
    }

    const parallelPoint = hoverPoint ?? secondaryDraftPoint;
    const directionX = secondaryDraftPoint.x - draftPoint.x;
    const directionY = secondaryDraftPoint.y - draftPoint.y;
    const offsetX = parallelPoint.x - draftPoint.x;
    const offsetY = parallelPoint.y - draftPoint.y;
    const primaryLine = projectInfiniteLine(
      draftPoint.x,
      draftPoint.y,
      directionX,
      directionY,
      overlaySize.width,
      overlaySize.height
    );
    const parallelLine = projectInfiniteLine(
      parallelPoint.x,
      parallelPoint.y,
      directionX,
      directionY,
      overlaySize.width,
      overlaySize.height
    );

    if (!primaryLine || !parallelLine) {
      return null;
    }

    return {
      guideLine: null,
      rails: [primaryLine, parallelLine],
      connectorA: {
        x1: draftPoint.x,
        y1: draftPoint.y,
        x2: parallelPoint.x,
        y2: parallelPoint.y
      },
      connectorB: {
        x1: secondaryDraftPoint.x,
        y1: secondaryDraftPoint.y,
        x2: secondaryDraftPoint.x + offsetX,
        y2: secondaryDraftPoint.y + offsetY
      },
      anchors: [draftPoint, secondaryDraftPoint, parallelPoint]
    };
  }, [drawingTool, draftPoint, hoverPoint, overlaySize.height, overlaySize.width, secondaryDraftPoint]);

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
            ? "Click second anchor to complete Fibonacci retracement"
            : "Click first anchor for Fibonacci retracement"
          : drawingTool === "pitchfork"
            ? !draftPoint
              ? "Click the center pivot point"
              : !secondaryDraftPoint
                ? "Click the left pivot point"
                : "Click the right pivot point"
            : drawingTool === "channel"
                  ? !draftPoint
                ? "Click the start of the base line"
                : !secondaryDraftPoint
                  ? "Click the end of the base line"
                  : "Click a point for the parallel line"
              : selectedDrawingId
                ? "Drag supported handles or press Delete to remove."
                : "Choose a drawing tool or click a line to select it.";
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
    <div className={`trade-chart-shell${fillHeight ? " is-fill" : ""}`} data-drawing-engine={drawingEngine}>
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
              <g key={marker.id}>
                <polygon
                  points={getExecutionMarkerPoints(marker.x, marker.y, marker.executionSide)}
                  className={`trade-chart-execution-marker trade-chart-execution-marker-${marker.kind} trade-chart-execution-marker-${marker.executionSide.toLowerCase()}`}
                  fill={getExecutionMarkerFill(marker)}
                />
              </g>
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

              if (drawing.type === "fibonacci") {
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
                      className={`trade-chart-drawing-line trade-chart-drawing-line-fibonacci-anchor${isSelected ? " is-selected" : ""}`}
                    />
                    {drawing.levels.map((level) => (
                      <g key={level.key}>
                        <line
                          x1={drawing.levelStartX}
                          y1={level.y}
                          x2={drawing.levelEndX}
                          y2={level.y}
                          className={`trade-chart-drawing-line trade-chart-drawing-line-fibonacci${isSelected ? " is-selected" : ""}`}
                        />
                        <text
                          x={drawing.levelEndX + 6}
                          y={level.y - 2}
                          className="trade-chart-drawing-label trade-chart-drawing-label-fibonacci"
                        >
                          {level.label}
                        </text>
                      </g>
                    ))}
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

              if (drawing.type === "vertical") {
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
              }

              if (drawing.type === "pitchfork") {
                return (
                  <g key={drawing.id}>
                    {drawing.rails.map((line, index) => (
                      <g key={`${drawing.id}-pitchfork-rail-${index}`}>
                        <line
                          x1={line.x1}
                          y1={line.y1}
                          x2={line.x2}
                          y2={line.y2}
                          className="trade-chart-drawing-hit-area"
                          onPointerDown={(event) => handleSelectDrawing(event, drawing.id)}
                          onContextMenu={(event) => handleOpenDrawingContextMenu(event, drawing.id)}
                        />
                        <line
                          x1={line.x1}
                          y1={line.y1}
                          x2={line.x2}
                          y2={line.y2}
                          className={`trade-chart-drawing-line trade-chart-drawing-line-pitchfork${isSelected ? " is-selected" : ""}`}
                        />
                      </g>
                    ))}
                    <line
                      x1={drawing.leftX}
                      y1={drawing.leftY}
                      x2={drawing.rightX}
                      y2={drawing.rightY}
                      className={`trade-chart-drawing-line trade-chart-drawing-line-pitchfork-base${isSelected ? " is-selected" : ""}`}
                    />
                    {isSelected ? (
                      <>
                        <circle cx={drawing.pivotX} cy={drawing.pivotY} r={3.5} className="trade-chart-drawing-handle" />
                        <circle cx={drawing.leftX} cy={drawing.leftY} r={3.5} className="trade-chart-drawing-handle" />
                        <circle cx={drawing.rightX} cy={drawing.rightY} r={3.5} className="trade-chart-drawing-handle" />
                      </>
                    ) : null}
                  </g>
                );
              }

              if (drawing.type === "channel") {
                return (
                  <g key={drawing.id}>
                    {drawing.rails.map((line, index) => (
                      <g key={`${drawing.id}-channel-rail-${index}`}>
                        <line
                          x1={line.x1}
                          y1={line.y1}
                          x2={line.x2}
                          y2={line.y2}
                          className="trade-chart-drawing-hit-area"
                          onPointerDown={(event) => handleSelectDrawing(event, drawing.id)}
                          onContextMenu={(event) => handleOpenDrawingContextMenu(event, drawing.id)}
                        />
                        <line
                          x1={line.x1}
                          y1={line.y1}
                          x2={line.x2}
                          y2={line.y2}
                          className={`trade-chart-drawing-line trade-chart-drawing-line-channel${isSelected ? " is-selected" : ""}`}
                        />
                      </g>
                    ))}
                    <line
                      x1={drawing.x1}
                      y1={drawing.y1}
                      x2={drawing.x3}
                      y2={drawing.y3}
                      className={`trade-chart-drawing-line trade-chart-drawing-line-channel-connector${isSelected ? " is-selected" : ""}`}
                    />
                    <line
                      x1={drawing.x2}
                      y1={drawing.y2}
                      x2={drawing.x4}
                      y2={drawing.y4}
                      className={`trade-chart-drawing-line trade-chart-drawing-line-channel-connector${isSelected ? " is-selected" : ""}`}
                    />
                    {isSelected ? (
                      <>
                        <circle cx={drawing.x1} cy={drawing.y1} r={3.5} className="trade-chart-drawing-handle" />
                        <circle cx={drawing.x2} cy={drawing.y2} r={3.5} className="trade-chart-drawing-handle" />
                        <circle cx={drawing.x3} cy={drawing.y3} r={3.5} className="trade-chart-drawing-handle" />
                      </>
                    ) : null}
                  </g>
                );
              }

              return null;
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
              {draftFibonacci ? (
                <>
                  <line
                    x1={draftFibonacci.x1}
                    y1={draftFibonacci.y1}
                    x2={draftFibonacci.x2}
                    y2={draftFibonacci.y2}
                    className="trade-chart-drawing-line trade-chart-drawing-line-fibonacci-anchor trade-chart-drawing-line-draft"
                  />
                  {draftFibonacci.levels.map((level) => (
                    <g key={`draft-${level.key}`}>
                      <line
                        x1={draftFibonacci.levelStartX}
                        y1={level.y}
                        x2={draftFibonacci.levelEndX}
                        y2={level.y}
                        className="trade-chart-drawing-line trade-chart-drawing-line-fibonacci trade-chart-drawing-line-draft"
                      />
                      <text
                        x={draftFibonacci.levelEndX + 6}
                        y={level.y - 2}
                        className="trade-chart-drawing-label trade-chart-drawing-label-fibonacci"
                      >
                        {level.label}
                      </text>
                    </g>
                  ))}
                </>
              ) : null}
              {draftPitchfork?.guideLine ? (
                <line
                  x1={draftPitchfork.guideLine.x1}
                  y1={draftPitchfork.guideLine.y1}
                  x2={draftPitchfork.guideLine.x2}
                  y2={draftPitchfork.guideLine.y2}
                  className="trade-chart-drawing-line trade-chart-drawing-line-pitchfork trade-chart-drawing-line-draft"
                />
              ) : null}
              {draftPitchfork?.rails && draftPitchfork.base ? (
                <>
                  {draftPitchfork.rails.map((line, index) => (
                    <line
                      key={`draft-pitchfork-rail-${index}`}
                      x1={line.x1}
                      y1={line.y1}
                      x2={line.x2}
                      y2={line.y2}
                      className="trade-chart-drawing-line trade-chart-drawing-line-pitchfork trade-chart-drawing-line-draft"
                    />
                  ))}
                  <line
                    x1={draftPitchfork.base.x1}
                    y1={draftPitchfork.base.y1}
                    x2={draftPitchfork.base.x2}
                    y2={draftPitchfork.base.y2}
                    className="trade-chart-drawing-line trade-chart-drawing-line-pitchfork-base trade-chart-drawing-line-draft"
                  />
                </>
              ) : null}
              {draftChannel?.guideLine ? (
                <line
                  x1={draftChannel.guideLine.x1}
                  y1={draftChannel.guideLine.y1}
                  x2={draftChannel.guideLine.x2}
                  y2={draftChannel.guideLine.y2}
                  className="trade-chart-drawing-line trade-chart-drawing-line-channel trade-chart-drawing-line-draft"
                />
              ) : null}
              {draftChannel?.rails && draftChannel.connectorA && draftChannel.connectorB ? (
                <>
                  {draftChannel.rails.map((line, index) => (
                    <line
                      key={`draft-channel-rail-${index}`}
                      x1={line.x1}
                      y1={line.y1}
                      x2={line.x2}
                      y2={line.y2}
                      className="trade-chart-drawing-line trade-chart-drawing-line-channel trade-chart-drawing-line-draft"
                    />
                  ))}
                  <line
                    x1={draftChannel.connectorA.x1}
                    y1={draftChannel.connectorA.y1}
                    x2={draftChannel.connectorA.x2}
                    y2={draftChannel.connectorA.y2}
                    className="trade-chart-drawing-line trade-chart-drawing-line-channel-connector trade-chart-drawing-line-draft"
                  />
                  <line
                    x1={draftChannel.connectorB.x1}
                    y1={draftChannel.connectorB.y1}
                    x2={draftChannel.connectorB.x2}
                    y2={draftChannel.connectorB.y2}
                    className="trade-chart-drawing-line trade-chart-drawing-line-channel-connector trade-chart-drawing-line-draft"
                  />
                </>
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
