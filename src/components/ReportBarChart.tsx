import { useMemo, useState } from "react";
import type { PointerEvent } from "react";
import type { TimeSeriesPoint } from "../lib/analytics/tradeAnalytics";

interface ReportBarChartProps {
  points: TimeSeriesPoint[];
  title: string;
  yAxisLabel: string;
  color?: string;
  negativeColor?: string;
  positiveColor?: string;
  valueFormatter?: (value: number) => string;
  labelFormatter?: (label: string) => string;
}

const formatChartLabel = (value: string): string => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-");
    return new Date(Number(year), Number(month) - 1, Number(day)).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric"
    });
  }

  return value;
};

const formatShortLabel = (value: string): string => {
  const formatted = formatChartLabel(value);
  return formatted.length > 18 ? `${formatted.slice(0, 17)}...` : formatted;
};

export const ReportBarChart = ({
  points,
  title,
  yAxisLabel,
  color = "#c694ff",
  negativeColor = "#b42eff",
  positiveColor = "#2ee6d6",
  valueFormatter = (value) => value.toFixed(2),
  labelFormatter = formatChartLabel
}: ReportBarChartProps) => {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const chart = useMemo(() => {
    const width = 1240;
    const height = 420;
    const paddingTop = 34;
    const paddingRight = 80;
    const paddingBottom = 82;
    const paddingLeft = 84;
    const innerWidth = width - paddingLeft - paddingRight;
    const innerHeight = height - paddingTop - paddingBottom;
    const values = points.map((point) => point.value);
    const minValue = values.length > 0 ? Math.min(...values, 0) : 0;
    const maxValue = values.length > 0 ? Math.max(...values, 0) : 0;
    const rawRange = maxValue - minValue || Math.max(1, Math.abs(maxValue), Math.abs(minValue));
    const chartMin = minValue < 0 ? minValue - rawRange * 0.12 : 0;
    const chartMax = maxValue > 0 ? maxValue + rawRange * 0.12 : 0;
    const chartRange = chartMax - chartMin || 1;
    const yScale = (value: number) => paddingTop + innerHeight - ((value - chartMin) / chartRange) * innerHeight;
    const baselineY = yScale(0);
    const slotWidth = innerWidth / Math.max(points.length, 1);
    const barWidth = Math.max(10, Math.min(52, slotWidth * 0.58));
    const chartBars = points.map((point, index) => {
      const x = paddingLeft + index * slotWidth + (slotWidth - barWidth) / 2;
      const y = yScale(point.value);
      const top = Math.min(y, baselineY);
      const heightValue = Math.max(2, Math.abs(y - baselineY));

      return {
        ...point,
        barWidth,
        height: heightValue,
        isNegative: point.value < 0,
        x,
        y,
        rectY: top
      };
    });
    const yTicks = Array.from({ length: 5 }, (_, index) => {
      const value = chartMin + (chartRange / 4) * index;
      return {
        value,
        y: yScale(value)
      };
    });
    const xTickCount = Math.min(8, points.length);
    const xTickIndexes =
      xTickCount <= 1
        ? [0]
        : Array.from(
            new Set(
              Array.from({ length: xTickCount }, (_, index) =>
                Math.round((index / (xTickCount - 1)) * (points.length - 1))
              )
            )
          );

    return {
      baselineY,
      chartBars,
      height,
      innerHeight,
      innerWidth,
      paddingBottom,
      paddingLeft,
      paddingRight,
      paddingTop,
      slotWidth,
      width,
      xTickIndexes,
      yTicks
    };
  }, [points]);

  if (points.length === 0) {
    return <div className="empty-state">Adjust the report filters to populate this chart.</div>;
  }

  const hoveredPoint = hoveredIndex === null ? null : chart.chartBars[hoveredIndex] ?? null;
  const tooltipX =
    hoveredPoint && hoveredPoint.x > chart.width - chart.paddingRight - 220 ? hoveredPoint.x - 204 : (hoveredPoint?.x ?? 0) + 16;
  const tooltipY =
    hoveredPoint && hoveredPoint.rectY > chart.height - chart.paddingBottom - 74
      ? hoveredPoint.rectY - 82
      : (hoveredPoint?.rectY ?? 0) + 16;

  const handlePointerMove = (event: PointerEvent<SVGRectElement>) => {
    const bounds = event.currentTarget.ownerSVGElement?.getBoundingClientRect();
    if (!bounds) {
      return;
    }

    const svgX = ((event.clientX - bounds.left) / bounds.width) * chart.width;
    const boundedX = Math.max(chart.paddingLeft, Math.min(chart.width - chart.paddingRight, svgX));
    const nextIndex = Math.max(
      0,
      Math.min(points.length - 1, Math.floor((boundedX - chart.paddingLeft) / Math.max(chart.slotWidth, 1)))
    );
    setHoveredIndex(nextIndex);
  };

  return (
    <div className="report-bar-chart-card">
      <div className="panel-header">
        <div className="panel-title-inline">
          <span className="panel-header-line" style={{ background: color }} />
          <h2>{title}</h2>
        </div>
        <span className="report-line-chart-readout">
          {hoveredPoint
            ? `${labelFormatter(hoveredPoint.label)} - ${valueFormatter(hoveredPoint.value)}`
            : "Hover chart for bar details"}
        </span>
      </div>
      <div className="report-bar-chart-shell">
        <span className="report-line-chart-axis-label">{yAxisLabel}</span>
        <svg viewBox={`0 0 ${chart.width} ${chart.height}`} className="report-bar-chart-svg" preserveAspectRatio="none">
          {chart.yTicks.map((tick) => (
            <g key={`bar-y-${tick.value}`}>
              <line
                x1={chart.paddingLeft}
                x2={chart.width - chart.paddingRight}
                y1={tick.y}
                y2={tick.y}
                className="report-line-chart-grid"
              />
              <text x={chart.paddingLeft - 12} y={tick.y + 4} textAnchor="end" className="report-line-chart-tick">
                {valueFormatter(tick.value)}
              </text>
            </g>
          ))}
          {chart.xTickIndexes.map((index) => {
            const point = chart.chartBars[index];
            return point ? (
              <g key={`${point.label}-bar-grid`}>
                <line
                  x1={point.x + point.barWidth / 2}
                  x2={point.x + point.barWidth / 2}
                  y1={chart.paddingTop}
                  y2={chart.height - chart.paddingBottom}
                  className="report-line-chart-grid report-line-chart-grid-vertical"
                />
                <text
                  x={point.x + point.barWidth / 2}
                  y={chart.height - 30}
                  textAnchor="middle"
                  className="report-line-chart-tick"
                >
                  {formatShortLabel(point.label)}
                </text>
              </g>
            ) : null;
          })}
          <line
            x1={chart.paddingLeft}
            x2={chart.width - chart.paddingRight}
            y1={chart.baselineY}
            y2={chart.baselineY}
            className="report-line-chart-baseline"
          />
          <line
            x1={chart.paddingLeft}
            x2={chart.paddingLeft}
            y1={chart.paddingTop}
            y2={chart.height - chart.paddingBottom}
            className="report-line-chart-axis"
          />
          <line
            x1={chart.paddingLeft}
            x2={chart.width - chart.paddingRight}
            y1={chart.height - chart.paddingBottom}
            y2={chart.height - chart.paddingBottom}
            className="report-line-chart-axis"
          />
          {chart.chartBars.map((point, index) => (
            <rect
              key={`${point.label}-${index}`}
              x={point.x}
              y={point.rectY}
              width={point.barWidth}
              height={point.height}
              rx="7"
              fill={point.value < 0 ? negativeColor : point.value > 0 ? positiveColor : color}
              className="report-bar-chart-bar"
            />
          ))}
          {hoveredPoint ? (
            <g className="report-line-chart-cursor">
              <line
                x1={hoveredPoint.x + hoveredPoint.barWidth / 2}
                x2={hoveredPoint.x + hoveredPoint.barWidth / 2}
                y1={chart.paddingTop}
                y2={chart.height - chart.paddingBottom}
                className="report-line-chart-crosshair"
              />
              <g transform={`translate(${tooltipX}, ${tooltipY})`}>
                <rect width="202" height="58" rx="12" className="report-line-chart-tooltip-box" />
                <text x="14" y="22" className="report-line-chart-tooltip-label">
                  {labelFormatter(hoveredPoint.label)}
                </text>
                <text x="14" y="43" className="report-line-chart-tooltip-value">
                  {valueFormatter(hoveredPoint.value)}
                </text>
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
    </div>
  );
};
