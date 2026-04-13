import { useMemo, useState } from "react";
import type { PointerEvent } from "react";
import type { TimeSeriesPoint } from "../lib/analytics/tradeAnalytics";

interface ReportLineChartProps {
  points: TimeSeriesPoint[];
  color: string;
  title: string;
  yAxisLabel: string;
  valueFormatter?: (value: number) => string;
}

const formatAxisDate = (value: string): string => {
  const [year, month, day] = value.split("-");
  return new Date(Number(year), Number(month) - 1, Number(day)).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric"
  });
};

export const ReportLineChart = ({
  points,
  color,
  title,
  yAxisLabel,
  valueFormatter = (value) => value.toFixed(2)
}: ReportLineChartProps) => {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const chart = useMemo(() => {
    const width = 1240;
    const height = 540;
    const paddingTop = 34;
    const paddingRight = 80;
    const paddingBottom = 70;
    const paddingLeft = 84;
    const innerWidth = width - paddingLeft - paddingRight;
    const innerHeight = height - paddingTop - paddingBottom;
    const values = points.map((point) => point.value);
    const minValue = values.length > 0 ? Math.min(...values) : 0;
    const maxValue = values.length > 0 ? Math.max(...values) : 0;
    const rawRange = maxValue - minValue || Math.max(1, Math.abs(maxValue) * 0.1);
    const chartMin = minValue - rawRange * 0.12;
    const chartMax = maxValue + rawRange * 0.12;
    const chartRange = chartMax - chartMin || 1;
    const baselineValue = chartMin > 0 ? chartMin : chartMax < 0 ? chartMax : 0;
    const yScale = (value: number) => paddingTop + innerHeight - ((value - chartMin) / chartRange) * innerHeight;
    const xScale = (index: number) =>
      paddingLeft + (points.length <= 1 ? innerWidth / 2 : (index / (points.length - 1)) * innerWidth);
    const chartPoints = points.map((point, index) => ({
      ...point,
      x: xScale(index),
      y: yScale(point.value)
    }));
    const linePath = chartPoints
      .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
      .join(" ");
    const baselineY = yScale(baselineValue);
    const areaPath =
      chartPoints.length > 0
        ? `${linePath} L ${chartPoints[chartPoints.length - 1].x.toFixed(2)} ${baselineY.toFixed(
            2
          )} L ${chartPoints[0].x.toFixed(2)} ${baselineY.toFixed(2)} Z`
        : "";
    const yTicks = Array.from({ length: 6 }, (_, index) => {
      const value = chartMin + (chartRange / 5) * index;
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
      areaPath,
      baselineY,
      chartPoints,
      height,
      innerHeight,
      innerWidth,
      linePath,
      paddingBottom,
      paddingLeft,
      paddingRight,
      paddingTop,
      width,
      xTickIndexes,
      yTicks
    };
  }, [points]);

  if (points.length === 0) {
    return <div className="empty-state">Adjust the report filters to populate this chart.</div>;
  }

  const hoveredPoint = hoveredIndex === null ? null : chart.chartPoints[hoveredIndex] ?? null;
  const tooltipX =
    hoveredPoint && hoveredPoint.x > chart.width - chart.paddingRight - 210 ? hoveredPoint.x - 204 : (hoveredPoint?.x ?? 0) + 14;
  const tooltipY =
    hoveredPoint && hoveredPoint.y > chart.height - chart.paddingBottom - 70 ? hoveredPoint.y - 78 : (hoveredPoint?.y ?? 0) + 14;

  const handlePointerMove = (event: PointerEvent<SVGRectElement>) => {
    const bounds = event.currentTarget.ownerSVGElement?.getBoundingClientRect();
    if (!bounds) {
      return;
    }
    const svgX = ((event.clientX - bounds.left) / bounds.width) * chart.width;
    const boundedX = Math.max(chart.paddingLeft, Math.min(chart.width - chart.paddingRight, svgX));
    const ratio = (boundedX - chart.paddingLeft) / chart.innerWidth;
    const nextIndex = points.length <= 1 ? 0 : Math.round(ratio * (points.length - 1));
    setHoveredIndex(nextIndex);
  };

  return (
    <div className="report-line-chart-card">
      <div className="panel-header">
        <div className="panel-title-inline">
          <span className="panel-header-line" style={{ background: color }} />
          <h2>{title}</h2>
        </div>
        <span className="report-line-chart-readout">
          {hoveredPoint
            ? `${formatAxisDate(hoveredPoint.label)} - ${valueFormatter(hoveredPoint.value)}`
            : "Hover chart for point details"}
        </span>
      </div>
      <div className="report-line-chart-shell">
        <span className="report-line-chart-axis-label">{yAxisLabel}</span>
        <svg viewBox={`0 0 ${chart.width} ${chart.height}`} className="report-line-chart-svg" preserveAspectRatio="none">
          {chart.yTicks.map((tick) => (
            <g key={`y-${tick.value}`}>
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
            const point = chart.chartPoints[index];
            return point ? (
              <g key={`${point.label}-grid`}>
                <line
                  x1={point.x}
                  x2={point.x}
                  y1={chart.paddingTop}
                  y2={chart.height - chart.paddingBottom}
                  className="report-line-chart-grid report-line-chart-grid-vertical"
                />
                <text
                  x={point.x}
                  y={chart.height - 26}
                  textAnchor={point.x > chart.width - 120 ? "end" : point.x < 120 ? "start" : "middle"}
                  className="report-line-chart-tick"
                >
                  {formatAxisDate(point.label)}
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
          <path d={chart.areaPath} fill={color} fillOpacity="0.09" />
          <path d={chart.linePath} fill="none" stroke={color} strokeWidth="2.75" strokeLinejoin="round" strokeLinecap="round" />
          {chart.chartPoints.map((point) => (
            <circle key={point.label} cx={point.x} cy={point.y} r="4" fill={color} className="report-line-chart-point" />
          ))}
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
                y1={hoveredPoint.y}
                y2={hoveredPoint.y}
                className="report-line-chart-crosshair"
              />
              <circle cx={hoveredPoint.x} cy={hoveredPoint.y} r="7" fill={color} stroke="#f8fbff" strokeWidth="2" />
              <g transform={`translate(${tooltipX}, ${tooltipY})`}>
                <rect width="190" height="56" rx="12" className="report-line-chart-tooltip-box" />
                <text x="14" y="22" className="report-line-chart-tooltip-label">
                  {formatAxisDate(hoveredPoint.label)}
                </text>
                <text x="14" y="42" className="report-line-chart-tooltip-value">
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
