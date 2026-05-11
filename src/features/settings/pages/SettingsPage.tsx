import { useCallback, useEffect, useState } from "react";
import { Button } from "../../../components/Button";
import { PageHero } from "../../../components/PageHero";
import { DEFAULT_MPP_LOCK_IN_STEPS } from "../../../lib/settings/settingsStore";
import { tradeTagFieldLabels, tradeTagFields } from "../../../lib/trades/tradeTagCatalog";
import type { WorkspaceAttachmentAuditResult } from "../../../lib/workspace/workspaceAttachmentClient";
import type { Settings } from "../../../types/trade";

const backupIntervalOptions: Array<{ value: number; label: string }> = [
  { value: 0, label: "Every Save (Recommended)" },
  { value: 5, label: "Every 5 minutes" },
  { value: 15, label: "Every 15 minutes" },
  { value: 60, label: "Every 1 hour" },
  { value: 360, label: "Every 6 hours" },
  { value: 1440, label: "Every 24 hours" }
];

interface SettingsPageProps {
  settings: Settings;
  onChange: (settings: Settings) => void;
  onTestConnection: () => Promise<string>;
  onLoadWorkspaceAttachmentSummary: () => Promise<WorkspaceAttachmentAuditResult | null>;
  onAuditWorkspaceAttachments: () => Promise<string>;
  onPruneWorkspaceAttachments: () => Promise<string>;
}

