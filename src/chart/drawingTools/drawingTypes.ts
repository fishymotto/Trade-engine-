import type { TradeChartDrawing } from "../../types/review";

export type NativeDrawingTool = "cursor" | "trendline" | "horizontal" | "vertical" | "fibonacci" | "pitchfork" | "channel";

export type LightweightDrawingTool =
  | "trend-line"
  | "horizontal-line"
  | "vertical-line"
  | "fib-retracement"
  | "andrews-pitchfork"
  | "parallel-channel";

export type DrawingEngine = "native" | "lightweight-adapter";
export type AdapterManagedNativeTool = "trendline" | "horizontal" | "vertical" | "fibonacci";
export type AdapterManagedTradeDrawingType = Extract<TradeChartDrawing["type"], "trendline" | "horizontal" | "vertical" | "fibonacci">;

const lightweightToolMap: Record<NativeDrawingTool, LightweightDrawingTool | null> = {
  cursor: null,
  trendline: "trend-line",
  horizontal: "horizontal-line",
  vertical: "vertical-line",
  fibonacci: "fib-retracement",
  pitchfork: "andrews-pitchfork",
  channel: "parallel-channel"
};

export const toLightweightDrawingTool = (tool: NativeDrawingTool): LightweightDrawingTool | null =>
  lightweightToolMap[tool] ?? null;

const supportedSerializedTypes = new Set<LightweightDrawingTool>([
  "trend-line",
  "horizontal-line",
  "vertical-line",
  "fib-retracement",
  "andrews-pitchfork",
  "parallel-channel"
]);

export const isSupportedSerializedDrawingType = (type: string): type is LightweightDrawingTool =>
  supportedSerializedTypes.has(type as LightweightDrawingTool);

export const resolveDrawingEngine = (showDrawingTools: boolean): DrawingEngine =>
  showDrawingTools && isLightweightDrawingAdapterEnabled() ? "lightweight-adapter" : "native";

export const isLightweightDrawingAdapterEnabled = (): boolean => {
  const flag = import.meta.env.VITE_EXPERIMENTAL_LIGHTWEIGHT_DRAWING_ADAPTER?.trim().toLowerCase();
  return flag === "1" || flag === "true" || flag === "yes" || flag === "on";
};

export const normalizeTradeDrawings = (drawings: TradeChartDrawing[] | undefined): TradeChartDrawing[] =>
  Array.isArray(drawings) ? drawings : [];

const adapterManagedNativeTools = new Set<AdapterManagedNativeTool>(["trendline", "horizontal", "vertical", "fibonacci"]);
const adapterManagedTradeDrawingTypes = new Set<AdapterManagedTradeDrawingType>([
  "trendline",
  "horizontal",
  "vertical",
  "fibonacci"
]);

export const isAdapterManagedNativeTool = (tool: NativeDrawingTool): tool is AdapterManagedNativeTool =>
  adapterManagedNativeTools.has(tool as AdapterManagedNativeTool);

export const isAdapterManagedTradeDrawingType = (
  drawingType: TradeChartDrawing["type"]
): drawingType is AdapterManagedTradeDrawingType => adapterManagedTradeDrawingTypes.has(drawingType as AdapterManagedTradeDrawingType);
