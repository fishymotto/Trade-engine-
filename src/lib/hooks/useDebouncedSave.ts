import { useEffect, useRef } from "react";
import { FLUSH_DEBOUNCED_SAVES_EVENT } from "../sync/pendingSaveFlush";

interface UseDebouncedSaveOptions {
  skipInitialSave?: boolean;
}

export const useDebouncedSave = <T,>(
  value: T,
  delayMs: number,
  onSave: (value: T) => void,
  enabled: boolean,
  options: UseDebouncedSaveOptions = {}
) => {
  const { skipInitialSave = false } = options;
  const hasMountedRef = useRef(false);
  const hasSkippedInitialEnabledSaveRef = useRef(!skipInitialSave);
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
      hasMountedRef.current = true;
      flushPendingSave();
      return;
    }

    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      if (skipInitialSave) {
        hasSkippedInitialEnabledSaveRef.current = true;
      }
      return;
    }

    if (skipInitialSave && !hasSkippedInitialEnabledSaveRef.current) {
      hasSkippedInitialEnabledSaveRef.current = true;
      return;
    }

    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = window.setTimeout(() => {
      timeoutRef.current = null;
      latestOnSaveRef.current(latestValueRef.current);
    }, delayMs);
  }, [delayMs, enabled, skipInitialSave, value]);

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

    const handlePageHide = () => {
      flushPendingSave();
    };

    const handleWindowBlur = () => {
      flushPendingSave();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        flushPendingSave();
      }
    };

    window.addEventListener(FLUSH_DEBOUNCED_SAVES_EVENT, handleFlushRequest);
    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("blur", handleWindowBlur);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener(FLUSH_DEBOUNCED_SAVES_EVENT, handleFlushRequest);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("blur", handleWindowBlur);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  useEffect(
    () => () => {
      flushPendingSave();
    },
    []
  );
};
