const INLINE_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/svg+xml"
] as const;

export const INLINE_IMAGE_ACCEPT = INLINE_IMAGE_TYPES.join(",");
export const ACCEPTED_INLINE_IMAGE_TYPES = new Set<string>(INLINE_IMAGE_TYPES);

export const pickInlineImageFile = (onSelect: (file: File) => void | Promise<void>) => {
  if (typeof document === "undefined") {
    return;
  }

  const input = document.createElement("input");
  input.type = "file";
  input.accept = INLINE_IMAGE_ACCEPT;
  input.tabIndex = -1;
  input.setAttribute("aria-hidden", "true");
  input.style.position = "fixed";
  input.style.left = "-10000px";
  input.style.top = "0";
  input.style.width = "1px";
  input.style.height = "1px";
  input.style.opacity = "0";
  input.style.pointerEvents = "none";

  let cleanupTimeout: number | undefined;
  const cleanup = () => {
    if (cleanupTimeout !== undefined) {
      window.clearTimeout(cleanupTimeout);
    }
    input.remove();
  };

  input.addEventListener(
    "change",
    () => {
      const file = input.files?.[0] ?? null;
      cleanup();
      if (file) {
        void onSelect(file);
      }
    },
    { once: true }
  );
  input.addEventListener("cancel", cleanup, { once: true });

  document.body.appendChild(input);
  input.click();
  cleanupTimeout = window.setTimeout(cleanup, 60000);
};
