import {
  AndrewsPitchfork,
  DrawingManager,
  FibRetracement,
  HorizontalLine,
  ParallelChannel,
  TrendLine,
  VerticalLine,
  type SerializedDrawing
} from "lightweight-charts-drawing";
import type { IChartApi, ISeriesApi, Time } from "lightweight-charts";
import type { TradeChartDrawing } from "../../types/review";
import {
  isSupportedSerializedDrawingType,
  type NativeDrawingTool,
  toLightweightDrawingTool
} from "./drawingTypes";

interface LightweightDrawingAdapterOptions {
  onDrawingsChange?: (drawings: TradeChartDrawing[]) => void;
  onSelectionChange?: (drawingId: string | null) => void;
  referenceTime?: number;
  referencePrice?: number;
}

interface LightweightDrawingAttachArgs {
  chart: IChartApi;
  series: ISeriesApi<"Candlestick">;
  container: HTMLElement;
}

const DEFAULT_REFERENCE_TIME = Math.floor(Date.now() / 1000);
const DEFAULT_REFERENCE_PRICE = 0;

const LINE_STYLE = { lineColor: "#5da8ff", lineWidth: 2 };
const HORIZONTAL_STYLE = { lineColor: "rgba(232, 203, 76, 0.9)", lineWidth: 2 };
const VERTICAL_STYLE = { lineColor: "rgba(161, 168, 184, 0.8)", lineWidth: 1 };
const FIB_STYLE = { lineColor: "rgba(93, 168, 255, 0.9)", lineWidth: 1, fillColor: "rgba(93, 168, 255, 0.08)" };
const CHANNEL_STYLE = { lineColor: "rgba(93, 168, 255, 0.85)", lineWidth: 1, fillColor: "rgba(93, 168, 255, 0.08)" };
const PITCHFORK_STYLE = { lineColor: "rgba(93, 168, 255, 0.9)", lineWidth: 1 };

const toUnixTimestamp = (time: Time): number | null => {
  if (typeof time === "number" && Number.isFinite(time)) {
    return time;
  }

  if (typeof time === "string") {
    const parsed = Date.parse(time);
    return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null;
  }

  if (time && typeof time === "object" && "year" in time && "month" in time && "day" in time) {
    return Math.floor(Date.UTC(time.year, time.month - 1, time.day) / 1000);
  }

  return null;
};

const toSnapshotHash = (snapshot: SerializedDrawing[]): string => JSON.stringify(snapshot);
const toAdapterTime = (timestamp: number): Time => timestamp as Time;
const createDrawingId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

interface AdapterPoint {
  time: number;
  price: number;
}

interface AdapterPixelPoint {
  x: number;
  y: number;
}

export class LightweightDrawingAdapter {
  private readonly manager = new DrawingManager();
  private readonly unsubscribers: Array<() => void> = [];
  private onDrawingsChange?: (drawings: TradeChartDrawing[]) => void;
  private onSelectionChange?: (drawingId: string | null) => void;
  private referenceTime = DEFAULT_REFERENCE_TIME;
  private referencePrice = DEFAULT_REFERENCE_PRICE;
  private suppressEvents = false;
  private history: SerializedDrawing[][] = [];
  private lastSnapshotHash = "";

  constructor(options: LightweightDrawingAdapterOptions = {}) {
    this.onDrawingsChange = options.onDrawingsChange;
    this.onSelectionChange = options.onSelectionChange;
    this.referenceTime = options.referenceTime ?? DEFAULT_REFERENCE_TIME;
    this.referencePrice = options.referencePrice ?? DEFAULT_REFERENCE_PRICE;
  }

  attach(args: LightweightDrawingAttachArgs): void {
    this.detach();
    this.manager.attach(args.chart, args.series, args.container);
    this.subscribeToManagerEvents();
    this.resetHistory();
  }

  detach(): void {
    while (this.unsubscribers.length > 0) {
      const unsubscribe = this.unsubscribers.pop();
      unsubscribe?.();
    }

    if (this.manager.isAttached()) {
      this.manager.detach();
    }
  }

  destroy(): void {
    this.detach();
    this.resetHistory();
  }

  isAttached(): boolean {
    return this.manager.isAttached();
  }

