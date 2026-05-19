import { useId, useMemo, useState } from "react";
import type { CSSProperties, PointerEvent } from "react";
import type { TimeSeriesPoint } from "../../../lib/analytics/tradeAnalytics";
import type { GroupedTrade } from "../../../types/trade";

interface DailyPnlOverviewProps {
  points: TimeSeriesPoint[];
  comparePoints?: TimeSeriesPoint[];
  trades: GroupedTrade[];
  compareTrades?: GroupedTrade[];
  title: string;
  positiveColor?: string;
  negativeColor?: string;
  compareColor?: string;
  cumulativeColor?: string;
  valueFormatter?: (value: number) => string;
  primarySeriesLabel?: string;
  compareSeriesLabel?: string;
}

interface DailyPointDetail extends TimeSeriesPoint {
  cumulative: number;
  fees: number;
  tradeCount: number;
}

interface ChartBar extends DailyPointDetail {
  barHeight: number;
  barWidth: number;
  isNegative: boolean;
  rectX: number;
  rectY: number;
  x: number;
}

interface HeatmapDay {
  dateKey: string;
  detail: (DailyPointDetail & { index: number }) | null;
}

const round = (value: number): number => Number(value.toFixed(2));

const formatDateKey = (value: Date): string => {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const parseDateKey = (value: string): Date => {
  const [year = "0", month = "1", day = "1"] = value.split("-");
  return new Date(Number(year), Number(month) - 1, Number(day));
};

const addDays = (value: Date, days: number): Date => {
  const result = new Date(value);
  result.setDate(result.getDate() + days);
  return result;
};

const getStartOfWeek = (value: Date): Date => {
  const result = new Date(value);
  const day = result.getDay();
  const delta = day === 0 ? -6 : 1 - day;
  result.setDate(result.getDate() + delta);
  result.setHours(0, 0, 0, 0);
  return result;
};

const getEndOfWeek = (value: Date): Date => addDays(getStartOfWeek(value), 6);

const formatChartDate = (value: string): string => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  return parseDateKey(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric"
  });
};

const formatFullChartDate = (value: string): string => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  return parseDateKey(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
};

const formatAxisValue = (value: number): string => {
  const absolute = Math.abs(value);
  const prefix = value < 0 ? "-" : "";

  if (absolute >= 1_000_000) {
    const compact = absolute >= 10_000_000 ? (absolute / 1_000_000).toFixed(0) : (absolute / 1_000_000).toFixed(1);
    return `${prefix}${compact}m`;
  }

  if (absolute >= 1_000) {
    const compact = absolute >= 10_000 ? (absolute / 1_000).toFixed(0) : (absolute / 1_000).toFixed(1);
    return `${prefix}${compact}k`;
  }

  if (absolute >= 100) {
    return `${Math.round(value)}`;
  }

  if (absolute >= 10) {
    return value.toFixed(1);
  }

  return value.toFixed(2);
};

const getNiceNumber = (value: number, shouldRound: boolean): number => {
  const absolute = Math.abs(value);
  if (!Number.isFinite(absolute) || absolute === 0) {
    return 1;
  }

  const exponent = Math.floor(Math.log10(absolute));
  const fraction = absolute / 10 ** exponent;
  let niceFraction = 1;

  if (shouldRound) {
    if (fraction < 1.5) {
      niceFraction = 1;
    } else if (fraction < 3) {
      niceFraction = 2;
    } else if (fraction < 7) {
      niceFraction = 5;
    } else {
      niceFraction = 10;
    }
  } else if (fraction <= 1) {
    niceFraction = 1;
  } else if (fraction <= 2) {
    niceFraction = 2;
  } else if (fraction <= 5) {
    niceFraction = 5;
  } else {
    niceFraction = 10;
  }

  return niceFraction * 10 ** exponent;
};

const buildNiceAxis = (minValue: number, maxValue: number, tickCount = 5) => {
  const safeMin = Number.isFinite(minValue) ? minValue : 0;
  const safeMax = Number.isFinite(maxValue) ? maxValue : 0;

  if (safeMin === safeMax) {
    const buffer = Math.max(1, Math.abs(safeMin) * 0.2);
    const min = safeMin - buffer;
    const max = safeMax + buffer;

    return {
      max,
      min,
      ticks: [min, safeMin, max]
    };
  }

  const range = getNiceNumber(safeMax - safeMin, false);
  const spacing = getNiceNumber(range / Math.max(tickCount - 1, 1), true);
  const min = Math.floor(safeMin / spacing) * spacing;
  const max = Math.ceil(safeMax / spacing) * spacing;
  const ticks: number[] = [];

  for (let value = min; value <= max + spacing * 0.5; value += spacing) {
    ticks.push(Number(value.toFixed(10)));
  }

  return { max, min, ticks };
};

