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
  if (points.length === 0) {
    return <div className="empty-state">Adjust the report filters to populate this chart.</div>;
  }

  const width = 1240;
  const height = 292;
  const paddingTop = 18;
  const paddingRight = 24;
  const paddingBottom = 68;
  const paddingLeft = 60;
  const innerWidth = width - paddingLeft - paddingRight;
  const innerHeight = height - paddingTop - paddingBottom;

  const values = points.map((point) => point.value);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const range = maxValue - minValue || 1;
  const baselineValue = minValue > 0 ? minValue : maxValue < 0 ? maxValue : 0;
  const baselineY = paddingTop + innerHeight - ((baselineValue - minValue) / range) * innerHeight;

  const chartPoints = points.map((point, index) => {
    const x = paddingLeft + (points.length === 1 ? innerWidth / 2 : (index / (points.length - 1)) * innerWidth);
    const y = paddingTop + innerHeight - ((point.value - minValue) / range) * innerHeight;
    return { ...point, x, y };
  });

  const linePath = chartPoints
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(" ");

  const areaPath = `${linePath} L ${chartPoints[chartPoints.length - 1]?.x.toFixed(2)} ${baselineY.toFixed(
    2
  )} L ${chartPoints[0]?.x.toFixed(2)} ${baselineY.toFixed(2)} Z`;
  const tickStep = Math.max(1, Math.ceil(points.length / 5));
  const tickPoints = chartPoints.filter(
    (point, index) => index === 0 || index === chartPoints.length - 1 || index % tickStep === 0
  );

  return (
    <div className="report-line-chart-card">
      <div className="panel-header">
        <span className="panel-header-line" style={{ background: color }} />
        <h2>{title}</h2>
      </div>
      <div className="report-line-chart-shell">
        <span className="report-line-chart-axis-label">{yAxisLabel}</span>
        <svg viewBox={`0 0 ${width} ${height}`} className="report-line-chart-svg" preserveAspectRatio="none">
          <line
            x1={paddingLeft}
            x2={width - paddingRight}
            y1={baselineY}
            y2={baselineY}
            className="report-line-chart-baseline"
          />
          <path d={areaPath} fill={color} fillOpacity="0.08" />
          <path d={linePath} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
          {chartPoints.map((point) => (
            <g key={point.label}>
              <circle cx={point.x} cy={point.y} r="3.5" fill={color} />
              <text x={point.x} y={point.y - 10} textAnchor="middle" className="report-line-chart-value">
                {valueFormatter(point.value)}
              </text>
            </g>
          ))}
          {tickPoints.map((point) => (
            <text
              key={`${point.label}-x`}
              x={point.x}
              y={height - 16}
              textAnchor={point.x > width - 90 ? "end" : point.x < 90 ? "start" : "middle"}
              className="report-line-chart-tick"
            >
              {formatAxisDate(point.label)}
            </text>
          ))}
        </svg>
      </div>
    </div>
  );
};
