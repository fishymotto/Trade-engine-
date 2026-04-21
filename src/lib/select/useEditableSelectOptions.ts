import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SYNC_HYDRATED_EVENT, syncStores } from "../sync/syncStore";

const normalizeOption = (value: string) => value.trim().replace(/\s+/g, " ");

const hasValue = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

const loadStoredAdditions = (storageKey: string): string[] => {
  try {
    if (typeof window === "undefined") {
      return [];
    }

    const store = syncStores.selectOptionAdditions.load<Record<string, string[]>>({});
    const values = store?.[storageKey];
    if (!Array.isArray(values)) {
      return [];
    }

    return values.filter(hasValue).map(normalizeOption);
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
  const skipNextSaveRef = useRef(true);

  useEffect(() => {
    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false;
      return;
    }

    try {
      const current = syncStores.selectOptionAdditions.load<Record<string, string[]>>({});
      void syncStores.selectOptionAdditions.save({
        ...(current && typeof current === "object" ? current : {}),
        [storageKey]: additions
      });
    } catch {
      // ignore
    }
  }, [additions, storageKey]);

  useEffect(() => {
    const handleHydrated = () => {
      skipNextSaveRef.current = true;
      setAdditions(
        dedupeByLower(loadStoredAdditions(storageKey)).filter((value) => !defaultLookup.has(value.toLowerCase()))
      );
    };

    window.addEventListener(SYNC_HYDRATED_EVENT, handleHydrated);
    return () => window.removeEventListener(SYNC_HYDRATED_EVENT, handleHydrated);
  }, [defaultLookup, storageKey]);

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
