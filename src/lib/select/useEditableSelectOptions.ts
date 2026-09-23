import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SYNC_HYDRATED_EVENT } from "../sync/syncStore";
import {
  loadSelectOptionAdditions,
  persistSelectOptionAdditions
} from "./selectOptionAdditionsStore";

const normalizeOption = (value: string) => value.trim().replace(/\s+/g, " ");

const hasValue = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

const loadStoredAdditions = (storageKey: string): string[] => {
  try {
    if (typeof window === "undefined") {
      return [];
    }

    const store = loadSelectOptionAdditions();
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

const areOptionsEqual = (left: string[], right: string[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index]);

export const useEditableSelectOptions = (storageKey: string, defaultOptions: string[]) => {
  const normalizedDefaults = useMemo(() => dedupeByLower(defaultOptions), [defaultOptions]);
  const defaultLookup = useMemo(() => new Set(normalizedDefaults.map((value) => value.toLowerCase())), [normalizedDefaults]);

  const [additions, setAdditions] = useState<string[]>(() =>
    dedupeByLower(loadStoredAdditions(storageKey)).filter((value) => !defaultLookup.has(value.toLowerCase()))
  );
  const additionsRef = useRef(additions);
  additionsRef.current = additions;
  const skipNextSaveRef = useRef(true);

  const persistAdditionsForKey = useCallback(
    (nextAdditions: string[]) => {
      try {
        const current = loadSelectOptionAdditions();
        void persistSelectOptionAdditions({
          ...(current && typeof current === "object" ? current : {}),
          [storageKey]: nextAdditions
        });
      } catch {
        // ignore
      }
    },
    [storageKey]
  );

  const setAndPersistAdditions = useCallback(
    (nextAdditions: string[]) => {
      additionsRef.current = nextAdditions;
      setAdditions(nextAdditions);
      persistAdditionsForKey(nextAdditions);
    },
    [persistAdditionsForKey]
  );

  useEffect(() => {
    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false;
      return;
    }

    try {
      const current = loadSelectOptionAdditions();
      void persistSelectOptionAdditions({
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
      const nextAdditions = dedupeByLower(loadStoredAdditions(storageKey)).filter(
        (value) => !defaultLookup.has(value.toLowerCase())
      );
      additionsRef.current = nextAdditions;
      setAdditions(nextAdditions);
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

      const nextAdditions = dedupeByLower([...additionsRef.current, normalized]).filter(
        (option) => !defaultLookup.has(option.toLowerCase())
      );
      if (!areOptionsEqual(nextAdditions, additionsRef.current)) {
        setAndPersistAdditions(nextAdditions);
      }

      return normalized;
    },
    [defaultLookup, setAndPersistAdditions]
  );

  const renameOption = useCallback(
    (currentValue: string, nextValue: string) => {
      const currentNormalized = normalizeOption(currentValue);
      const nextNormalized = normalizeOption(nextValue);
      if (!currentNormalized || !nextNormalized) {
        return false;
      }

      const currentKey = currentNormalized.toLowerCase();
      const nextKey = nextNormalized.toLowerCase();
      const isCaseOnlyRename = currentKey === nextKey && currentNormalized !== nextNormalized;

      if (defaultLookup.has(currentKey)) {
        return false;
      }

      if (!additionsRef.current.some((option) => option.toLowerCase() === currentKey)) {
        return false;
      }

      if (isCaseOnlyRename) {
        setAndPersistAdditions(
          dedupeByLower(
            additionsRef.current.map((option) => (option.toLowerCase() === currentKey ? nextNormalized : option))
          ).filter((option) => !defaultLookup.has(option.toLowerCase()))
        );
        return true;
      }

      if (currentKey === nextKey || defaultLookup.has(nextKey)) {
        return false;
      }

      if (additionsRef.current.some((option) => option.toLowerCase() === nextKey)) {
        return false;
      }

      const withoutCurrent = additionsRef.current.filter((option) => option.toLowerCase() !== currentKey);
      setAndPersistAdditions(
        dedupeByLower([...withoutCurrent, nextNormalized]).filter(
          (option) => !defaultLookup.has(option.toLowerCase())
        )
      );
      return true;
    },
    [defaultLookup, setAndPersistAdditions]
  );

  const removeOption = useCallback(
    (value: string) => {
      const normalized = normalizeOption(value);
      if (!normalized) {
        return false;
      }

      const key = normalized.toLowerCase();
      if (defaultLookup.has(key)) {
        return false;
      }

      if (!additionsRef.current.some((option) => option.toLowerCase() === key)) {
        return false;
      }

      setAndPersistAdditions(additionsRef.current.filter((option) => option.toLowerCase() !== key));
      return true;
    },
    [defaultLookup, setAndPersistAdditions]
  );

  const isCustomOption = useCallback(
    (value: string) => {
      const normalized = normalizeOption(value).toLowerCase();
      if (!normalized || defaultLookup.has(normalized)) {
        return false;
      }

      return additions.some((option) => option.toLowerCase() === normalized);
    },
    [additions, defaultLookup]
  );

  return { options, addOption, renameOption, removeOption, isCustomOption };
};
