import { useState } from "react";
import { Button } from "./Button";
import type { Settings } from "../types/trade";

interface SettingsModalProps {
  isOpen: boolean;
  settings: Settings;
  onClose: () => void;
  onChange: (settings: Settings) => void;
  onBrowse: () => Promise<void>;
  onTestConnection: () => Promise<string>;
}

export const SettingsModal = ({
  isOpen,
  settings,
  onClose,
  onChange,
  onBrowse,
  onTestConnection
}: SettingsModalProps) => {
  const [message, setMessage] = useState("");

  if (!isOpen) {
    return null;
  }

  const update = (patch: Partial<Settings>) => onChange({ ...settings, ...patch });

  const handleTest = async () => {
    setMessage("Testing Notion connection...");
    setMessage(await onTestConnection());
  };

  return (
    <div className="modal-backdrop">
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
        <div className="modal-actions">
          <Button variant="secondary" onClick={handleTest}>
            Test Notion Connection
          </Button>
        </div>
        <p className="settings-message">{message}</p>
      </div>
    </div>
  );
};
