import { useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "./Button";
import { tradeTagFieldLabels, tradeTagFields } from "../lib/trades/tradeTagCatalog";
import type { Settings } from "../types/trade";

interface SettingsModalProps {
  isOpen: boolean;
  settings: Settings;
  onClose: () => void;
  onChange: (settings: Settings) => void;
  onBrowse: () => Promise<void>;
  onTestConnection: () => Promise<string>;
  onLogout?: () => Promise<void>;
}

export const SettingsModal = ({
  isOpen,
  settings,
  onClose,
  onChange,
  onBrowse,
  onTestConnection,
  onLogout
}: SettingsModalProps) => {
  const [message, setMessage] = useState("");

  if (!isOpen) {
    return null;
  }

  const update = (patch: Partial<Settings>) => onChange({ ...settings, ...patch });
  const updateTagVisibility = (field: keyof Settings["tradeTagVisibility"], enabled: boolean) =>
    update({
      tradeTagVisibility: {
        ...settings.tradeTagVisibility,
        [field]: enabled
      }
    });

  const handleTest = async () => {
    setMessage("Testing Notion connection...");
    setMessage(await onTestConnection());
  };

  const handleLogout = async () => {
    try {
      await onLogout?.();
      onClose();
    } catch (err) {
      setMessage(`Logout failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  return createPortal(
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Settings">
      <div className="modal">
        <div className="modal-header">
          <h2>Settings</h2>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
        <label>
          <span>Notion Integration Token</span>
          <input
            type="password"
            value={settings.notionToken}
            onChange={(event) => update({ notionToken: event.target.value })}
            placeholder="secret_..."
          />
        </label>
        <label>
          <span>Notion Database URL</span>
          <input
            type="text"
            value={settings.notionDatabaseUrl}
            onChange={(event) => update({ notionDatabaseUrl: event.target.value })}
            placeholder="https://www.notion.so/..."
          />
        </label>
        <label>
          <span>Export Folder</span>
          <div className="inline-field">
            <input
              type="text"
              value={settings.exportFolder}
              onChange={(event) => update({ exportFolder: event.target.value })}
              placeholder="C:\\Users\\Owner\\Documents\\Trade Engine\\exports"
            />
            <Button onClick={onBrowse}>Browse</Button>
          </div>
        </label>
        <label>
          <span>Twelve Data API Key</span>
          <input
            type="password"
            value={settings.twelveDataApiKey}
            onChange={(event) => update({ twelveDataApiKey: event.target.value })}
            placeholder="Paste your Twelve Data API key"
          />
        </label>
        <label>
          <span>BRL to USD Rate</span>
          <input
            type="number"
            min="0"
            step="0.0001"
            value={settings.brlToUsdRate || ""}
            onChange={(event) =>
              update({ brlToUsdRate: Number(event.target.value) || 0 })
            }
            placeholder="Example: 0.1700"
          />
          <small>Used only for tickers in the Bovespa list. Leave blank to skip BRL conversion.</small>
        </label>
        <label>
          <span>Bovespa Tickers</span>
          <textarea
            rows={4}
            value={settings.brlTickerList}
            onChange={(event) => update({ brlTickerList: event.target.value })}
            placeholder="PETR4, VALE3, BBAS3"
          />
          <small>Comma, space, or new-line separated. These symbols will convert from BRL to USD on import.</small>
        </label>
        <section className="settings-section">
          <div>
            <h3>Tagging System</h3>
            <p>Turn tag lanes on or off without deleting existing trade tags. Useful when your rules change or when sharing the app.</p>
          </div>
          <div className="settings-toggle-grid">
            {tradeTagFields.map((field) => (
              <label key={field} className="settings-toggle-row">
                <input
                  type="checkbox"
                  checked={settings.tradeTagVisibility[field]}
                  onChange={(event) => updateTagVisibility(field, event.target.checked)}
                />
                <span>{tradeTagFieldLabels[field]}</span>
              </label>
            ))}
          </div>
        </section>
        <div className="modal-actions">
          <Button variant="secondary" onClick={handleTest}>
            Test Notion Connection
          </Button>
        </div>
        <p className="settings-message">{message}</p>
      </div>
    </div>,
    document.body
  );
};
