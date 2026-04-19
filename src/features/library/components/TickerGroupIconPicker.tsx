import { useMemo, useRef, useState } from "react";
import {
  resolveTickerGroupIcon,
  tickerGroupIconPresetOptions,
  tickerGroupIconPresets,
  type TickerGroupIconPresetKey
} from "../../../lib/tickers/tickerIcons";

interface TickerGroupIconPickerProps {
  label: string;
  value: string;
  onChange: (next: string) => void;
}

const readFileAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }

      reject(new Error("The file could not be read."));
    };
    reader.onerror = () => reject(reader.error ?? new Error("The file could not be read."));
    reader.readAsDataURL(file);
  });

const getSelectedPreset = (value: string): TickerGroupIconPresetKey | null => {
  const trimmed = value.trim();
  if (!trimmed.startsWith("preset:")) {
    return null;
  }

  return trimmed.slice("preset:".length) as TickerGroupIconPresetKey;
};

export const TickerGroupIconPicker = ({ label, value, onChange }: TickerGroupIconPickerProps) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const previewUrl = useMemo(() => resolveTickerGroupIcon(value), [value]);
  const selectedPreset = useMemo(() => getSelectedPreset(value), [value]);

  const handleUpload = async (file: File | null) => {
    if (!file) {
      return;
    }

    setBusy(true);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      onChange(dataUrl);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ticker-group-icon-picker">
      <label className="property-label">{label}</label>

      <div className="ticker-group-icon-picker-row">
        <div className="ticker-group-icon-preview">
          {previewUrl ? <img src={previewUrl} alt="Group icon preview" /> : <span>No icon</span>}
        </div>

        <div className="ticker-group-icon-actions">
          <button
            type="button"
            className="button button-secondary"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy}
          >
            {busy ? "Uploading..." : "Upload Icon"}
          </button>
          <button
            type="button"
            className="button button-secondary"
            onClick={() => onChange("")}
            disabled={!value.trim() || busy}
          >
            Clear
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="ticker-group-icon-file-input"
            onChange={(event) => {
              void handleUpload(event.target.files?.[0] ?? null);
              event.target.value = "";
            }}
          />
        </div>
      </div>

      <div className="ticker-group-icon-grid" role="list" aria-label="Preset icons">
        {tickerGroupIconPresetOptions.map((preset) => {
          const isActive = selectedPreset === preset.key;
          return (
            <button
              key={preset.key}
              type="button"
              className={`ticker-group-icon-option${isActive ? " ticker-group-icon-option-active" : ""}`}
              onClick={() => onChange(`preset:${preset.key}`)}
              title={preset.label}
              aria-label={`Use preset icon: ${preset.label}`}
            >
              <img src={tickerGroupIconPresets[preset.key]} alt="" />
              <span>{preset.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
