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
  type ISeriesApi,
  type Time,
  type UTCTimestamp
} from "lightweight-charts";
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
}

interface TradeChartProps {
  bars: HistoricalBar[];
  trade: GroupedTrade | null;
  height?: number;
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

type DrawingTool = "cursor" | "trendline" | "horizontal" | "vertical";

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
  volume: true
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
  const displayBarsRef = useRef<HistoricalBar[]>([]);
  const [hoveredBar, setHoveredBar] = useState<HistoricalBar | null>(null);
  const [drawingTool, setDrawingTool] = useState<DrawingTool>("cursor");
  const [draftPoint, setDraftPoint] = useState<DrawingPoint | null>(null);
  const [hoverPoint, setHoverPoint] = useState<DrawingPoint | null>(null);
  const [selectedDrawingId, setSelectedDrawingId] = useState<string | null>(null);
  const [showIndicatorStrip, setShowIndicatorStrip] = useState(true);
  const [overlayVersion, setOverlayVersion] = useState(0);
  const [overlaySize, setOverlaySize] = useState({ width: 0, height: 0 });

  const sourceBars = useMemo(
    () => (regularSessionOnly ? bars.filter(isRegularSessionBar) : bars),
    [bars, regularSessionOnly]
  );
  const displayBars = useMemo(() => aggregateBars(sourceBars, interval), [interval, sourceBars]);
  const vwapData = useMemo(() => buildVwapSeries(displayBars), [displayBars]);
  const fastEmaData = useMemo(() => buildEmaSeries(displayBars, FAST_EMA_PERIOD), [displayBars]);
  const slowEmaData = useMemo(() => buildEmaSeries(displayBars, SLOW_EMA_PERIOD), [displayBars]);
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

  const resetDrawingDraft = useCallback(() => {
    setDraftPoint(null);
    setHoverPoint(null);
  }, []);

  const handleSelectDrawingTool = useCallback(
    (tool: DrawingTool) => {
      setDrawingTool((current) => (current === tool ? "cursor" : tool));
      setSelectedDrawingId(null);
      resetDrawingDraft();
    },
    [resetDrawingDraft]
  );

  useEffect(() => {
    resetDrawingDraft();
    setSelectedDrawingId(null);
  }, [interval, resetDrawingDraft, trade?.id]);

  useEffect(() => {
    if (!selectedDrawingId) {
      return;
    }

    if (!drawings.some((drawing) => drawing.id === selectedDrawingId)) {
      setSelectedDrawingId(null);
    }
  }, [drawings, selectedDrawingId]);

  const handleDeleteSelectedDrawing = useCallback(() => {
    if (!onDrawingsChange || !selectedDrawingId) {
      return;
    }

    onDrawingsChange(drawings.filter((drawing) => drawing.id !== selectedDrawingId));
    setSelectedDrawingId(null);
    setDrawingTool("cursor");
    resetDrawingDraft();
  }, [drawings, onDrawingsChange, resetDrawingDraft, selectedDrawingId]);

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

      if (draftPoint || hoverPoint || drawingTool !== "cursor" || selectedDrawingId) {
        event.preventDefault();
        setDrawingTool("cursor");
        setSelectedDrawingId(null);
        resetDrawingDraft();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [canDraw, draftPoint, drawingTool, handleDeleteSelectedDrawing, hoverPoint, resetDrawingDraft, selectedDrawingId]);

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
      if (!canDraw || drawingTool === "cursor") {
        return;
      }

