import { invoke, isTauri } from "@tauri-apps/api/core";
import type {
  DuplicateScanResult,
  GroupedTrade,
  NotionConnectionResult,
  Settings
} from "../../../types/trade";

interface NotionDatabaseResponse {
  id: string;
  properties: Record<
    string,
    {
      id: string;
      name: string;
      type: string;
      select?: { options: Array<{ name: string }> };
      multi_select?: { options: Array<{ name: string }> };
    }
  >;
}

interface NotionPage {
  id: string;
  properties: Record<string, unknown>;
}

interface NotionPageIcon {
  type: "emoji";
  emoji: string;
}

interface NotionPropertyCapabilities {
  allowedSymbolOptions: string[];
  allowedExecutionOptions: string[];
  hasExecutionProperty: boolean;
}

const PROPERTY_ALIASES: Record<string, string[]> = {
  Name: ["Name", "Trade Group Name", "Title"],
  "Trade Date": ["Trade Date", "Date"],
  "Open Time": ["Open Time"],
  "Close Time": ["Close Time"],
  "Hold Time": ["Hold Time"],
  Symbol: ["Symbol"],
  "Symbol (Select)": ["Symbol (Select)", "Symbol Select"],
  Market: ["Market"],
  Currency: ["Currency"],
  Side: ["Side"],
  Status: ["Status", "Win / Loss", "Result"],
  Size: ["Size", "Shares"],
  "Entry Price": ["Entry Price"],
  "Exit Price": ["Exit Price"],
  "Gross PnL USD": ["Gross PnL USD", "Gross P/L USD", "Gross PnL"],
  "Net PnL USD": ["Net PnL USD", "Net P/L USD", "Net PnL"],
  "Fees USD": ["Fees USD", "Fees", "Commission + Fees"],
  "Net Return": ["Net Return"],
  "Return / Share": ["Return / Share", "Return per Share"],
  Mistakes: ["Mistakes"],
  Setups: ["Setups"],
  Catalyst: ["Catalyst"],
  Game: ["Game"],
  "Out Tag": ["Out Tag", "Out Tags"],
  Gateways: ["Gateways", "Gateway"],
  Execution: ["Execution", "Executions"]
};

const NOTION_VERSION = "2022-06-28";

const parseDatabaseId = (databaseUrl: string): string => {
  const match = databaseUrl.match(/([a-f0-9]{32})/i);
  if (!match) {
    throw new Error("The Notion Database URL does not look valid.");
  }

  const compact = match[1];
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
};

const notionRequest = async <T>(
  settings: Settings,
  path: string,
  init?: RequestInit
): Promise<T> => {
  if (isTauri()) {
    return invoke<T>("notion_api_request", {
      token: settings.notionToken,
      path,
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : null
    });
  }

  const response = await fetch(`https://api.notion.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${settings.notionToken}`,
      "Content-Type": "application/json",
      "Notion-Version": NOTION_VERSION,
      ...(init?.headers ?? {})
    }
  });

  if (!response.ok) {
    const text = await response.text();
    // TODO: Map common Notion API failures into more specific user-facing messages.
    throw new Error(text || "Notion returned an error.");
  }

  return response.json() as Promise<T>;
};

const getPlainTextValue = (property: unknown): string => {
  if (!property || typeof property !== "object") {
    return "";
  }

  const typed = property as Record<string, unknown>;
  if (Array.isArray(typed.title)) {
    return typed.title.map((item: any) => item.plain_text).join("");
  }
  if (Array.isArray(typed.rich_text)) {
    return typed.rich_text.map((item: any) => item.plain_text).join("");
  }
  if (typed.select && typeof typed.select === "object") {
    return ((typed.select as { name?: string }).name ?? "").trim();
  }
  if (typed.number !== undefined && typed.number !== null) {
    return String(typed.number);
  }
  if (typed.date && typeof typed.date === "object") {
    return ((typed.date as { start?: string }).start ?? "").trim();
  }
  return "";
};

const resolvePropertySchema = (
  properties: NotionDatabaseResponse["properties"],
  name: string
): NotionDatabaseResponse["properties"][string] | undefined => {
  const aliases = PROPERTY_ALIASES[name] ?? [name];
  for (const alias of aliases) {
    if (properties[alias]) {
      return properties[alias];
    }
  }
  return undefined;
};

const getNotionPageIcon = (symbol: string): NotionPageIcon | undefined => {
  const iconMap: Record<string, string> = {
    CVE: "🐙",
    JD: "🛒"
  };

  const emoji = iconMap[symbol];
  return emoji ? { type: "emoji", emoji } : undefined;
};

