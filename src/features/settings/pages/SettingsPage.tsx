import { useState } from "react";
import { Button } from "../../../components/Button";
import { PageHero } from "../../../components/PageHero";
import { tradeTagFieldLabels, tradeTagFields } from "../../../lib/trades/tradeTagCatalog";
import type { Settings } from "../../../types/trade";

interface SettingsPageProps {
  settings: Settings;
  onChange: (settings: Settings) => void;
  onBrowse: () => Promise<void>;
  onTestConnection: () => Promise<string>;
}

export const SettingsPage = ({ settings, onChange, onBrowse, onTestConnection }: SettingsPageProps) => {
  const [message, setMessage] = useState("");

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

  return (
    <main className="page-shell settings-page">
      <PageHero
        eyebrow="Settings"
        title="Workspace Preferences"
        description="Set Notion credentials, export paths, and tagging system visibility."
      />

      <section className="settings-page-layout" aria-label="Settings form">
        <div className="modal settings-page-card">
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
              onChange={(event) => update({ brlToUsdRate: Number(event.target.value) || 0 })}
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
          <label>
            <span>Daily Shutdown Risk (USD)</span>
            <input
              type="number"
              min="0"
              step="1"
              value={settings.dailyShutdownRiskUsd || ""}
              onChange={(event) => update({ dailyShutdownRiskUsd: Number(event.target.value) || 0 })}
              placeholder="Example: 30"
            />
            <small>Used to count breach days in Weekly/Monthly Review entries.</small>
          </label>

          <section className="settings-section">
            <div>
              <h3>Tagging System</h3>
              <p>Turn tag lanes on or off without deleting existing trade tags.</p>
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

          <div className="settings-page-actions">
            <Button variant="secondary" onClick={handleTest}>
              Test Notion Connection
            </Button>
          </div>
          <p className="settings-message">{message}</p>
        </div>
      </section>
    </main>
  );
};

