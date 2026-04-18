import { useCallback, useEffect, useMemo, useState } from "react";

const normalizeOption = (value: string) => value.trim().replace(/\s+/g, " ");

const hasValue = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

const loadStoredAdditions = (storageKey: string): string[] => {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(hasValue).map(normalizeOption);
  } catch {
    return [];
  }
};

const dedupeByLower = (values: string[]) => {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const normalized = normalizeOption(value);
    if (!normalized) {
      continue;
    }

    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    output.push(normalized);
  }
  return output;
};

export const useEditableSelectOptions = (storageKey: string, defaultOptions: string[]) => {
  const normalizedDefaults = useMemo(() => dedupeByLower(defaultOptions), [defaultOptions]);
  const defaultLookup = useMemo(() => new Set(normalizedDefaults.map((value) => value.toLowerCase())), [normalizedDefaults]);

  const [additions, setAdditions] = useState<string[]>(() =>
    dedupeByLower(loadStoredAdditions(storageKey)).filter((value) => !defaultLookup.has(value.toLowerCase()))
  );

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(additions));
    } catch {
      // ignore
    }
  }, [additions, storageKey]);

  const options = useMemo(() => {
    const merged = [...normalizedDefaults, ...additions.filter((value) => !defaultLookup.has(value.toLowerCase()))];
    return dedupeByLower(merged);
  }, [additions, defaultLookup, normalizedDefaults]);

  const addOption = useCallback(
    (value: string) => {
      const normalized = normalizeOption(value);
      if (!normalized) {
        return null;
      }

      if (defaultLookup.has(normalized.toLowerCase())) {
        return normalized;
      }

      setAdditions((current) => {
        const next = dedupeByLower([...current, normalized]).filter(
          (option) => !defaultLookup.has(option.toLowerCase())
        );
        return next;
      });

      return normalized;
    },
    [defaultLookup]
  );

  return { options, addOption };
};

