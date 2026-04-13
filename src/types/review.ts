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
    }
  | {
      id: string;
      type: "fibonacci";
      startTime: number;
      startPrice: number;
      endTime: number;
      endPrice: number;
    }
  | {
      id: string;
      type: "pitchfork";
      pivotTime: number;
      pivotPrice: number;
      leftTime: number;
      leftPrice: number;
      rightTime: number;
      rightPrice: number;
    }
  | {
      id: string;
      type: "channel";
      startTime: number;
      startPrice: number;
      endTime: number;
      endPrice: number;
      parallelTime: number;
      parallelPrice: number;
    };

export interface TradeReviewRecord {
  tradeId: string;
  notes: string;
  chartContext: string;
  screenshotUrl: string;
  drawings?: TradeChartDrawing[];
  updatedAt: string;
}
