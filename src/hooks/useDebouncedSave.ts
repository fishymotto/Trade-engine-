import { useEffect, useRef } from "react";

export const useDebouncedSave = <T,>(
  value: T,
  delayMs: number,
  onSave: (value: T) => void,
  enabled: boolean
) => {
  const isFirstRunRef = useRef(true);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    if (isFirstRunRef.current) {
      isFirstRunRef.current = false;
      return;
    }

    const timeoutId = window.setTimeout(() => {
      onSave(value);
    }, delayMs);

    return () => window.clearTimeout(timeoutId);
  }, [delayMs, enabled, onSave, value]);
};