      setHoverPoint(resolveDrawingPoint(event.clientX, event.clientY));
    },
    [canDraw, drawingTool, resolveDrawingPoint]
  );

  const handleOverlayPointerLeave = useCallback(() => {
    setHoverPoint(null);
  }, []);

  const handleOverlayPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!canDraw || drawingTool === "cursor" || !onDrawingsChange) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const point = resolveDrawingPoint(event.clientX, event.clientY);
      if (!point) {
        return;
      }

      if (drawingTool === "horizontal") {
        onDrawingsChange([
          ...drawings,
          {
            id: createDrawingId(),
            type: "horizontal",
            price: point.price
          }
        ]);
        setDrawingTool("cursor");
        resetDrawingDraft();
        return;
      }

      if (drawingTool === "vertical") {
        onDrawingsChange([
          ...drawings,
          {
            id: createDrawingId(),
            type: "vertical",
            time: point.time
          }
        ]);
        setDrawingTool("cursor");
        resetDrawingDraft();
        return;
      }

      if (!draftPoint) {
        setDraftPoint(point);
        return;
      }

      onDrawingsChange([
        ...drawings,
        {
          id: createDrawingId(),
          type: "trendline",
          startTime: draftPoint.time,
          startPrice: draftPoint.price,
          endTime: point.time,
          endPrice: point.price
        }
      ]);
      setDrawingTool("cursor");
      resetDrawingDraft();
    },
    [canDraw, draftPoint, drawingTool, drawings, onDrawingsChange, resetDrawingDraft, resolveDrawingPoint]
  );

  const handleUndoDrawing = useCallback(() => {
    if (!onDrawingsChange || drawings.length === 0) {
      return;
    }

    onDrawingsChange(drawings.slice(0, -1));
    setSelectedDrawingId(null);
    setDrawingTool("cursor");
    resetDrawingDraft();
  }, [drawings, onDrawingsChange, resetDrawingDraft]);

  const handleClearDrawings = useCallback(() => {
    if (!onDrawingsChange || drawings.length === 0) {
      return;
    }

    onDrawingsChange([]);
    setSelectedDrawingId(null);
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
    openSeriesRef.current = openSeries;
    hodSeriesRef.current = hodSeries;
    lodSeriesRef.current = lodSeries;
    volumeSeriesRef.current = volumeSeries;
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
    };
  }, [refreshOverlay]);

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

    if (displayBars.length === 0) {
      return;
    }

    if (!trade || focusMode === "day") {
      fitDayRange();
      return;
    }

    fitTradeRange();
  }, [displayBars, fastEmaData, fitDayRange, fitTradeRange, height, layerVisibility, showEma, showMarkers, slowEmaData, trade, vwapData]);

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

  const change = headerBar && previousBar ? headerBar.close - previousBar.close : 0;
  const changePct = headerBar && previousBar && previousBar.close !== 0 ? (change / previousBar.close) * 100 : 0;
  const indicatorItems = useMemo(() => {
    if (!onToggleLayerVisibility) {
      return [];
    }

    const items: Array<{
      key: keyof TradeChartLayerVisibility;
      label: string;
      colorClass: string;
      value?: string;
    }> = [];

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

    return items;
  }, [
    dayHigh,
    dayLow,
    dayOpen,
    headerBar?.volume,
    latestFastEma,
    latestSlowEma,
    latestVwap,
    onToggleLayerVisibility,
    showEma,
    showMarkers
  ]);

  const projectedDrawings = useMemo(() => {
    if (!chartRef.current || !seriesRef.current || overlaySize.width === 0 || overlaySize.height === 0) {
      return [];
    }

    return drawings
      .map((drawing) => {
        if (drawing.type === "trendline") {
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

        const x = chartRef.current?.timeScale().timeToCoordinate(drawing.time as UTCTimestamp);
        if (typeof x !== "number") {
          return null;
        }

        return {
          id: drawing.id,
          type: drawing.type,
          x
        };
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

  const intervalToolbar = availableIntervals && onChangeInterval ? (
    <div className="trade-chart-command-group trade-chart-command-group-intervals" aria-label="Chart timeframe">
      {availableIntervals.map((intervalOption) => (
        <button
          key={intervalOption}
          type="button"
          className={`trade-chart-command-chip${interval === intervalOption ? " is-active" : ""}`}
          onClick={() => onChangeInterval(intervalOption)}
        >
          {intervalOption}
        </button>
      ))}
    </div>
  ) : null;

  return (
    <div className="trade-chart-shell">
      <div className="trade-chart-command-bar">
        <div className="trade-chart-command-group">
          <button type="button" className="trade-chart-symbol-pill">
            {trade?.symbol ?? "Chart"}
          </button>
          {intervalToolbar}
        </div>
        <div className="trade-chart-command-group trade-chart-command-group-actions">
          {onToggleLayerVisibility ? (
            <button
              type="button"
              className={`trade-chart-command-chip trade-chart-command-chip-menu${showIndicatorStrip ? " is-active" : ""}`}
              onClick={() => setShowIndicatorStrip((current) => !current)}
            >
              Indicators
            </button>
          ) : null}
          {showDrawingTools ? (
            <button
              type="button"
              className={`trade-chart-command-chip trade-chart-command-chip-menu${drawingTool !== "cursor" ? " is-active" : ""}`}
              onClick={() => handleSelectDrawingTool(drawingTool === "cursor" ? "trendline" : "cursor")}
            >
              Draw
            </button>
          ) : null}
          <button type="button" className="trade-chart-command-chip trade-chart-command-chip-menu" onClick={resetChartView}>
            Reset
          </button>
        </div>
      </div>
      <div className="trade-chart-header">
        <div className="trade-chart-title-group">
          <strong>{trade?.symbol ?? "Chart"}</strong>
          <span>{trade ? `${trade.tradeDate} · ${intervalLabels[interval]}` : intervalLabels[interval]}</span>
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
      {showIndicatorStrip && indicatorItems.length > 0 ? (
        <div className="trade-chart-indicator-strip">
          {indicatorItems.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`trade-chart-indicator-chip${layerVisibility[item.key] ? "" : " is-disabled"}`}
              onClick={() => onToggleLayerVisibility?.(item.key)}
              aria-pressed={layerVisibility[item.key]}
              title={`${layerVisibility[item.key] ? "Hide" : "Show"} ${item.label}`}
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
            <button
              type="button"
              className={`trade-chart-tool-button${drawingTool === "cursor" ? " is-active" : ""}`}
              onClick={() => handleSelectDrawingTool("cursor")}
              title="Cursor"
            >
              <span className="trade-chart-tool-glyph">+</span>
            </button>
            <button
              type="button"
              className={`trade-chart-tool-button${drawingTool === "trendline" ? " is-active" : ""}`}
              onClick={() => handleSelectDrawingTool("trendline")}
              disabled={!canDraw}
              title="Trend line"
            >
              <span className="trade-chart-tool-glyph">?</span>
            </button>
            <button
              type="button"
              className={`trade-chart-tool-button${drawingTool === "horizontal" ? " is-active" : ""}`}
              onClick={() => handleSelectDrawingTool("horizontal")}
              disabled={!canDraw}
              title="Horizontal line"
            >
              <span className="trade-chart-tool-glyph">—</span>
            </button>
            <button
              type="button"
              className={`trade-chart-tool-button${drawingTool === "vertical" ? " is-active" : ""}`}
              onClick={() => handleSelectDrawingTool("vertical")}
              disabled={!canDraw}
              title="Vertical line"
            >
              <span className="trade-chart-tool-glyph">¦</span>
            </button>
            <button
              type="button"
              className="trade-chart-tool-button trade-chart-tool-button-muted"
              onClick={handleUndoDrawing}
              disabled={drawings.length === 0}
              title="Undo"
            >
              <span className="trade-chart-tool-glyph">?</span>
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
              <span className="trade-chart-tool-glyph">?</span>
            </button>
          </div>
        ) : null}
        <div className="trade-chart-canvas-wrap">
          <div ref={containerRef} className="trade-chart-canvas" />
          <div
            ref={overlayRef}
            className={`trade-chart-overlay${drawingTool !== "cursor" && canDraw ? " trade-chart-overlay-active" : ""}`}
            onPointerMove={handleOverlayPointerMove}
            onPointerLeave={handleOverlayPointerLeave}
            onPointerDown={handleOverlayPointerDown}
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
                        <circle cx={drawing.x1} cy={drawing.y1} r={4} className="trade-chart-drawing-handle" />
                        <circle cx={drawing.x2} cy={drawing.y2} r={4} className="trade-chart-drawing-handle" />
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
                      onPointerDown={(event) => handleSelectDrawing(event, drawing.id)}
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
                    onPointerDown={(event) => handleSelectDrawing(event, drawing.id)}
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
          </div>
        </div>
      </div>
    </div>
  );
};