const getPropertyCapabilities = (database: NotionDatabaseResponse): NotionPropertyCapabilities => {
  const symbolSelect = resolvePropertySchema(database.properties, "Symbol (Select)");
  const execution = resolvePropertySchema(database.properties, "Execution");

  const allowedSymbolOptions =
    symbolSelect?.type === "select"
      ? symbolSelect.select?.options.map((option) => option.name) ?? []
      : symbolSelect?.type === "multi_select"
        ? symbolSelect.multi_select?.options.map((option) => option.name) ?? []
        : [];

  const allowedExecutionOptions =
    execution?.type === "multi_select"
      ? execution.multi_select?.options.map((option) => option.name) ?? []
      : execution?.type === "select"
        ? execution.select?.options.map((option) => option.name) ?? []
        : [];

  return {
    allowedSymbolOptions,
    allowedExecutionOptions,
    hasExecutionProperty: Boolean(execution)
  };
};

const ensurePropertyOptions = async (
  settings: Settings,
  databaseId: string,
  database: NotionDatabaseResponse,
  propertyName: string,
  values: string[]
): Promise<NotionDatabaseResponse> => {
  const schema = resolvePropertySchema(database.properties, propertyName);
  if (!schema || (schema.type !== "select" && schema.type !== "multi_select")) {
    return database;
  }

  const requestedValues = Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
  if (requestedValues.length === 0) {
    return database;
  }

  const existingOptions = schema.type === "select"
    ? schema.select?.options ?? []
    : schema.multi_select?.options ?? [];

  const existingOptionNames = new Set(existingOptions.map((option) => option.name.toLowerCase()));
  const missingValues = requestedValues.filter((value) => !existingOptionNames.has(value.toLowerCase()));

  if (missingValues.length === 0) {
    return database;
  }

  const options = [
    ...existingOptions.map((option) => ({ name: option.name })),
    ...missingValues.map((value) => ({ name: value }))
  ];

  await notionRequest(settings, `/v1/databases/${databaseId}`, {
    method: "PATCH",
    body: JSON.stringify({
      properties: {
        [schema.name]: {
          [schema.type]: {
            options
          }
        }
      }
    })
  });

  return notionRequest<NotionDatabaseResponse>(settings, `/v1/databases/${databaseId}`);
};

const buildPropertyValue = (
  schema: NotionDatabaseResponse["properties"][string],
  value: string | number | string[]
): Record<string, unknown> | undefined => {
  if (value === "" || value === null || value === undefined) {
    return undefined;
  }

  switch (schema.type) {
    case "title":
      return { title: [{ text: { content: String(value) } }] };
    case "rich_text":
      return {
        rich_text: [{ text: { content: Array.isArray(value) ? value.join(", ") : String(value) } }]
      };
    case "select":
      if (typeof value === "string" && value) {
        return { select: { name: value } };
      }
      if (Array.isArray(value) && value.length > 0) {
        return { select: { name: value[0] } };
      }
      return undefined;
    case "multi_select":
      return Array.isArray(value)
        ? { multi_select: value.filter(Boolean).map((name) => ({ name })) }
        : typeof value === "string" && value
          ? { multi_select: value.split(",").map((name) => name.trim()).filter(Boolean).map((name) => ({ name })) }
          : undefined;
    case "date":
      return typeof value === "string" && value ? { date: { start: value } } : undefined;
    case "number":
      return { number: typeof value === "number" ? value : Number(value) || 0 };
    default:
      return undefined;
  }
};

export const testNotionConnection = async (settings: Settings): Promise<NotionConnectionResult> => {
  if (!settings.notionToken.trim() || !settings.notionDatabaseUrl.trim()) {
    return {
      ok: false,
      message: "Add both the Notion token and database URL first.",
      allowedSymbolOptions: [],
      hasExecutionProperty: false
    };
  }

  const databaseId = parseDatabaseId(settings.notionDatabaseUrl);
  const database = await notionRequest<NotionDatabaseResponse>(settings, `/v1/databases/${databaseId}`);
  const capabilities = getPropertyCapabilities(database);

  return {
    ok: true,
    message: "Notion connection works.",
    allowedSymbolOptions: capabilities.allowedSymbolOptions,
    hasExecutionProperty: capabilities.hasExecutionProperty,
    databaseId
  };
};