const buildLinePath = (points: Array<{ x: number; y: number }>): string => {
  if (points.length === 0) {
    return "";
  }

  return points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(" ");
};

const buildDailyDetails = (points: TimeSeriesPoint[], trades: GroupedTrade[]): DailyPointDetail[] => {
  const metaByDate = new Map<string, { fees: number; tradeCount: number }>();

  for (const trade of trades) {
    const current = metaByDate.get(trade.tradeDate) ?? { fees: 0, tradeCount: 0 };
    current.fees += trade.feesUsd;
    current.tradeCount += 1;
    metaByDate.set(trade.tradeDate, current);
  }

  let cumulative = 0;

  return points.map((point) => {
    const meta = metaByDate.get(point.label);
    cumulative += point.value;

    return {
      ...point,
      cumulative: round(cumulative),
      fees: round(meta?.fees ?? 0),
      tradeCount: meta?.tradeCount ?? 0
    };
  });
};

const buildCompareIndex = (activeIndex: number, activeLength: number, compareLength: number): number => {
  if (compareLength <= 1 || activeLength <= 1) {
    return Math.min(activeIndex, Math.max(compareLength - 1, 0));
  }

  return Math.round((activeIndex / (activeLength - 1)) * (compareLength - 1));
};

const getHeatmapCellStyle = (
  detail: DailyPointDetail | null,
  maxMagnitude: number,
  positiveColor: string,
  negativeColor: string
): CSSProperties => {
  if (!detail) {
    return {
      background: "rgba(255, 255, 255, 0.035)"
    };
  }

  if (detail.value === 0) {
    return {
      background: "rgba(125, 145, 180, 0.22)"
    };
  }

  const intensity = Math.min(1, Math.abs(detail.value) / Math.max(maxMagnitude, 1));
  const opacity = 0.18 + intensity * 0.74;
  const color = detail.value > 0 ? positiveColor : negativeColor;

  return {
    background: color,
    opacity
  };
};

const WEEKDAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"];