export const SettingsPage = ({
  settings,
  onChange,
  onTestConnection,
  onLoadWorkspaceAttachmentSummary,
  onAuditWorkspaceAttachments,
  onPruneWorkspaceAttachments
}: SettingsPageProps) => {
  const [message, setMessage] = useState("");
  const [mppLockInDrafts, setMppLockInDrafts] = useState<string[]>(() =>
    settings.mppLockInSteps.map((step) => step.toString())
  );
  const [attachmentSummary, setAttachmentSummary] = useState<WorkspaceAttachmentAuditResult | null>(null);
  const [attachmentSummaryLoading, setAttachmentSummaryLoading] = useState(false);
  const selectedBackupInterval = backupIntervalOptions.some(
    (option) => option.value === settings.desktopBackupIntervalMinutes
  )
    ? settings.desktopBackupIntervalMinutes
    : 0;

  const formatAttachmentBytes = (value: number): string => {
    if (!Number.isFinite(value) || value <= 0) {
      return "0 B";
    }

    const units = ["B", "KB", "MB", "GB", "TB"];
    let size = value;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex += 1;
    }

    const decimals = size >= 100 || unitIndex === 0 ? 0 : size >= 10 ? 1 : 2;
    return `${size.toFixed(decimals)} ${units[unitIndex]}`;
  };

  const update = (patch: Partial<Settings>) => onChange({ ...settings, ...patch });
  const updateTagVisibility = (field: keyof Settings["tradeTagVisibility"], enabled: boolean) =>
    update({
      tradeTagVisibility: {
        ...settings.tradeTagVisibility,
        [field]: enabled
      }
    });

  const updateMppLockInStep = (index: number, rawValue: string) => {
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setMppLockInDrafts(settings.mppLockInSteps.map((step) => step.toString()));
      return;
    }

    const nextSteps = settings.mppLockInSteps.map((step, stepIndex) =>
      stepIndex === index ? Math.round(parsed) : step
    );
    update({ mppLockInSteps: nextSteps });
  };

  const refreshAttachmentSummary = useCallback(async () => {
    setAttachmentSummaryLoading(true);
    try {
      const nextSummary = await onLoadWorkspaceAttachmentSummary();
      setAttachmentSummary(nextSummary);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Could not load attachment storage details.";
      setMessage(errorMessage);
    } finally {
      setAttachmentSummaryLoading(false);
    }
  }, [onLoadWorkspaceAttachmentSummary]);

  const handleTest = async () => {
    setMessage("Testing Notion connection...");
    setMessage(await onTestConnection());
  };

  const handleAuditWorkspaceAttachments = async () => {
    setMessage("Scanning workspace attachments...");
    setMessage(await onAuditWorkspaceAttachments());
    await refreshAttachmentSummary();
  };

  const handlePruneWorkspaceAttachments = async () => {
    setMessage("Cleaning up unused workspace attachments...");
    setMessage(await onPruneWorkspaceAttachments());
    await refreshAttachmentSummary();
  };

  useEffect(() => {
    setMppLockInDrafts(settings.mppLockInSteps.map((step) => step.toString()));
  }, [settings.mppLockInSteps]);

  useEffect(() => {
    void refreshAttachmentSummary();
  }, [refreshAttachmentSummary]);

  return (
    <main className="page-shell settings-page">
      <PageHero
        eyebrow="Settings"
        title="Workspace Preferences"
        description="Set local workspace preferences, desktop backups, and maintenance tools. File transfers now live on Imports."
      />

      <section className="settings-page-layout" aria-label="Settings form">
        <div className="modal settings-page-card">
          <section className="settings-section">
            <div>
              <h3>Imports and Transfers</h3>
              <p>Use the Imports page for Trade CSV exports plus Send Workspace and Receive Workspace file transfers.</p>
            </div>
          </section>

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
              <h3>MPP Lock-In Cards</h3>
              <p>These values drive the "Replace day with +/-" projection rows in Journal.</p>
            </div>
            <div className="settings-number-grid">
              {DEFAULT_MPP_LOCK_IN_STEPS.map((fallbackStep, index) => (
                <label key={`mpp-lock-in-step-${index}`}>
                  <span>Step {index + 1}</span>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    inputMode="numeric"
                    value={mppLockInDrafts[index] ?? settings.mppLockInSteps[index]?.toString() ?? ""}
                    onChange={(event) =>
                      setMppLockInDrafts((current) => {
                        const next = [...current];
                        next[index] = event.target.value;
                        return next;
                      })
                    }
                    onBlur={(event) => updateMppLockInStep(index, event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter") {
                        return;
                      }

                      event.currentTarget.blur();
                    }}
                    placeholder={fallbackStep.toString()}
                  />
                </label>
              ))}
            </div>
            <small>
              Use positive whole numbers only. The app mirrors them as both `+value` and `-value` in the Journal cards.
            </small>
          </section>

          <label>
            <span>Desktop Backup Frequency</span>
            <select
              value={String(selectedBackupInterval)}
              onChange={(event) =>
                update({ desktopBackupIntervalMinutes: Number(event.target.value) || 0 })
              }
            >
              {backupIntervalOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <small>
              Main data still saves every time. This controls how often extra backup snapshots are created in the
              desktop backup folder.
            </small>
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

          <section className="settings-section">
            <div className="settings-admin-header">
              <div>
                <h3>Attachment Storage</h3>
                <p>See which workspace areas are using disk space and how much unused data is still hanging around.</p>
              </div>
              <Button
                variant="secondary"
                onClick={() => void refreshAttachmentSummary()}
                disabled={attachmentSummaryLoading}
              >
                {attachmentSummaryLoading ? "Refreshing..." : "Refresh Stats"}
              </Button>
            </div>
            {attachmentSummary ? (
              <>
                <div className="data-storage-summary" aria-label="Attachment storage summary">
                  <div>
                    <span>Stored Files</span>
                    <strong>{attachmentSummary.scannedFileCount.toLocaleString()}</strong>
                  </div>
                  <div>
                    <span>Referenced Files</span>
                    <strong>{attachmentSummary.referencedFileCount.toLocaleString()}</strong>
                  </div>
                  <div>
                    <span>Unused Files</span>
                    <strong>{attachmentSummary.orphanedFileCount.toLocaleString()}</strong>
                  </div>
                  <div>
                    <span>Total Size</span>
                    <strong>{formatAttachmentBytes(attachmentSummary.totalBytes)}</strong>
                  </div>
                  <div>
                    <span>Unused Size</span>
                    <strong>{formatAttachmentBytes(attachmentSummary.orphanedBytes)}</strong>
                  </div>
                </div>
                <div className="settings-admin-table-wrap">
                  <table className="settings-admin-table">
                    <thead>
                      <tr>
                        <th>Area</th>
                        <th>Files</th>
                        <th>Used</th>
                        <th>Unused</th>
                        <th>Total Size</th>
                        <th>Unused Size</th>
                      </tr>
                    </thead>
                    <tbody>
                      {attachmentSummary.categories.map((category) => (
                        <tr key={category.key}>
                          <td>{category.label}</td>
                          <td>{category.fileCount.toLocaleString()}</td>
                          <td>{category.referencedFileCount.toLocaleString()}</td>
                          <td>{category.orphanedFileCount.toLocaleString()}</td>
                          <td>{formatAttachmentBytes(category.totalBytes)}</td>
                          <td>{formatAttachmentBytes(category.orphanedBytes)}</td>
                        </tr>
                      ))}
                      {attachmentSummary.categories.length === 0 ? (
                        <tr>
                          <td className="settings-admin-empty" colSpan={6}>
                            No stored attachments found yet.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
                {attachmentSummary.missingReferenceCount > 0 ? (
                  <small>
                    {attachmentSummary.missingReferenceCount.toLocaleString()} referenced attachment path
                    {attachmentSummary.missingReferenceCount === 1 ? " is" : "s are"} already missing on disk.
                  </small>
                ) : null}
              </>
            ) : attachmentSummaryLoading ? (
              <small>Loading attachment storage details...</small>
            ) : (
              <small>Attachment storage details are available in the desktop app.</small>
            )}
          </section>

          <div className="settings-page-actions">
            <Button variant="secondary" onClick={handleTest}>
              Test Notion Connection
            </Button>
            <Button variant="secondary" onClick={handleAuditWorkspaceAttachments}>
              Audit Stored Attachments
            </Button>
            <Button variant="danger" onClick={handlePruneWorkspaceAttachments}>
              Clean Up Unused Attachments
            </Button>
          </div>

          <small>
            Workspace transfer tools and export destinations now live on the Imports page. Attachment cleanup only
            removes files no longer referenced anywhere in the current workspace.
          </small>
          <p className="settings-message">{message}</p>
        </div>
      </section>
    </main>
  );
};
