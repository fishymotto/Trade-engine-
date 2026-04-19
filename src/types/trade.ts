export type TradeDirection = "Long" | "Short";
export type TradeStatus = "Win" | "Loss";
export type GameTag = "A Game" | "B+ Game" | "B Game" | "B- Game" | "C Game" | "";

export interface TradeTagVisibilitySettings {
  status: boolean;
  mistake: boolean;
  playbook: boolean;
  catalyst: boolean;
  game: boolean;
  outTag: boolean;
  execution: boolean;
}

export interface Settings {
  notionToken: string;
  notionDatabaseUrl: string;
  exportFolder: string;
  twelveDataApiKey: string;
  brlToUsdRate: number;
  brlTickerList: string;
  dailyShutdownRiskUsd: number;
  tradeTagVisibility: TradeTagVisibilitySettings;
}

export interface RawExecutionRow {
  originalIndex: number;
  tradeDate: string;
  time: string;
  symbol: string;
  gatewayName: string;
  orderSide: string;
  quantity: number;
  price: number;
  grossPnlUsd: number;
  netPnlUsd: number;
  feesUsd: number;
  gatewayFee: number;
  sourceRow: Record<string, string>;
}

export interface ExecutionPiece {
  tradeDate: string;
  time: string;
  timestamp: string;
  symbol: string;
  gatewayName: string;
  side: "Buy" | "Sell";
  quantity: number;
  price: number;
  grossPnlUsd: number;
  netPnlUsd: number;
  feesUsd: number;
  gatewayFee: number;
  sourceIndex: number;
}

export interface AddSignal {
  price: number;
  time: string;
  averagedDown: boolean;
  addedToWinner: boolean;
}

export interface GroupedTrade {
  id: string;
  name: string;
  tradeDate: string;
  symbol: string;
  side: TradeDirection;
  openTime: string;
  closeTime: string;
  holdTime: string;
  holdSeconds: number;
  size: number;
  entryPrice: number;
  exitPrice: number;
  grossPnlUsd: number;
  feesUsd: number;
  netPnlUsd: number;
  netReturn: number;
  returnPerShare: number;
  status: TradeStatus;
  mistakes: string[];
  setups: string[];
  catalyst: string[];
  game: GameTag;
  outTag: string[];
  gateways: string[];
  execution: string[];
  firstOpeningPrice: number;
  openingExecutions: ExecutionPiece[];
  closingExecutions: ExecutionPiece[];
  addSignals: AddSignal[];
}

export interface ExportRow {
  Name: string;
  "Trade Date": string;
  "Open Time": string;
  "Close Time": string;
  "Hold Time": string;
  Symbol: string;
  "Symbol (Select)": string;
  Market: string;
  Currency: string;
  Side: TradeDirection;
  Status: TradeStatus;
  Size: number;
  "Entry Price": string;
  "Exit Price": string;
  "Gross PnL USD": string;
  "Net PnL USD": string;
  "Fees USD": string;
  "Net Return": string;
  "Return / Share": string;
  Mistakes: string;
  Setups: string;
  Game: string;
  "Out Tag": string;
  Gateways: string;
  Execution: string;
  Notes: string;
  Catalyst: string;
  Chart: string;
  Executions: string;
  Place: string;
  "Would a MOC Hit": string;
}

export interface NotionConnectionResult {
  ok: boolean;
  message: string;
  allowedSymbolOptions: string[];
  hasExecutionProperty: boolean;
  databaseId?: string;
}

export interface DuplicateScanResult {
  duplicates: GroupedTrade[];
  remaining: GroupedTrade[];
}