export const findNotionDuplicates = async (
  settings: Settings,
  trades: GroupedTrade[]
): Promise<DuplicateScanResult> => {
  const databaseId = parseDatabaseId(settings.notionDatabaseUrl);
  const pages: NotionPage[] = [];
  let cursor: string | undefined;

  do {
    const response = await notionRequest<{
      results: NotionPage[];
      next_cursor: string | null;
      has_more: boolean;
    }>(settings, `/v1/databases/${databaseId}/query`, {
      method: "POST",
      body: JSON.stringify(cursor ? { start_cursor: cursor } : {})
    });

    pages.push(...response.results);
    cursor = response.has_more ? response.next_cursor ?? undefined : undefined;
  } while (cursor);

  const existingKeys = new Set(
    pages.map((page) => {
      const properties = page.properties as Record<string, unknown>;
      const tradeDate = getPlainTextValue(properties["Trade Date"]);
      const symbol = getPlainTextValue(properties.Symbol);
      const openTime = getPlainTextValue(properties["Open Time"]);
      const closeTime = getPlainTextValue(properties["Close Time"]);
      const side = getPlainTextValue(properties.Side);
      const size = getPlainTextValue(properties.Size);
      return [tradeDate, symbol, openTime, closeTime, side, size].join("|");
    })
  );

  const duplicates: GroupedTrade[] = [];
  const remaining: GroupedTrade[] = [];

  for (const trade of trades) {
    const key = [trade.tradeDate, trade.symbol, trade.openTime, trade.closeTime, trade.side, String(trade.size)].join("|");
    if (existingKeys.has(key)) {
      duplicates.push(trade);
    } else {
      remaining.push(trade);
    }
  }

  return { duplicates, remaining };
};

export const importTradesToNotion = async (
  settings: Settings,
  trades: GroupedTrade[],
  allowedSymbolOptions: string[],
  hasExecutionProperty: boolean
): Promise<number> => {
  const databaseId = parseDatabaseId(settings.notionDatabaseUrl);
  let database = await notionRequest<NotionDatabaseResponse>(settings, `/v1/databases/${databaseId}`);
  database = await ensurePropertyOptions(
    settings,
    databaseId,
    database,
    "Symbol (Select)",
    trades.map((trade) => trade.symbol)
  );
  database = await ensurePropertyOptions(
    settings,
    databaseId,
    database,
    "Execution",
    trades.flatMap((trade) => trade.execution)
  );

  const capabilities = getPropertyCapabilities(database);
  const createdPages: Promise<unknown>[] = [];

  for (const trade of trades) {
    const values: Record<string, string | number | string[]> = {
      Name: trade.name,
      "Trade Date": trade.tradeDate,
      "Open Time": trade.openTime,
      "Close Time": trade.closeTime,
      "Hold Time": trade.holdTime,
      Symbol: trade.symbol,
      "Symbol (Select)": allowedSymbolOptions.length === 0 || allowedSymbolOptions.includes(trade.symbol) ? trade.symbol : "",
      Market: "US",
      Currency: "USD",
      Side: trade.side,
      Status: trade.status,
      Size: trade.size,
      "Entry Price": trade.entryPrice,
      "Exit Price": trade.exitPrice,
      "Gross PnL USD": trade.grossPnlUsd,
      "Net PnL USD": trade.netPnlUsd,
      "Fees USD": trade.feesUsd,
      "Net Return": trade.netReturn,
      "Return / Share": trade.returnPerShare,
      Mistakes: trade.mistakes,
      Setups: trade.setups,
      Catalyst: trade.catalyst ?? [],
      Game: trade.game,
      "Out Tag": trade.outTag,
      Gateways: trade.gateways,
      Execution:
        hasExecutionProperty && (capabilities.allowedExecutionOptions.length === 0
          || trade.execution.every((tag) => capabilities.allowedExecutionOptions.includes(tag)))
          ? trade.execution
          : []
    };

    const properties = Object.entries(values).reduce<Record<string, unknown>>((accumulator, [name, value]) => {
      const schema = resolvePropertySchema(database.properties, name);
      if (!schema) {
        return accumulator;
      }

      const propertyValue = buildPropertyValue(schema, value);
      if (propertyValue) {
        accumulator[schema.name] = propertyValue;
      }
      return accumulator;
    }, {});

    createdPages.push(
      notionRequest(settings, "/v1/pages", {
        method: "POST",
        body: JSON.stringify({
          parent: { database_id: databaseId },
          icon: getNotionPageIcon(trade.symbol),
          properties
        })
      })
    );
  }

  await Promise.all(createdPages);
  return trades.length;
};