  setOnDrawingsChange(handler: ((drawings: TradeChartDrawing[]) => void) | undefined): void {
    this.onDrawingsChange = handler;
  }

  setOnSelectionChange(handler: ((drawingId: string | null) => void) | undefined): void {
    this.onSelectionChange = handler;
  }

  setReferencePoint(time: number | undefined, price: number | undefined): void {
    if (typeof time === "number" && Number.isFinite(time)) {
      this.referenceTime = time;
    }

    if (typeof price === "number" && Number.isFinite(price)) {
      this.referencePrice = price;
    }
  }

  setActiveTool(tool: NativeDrawingTool): void {
    this.manager.setActiveTool(toLightweightDrawingTool(tool));
  }

  clearActiveTool(): void {
    this.manager.setActiveTool(null);
  }

  selectAtPoint(point: AdapterPixelPoint): string | null {
    const hit = this.manager.hitTest(point);
    if (!hit) {
      this.manager.deselectAll();
      return null;
    }

    this.manager.selectDrawing(hit.id);
    return hit.id;
  }

  addTrendLine(start: AdapterPoint, end: AdapterPoint): string {
    const id = createDrawingId();
    const drawing = new TrendLine(
      id,
      [
        { time: toAdapterTime(start.time), price: start.price },
        { time: toAdapterTime(end.time), price: end.price }
      ],
      LINE_STYLE,
      {}
    );
    this.manager.addDrawing(drawing);
    this.manager.selectDrawing(id);
    return id;
  }

  addHorizontalLine(price: number): string {
    const id = createDrawingId();
    const drawing = new HorizontalLine(
      id,
      [{ time: toAdapterTime(this.referenceTime), price }],
      HORIZONTAL_STYLE,
      {}
    );
    this.manager.addDrawing(drawing);
    this.manager.selectDrawing(id);
    return id;
  }

  addVerticalLine(time: number): string {
    const id = createDrawingId();
    const drawing = new VerticalLine(
      id,
      [{ time: toAdapterTime(time), price: this.referencePrice }],
      VERTICAL_STYLE,
      {}
    );
    this.manager.addDrawing(drawing);
    this.manager.selectDrawing(id);
    return id;
  }

  addFibRetracement(start: AdapterPoint, end: AdapterPoint): string {
    const id = createDrawingId();
    const drawing = new FibRetracement(
      id,
      [
        { time: toAdapterTime(start.time), price: start.price },
        { time: toAdapterTime(end.time), price: end.price }
      ],
      FIB_STYLE,
      {}
    );
    this.manager.addDrawing(drawing);
    this.manager.selectDrawing(id);
    return id;
  }

  deleteSelectedDrawing(): boolean {
    const selected = this.manager.getSelectedDrawing();
    if (!selected) {
      return false;
    }

    this.manager.removeDrawing(selected.id);
    return true;
  }

  clearAll(): void {
    this.manager.clearAll();
  }

  exportSerialized(): SerializedDrawing[] {
    return this.manager.exportDrawings();
  }

  exportToTradeDrawings(): TradeChartDrawing[] {
    return this.exportSerialized()
      .map((drawing) => this.toTradeDrawing(drawing))
      .filter((drawing): drawing is TradeChartDrawing => drawing !== null);
  }

  importSerialized(snapshot: SerializedDrawing[]): void {
    const nextHash = toSnapshotHash(snapshot);
    if (nextHash === this.lastSnapshotHash) {
      return;
    }

    this.suppressEvents = true;
    this.manager.clearAll();
    this.manager.importDrawings(snapshot, (type, data) => this.createDrawingFromSerialized(type, data));
    this.suppressEvents = false;

    this.lastSnapshotHash = nextHash;
    this.pushHistorySnapshot(snapshot);
  }

  syncFromApp(drawings: TradeChartDrawing[]): void {
    const serialized = drawings
      .map((drawing) => this.toSerializedDrawing(drawing))
      .filter((drawing): drawing is SerializedDrawing => drawing !== null);
    this.importSerialized(serialized);
  }

