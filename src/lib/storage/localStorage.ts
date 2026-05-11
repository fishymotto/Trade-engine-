const hasLocalStorage = (): boolean =>
  typeof window !== "undefined" && typeof window.localStorage !== "undefined";

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
};

export const isStorageQuotaExceededError = (error: unknown): boolean => {
  if (typeof DOMException !== "undefined" && error instanceof DOMException) {
    return error.name === "QuotaExceededError" || error.name === "NS_ERROR_DOM_QUOTA_REACHED";
  }

  const message = getErrorMessage(error).toLowerCase();
  return message.includes("quota") && (message.includes("exceeded") || message.includes("full"));
};

interface LocalStorageWriteOptions {
  label?: string;
  suppressQuotaWarning?: boolean;
}

const describeKey = (key: string, options?: LocalStorageWriteOptions): string => {
  const label = options?.label?.trim();
  return label && label.length > 0 ? label : key;
};

export const readLocalStorageItem = (key: string): string | null => {
  if (!hasLocalStorage()) {
    return null;
  }

  try {
    return window.localStorage.getItem(key);
  } catch (error) {
    console.warn(`[storage] Failed to read ${key} from localStorage.`, error);
    return null;
  }
};

export const writeLocalStorageItem = (
  key: string,
  value: string,
  options?: LocalStorageWriteOptions
): boolean => {
  if (!hasLocalStorage()) {
    return false;
  }

  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch (error) {
    const keyLabel = describeKey(key, options);
    if (isStorageQuotaExceededError(error)) {
      if (!options?.suppressQuotaWarning) {
        console.warn(`[storage] Skipped saving ${keyLabel} because localStorage is full.`);
      }
      return false;
    }

    console.warn(`[storage] Failed to save ${keyLabel} to localStorage.`, error);
    return false;
  }
};

export const removeLocalStorageItem = (
  key: string,
  options?: Pick<LocalStorageWriteOptions, "label">
): boolean => {
  if (!hasLocalStorage()) {
    return false;
  }

  try {
    window.localStorage.removeItem(key);
    return true;
  } catch (error) {
    console.warn(`[storage] Failed to remove ${describeKey(key, options)} from localStorage.`, error);
    return false;
  }
};
