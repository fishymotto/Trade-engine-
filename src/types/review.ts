export type TradeChartDrawing =
  | {
      id: string;
      type: "trendline";
      startTime: number;
      startPrice: number;
      endTime: number;
      endPrice: number;
    }
  | {
      id: string;
      type: "horizontal";
      price: number;
    }
  | {
      id: string;
      type: "vertical";
      time: number;
    };

export interface TradeReviewRecord {
  tradeId: string;
  notes: string;
  chartContext: string;
  screenshotUrl: string;
  drawings?: TradeChartDrawing[];
  updatedAt: string;
}