  undoLast(): boolean {
    if (this.history.length < 2) {
      return false;
    }

    this.history.pop();
    const previousSnapshot = this.history[this.history.length - 1] ?? [];

    this.suppressEvents = true;
    this.manager.clearAll();
    this.manager.importDrawings(previousSnapshot, (type, data) => this.createDrawingFromSerialized(type, data));
    this.suppressEvents = false;

    this.lastSnapshotHash = toSnapshotHash(previousSnapshot);
    this.emitDrawingsChange();
    return true;
  }

  private subscribeToManagerEvents(): void {
    const eventNames = ["drawing:added", "drawing:updated", "drawing:removed", "drawing:cleared"] as const;
    eventNames.forEach((eventName) => {
      this.unsubscribers.push(
        this.manager.on(eventName, () => {
          this.handleManagerMutation();
        })
      );
    });

    this.unsubscribers.push(
      this.manager.on("drawing:selected", (event) => {
        this.onSelectionChange?.(event.drawingId ?? null);
      })
    );
    this.unsubscribers.push(
      this.manager.on("drawing:deselected", () => {
        this.onSelectionChange?.(null);
      })
    );
    this.unsubscribers.push(
      this.manager.on("drawing:cleared", () => {
        this.onSelectionChange?.(null);
      })
    );
  }

  private handleManagerMutation(): void {
    if (this.suppressEvents) {
      return;
    }

    const snapshot = this.exportSerialized();
    const snapshotHash = toSnapshotHash(snapshot);
    if (snapshotHash === this.lastSnapshotHash) {
      return;
    }

    this.lastSnapshotHash = snapshotHash;
    this.pushHistorySnapshot(snapshot);
    this.emitDrawingsChange();
  }

  private emitDrawingsChange(): void {
    if (!this.onDrawingsChange) {
      return;
    }

    this.onDrawingsChange(this.exportToTradeDrawings());
  }

  private resetHistory(): void {
    this.history = [[]];
    this.lastSnapshotHash = toSnapshotHash([]);
  }

  private pushHistorySnapshot(snapshot: SerializedDrawing[]): void {
    const snapshotHash = toSnapshotHash(snapshot);
    const lastHistorySnapshot = this.history[this.history.length - 1] ?? [];
    const lastHistoryHash = toSnapshotHash(lastHistorySnapshot);
    if (snapshotHash === lastHistoryHash) {
      return;
    }

    this.history.push(snapshot);
    if (this.history.length > 200) {
      this.history.shift();
    }
  }

  private createDrawingFromSerialized(type: string, data: SerializedDrawing) {
    if (!isSupportedSerializedDrawingType(type)) {
      return null;
    }

    switch (type) {
      case "trend-line":
        return new TrendLine(data.id, data.anchors, data.style, data.options);
      case "horizontal-line":
        return new HorizontalLine(data.id, data.anchors, data.style, data.options);
      case "vertical-line":
        return new VerticalLine(data.id, data.anchors, data.style, data.options);
      case "fib-retracement":
        return new FibRetracement(data.id, data.anchors, data.style, data.options);
      case "parallel-channel":
        return new ParallelChannel(data.id, data.anchors, data.style, data.options);
      case "andrews-pitchfork":
        return new AndrewsPitchfork(data.id, data.anchors, data.style, data.options);
      default:
        return null;
    }
  }

