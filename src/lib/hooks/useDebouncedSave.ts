import { useEffect, useRef } from "react";

export const useDebouncedSave = <T,>(
  value: T,
  delayMs: number,
  onSave: (value: T) => void,
  enabled: boolean
) => {
  const isFirstRunRef = useRef(true);
  const timeoutRef = useRef<number | null>(null);
  const latestValueRef = useRef(value);
  const latestOnSaveRef = useRef(onSave);

  latestValueRef.current = value;
  latestOnSaveRef.current = onSave;

  useEffect(() => {
    if (!enabled) {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
        latestOnSaveRef.current(latestValueRef.current);
      }
      return;
    }

    if (isFirstRunRef.current) {
      isFirstRunRef.current = false;
      return;
    }

    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = window.setTimeout(() => {
      timeoutRef.current = null;
      latestOnSaveRef.current(latestValueRef.current);
    }, delayMs);
  }, [delayMs, enabled, value]);

  useEffect(
    () => () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
        latestOnSaveRef.current(latestValueRef.current);
      }
    },
    []
  );
};
