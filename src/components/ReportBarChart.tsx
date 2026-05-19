import { useId, useMemo, useState } from "react";
import type { PointerEvent } from "react";
import type { TimeSeriesPoint } from "../lib/analytics/tradeAnalytics";

interface ReportBarChartProps {
  points: TimeSeriesPoint[];
  comparePoints?: TimeSeriesPoint[];
  title: string;
  yAxisLabel: string;
  color?: string;
  compareColor?: string;
  negativeColor?: string;
  positiveColor?: string;
  valueFormatter?: (value: number) => string;
  labelFormatter?: (label: string) => string;
  layout?: "vertical" | "horizontal";
  primarySeriesLabel?: string;
  compareSeriesLabel?: string;
  compareMode?: "index" | "label";
  horizontalLabelWidth?: number;
  horizontalLabelMaxLength?: number;
  horizontalRowHeight?: number;
  showAllCategoryLabels?: boolean;
  showValueLabels?: boolean;
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

const formatShortLabel = (value: string, maxLength = 18): string => {
  const formatted = formatChartLabel(value);
  return formatted.length > maxLength ? `${formatted.slice(0, Math.max(1, maxLength - 1))}...` : formatted;
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

export const ReportBarChart = ({
  points,
  comparePoints = [],
  title,
  yAxisLabel,
  color = "#c694ff",
  compareColor = "#7f91b8",
  negativeColor = "#b42eff",
  positiveColor = "#2ee6d6",
  valueFormatter = (value) => value.toFixed(2),
  labelFormatter = formatChartLabel,
  layout = "horizontal",
  primarySeriesLabel = "Current",
  compareSeriesLabel = "Previous",
  compareMode = "index",
  horizontalLabelWidth = 190,
  horizontalLabelMaxLength = 18,
  horizontalRowHeight = 22,
  showAllCategoryLabels = false,
  showValueLabels = false
}: ReportBarChartProps) => {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const chartId = useId().replace(/:/g, "");

  const chart = useMemo(() => {
    const width = 1240;
    const baseHeight = 420;
    const paddingTop = 34;
    const paddingRight = 80;
    const paddingBottom = layout === "horizontal" ? 72 : 82;
    const paddingLeft = layout === "horizontal" ? horizontalLabelWidth : 84;
    const minInnerHeight = baseHeight - paddingTop - paddingBottom;
    const innerWidth = width - paddingLeft - paddingRight;
    const innerHeight =
      layout === "horizontal" ? Math.max(minInnerHeight, points.length * horizontalRowHeight) : minInnerHeight;
    const height = paddingTop + paddingBottom + innerHeight;
    const pointLabels = new Set(points.map((point) => point.label));
    const values = [
      ...points.map((point) => point.value),
      ...comparePoints
        .filter((point) => compareMode === "index" || pointLabels.has(point.label))
        .map((point) => point.value)
    ];
    const minValue = values.length > 0 ? Math.min(...values, 0) : 0;
    const maxValue = values.length > 0 ? Math.max(...values, 0) : 0;
    const rawRange = maxValue - minValue || Math.max(1, Math.abs(maxValue), Math.abs(minValue));
    const chartMin = minValue < 0 ? minValue - rawRange * 0.12 : 0;
    const chartMax = maxValue > 0 ? maxValue + rawRange * 0.12 : 0;
    const chartRange = chartMax - chartMin || 1;
    const comparePointsByLabel =
      compareMode === "label" ? new Map(comparePoints.map((point) => [point.label, point])) : null;
    const getComparePoint = (index: number) => {
      if (comparePoints.length === 0) {
        return null;
      }

      if (comparePointsByLabel) {
        return comparePointsByLabel.get(points[index]?.label ?? "") ?? null;
      }

      const mappedIndex =
        points.length <= 1 || comparePoints.length <= 1
          ? Math.min(index, comparePoints.length - 1)
          : Math.round((index / (points.length - 1)) * (comparePoints.length - 1));
      return comparePoints[mappedIndex] ?? null;
    };

    if (layout === "vertical") {
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
          barBreadth: barWidth,
          barLength: heightValue,
          isNegative: point.value < 0,
          rectX: x,
          rectY: top
        };
      });
      const compareBars = points.map((_, index) => {
        const comparePoint = getComparePoint(index);
        if (!comparePoint) {
          return null;
        }
        const compareWidth = Math.max(8, Math.min(36, barWidth * 0.58));
        const x = paddingLeft + index * slotWidth + (slotWidth - compareWidth) / 2;
        const y = yScale(comparePoint.value);
        const top = Math.min(y, baselineY);
        const heightValue = Math.max(2, Math.abs(y - baselineY));

        return {
          ...comparePoint,
          barBreadth: compareWidth,
          barLength: heightValue,
          isNegative: comparePoint.value < 0,
          rectX: x,
          rectY: top
        };
      });
      const valueTicks = Array.from({ length: 5 }, (_, index) => {
        const value = chartMin + (chartRange / 4) * index;
        return {
          value,
          x: 0,
          y: yScale(value)
        };
      });
      const categoryTickCount = Math.min(showAllCategoryLabels ? points.length : 8, points.length);
      const categoryTickIndexes =
        categoryTickCount <= 1
          ? [0]
          : Array.from(
              new Set(
                Array.from({ length: categoryTickCount }, (_, index) =>
                  Math.round((index / (categoryTickCount - 1)) * (points.length - 1))
                )
              )
            );

      return {
        layout,
        baselineX: 0,
        baselineY,
        categoryTickIndexes,
        categoryTickPositions: categoryTickIndexes.map((index) => {
          const point = chartBars[index];
          return point
            ? {
                index,
                label: point.label,
                x: point.rectX + point.barBreadth / 2,
                y: 0
              }
            : null;
        }).filter((tick): tick is NonNullable<typeof tick> => tick !== null),
        chartBars,
        compareBars,
        height,
        innerHeight,
        innerWidth,
        paddingBottom,
        paddingLeft,
        paddingRight,
        paddingTop,
        slotSize: slotWidth,
        valueTicks,
        width
      };
    }

    const xScale = (value: number) => paddingLeft + ((value - chartMin) / chartRange) * innerWidth;
    const baselineX = xScale(0);
    const slotHeight = innerHeight / Math.max(points.length, 1);
    const barHeight = Math.max(8, Math.min(44, Math.min(slotHeight - 2, slotHeight * 0.58)));
    const chartBars = points.map((point, index) => {
      const y = paddingTop + index * slotHeight + (slotHeight - barHeight) / 2;
      const xValue = xScale(point.value);
      const rectX = Math.min(xValue, baselineX);
      const barLength = Math.max(2, Math.abs(xValue - baselineX));

      return {
        ...point,
        barBreadth: barHeight,
        barLength,
        isNegative: point.value < 0,
        rectX,
        rectY: y
      };
    });
    const compareBars = points.map((_, index) => {
      const comparePoint = getComparePoint(index);
      if (!comparePoint) {
        return null;
      }
      const compareBarHeight = Math.max(5, Math.min(22, barHeight * 0.58));
      const y = paddingTop + index * slotHeight + (slotHeight - compareBarHeight) / 2;
      const xValue = xScale(comparePoint.value);
      const rectX = Math.min(xValue, baselineX);
      const barLength = Math.max(2, Math.abs(xValue - baselineX));

      return {
        ...comparePoint,
        barBreadth: compareBarHeight,
        barLength,
        isNegative: comparePoint.value < 0,
        rectX,
        rectY: y
      };
    });

    const valueTicks = Array.from({ length: 5 }, (_, index) => {
      const value = chartMin + (chartRange / 4) * index;
      return {
        value,
        x: xScale(value),
        y: 0
      };
    });

    const categoryTickCount = Math.min(showAllCategoryLabels ? points.length : 10, points.length);
    const categoryTickIndexes =
      categoryTickCount <= 1
        ? [0]
        : Array.from(
            new Set(
              Array.from({ length: categoryTickCount }, (_, index) =>
                Math.round((index / (categoryTickCount - 1)) * (points.length - 1))
              )
            )
          );

    return {
      layout,
      baselineX,
      baselineY: 0,
      categoryTickIndexes,
      categoryTickPositions: categoryTickIndexes.map((index) => {
        const point = chartBars[index];
        return point
          ? {
              index,
              label: point.label,
              x: 0,
              y: point.rectY + point.barBreadth / 2
            }
          : null;
      }).filter((tick): tick is NonNullable<typeof tick> => tick !== null),
      chartBars,
      compareBars,
      height,
      innerHeight,
      innerWidth,
      paddingBottom,
      paddingLeft,
      paddingRight,
      paddingTop,
      slotSize: slotHeight,
      valueTicks,
      width
    };
  }, [compareMode, comparePoints, horizontalLabelWidth, horizontalRowHeight, layout, points, showAllCategoryLabels]);

  if (points.length === 0) {
    return <div className="empty-state">Adjust the report filters to populate this chart.</div>;
  }

  const hoveredPoint = hoveredIndex === null ? null : chart.chartBars[hoveredIndex] ?? null;
  const hoveredComparePoint =
    hoveredIndex === null ? null : chart.compareBars[hoveredIndex] ?? null;
  const tooltipAnchorX = hoveredPoint
    ? chart.layout === "horizontal"
      ? hoveredPoint.value >= 0
        ? hoveredPoint.rectX + hoveredPoint.barLength
        : hoveredPoint.rectX
      : hoveredPoint.rectX + hoveredPoint.barBreadth / 2
    : 0;
  const tooltipAnchorY = hoveredPoint
    ? chart.layout === "horizontal"
      ? hoveredPoint.rectY + hoveredPoint.barBreadth / 2
      : hoveredPoint.rectY
    : 0;
  const tooltipX =
    tooltipAnchorX > chart.width - chart.paddingRight - 220 ? tooltipAnchorX - 204 : tooltipAnchorX + 16;
  const tooltipY =
    tooltipAnchorY > chart.height - chart.paddingBottom - 74 ? tooltipAnchorY - 82 : tooltipAnchorY + 16;
  const hoveredValueLabel: { x: number; y: number; anchor: "start" | "end" | "middle" } | null =
    hoveredPoint && chart.layout === "horizontal"
      ? {
          x: Math.max(
            chart.paddingLeft + 8,
            Math.min(
              chart.width - chart.paddingRight - 8,
              hoveredPoint.value >= 0 ? hoveredPoint.rectX + hoveredPoint.barLength + 10 : hoveredPoint.rectX - 10
            )
          ),
          y: hoveredPoint.rectY + hoveredPoint.barBreadth / 2 + 4,
          anchor:
              hoveredPoint.value >= 0
              ? hoveredPoint.rectX + hoveredPoint.barLength > chart.width - chart.paddingRight - 34
                ? "end"
                : "start"
              : hoveredPoint.rectX < chart.paddingLeft + 40
                ? "start"
                : "end"
        }
      : hoveredPoint
        ? {
            x: hoveredPoint.rectX + hoveredPoint.barBreadth / 2,
            y:
              hoveredPoint.value >= 0
                ? Math.max(chart.paddingTop + 14, hoveredPoint.rectY - 10)
                : Math.min(chart.height - chart.paddingBottom - 8, hoveredPoint.rectY + hoveredPoint.barLength + 16),
            anchor: "middle"
          }
        : null;
  const getValueLabelPosition = (point: { value: number; rectX: number; rectY: number; barLength: number; barBreadth: number }) => {
    if (chart.layout !== "horizontal") {
      return null;
    }

    const minX = chart.paddingLeft + 8;
    const maxX = chart.width - chart.paddingRight - 8;
    const targetX = point.value >= 0 ? point.rectX + point.barLength + 10 : point.rectX - 10;

    return {
      x: Math.max(minX, Math.min(maxX, targetX)),
      y: point.rectY + point.barBreadth / 2 + 4,
      anchor:
        point.value >= 0
          ? targetX > maxX
            ? "end"
            : "start"
          : targetX < minX
            ? "start"
            : "end"
    } as const;
  };

  const handlePointerMove = (event: PointerEvent<SVGRectElement>) => {
    const bounds = event.currentTarget.ownerSVGElement?.getBoundingClientRect();
    if (!bounds) {
      return;
    }

    const svgX = ((event.clientX - bounds.left) / bounds.width) * chart.width;
    const svgY = ((event.clientY - bounds.top) / bounds.height) * chart.height;
    const boundedX = Math.max(chart.paddingLeft, Math.min(chart.width - chart.paddingRight, svgX));
    const boundedY = Math.max(chart.paddingTop, Math.min(chart.height - chart.paddingBottom, svgY));
    const nextIndex =
      chart.layout === "horizontal"
        ? Math.max(0, Math.min(points.length - 1, Math.floor((boundedY - chart.paddingTop) / Math.max(chart.slotSize, 1))))
        : Math.max(0, Math.min(points.length - 1, Math.floor((boundedX - chart.paddingLeft) / Math.max(chart.slotSize, 1))));
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
            ? `${labelFormatter(hoveredPoint.label)} - ${primarySeriesLabel}: ${valueFormatter(hoveredPoint.value)}${
                hoveredComparePoint ? ` | ${compareSeriesLabel}: ${valueFormatter(hoveredComparePoint.value)}` : ""
              }`
            : "Hover chart for bar details"}
        </span>
      </div>
      <div className={`report-bar-chart-shell ${layout === "horizontal" ? "horizontal" : ""}`}>
        <span className="report-line-chart-axis-label">{yAxisLabel}</span>
        <svg
          viewBox={`0 0 ${chart.width} ${chart.height}`}
          className="report-bar-chart-svg"
          preserveAspectRatio="none"
          style={{ height: chart.height }}
        >
          <defs>
            <linearGradient id={`${chartId}-positive-gradient`} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={positiveColor} stopOpacity="0.74" />
              <stop offset="100%" stopColor={positiveColor} stopOpacity="1" />
            </linearGradient>
            <linearGradient id={`${chartId}-negative-gradient`} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={negativeColor} stopOpacity="0.78" />
              <stop offset="100%" stopColor={negativeColor} stopOpacity="1" />
            </linearGradient>
            <linearGradient id={`${chartId}-neutral-gradient`} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={color} stopOpacity="0.72" />
              <stop offset="100%" stopColor={color} stopOpacity="0.96" />
            </linearGradient>
            <linearGradient id={`${chartId}-compare-gradient`} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={compareColor} stopOpacity="0.28" />
              <stop offset="100%" stopColor={compareColor} stopOpacity="0.6" />
            </linearGradient>
            <filter id={`${chartId}-bar-glow`} x="-20%" y="-40%" width="150%" height="200%">
              <feGaussianBlur stdDeviation="2.1" result="barBlur" />
              <feMerge>
                <feMergeNode in="barBlur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <rect
            x={chart.paddingLeft}
            y={chart.paddingTop}
            width={chart.innerWidth}
            height={chart.innerHeight}
            rx="18"
            className="report-line-chart-plot-bg"
          />
          {chart.layout === "horizontal"
            ? chart.valueTicks.map((tick) => (
                <g key={`bar-x-${tick.value}`}>
                  <line
                    x1={tick.x}
                    x2={tick.x}
                    y1={chart.paddingTop}
                    y2={chart.height - chart.paddingBottom}
                    className="report-line-chart-grid report-line-chart-grid-vertical"
                  />
                  <text
                    x={tick.x}
                    y={chart.height - chart.paddingBottom + 30}
                    textAnchor="middle"
                    className="report-line-chart-tick"
                  >
                    {formatAxisValue(tick.value)}
                  </text>
                </g>
              ))
            : chart.valueTicks.map((tick) => (
                <g key={`bar-y-${tick.value}`}>
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

          {chart.layout === "horizontal"
            ? chart.categoryTickPositions.map((tick) => (
                <g key={`${tick.label}-bar-grid`}>
                  <line
                    x1={chart.paddingLeft}
                    x2={chart.width - chart.paddingRight}
                    y1={tick.y}
                    y2={tick.y}
                    className="report-line-chart-grid"
                  />
                  <text x={chart.paddingLeft - 12} y={tick.y + 4} textAnchor="end" className="report-line-chart-tick">
                    {formatShortLabel(tick.label, horizontalLabelMaxLength)}
                  </text>
                </g>
              ))
            : chart.categoryTickPositions.map((tick) => (
                <g key={`${tick.label}-bar-grid`}>
                  <line
                    x1={tick.x}
                    x2={tick.x}
                    y1={chart.paddingTop}
                    y2={chart.height - chart.paddingBottom}
                    className="report-line-chart-grid report-line-chart-grid-vertical"
                  />
                  <text x={tick.x} y={chart.height - 30} textAnchor="middle" className="report-line-chart-tick">
                    {formatShortLabel(tick.label, horizontalLabelMaxLength)}
                  </text>
                </g>
              ))}

          {chart.layout === "horizontal" ? (
            <line
              x1={chart.baselineX}
              x2={chart.baselineX}
              y1={chart.paddingTop}
              y2={chart.height - chart.paddingBottom}
              className="report-line-chart-baseline"
            />
          ) : (
            <line
              x1={chart.paddingLeft}
              x2={chart.width - chart.paddingRight}
              y1={chart.baselineY}
              y2={chart.baselineY}
              className="report-line-chart-baseline"
            />
          )}
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
          {chart.compareBars.map((point, index) =>
            point ? (
              <rect
                key={`compare-${point.label}-${index}`}
                x={point.rectX}
                y={point.rectY}
                width={chart.layout === "horizontal" ? point.barLength : point.barBreadth}
                height={chart.layout === "horizontal" ? point.barBreadth : point.barLength}
                rx="6"
                fill={`url(#${chartId}-compare-gradient)`}
                className={`report-bar-chart-bar report-bar-chart-bar-compare ${
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
              width={chart.layout === "horizontal" ? point.barLength : point.barBreadth}
              height={chart.layout === "horizontal" ? point.barBreadth : point.barLength}
              rx="7"
              fill={
                point.value < 0
                  ? `url(#${chartId}-negative-gradient)`
                  : point.value > 0
                    ? `url(#${chartId}-positive-gradient)`
                    : `url(#${chartId}-neutral-gradient)`
              }
              className={`report-bar-chart-bar ${
                hoveredIndex === index ? "is-hovered" : hoveredIndex !== null ? "is-muted" : ""
              }`}
              filter={hoveredIndex === index ? `url(#${chartId}-bar-glow)` : undefined}
            />
          ))}
          {showValueLabels
            ? chart.chartBars.map((point, index) => {
                const position = getValueLabelPosition(point);
                return position ? (
                  <text
                    key={`${point.label}-${index}-value`}
                    x={position.x}
                    y={position.y}
                    textAnchor={position.anchor}
                    className={`report-bar-chart-value-label ${
                      point.value < 0 ? "report-bar-chart-value-label-negative" : "report-bar-chart-value-label-positive"
                    }`}
                  >
                    {valueFormatter(point.value)}
                  </text>
                ) : null;
              })
            : null}
          {hoveredPoint && hoveredValueLabel ? (
            <text
              x={hoveredValueLabel.x}
              y={hoveredValueLabel.y}
              textAnchor={hoveredValueLabel.anchor}
              className="report-bar-chart-hover-value"
            >
              {valueFormatter(hoveredPoint.value)}
            </text>
          ) : null}
          {hoveredPoint ? (
            <g className="report-line-chart-cursor">
              {chart.layout === "horizontal" ? (
                <line
                  x1={chart.paddingLeft}
                  x2={chart.width - chart.paddingRight}
                  y1={hoveredPoint.rectY + hoveredPoint.barBreadth / 2}
                  y2={hoveredPoint.rectY + hoveredPoint.barBreadth / 2}
                  className="report-line-chart-crosshair"
                />
              ) : (
                <line
                  x1={hoveredPoint.rectX + hoveredPoint.barBreadth / 2}
                  x2={hoveredPoint.rectX + hoveredPoint.barBreadth / 2}
                  y1={chart.paddingTop}
                  y2={chart.height - chart.paddingBottom}
                  className="report-line-chart-crosshair"
                />
              )}
              <g transform={`translate(${tooltipX}, ${tooltipY})`}>
                <rect
                  width="202"
                  height={hoveredComparePoint ? "78" : "58"}
                  rx="12"
                  className="report-line-chart-tooltip-box"
                />
                <text x="14" y="22" className="report-line-chart-tooltip-label">
                  {labelFormatter(hoveredPoint.label)}
                </text>
                <text x="14" y="43" className="report-line-chart-tooltip-value">
                  {primarySeriesLabel}: {valueFormatter(hoveredPoint.value)}
                </text>
                {hoveredComparePoint ? (
                  <text x="14" y="62" className="report-line-chart-tooltip-label">
                    {compareSeriesLabel}: {valueFormatter(hoveredComparePoint.value)}
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
    </div>
  );
};
