export const FLUSH_DEBOUNCED_SAVES_EVENT = "trade-engine-flush-debounced-saves";

export const requestFlushDebouncedSaves = async (): Promise<void> => {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new CustomEvent(FLUSH_DEBOUNCED_SAVES_EVENT));
  await new Promise<void>((resolve) => {
    window.setTimeout(() => resolve(), 0);
  });
};