  private toSerializedDrawing(drawing: TradeChartDrawing): SerializedDrawing | null {
    switch (drawing.type) {
      case "trendline":
        return {
          id: drawing.id,
          type: "trend-line",
          anchors: [
            { time: toAdapterTime(drawing.startTime), price: drawing.startPrice },
            { time: toAdapterTime(drawing.endTime), price: drawing.endPrice }
          ],
          style: LINE_STYLE,
          options: {}
        };
      case "horizontal":
        return {
          id: drawing.id,
          type: "horizontal-line",
          anchors: [{ time: toAdapterTime(this.referenceTime), price: drawing.price }],
          style: HORIZONTAL_STYLE,
          options: {}
        };
      case "vertical":
        return {
          id: drawing.id,
          type: "vertical-line",
          anchors: [{ time: toAdapterTime(drawing.time), price: this.referencePrice }],
          style: VERTICAL_STYLE,
          options: {}
        };
      case "fibonacci":
        return {
          id: drawing.id,
          type: "fib-retracement",
          anchors: [
            { time: toAdapterTime(drawing.startTime), price: drawing.startPrice },
            { time: toAdapterTime(drawing.endTime), price: drawing.endPrice }
          ],
          style: FIB_STYLE,
          options: {}
        };
      case "channel":
        return {
          id: drawing.id,
          type: "parallel-channel",
          anchors: [
            { time: toAdapterTime(drawing.startTime), price: drawing.startPrice },
            { time: toAdapterTime(drawing.endTime), price: drawing.endPrice },
            { time: toAdapterTime(drawing.parallelTime), price: drawing.parallelPrice }
          ],
          style: CHANNEL_STYLE,
          options: {}
        };
      case "pitchfork":
        return {
          id: drawing.id,
          type: "andrews-pitchfork",
          anchors: [
            { time: toAdapterTime(drawing.pivotTime), price: drawing.pivotPrice },
            { time: toAdapterTime(drawing.leftTime), price: drawing.leftPrice },
            { time: toAdapterTime(drawing.rightTime), price: drawing.rightPrice }
          ],
          style: PITCHFORK_STYLE,
          options: {}
        };
      default:
        return null;
    }
  }

  private toTradeDrawing(drawing: SerializedDrawing): TradeChartDrawing | null {
    if (!isSupportedSerializedDrawingType(drawing.type)) {
      return null;
    }

    switch (drawing.type) {
      case "trend-line": {
        const start = drawing.anchors[0];
        const end = drawing.anchors[1];
        const startTime = start ? toUnixTimestamp(start.time) : null;
        const endTime = end ? toUnixTimestamp(end.time) : null;
        if (!start || !end || startTime === null || endTime === null) {
          return null;
        }

        return {
          id: drawing.id,
          type: "trendline",
          startTime,
          startPrice: start.price,
          endTime,
          endPrice: end.price
        };
      }
      case "horizontal-line": {
        const anchor = drawing.anchors[0];
        if (!anchor) {
          return null;
        }

        return {
          id: drawing.id,
          type: "horizontal",
          price: anchor.price
        };
      }
      case "vertical-line": {
        const anchor = drawing.anchors[0];
        const time = anchor ? toUnixTimestamp(anchor.time) : null;
        if (!anchor || time === null) {
          return null;
        }

        return {
          id: drawing.id,
          type: "vertical",
          time
        };
      }
      case "fib-retracement": {
        const start = drawing.anchors[0];
        const end = drawing.anchors[1];
        const startTime = start ? toUnixTimestamp(start.time) : null;
        const endTime = end ? toUnixTimestamp(end.time) : null;
        if (!start || !end || startTime === null || endTime === null) {
          return null;
        }

        return {
          id: drawing.id,
          type: "fibonacci",
          startTime,
          startPrice: start.price,
          endTime,
          endPrice: end.price
        };
      }
      case "parallel-channel": {
        const start = drawing.anchors[0];
        const end = drawing.anchors[1];
        const parallel = drawing.anchors[2];
        const startTime = start ? toUnixTimestamp(start.time) : null;
        const endTime = end ? toUnixTimestamp(end.time) : null;
        const parallelTime = parallel ? toUnixTimestamp(parallel.time) : null;
        if (!start || !end || !parallel || startTime === null || endTime === null || parallelTime === null) {
          return null;
        }

        return {
          id: drawing.id,
          type: "channel",
          startTime,
          startPrice: start.price,
          endTime,
          endPrice: end.price,
          parallelTime,
          parallelPrice: parallel.price
        };
      }
      case "andrews-pitchfork": {
        const pivot = drawing.anchors[0];
        const left = drawing.anchors[1];
        const right = drawing.anchors[2];
        const pivotTime = pivot ? toUnixTimestamp(pivot.time) : null;
        const leftTime = left ? toUnixTimestamp(left.time) : null;
        const rightTime = right ? toUnixTimestamp(right.time) : null;
        if (!pivot || !left || !right || pivotTime === null || leftTime === null || rightTime === null) {
          return null;
        }

        return {
          id: drawing.id,
          type: "pitchfork",
          pivotTime,
          pivotPrice: pivot.price,
          leftTime,
          leftPrice: left.price,
          rightTime,
          rightPrice: right.price
        };
      }
      default:
        return null;
    }
  }
}
