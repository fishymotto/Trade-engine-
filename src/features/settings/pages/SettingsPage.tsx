import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "../../../components/Button";
import { PageHero } from "../../../components/PageHero";
import { DEFAULT_MPP_LOCK_IN_STEPS } from "../../../lib/settings/settingsStore";
import { tradeTagFieldLabels, tradeTagFields } from "../../../lib/trades/tradeTagCatalog";
import type {
  TradeTagCleanupMerge,
  TradeTagCleanupReport
} from "../../../lib/trades/tradeTagCleanup";
import type { WorkspaceAttachmentAuditResult } from "../../../lib/workspace/workspaceAttachmentClient";
import type { RiskSessionSetting, Settings } from "../../../types/trade";

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
  tagCleanupReport: TradeTagCleanupReport;
  onMergeExactTagDuplicates: () => string;
  onMergeSimilarTagPair: (merge: TradeTagCleanupMerge) => string;
}

export const SettingsPage = ({
  settings,
  onChange,
  onTestConnection,
  onLoadWorkspaceAttachmentSummary,
  onAuditWorkspaceAttachments,
  onPruneWorkspaceAttachments,
  tagCleanupReport,
  onMergeExactTagDuplicates,
  onMergeSimilarTagPair
}: SettingsPageProps) => {
  const [message, setMessage] = useState("");
  const [mppLockInDrafts, setMppLockInDrafts] = useState<string[]>(() =>
    settings.mppLockInSteps.map((step) => step.toString())
  );
  const [attachmentSummary, setAttachmentSummary] = useState<WorkspaceAttachmentAuditResult | null>(null);
  const [attachmentSummaryLoading, setAttachmentSummaryLoading] = useState(false);
  const [ignoredTagCleanupSuggestionIds, setIgnoredTagCleanupSuggestionIds] = useState<string[]>([]);
  const selectedBackupInterval = backupIntervalOptions.some(
    (option) => option.value === settings.desktopBackupIntervalMinutes
  )
    ? settings.desktopBackupIntervalMinutes
    : 0;
  const visibleTagCleanupSuggestions = useMemo(
    () =>
      tagCleanupReport.suggestions.filter(
        (suggestion) => !ignoredTagCleanupSuggestionIds.includes(suggestion.id)
      ),
    [ignoredTagCleanupSuggestionIds, tagCleanupReport.suggestions]
  );
  const exactTagDuplicateCount = useMemo(
    () =>
      tagCleanupReport.exactGroups.reduce(
        (total, group) => total + Math.max(0, group.variants.length - 1),
        0
      ),
    [tagCleanupReport.exactGroups]
  );

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
  const updateRiskSessions = (riskSessions: RiskSessionSetting[]) => update({ riskSessions });
  const updateRiskSession = (sessionId: string, patch: Partial<RiskSessionSetting>) =>
    updateRiskSessions(
      settings.riskSessions.map((session) =>
        session.id === sessionId ? { ...session, ...patch } : session
      )
    );
  const addRiskSession = () =>
    updateRiskSessions([
      ...settings.riskSessions,
      {
        id: `risk-session-${Date.now().toString(36)}`,
        name: "Close Session",
        startTime: "14:30",
        endTime: "16:00",
        riskAllocationUsd: 12
      }
    ]);
  const removeRiskSession = (sessionId: string) => {
    if (settings.riskSessions.length <= 1) {
      return;
    }

    updateRiskSessions(settings.riskSessions.filter((session) => session.id !== sessionId));
  };

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

  const handleMergeSimilarTagPair = (
    suggestionId: string,
    merge: TradeTagCleanupMerge
  ) => {
    setMessage(onMergeSimilarTagPair(merge));
    setIgnoredTagCleanupSuggestionIds((current) => current.filter((id) => id !== suggestionId));
  };

  useEffect(() => {
    setMppLockInDrafts(settings.mppLockInSteps.map((step) => step.toString()));
  }, [settings.mppLockInSteps]);

  useEffect(() => {
    void refreshAttachmentSummary();
  }, [refreshAttachmentSummary]);

  useEffect(() => {
    setIgnoredTagCleanupSuggestionIds((current) =>
      current.filter((id) => tagCleanupReport.suggestions.some((suggestion) => suggestion.id === id))
    );
  }, [tagCleanupReport.suggestions]);

  return (
    <main className="page-shell settings-page">
      <PageHero
        eyebrow="Settings"
        title="Workspace Preferences"
        icon="settings"
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
            <span>Currency Symbols</span>
            <textarea
              rows={3}
              value={settings.currencySymbolList}
              onChange={(event) => update({ currencySymbolList: event.target.value })}
              placeholder="ETH, ETHUSD"
            />
            <small>Comma, space, or new-line separated. These symbols use Currency MPP and Currency Shutdown Risk.</small>
          </label>

          <label>
            <span>Currency Daily Shutdown Risk (USD)</span>
            <input
              type="number"
              min="0"
              step="1"
              value={settings.currencyDailyShutdownRiskUsd || ""}
              onChange={(event) => update({ currencyDailyShutdownRiskUsd: Number(event.target.value) || 0 })}
              placeholder="Example: 10"
            />
            <small>Used to count ETH/currency breach days separately from stock breach days.</small>
          </label>

          <section className="settings-section">
            <div className="settings-admin-header">
              <div>
                <h3>Risk Sessions</h3>
                <p>These sessions drive the automatic Risk Check scores in weekly and monthly reviews.</p>
              </div>
              <Button variant="secondary" onClick={addRiskSession}>
                Add Risk Session
              </Button>
            </div>
            <div className="settings-risk-session-list">
              {settings.riskSessions.map((session) => (
                <div key={session.id} className="settings-risk-session-card">
                  <label>
                    <span>Session name</span>
                    <input
                      type="text"
                      value={session.name}
                      onChange={(event) => updateRiskSession(session.id, { name: event.target.value })}
                      placeholder="Morning Session"
                    />
                  </label>
                  <label>
                    <span>Start time</span>
                    <input
                      type="time"
                      value={session.startTime}
                      onChange={(event) => updateRiskSession(session.id, { startTime: event.target.value })}
                    />
                  </label>
                  <label>
                    <span>End time</span>
                    <input
                      type="time"
                      value={session.endTime}
                      onChange={(event) => updateRiskSession(session.id, { endTime: event.target.value })}
                    />
                  </label>
                  <label>
                    <span>Risk allocation amount</span>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      inputMode="decimal"
                      value={session.riskAllocationUsd || ""}
                      onChange={(event) =>
                        updateRiskSession(session.id, { riskAllocationUsd: Number(event.target.value) || 0 })
                      }
                      placeholder="18"
                    />
                  </label>
                  <Button
                    variant="danger"
                    onClick={() => removeRiskSession(session.id)}
                    disabled={settings.riskSessions.length <= 1}
                    className="settings-risk-session-remove"
                  >
                    Remove
                  </Button>
                </div>
              ))}
            </div>
            <small>
              Risk Check treats trades opened inside a session as that session's trades and counts the day as followed
              when session net P&L stays above the negative allocation.
            </small>
          </section>

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

          <section className="settings-section tag-cleanup-section">
            <div className="settings-admin-header">
              <div>
                <h3>Tag Cleanup</h3>
                <p>Capitalization matches merge automatically. Review close matches before combining them.</p>
              </div>
              <Button
                variant="secondary"
                onClick={() => setMessage(onMergeExactTagDuplicates())}
                disabled={exactTagDuplicateCount === 0}
              >
                Merge Case Matches
              </Button>
            </div>

            <div className="tag-cleanup-status-grid">
              <div>
                <span>Case Matches</span>
                <strong>{exactTagDuplicateCount}</strong>
              </div>
              <div>
                <span>Close Matches</span>
                <strong>{visibleTagCleanupSuggestions.length}</strong>
              </div>
            </div>

            {tagCleanupReport.exactGroups.length > 0 ? (
              <div className="tag-cleanup-list" aria-label="Capitalization duplicate tags">
                {tagCleanupReport.exactGroups.slice(0, 6).map((group) => (
                  <div key={group.id} className="tag-cleanup-row">
                    <span>{tradeTagFieldLabels[group.field]}</span>
                    <strong>{group.target}</strong>
                    <small>
                      {group.variants.filter((variant) => variant !== group.target).join(", ")}{" "}
                      {"->"} {group.target}
                    </small>
                  </div>
                ))}
              </div>
            ) : (
              <small>No capitalization-only tag duplicates are waiting.</small>
            )}

            {visibleTagCleanupSuggestions.length > 0 ? (
              <div className="tag-cleanup-list" aria-label="Close tag matches">
                {visibleTagCleanupSuggestions.map((suggestion) => (
                  <div key={suggestion.id} className="tag-cleanup-row tag-cleanup-suggestion-row">
                    <span>{tradeTagFieldLabels[suggestion.field]}</span>
                    <div className="tag-cleanup-candidate-grid">
                      <div>
                        <strong>{suggestion.left}</strong>
                        <small>{suggestion.leftCount.toLocaleString()} use{suggestion.leftCount === 1 ? "" : "s"}</small>
                      </div>
                      <div>
                        <strong>{suggestion.right}</strong>
                        <small>{suggestion.rightCount.toLocaleString()} use{suggestion.rightCount === 1 ? "" : "s"}</small>
                      </div>
                    </div>
                    <div className="tag-cleanup-actions">
                      <Button
                        variant="secondary"
                        title={`Merge "${suggestion.right}" into "${suggestion.left}"`}
                        onClick={() =>
                          handleMergeSimilarTagPair(suggestion.id, {
                            field: suggestion.field,
                            source: suggestion.right,
                            target: suggestion.left
                          })
                        }
                      >
                        Use Left
                      </Button>
                      <Button
                        variant="secondary"
                        title={`Merge "${suggestion.left}" into "${suggestion.right}"`}
                        onClick={() =>
                          handleMergeSimilarTagPair(suggestion.id, {
                            field: suggestion.field,
                            source: suggestion.left,
                            target: suggestion.right
                          })
                        }
                      >
                        Use Right
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() =>
                          setIgnoredTagCleanupSuggestionIds((current) => [...current, suggestion.id])
                        }
                      >
                        Skip
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <small>No close-match tag pairs are waiting for review.</small>
            )}
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
