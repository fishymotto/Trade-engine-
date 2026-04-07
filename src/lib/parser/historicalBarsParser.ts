import Papa from "papaparse";
import type { HistoricalBar } from "../../types/chart";

const normalizeHeader = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, "");

const parseNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== "string") {
    return null;
  }

  const parsed = Number(value.replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : null;
};

const parseTimestamp = (rawValue: string, rawTime?: string): number | null => {
  const combined = rawTime ? `${rawValue} ${rawTime}` : rawValue;
  const trimmed = combined.trim();

  if (!trimmed) {
    return null;
  }

  const numeric = Number(trimmed);
  if (Number.isFinite(numeric)) {
    if (trimmed.length === 10) {
      return numeric;
    }

    if (trimmed.length === 13) {
      return Math.floor(numeric / 1000);
    }
  }

  const direct = new Date(trimmed);
  if (!Number.isNaN(direct.getTime())) {
    return Math.floor(direct.getTime() / 1000);
  }

  const isoLike = new Date(trimmed.replace(" ", "T"));
  if (!Number.isNaN(isoLike.getTime())) {
    return Math.floor(isoLike.getTime() / 1000);
  }

  return null;
};

const formatTradeDate = (timestampSeconds: number): string => {
  const date = new Date(timestampSeconds * 1000);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export const parseHistoricalBarsCsv = async (
  file: File,
  tradeDate: string
): Promise<HistoricalBar[]> => {
  const text = await file.text();

  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true
  });

  const rows = parsed.data;
  if (rows.length === 0) {
    throw new Error("The historical bar file was empty.");
  }

  const headers = Object.keys(rows[0] ?? {});
  const headerMap = new Map(headers.map((header) => [normalizeHeader(header), header]));

  const openHeader = headerMap.get("open");
  const highHeader = headerMap.get("high");
  const lowHeader = headerMap.get("low");
  const closeHeader = headerMap.get("close");
  const volumeHeader = headerMap.get("volume") ?? headerMap.get("vol");
  const dateTimeHeader =
    headerMap.get("datetime") ??
    headerMap.get("timestamp") ??
    headerMap.get("date") ??
    headerMap.get("time");
  const dateHeader =
    headerMap.get("date") ??
    headerMap.get("tradedate") ??
    headerMap.get("day");
  const timeHeader = headerMap.get("time");

  if (!openHeader || !highHeader || !lowHeader || !closeHeader || !dateTimeHeader) {
    throw new Error("Historical bars need date/time, open, high, low, and close columns.");
  }

  const bars: HistoricalBar[] = [];

  for (const row of rows) {
    const timestamp = dateHeader && timeHeader
      ? parseTimestamp(row[dateHeader] ?? "", row[timeHeader] ?? "")
      : parseTimestamp(row[dateTimeHeader] ?? "");
    const open = parseNumber(row[openHeader]);
    const high = parseNumber(row[highHeader]);
    const low = parseNumber(row[lowHeader]);
    const close = parseNumber(row[closeHeader]);
    const volume = volumeHeader ? parseNumber(row[volumeHeader]) ?? undefined : undefined;

    if (timestamp === null || open === null || high === null || low === null || close === null) {
      continue;
    }

    bars.push({
      time: timestamp,
      open,
      high,
      low,
      close,
      volume
    });
  }

  const filteredBars = bars
    .filter((bar) => formatTradeDate(bar.time) === tradeDate)
    .sort((left, right) => left.time - right.time);

  const result = filteredBars.length > 0 ? filteredBars : bars.sort((left, right) => left.time - right.time);
  if (result.length === 0) {
    throw new Error("No usable historical bars were found in that file.");
  }

  return result;
};