export const DailyPnlOverview = ({
  points,
  comparePoints = [],
  trades,
  compareTrades = [],
  title,
  positiveColor = "#2ee6d6",
  negativeColor = "#b42eff",
  compareColor = "#91a6cc",
  cumulativeColor = "#7bb6ff",
  valueFormatter = (value) => value.toFixed(2),
  primarySeriesLabel = "Current",
  compareSeriesLabel = "Previous"
}: DailyPnlOverviewProps) => {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const chartId = useId().replace(/:/g, "");

  const dailyDetails = useMemo(() => buildDailyDetails(points, trades), [points, trades]);
  const compareDetails = useMemo(
    () => buildDailyDetails(comparePoints, compareTrades),
    [comparePoints, compareTrades]
  );

  const summary = useMemo(() => {
    const totalNetPnl = round(dailyDetails.reduce((sum, point) => sum + point.value, 0));
    const totalTrades = dailyDetails.reduce((sum, point) => sum + point.tradeCount, 0);
    const greenDays = dailyDetails.filter((point) => point.value > 0).length;
    const redDays = dailyDetails.filter((point) => point.value < 0).length;
    const bestDay = dailyDetails.reduce<DailyPointDetail | null>(
      (best, point) => (!best || point.value > best.value ? point : best),
      null
    );
    const worstDay = dailyDetails.reduce<DailyPointDetail | null>(
      (worst, point) => (!worst || point.value < worst.value ? point : worst),
      null
    );

    return {
      activeDays: dailyDetails.length,
      avgDay: dailyDetails.length > 0 ? round(totalNetPnl / dailyDetails.length) : 0,
      bestDay,
      dayWinRate: dailyDetails.length > 0 ? (greenDays / dailyDetails.length) * 100 : 0,
      greenDays,
      redDays,
      totalNetPnl,
      totalTrades,
      worstDay
    };
  }, [dailyDetails]);

  const chart = useMemo(() => {
    const width = 1240;
    const height = 500;
    const paddingTop = 34;
    const paddingRight = 90;
    const paddingBottom = 66;
    const paddingLeft = 84;
    const innerWidth = width - paddingLeft - paddingRight;
    const innerHeight = height - paddingTop - paddingBottom;
    const dailyValues = [
      0,
      ...dailyDetails.map((point) => point.value),
      ...compareDetails.map((point) => point.value)
    ];
    const cumulativeValues = [
      0,
      ...dailyDetails.map((point) => point.cumulative),
      ...compareDetails.map((point) => point.cumulative)
    ];
    const dailyAxis = buildNiceAxis(Math.min(...dailyValues), Math.max(...dailyValues));
    const cumulativeAxis = buildNiceAxis(Math.min(...cumulativeValues), Math.max(...cumulativeValues));
    const dailyRange = dailyAxis.max - dailyAxis.min || 1;
    const cumulativeRange = cumulativeAxis.max - cumulativeAxis.min || 1;
    const yDailyScale = (value: number) =>
      paddingTop + innerHeight - ((value - dailyAxis.min) / dailyRange) * innerHeight;
    const yCumulativeScale = (value: number) =>
      paddingTop + innerHeight - ((value - cumulativeAxis.min) / cumulativeRange) * innerHeight;
    const xScale = (index: number) =>
      paddingLeft + (dailyDetails.length <= 1 ? innerWidth / 2 : (index / (dailyDetails.length - 1)) * innerWidth);
    const slotWidth = innerWidth / Math.max(dailyDetails.length, 1);
    const barWidth = Math.max(5, Math.min(34, slotWidth * 0.48));
    const compareBarWidth = Math.max(4, Math.min(22, barWidth * 0.58));
    const baselineY = yDailyScale(0);
    const chartBars: ChartBar[] = dailyDetails.map((point, index) => {
      const x = xScale(index);
      const y = yDailyScale(point.value);
      const barHeight = Math.max(2, Math.abs(y - baselineY));

      return {
        ...point,
        barHeight,
        barWidth,
        isNegative: point.value < 0,
        rectX: x - barWidth / 2,
        rectY: Math.min(y, baselineY),
        x
      };
    });
    const compareBars = dailyDetails.map((_, index) => {
      if (compareDetails.length === 0) {
        return null;
      }

      const compareIndex = buildCompareIndex(index, dailyDetails.length, compareDetails.length);
      const point = compareDetails[compareIndex];
      if (!point) {
        return null;
      }

      const x = xScale(index);
      const y = yDailyScale(point.value);
      const barHeight = Math.max(2, Math.abs(y - baselineY));

      return {
        ...point,
        barHeight,
        barWidth: compareBarWidth,
        isNegative: point.value < 0,
        rectX: x - compareBarWidth / 2,
        rectY: Math.min(y, baselineY),
        x
      };
    });
    const linePoints = dailyDetails.map((point, index) => ({
      ...point,
      x: xScale(index),
      y: yCumulativeScale(point.cumulative)
    }));
    const compareLinePoints = compareDetails.map((point, index) => ({
      ...point,
      x:
        compareDetails.length <= 1
          ? paddingLeft + innerWidth / 2
          : paddingLeft + (index / (compareDetails.length - 1)) * innerWidth,
      y: yCumulativeScale(point.cumulative)
    }));
    const linePath = buildLinePath(linePoints);
    const compareLinePath = buildLinePath(compareLinePoints);
    const cumulativeBaselineY = yCumulativeScale(0);
    const areaPath =
      linePath && linePoints.length > 0
        ? `${linePath} L ${linePoints[linePoints.length - 1].x.toFixed(2)} ${cumulativeBaselineY.toFixed(
            2
          )} L ${linePoints[0].x.toFixed(2)} ${cumulativeBaselineY.toFixed(2)} Z`
        : "";
    const xTickCount = Math.min(8, dailyDetails.length);
    const xTickIndexes =
      xTickCount <= 1
        ? [0]
        : Array.from(
            new Set(
              Array.from({ length: xTickCount }, (_, index) =>
                Math.round((index / (xTickCount - 1)) * (dailyDetails.length - 1))
              )
            )
          );

    return {
      areaPath,
      baselineY,
      chartBars,
      compareBars,
      compareLinePath,
      height,
      innerHeight,
      innerWidth,
      linePath,
      linePoints,
      paddingBottom,
      paddingLeft,
      paddingRight,
      paddingTop,
      rightTicks: cumulativeAxis.ticks.map((value) => ({
        value,
        y: yCumulativeScale(value)
      })),
      slotWidth,
      width,
      xTickIndexes,
      yTicks: dailyAxis.ticks.map((value) => ({
        value,
        y: yDailyScale(value)
      }))
    };
  }, [compareDetails, dailyDetails]);

  const heatmap = useMemo(() => {
    if (dailyDetails.length === 0) {
      return {
        days: [] as HeatmapDay[],
        maxMagnitude: 1,
        weekCount: 0
      };
    }

    const detailByDate = new Map(
      dailyDetails.map((detail, index) => [detail.label, { ...detail, index }])
    );
    const firstDate = parseDateKey(dailyDetails[0].label);
    const lastDate = parseDateKey(dailyDetails[dailyDetails.length - 1].label);
    const startDate = getStartOfWeek(firstDate);
    const endDate = getEndOfWeek(lastDate);
    const days: HeatmapDay[] = [];

    for (let cursor = new Date(startDate); cursor <= endDate; cursor = addDays(cursor, 1)) {
      const dateKey = formatDateKey(cursor);
      days.push({
        dateKey,
        detail: detailByDate.get(dateKey) ?? null
      });
    }

    return {
      days,
      maxMagnitude: Math.max(...dailyDetails.map((point) => Math.abs(point.value)), 1),
      weekCount: Math.ceil(days.length / 7)
    };
  }, [dailyDetails]);

  if (dailyDetails.length === 0) {
    return <div className="empty-state">Adjust the report filters to populate this chart.</div>;
  }

  const hoveredPoint = hoveredIndex === null ? null : chart.chartBars[hoveredIndex] ?? null;
  const hoveredLinePoint = hoveredIndex === null ? null : chart.linePoints[hoveredIndex] ?? null;
  const hoveredComparePoint = hoveredIndex === null ? null : chart.compareBars[hoveredIndex] ?? null;
  const readoutPoint = hoveredPoint ?? chart.chartBars[chart.chartBars.length - 1] ?? null;
  const readoutLinePoint = hoveredLinePoint ?? chart.linePoints[chart.linePoints.length - 1] ?? null;
  const tooltipHeight = hoveredComparePoint ? 118 : 96;
  const tooltipX =
    hoveredPoint && hoveredPoint.x > chart.width - chart.paddingRight - 254 ? hoveredPoint.x - 250 : (hoveredPoint?.x ?? 0) + 16;
  const tooltipAnchorY = hoveredPoint
    ? hoveredPoint.value >= 0
      ? hoveredPoint.rectY
      : hoveredPoint.rectY + hoveredPoint.barHeight
    : 0;
  const tooltipY =
    tooltipAnchorY > chart.height - chart.paddingBottom - tooltipHeight
      ? tooltipAnchorY - tooltipHeight - 12
      : tooltipAnchorY + 16;
  const readoutText = readoutPoint
    ? `${hoveredPoint ? formatChartDate(readoutPoint.label) : `Latest ${formatChartDate(readoutPoint.label)}`} | ${primarySeriesLabel} ${valueFormatter(
        readoutPoint.value
      )} | Cum ${readoutLinePoint ? valueFormatter(readoutLinePoint.cumulative) : valueFormatter(readoutPoint.cumulative)}`
    : "No daily P&L data";

  const handlePointerMove = (event: PointerEvent<SVGRectElement>) => {
    const bounds = event.currentTarget.ownerSVGElement?.getBoundingClientRect();
    if (!bounds) {
      return;
    }

    const svgX = ((event.clientX - bounds.left) / bounds.width) * chart.width;
    const boundedX = Math.max(chart.paddingLeft, Math.min(chart.width - chart.paddingRight, svgX));
    const ratio = (boundedX - chart.paddingLeft) / chart.innerWidth;
    const nextIndex = dailyDetails.length <= 1 ? 0 : Math.round(ratio * (dailyDetails.length - 1));
    setHoveredIndex(nextIndex);
  };

  const summaryCards = [
    {
      detail: `${summary.totalTrades.toLocaleString()} trades across ${summary.activeDays.toLocaleString()} sessions`,
      key: "net",
      label: "Net P&L",
      tone: summary.totalNetPnl >= 0 ? "positive" : "negative",
      value: valueFormatter(summary.totalNetPnl)
    },
    {
      detail: `${summary.greenDays} green / ${summary.redDays} red`,
      key: "win-rate",
      label: "Day Win Rate",
      tone: summary.dayWinRate >= 50 ? "positive" : "negative",
      value: `${summary.dayWinRate.toFixed(1)}%`
    },
    {
      detail: "Per active trading day",
      key: "avg",
      label: "Avg Day",
      tone: summary.avgDay >= 0 ? "positive" : "negative",
      value: valueFormatter(summary.avgDay)
    },
    {
      detail: summary.bestDay ? formatFullChartDate(summary.bestDay.label) : "No data",
      key: "best",
      label: "Best Day",
      tone: "positive",
      value: summary.bestDay ? valueFormatter(summary.bestDay.value) : valueFormatter(0)
    },
    {
      detail: summary.worstDay ? formatFullChartDate(summary.worstDay.label) : "No data",
      key: "worst",
      label: "Worst Day",
      tone: summary.worstDay && summary.worstDay.value >= 0 ? "positive" : "negative",
      value: summary.worstDay ? valueFormatter(summary.worstDay.value) : valueFormatter(0)
    }
  ];

  return (
    <div className="daily-pnl-overview-card">
      <div className="panel-header">
        <div className="panel-title-inline">
          <span className="panel-header-line" style={{ background: positiveColor }} />
          <h2>{title}</h2>
        </div>
        <span className="report-line-chart-readout">{readoutText}</span>
      </div>

      <div className="daily-pnl-summary-grid">
        {summaryCards.map((card) => (
          <div key={card.key} className={`daily-pnl-summary-card daily-pnl-summary-card-${card.tone}`}>
            <span>{card.label}</span>
            <strong>{card.value}</strong>
            <small>{card.detail}</small>
          </div>
        ))}
      </div>

      <div className="daily-pnl-chart-shell">
        <div className="daily-pnl-chart-legend" aria-hidden="true">
          <span><i style={{ background: positiveColor }} /> Wins</span>
          <span><i style={{ background: negativeColor }} /> Losses</span>
          <span><i style={{ background: cumulativeColor }} /> Cumulative</span>
          {compareDetails.length > 0 ? <span><i style={{ background: compareColor }} /> {compareSeriesLabel}</span> : null}
        </div>
        <svg
          viewBox={`0 0 ${chart.width} ${chart.height}`}
          className="daily-pnl-chart-svg"
          preserveAspectRatio="none"
        >
          <defs>
            <linearGradient id={`${chartId}-positive-bar`} x1="0%" y1="100%" x2="0%" y2="0%">
              <stop offset="0%" stopColor={positiveColor} stopOpacity="0.68" />
              <stop offset="100%" stopColor={positiveColor} stopOpacity="1" />
            </linearGradient>
            <linearGradient id={`${chartId}-negative-bar`} x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor={negativeColor} stopOpacity="1" />
              <stop offset="100%" stopColor={negativeColor} stopOpacity="0.7" />
            </linearGradient>
            <linearGradient id={`${chartId}-compare-bar`} x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor={compareColor} stopOpacity="0.56" />
              <stop offset="100%" stopColor={compareColor} stopOpacity="0.22" />
            </linearGradient>
            <linearGradient id={`${chartId}-cumulative-area`} x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor={cumulativeColor} stopOpacity="0.16" />
              <stop offset="100%" stopColor={cumulativeColor} stopOpacity="0" />
            </linearGradient>
          </defs>
          <rect
            x={chart.paddingLeft}
            y={chart.paddingTop}
            width={chart.innerWidth}
            height={chart.innerHeight}
            rx="18"
            className="report-line-chart-plot-bg"
          />
          {chart.yTicks.map((tick) => (
            <g key={`daily-y-${tick.value}`}>
              <line
                x1={chart.paddingLeft}
                x2={chart.width - chart.paddingRight}
                y1={tick.y}
                y2={tick.y}
                className="report-line-chart-grid"
              />
              <text x={chart.paddingLeft - 12} y={tick.y + 4} textAnchor="end" className="report-line-chart-tick">
                {formatAxisValue(tick.value)}
              </text>
            </g>
          ))}
          {chart.rightTicks.map((tick) => (
            <text
              key={`daily-cumulative-y-${tick.value}`}
              x={chart.width - chart.paddingRight + 12}
              y={tick.y + 4}
              textAnchor="start"
              className="daily-pnl-chart-right-tick"
            >
              {formatAxisValue(tick.value)}
            </text>
          ))}
          {chart.xTickIndexes.map((index) => {
            const point = chart.chartBars[index];
            return point ? (
              <g key={`${point.label}-daily-grid`}>
                <line
                  x1={point.x}
                  x2={point.x}
                  y1={chart.paddingTop}
                  y2={chart.height - chart.paddingBottom}
                  className="report-line-chart-grid report-line-chart-grid-vertical"
                />
                <text
                  x={point.x}
                  y={chart.height - 30}
                  textAnchor={point.x > chart.width - 128 ? "end" : point.x < 128 ? "start" : "middle"}
                  className="report-line-chart-tick"
                >
                  {formatChartDate(point.label)}
                </text>
              </g>
            ) : null;
          })}
          <line
            x1={chart.paddingLeft}
            x2={chart.width - chart.paddingRight}
            y1={chart.baselineY}
            y2={chart.baselineY}
            className="report-line-chart-baseline daily-pnl-chart-zero-line"
          />
          <line
            x1={chart.paddingLeft}
            x2={chart.paddingLeft}
            y1={chart.paddingTop}
            y2={chart.height - chart.paddingBottom}
            className="report-line-chart-axis"
          />
          <line
            x1={chart.width - chart.paddingRight}
            x2={chart.width - chart.paddingRight}
            y1={chart.paddingTop}
            y2={chart.height - chart.paddingBottom}
            className="daily-pnl-chart-right-axis"
          />
          <line
            x1={chart.paddingLeft}
            x2={chart.width - chart.paddingRight}
            y1={chart.height - chart.paddingBottom}
            y2={chart.height - chart.paddingBottom}
            className="report-line-chart-axis"
          />
          {chart.compareBars.map((point, index) =>
            point ? (
              <rect
                key={`daily-compare-${point.label}-${index}`}
                x={point.rectX}
                y={point.rectY}
                width={point.barWidth}
                height={point.barHeight}
                rx="5"
                fill={`url(#${chartId}-compare-bar)`}
                className={`daily-pnl-chart-bar daily-pnl-chart-compare-bar ${
                  hoveredIndex === index ? "is-hovered" : hoveredIndex !== null ? "is-muted" : ""
                }`}
              />
            ) : null
          )}
          {chart.chartBars.map((point, index) => (
            <rect
              key={`${point.label}-${index}`}
              x={point.rectX}
              y={point.rectY}
              width={point.barWidth}
              height={point.barHeight}
              rx="6"
              fill={point.value >= 0 ? `url(#${chartId}-positive-bar)` : `url(#${chartId}-negative-bar)`}
              className={`daily-pnl-chart-bar ${hoveredIndex === index ? "is-hovered" : hoveredIndex !== null ? "is-muted" : ""}`}
            />
          ))}
          {chart.compareLinePath ? (
            <path
              d={chart.compareLinePath}
              fill="none"
              stroke={compareColor}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="daily-pnl-chart-cumulative-compare"
            />
          ) : null}
          {chart.areaPath ? <path d={chart.areaPath} fill={`url(#${chartId}-cumulative-area)`} className="daily-pnl-chart-area" /> : null}
          <path
            d={chart.linePath}
            fill="none"
            stroke={cumulativeColor}
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="daily-pnl-chart-cumulative-line"
          />
          {chart.linePoints.length > 0 ? (
            <g className="daily-pnl-chart-latest-marker">
              <circle
                cx={chart.linePoints[chart.linePoints.length - 1].x}
                cy={chart.linePoints[chart.linePoints.length - 1].y}
                r="5.8"
                className="report-line-chart-latest-ring"
              />
              <circle
                cx={chart.linePoints[chart.linePoints.length - 1].x}
                cy={chart.linePoints[chart.linePoints.length - 1].y}
                r="2.8"
                fill={cumulativeColor}
              />
            </g>
          ) : null}
          {hoveredPoint ? (
            <g className="report-line-chart-cursor">
              <line
                x1={hoveredPoint.x}
                x2={hoveredPoint.x}
                y1={chart.paddingTop}
                y2={chart.height - chart.paddingBottom}
                className="report-line-chart-crosshair"
              />
              <line
                x1={chart.paddingLeft}
                x2={chart.width - chart.paddingRight}
                y1={hoveredPoint.value >= 0 ? hoveredPoint.rectY : hoveredPoint.rectY + hoveredPoint.barHeight}
                y2={hoveredPoint.value >= 0 ? hoveredPoint.rectY : hoveredPoint.rectY + hoveredPoint.barHeight}
                className="report-line-chart-crosshair"
              />
              <circle
                cx={hoveredLinePoint?.x ?? hoveredPoint.x}
                cy={hoveredLinePoint?.y ?? chart.baselineY}
                r="5.2"
                fill={cumulativeColor}
                stroke="#f8fbff"
                strokeWidth="1.5"
              />
              <g transform={`translate(${tooltipX}, ${tooltipY})`}>
                <rect width="246" height={tooltipHeight} rx="12" className="report-line-chart-tooltip-box" />
                <text x="14" y="22" className="report-line-chart-tooltip-label">
                  {formatFullChartDate(hoveredPoint.label)}
                </text>
                <text x="14" y="43" className="report-line-chart-tooltip-value">
                  {primarySeriesLabel}: {valueFormatter(hoveredPoint.value)}
                </text>
                <text x="14" y="63" className="report-line-chart-tooltip-label">
                  Cum: {valueFormatter(hoveredPoint.cumulative)} | Trades: {hoveredPoint.tradeCount}
                </text>
                <text x="14" y="82" className="report-line-chart-tooltip-label">
                  Fees: ${hoveredPoint.fees.toFixed(2)}
                </text>
                {hoveredComparePoint ? (
                  <text x="14" y="102" className="report-line-chart-tooltip-label">
                    {compareSeriesLabel} {formatChartDate(hoveredComparePoint.label)}: {valueFormatter(hoveredComparePoint.value)}
                  </text>
                ) : null}
              </g>
            </g>
          ) : null}
          <rect
            x={chart.paddingLeft}
            y={chart.paddingTop}
            width={chart.innerWidth}
            height={chart.innerHeight}
            fill="transparent"
            onPointerMove={handlePointerMove}
            onPointerLeave={() => setHoveredIndex(null)}
          />
        </svg>
      </div>

      <div className="daily-pnl-heatmap-panel">
        <div className="daily-pnl-heatmap-header">
          <span>Session Heatmap</span>
          <div className="daily-pnl-heatmap-legend" aria-hidden="true">
            <i className="daily-pnl-heatmap-loss" />
            <span>Loss</span>
            <i className="daily-pnl-heatmap-win" />
            <span>Win</span>
          </div>
        </div>
        <div className="daily-pnl-heatmap-layout">
          <div className="daily-pnl-heatmap-weekdays" aria-hidden="true">
            {WEEKDAY_LABELS.map((label, index) => (
              <span key={`${label}-${index}`}>{label}</span>
            ))}
          </div>
          <div className="daily-pnl-heatmap-scroll">
            <div
              className="daily-pnl-heatmap-grid"
              style={{
                gridTemplateColumns: `repeat(${heatmap.weekCount}, minmax(14px, 1fr))`,
                minWidth: `${Math.max(heatmap.weekCount * 18, 280)}px`
              }}
              onPointerLeave={() => setHoveredIndex(null)}
            >
              {heatmap.days.map((day) => (
                <span
                  key={day.dateKey}
                  className={`daily-pnl-heatmap-cell ${
                    day.detail
                      ? day.detail.value > 0
                        ? "daily-pnl-heatmap-cell-win"
                        : day.detail.value < 0
                          ? "daily-pnl-heatmap-cell-loss"
                          : "daily-pnl-heatmap-cell-flat"
                      : ""
                  }`}
                  style={getHeatmapCellStyle(day.detail, heatmap.maxMagnitude, positiveColor, negativeColor)}
                  title={
                    day.detail
                      ? `${formatFullChartDate(day.dateKey)}: ${valueFormatter(day.detail.value)}`
                      : formatFullChartDate(day.dateKey)
                  }
                  onPointerEnter={() => {
                    if (day.detail) {
                      setHoveredIndex(day.detail.index);
                    }
                  }}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
