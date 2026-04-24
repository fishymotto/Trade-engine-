import { useEffect, useState } from "react";
import { Button } from "../../../components/Button";
import { PageHero } from "../../../components/PageHero";
import { tradeTagFieldLabels, tradeTagFields } from "../../../lib/trades/tradeTagCatalog";
import type { AdminWorkspaceUserRecord } from "../../../lib/admin/adminUsers";
import type { Settings } from "../../../types/trade";

interface SettingsPageProps {
  settings: Settings;
  isAdmin: boolean;
  onChange: (settings: Settings) => void;
  onBrowse: () => Promise<void>;
  onTestConnection: () => Promise<string>;
  onForceCloudSeed: () => Promise<string>;
  onLoadAdminUsers: () => Promise<AdminWorkspaceUserRecord[]>;
}

const formatDate = (value: string): string => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString();
};

export const SettingsPage = ({
  settings,
  isAdmin,
  onChange,
  onBrowse,
  onTestConnection,
  onForceCloudSeed,
  onLoadAdminUsers
}: SettingsPageProps) => {
  const [message, setMessage] = useState("");
  const [adminUsers, setAdminUsers] = useState<AdminWorkspaceUserRecord[]>([]);
  const [adminUsersLoading, setAdminUsersLoading] = useState(false);
  const [adminUsersError, setAdminUsersError] = useState("");

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

  const handleForceCloudSeed = async () => {
    setMessage("Pushing this computer to cloud...");
    setMessage(await onForceCloudSeed());
  };

  const refreshAdminUsers = async () => {
    if (!isAdmin) {
      return;
    }

    setAdminUsersLoading(true);
    setAdminUsersError("");
    try {
      const users = await onLoadAdminUsers();
      setAdminUsers(users);
    } catch (error) {
      setAdminUsersError(error instanceof Error ? error.message : "Could not load users.");
    } finally {
      setAdminUsersLoading(false);
    }
  };

  useEffect(() => {
    void refreshAdminUsers();
  }, [isAdmin]);

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
            <Button variant="secondary" onClick={handleForceCloudSeed}>
              Push This Computer To Cloud
            </Button>
          </div>
          <p className="settings-message">{message}</p>
        </div>

        {isAdmin ? (
          <div className="modal settings-page-card settings-admin-card">
            <div className="settings-admin-header">
              <div>
                <h3>Admin Panel</h3>
                <p>Read-only user list for workspace administration.</p>
              </div>
              <Button variant="secondary" onClick={refreshAdminUsers} disabled={adminUsersLoading}>
                {adminUsersLoading ? "Refreshing..." : "Refresh Users"}
              </Button>
            </div>

            {adminUsersError ? <p className="settings-message">{adminUsersError}</p> : null}

            <div className="settings-admin-table-wrap">
              <table className="settings-admin-table">
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Username</th>
                    <th>Role</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {adminUsers.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="settings-admin-empty">
                        {adminUsersLoading ? "Loading users..." : "No users found yet."}
                      </td>
                    </tr>
                  ) : (
                    adminUsers.map((record) => (
                      <tr key={record.id}>
                        <td>{record.email || "(no email)"}</td>
                        <td>{record.username || "(no username)"}</td>
                        <td>{record.is_admin ? "Admin" : "User"}</td>
                        <td>{formatDate(record.created_at)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </section>
    </main>
  );
};

