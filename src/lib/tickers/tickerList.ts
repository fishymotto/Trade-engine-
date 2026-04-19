const normalizeTickerToken = (value: string): string => value.trim().replace(/^\$/, "").toUpperCase();

export const parseTickerList = (value: string | null | undefined): string[] => {
  const raw = typeof value === "string" ? value : "";
  const tokens = raw
    .split(/[\s,;]+/g)
    .map(normalizeTickerToken)
    .filter(Boolean);

  const seen = new Set<string>();
  const output: string[] = [];
  for (const token of tokens) {
    if (seen.has(token)) {
      continue;
    }

    seen.add(token);
    output.push(token);
  }

  return output;
};

export const formatTickerList = (tickers: string[]): string => tickers.map(normalizeTickerToken).filter(Boolean).join(", ");

