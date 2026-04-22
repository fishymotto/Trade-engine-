import { useEffect, useRef } from "react";
import { FLUSH_DEBOUNCED_SAVES_EVENT } from "../sync/pendingSaveFlush";

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

  const flushPendingSave = () => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
      latestOnSaveRef.current(latestValueRef.current);
    }
  };

  useEffect(() => {
    if (!enabled) {
      flushPendingSave();
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

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleFlushRequest = () => {
      flushPendingSave();
    };

    const handleBeforeUnload = () => {
      flushPendingSave();
    };

    window.addEventListener(FLUSH_DEBOUNCED_SAVES_EVENT, handleFlushRequest);
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener(FLUSH_DEBOUNCED_SAVES_EVENT, handleFlushRequest);
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, []);

  useEffect(
    () => () => {
      flushPendingSave();
    },
    []
  );
};
