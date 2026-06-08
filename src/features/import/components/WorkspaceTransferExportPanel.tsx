import { useState } from "react";
import { Button } from "../../../components/Button";
import type { Settings } from "../../../types/trade";

const workspaceDateMonthFormatter = new Intl.DateTimeFormat(undefined, {
  month: "long",
  year: "numeric",
  timeZone: "UTC"
});
const workspaceSyncTimestampFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short"
});

const formatWorkspaceDateMonth = (value: string): string => {
  const [yearText, monthText] = value.split("-");
  const year = Number(yearText);
  const month = Number(monthText);

  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return value;
  }

  return workspaceDateMonthFormatter.format(new Date(Date.UTC(year, month - 1, 1)));
};

const formatWorkspaceSyncTimestamp = (value: string): string => {
  if (!value.trim()) {
    return "";
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : workspaceSyncTimestampFormatter.format(parsed);
};

const toLocalDateInputValue = (value: string): string => {
  if (!value.trim()) {
    return "";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

interface WorkspaceTransferExportPanelProps {
  settings: Settings;
  workspaceTransferDates: string[];
  onChange: (settings: Settings) => void;
  onBrowse: () => Promise<void>;
  onExportWorkspaceBundle: () => Promise<string>;
}

export const WorkspaceTransferExportPanel = ({
  settings,
  workspaceTransferDates,
  onChange,
  onBrowse,
  onExportWorkspaceBundle
}: WorkspaceTransferExportPanelProps) => {
  const update = (patch: Partial<Settings>) => onChange({ ...settings, ...patch });
  const availableWorkspaceTransferDates = Array.from(
    new Set(
      workspaceTransferDates.filter((value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim()))
    )
  ).sort();
  const displayWorkspaceTransferDates = [...availableWorkspaceTransferDates].reverse();
  const workspaceExactDateMonthCounts = displayWorkspaceTransferDates.reduce<Record<string, number>>((counts, tradeDate) => {
    const monthKey = tradeDate.slice(0, 7);
    counts[monthKey] = (counts[monthKey] ?? 0) + 1;
    return counts;
  }, {});
  const workspaceExactDateMonthOptions = Object.entries(workspaceExactDateMonthCounts).map(([value, count]) => ({
    value,
    count,
    label: formatWorkspaceDateMonth(value)
  }));
  const selectedWorkspaceExportDates = Array.from(
    new Set(
      settings.workspaceExportSelectedDates.filter(
        (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())
      )
    )
  ).sort();
  const displaySelectedWorkspaceExportDates = [...selectedWorkspaceExportDates].reverse();
  const lastExportedLabel = formatWorkspaceSyncTimestamp(settings.workspaceTransferLastExportedAt);
  const lastImportedLabel = formatWorkspaceSyncTimestamp(settings.workspaceTransferLastImportedAt);
  const lastSyncStartDate = toLocalDateInputValue(settings.workspaceTransferLastExportedAt);
  const [workspaceTransferSelectionMode, setWorkspaceTransferSelectionMode] = useState<"window" | "specific">(() =>
    selectedWorkspaceExportDates.length > 0 ? "specific" : "window"
  );
  const [workspaceExactDateMonth, setWorkspaceExactDateMonth] = useState<string>(
    () => workspaceExactDateMonthOptions[0]?.value ?? "all"
  );
  const firstWorkspaceTransferDate = availableWorkspaceTransferDates[0] ?? "";
  const lastWorkspaceTransferDate =
    availableWorkspaceTransferDates.length > 0
      ? availableWorkspaceTransferDates[availableWorkspaceTransferDates.length - 1]
      : "";
  const activeWorkspaceExactDateMonth =
    workspaceExactDateMonth === "all" ||
    workspaceExactDateMonthOptions.some((option) => option.value === workspaceExactDateMonth)
      ? workspaceExactDateMonth
      : "all";
  const filteredDisplayWorkspaceTransferDates =
    activeWorkspaceExactDateMonth === "all"
      ? displayWorkspaceTransferDates
      : displayWorkspaceTransferDates.filter((tradeDate) => tradeDate.startsWith(activeWorkspaceExactDateMonth));
  const windowIncludedWorkspaceTransferDates = availableWorkspaceTransferDates.filter((tradeDate) => {
    if (settings.workspaceExportStartDate && tradeDate < settings.workspaceExportStartDate) {
      return false;
    }

    if (settings.workspaceExportEndDate && tradeDate > settings.workspaceExportEndDate) {
      return false;
    }

    return true;
  });
  const selectedDateSummary =
    selectedWorkspaceExportDates.length === 0
      ? ""
      : selectedWorkspaceExportDates.length === 1
        ? selectedWorkspaceExportDates[0]
        : selectedWorkspaceExportDates.length <= 3
          ? selectedWorkspaceExportDates.join(", ")
          : `${selectedWorkspaceExportDates.length} selected days`;
  const hasSpecificDayScope = selectedWorkspaceExportDates.length > 0;
  const hasDateWindowScope = Boolean(settings.workspaceExportStartDate || settings.workspaceExportEndDate);
  const transferPreview = hasSpecificDayScope
    ? {
        scopeLabel: "Specific Days",
        includedDayCount: selectedWorkspaceExportDates.length,
        coverageLabel: selectedDateSummary,
        detailLabel:
          "Only the checked dates will be included, along with their saved sessions, journal notes, Strong Views, headlines, library pages, and shared tags/templates."
      }
    : hasDateWindowScope
      ? {
          scopeLabel: "Date Window",
          includedDayCount: windowIncludedWorkspaceTransferDates.length,
          coverageLabel: `${settings.workspaceExportStartDate || "Beginning"} -> ${settings.workspaceExportEndDate || "Latest"}`,
          detailLabel:
            windowIncludedWorkspaceTransferDates.length > 0
              ? "Workspace dates inside the current window will be included, plus saved sessions, journal notes, Strong Views, headlines, library pages, and shared workspace definitions."
              : "No workspace dates currently fall inside the chosen window, but journal notes, Strong Views, headlines, library pages, and shared workspace definitions can still sync."
        }
      : {
          scopeLabel: "Full Workspace",
          includedDayCount: availableWorkspaceTransferDates.length,
          coverageLabel:
            availableWorkspaceTransferDates.length > 0
              ? `All ${availableWorkspaceTransferDates.length.toLocaleString()} workspace day${availableWorkspaceTransferDates.length === 1 ? "" : "s"}`
              : "All workspace data",
          detailLabel: "No date filter is active, so the sync file will include the full workspace snapshot."
        };
  const workspaceTransferModeSummary =
    selectedWorkspaceExportDates.length > 0
      ? `Current file scope: merge-ready records for ${selectedDateSummary}.`
      : settings.workspaceExportStartDate && settings.workspaceExportEndDate
        ? `Current file scope: merge-ready dated records from ${settings.workspaceExportStartDate} through ${settings.workspaceExportEndDate}.`
        : settings.workspaceExportStartDate
          ? `Current file scope: merge-ready dated records from ${settings.workspaceExportStartDate} forward.`
          : settings.workspaceExportEndDate
            ? `Current file scope: merge-ready dated records through ${settings.workspaceExportEndDate}.`
            : "Current file scope: full workspace file with all dated records on this computer.";
  const specificDateSelectionHelp =
    selectedWorkspaceExportDates.length > 0
      ? "Selected days override any window and include only the dates you keep checked here."
      : settings.workspaceExportStartDate || settings.workspaceExportEndDate
        ? "Your current date window stays active until you pick at least one specific day."
        : "Pick one or more missing dates. With nothing selected, the file stays a full workspace export.";
  const syncHistoryLabel =
    lastExportedLabel || lastImportedLabel
      ? `Manual sync history: last sent ${lastExportedLabel || "not yet"}; last received ${lastImportedLabel || "not yet"}.`
      : "Manual sync history starts after your first Send Workspace or Receive Workspace run on this machine.";

  const toggleWorkspaceExportDate = (tradeDate: string) => {
    const nextSelectedDates = selectedWorkspaceExportDates.includes(tradeDate)
      ? selectedWorkspaceExportDates.filter((value) => value !== tradeDate)
      : [...selectedWorkspaceExportDates, tradeDate].sort();

    setWorkspaceTransferSelectionMode("specific");
    update({
      workspaceExportStartDate: "",
      workspaceExportEndDate: "",
      workspaceExportSelectedDates: nextSelectedDates
    });
  };

  return (
    <section className="placeholder-panel import-workspace-panel">
      <div className="import-workspace-panel-copy">
        <h2>Create Sync File</h2>
        <p className="import-workspace-lead">Build a manual sync file to move recent workspace updates to the other computer.</p>
        <span className="import-workspace-note">
          This is the send side of the manual sync. Export here, then import that file on the other computer.
        </span>
      </div>

      <label className="import-workspace-field">
        <span>Export Destination</span>
        <div className="inline-field">
          <input
            type="text"
            value={settings.exportFolder}
            onChange={(event) => update({ exportFolder: event.target.value })}
            placeholder="C:\\Users\\Owner\\Documents\\Trade Engine\\exports"
          />
          <Button type="button" variant="secondary" onClick={() => void onBrowse()}>
            Browse
          </Button>
        </div>
        <small>Used for both Trade CSV exports and workspace transfer files.</small>
      </label>
      <small className="import-workspace-inline-note">{syncHistoryLabel}</small>

      {availableWorkspaceTransferDates.length > 0 ? (
        <div className="settings-transfer-summary" aria-label="Workspace transfer date summary">
          <div>
            <span>Workspace Days</span>
            <strong>{availableWorkspaceTransferDates.length.toLocaleString()}</strong>
          </div>
          <div>
            <span>Earliest</span>
            <strong>{firstWorkspaceTransferDate}</strong>
          </div>
          <div>
            <span>Latest</span>
            <strong>{lastWorkspaceTransferDate}</strong>
          </div>
          <div>
            <span>Picked Days</span>
            <strong>{selectedWorkspaceExportDates.length.toLocaleString()}</strong>
          </div>
        </div>
      ) : (
        <small className="import-workspace-inline-note">
          No workspace dates yet. A full workspace file still includes playbooks, Strong Views, library pages,
          journal entries, and other synced workspace data.
        </small>
      )}

      <div className="import-workspace-summary">
        <div className="import-workspace-summary-card">
          <span>Transfer Scope</span>
          <strong>{transferPreview.scopeLabel}</strong>
          <small>{transferPreview.detailLabel}</small>
        </div>
        <div className="import-workspace-summary-card">
          <span>Included Workspace Days</span>
          <strong>{transferPreview.includedDayCount.toLocaleString()}</strong>
          <small>{transferPreview.coverageLabel}</small>
        </div>
        <div className="import-workspace-summary-card">
          <span>Destination</span>
          <strong title={settings.exportFolder || "Not set"}>
            {settings.exportFolder.trim() || "Not Set Yet"}
          </strong>
          <small>
            {settings.exportFolder.trim()
              ? "Trade CSV exports use this same destination."
              : "Pick a destination before creating the transfer file."}
          </small>
        </div>
      </div>

      {availableWorkspaceTransferDates.length > 0 ? (
        <div className="settings-transfer-mode-grid" aria-label="Transfer file scope mode">
          <button
            type="button"
            className={`settings-transfer-mode-button${
              workspaceTransferSelectionMode === "window" ? " settings-transfer-mode-button-active" : ""
            }`}
            onClick={() => setWorkspaceTransferSelectionMode("window")}
            aria-pressed={workspaceTransferSelectionMode === "window"}
          >
            <strong>Date Window</strong>
            <span>Use a clean start and end range for one uninterrupted block of missing dates.</span>
          </button>
          <button
            type="button"
            className={`settings-transfer-mode-button${
              workspaceTransferSelectionMode === "specific" ? " settings-transfer-mode-button-active" : ""
            }`}
            onClick={() => setWorkspaceTransferSelectionMode("specific")}
            aria-pressed={workspaceTransferSelectionMode === "specific"}
          >
            <strong>Specific Days</strong>
            <span>Choose scattered missing dates without creating one oversized date window.</span>
          </button>
        </div>
      ) : null}

      {workspaceTransferSelectionMode === "window" || availableWorkspaceTransferDates.length === 0 ? (
        <div className="settings-transfer-mode-panel">
          <div className="settings-transfer-panel-header">
            <div className="settings-transfer-panel-copy">
              <strong>Date Window</strong>
              <span>Best when the other computer is missing one continuous block of workspace dates.</span>
            </div>
            {availableWorkspaceTransferDates.length > 0 ? (
              <div className="settings-transfer-actions">
                {lastSyncStartDate ? (
                  <Button
                    type="button"
                    variant="secondary"
                    className="settings-transfer-quick-action"
                    onClick={() => {
                      setWorkspaceTransferSelectionMode("window");
                      update({
                        workspaceExportStartDate: lastSyncStartDate,
                        workspaceExportEndDate: "",
                        workspaceExportSelectedDates: []
                      });
                    }}
                  >
                    Sync Since Last Send
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant={lastSyncStartDate ? "ghost" : "secondary"}
                  className="settings-transfer-quick-action"
                  onClick={() => {
                    setWorkspaceTransferSelectionMode("window");
                    update({
                      workspaceExportStartDate: firstWorkspaceTransferDate,
                      workspaceExportEndDate: lastWorkspaceTransferDate,
                      workspaceExportSelectedDates: []
                    });
                  }}
                >
                  Use All Workspace Days
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="settings-transfer-quick-action"
                  onClick={() => {
                    setWorkspaceTransferSelectionMode("window");
                    update({
                      workspaceExportStartDate: firstWorkspaceTransferDate,
                      workspaceExportSelectedDates: []
                    });
                  }}
                >
                  Start = Earliest
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="settings-transfer-quick-action"
                  onClick={() => {
                    setWorkspaceTransferSelectionMode("window");
                    update({
                      workspaceExportEndDate: lastWorkspaceTransferDate,
                      workspaceExportSelectedDates: []
                    });
                  }}
                >
                  End = Latest
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="settings-transfer-quick-action"
                  onClick={() => {
                    setWorkspaceTransferSelectionMode("window");
                    update({
                      workspaceExportStartDate: "",
                      workspaceExportEndDate: "",
                      workspaceExportSelectedDates: []
                    });
                  }}
                >
                  Clear Window
                </Button>
              </div>
            ) : null}
          </div>
          <div className="settings-transfer-date-grid">
            <label className="import-workspace-field">
              <span>Start Date</span>
              <input
                type="date"
                value={settings.workspaceExportStartDate}
                onChange={(event) => {
                  setWorkspaceTransferSelectionMode("window");
                  update({
                    workspaceExportStartDate: event.target.value,
                    workspaceExportSelectedDates: []
                  });
                }}
              />
            </label>
            <label className="import-workspace-field">
              <span>End Date</span>
              <input
                type="date"
                value={settings.workspaceExportEndDate}
                onChange={(event) => {
                  setWorkspaceTransferSelectionMode("window");
                  update({
                    workspaceExportEndDate: event.target.value,
                    workspaceExportSelectedDates: []
                  });
                }}
              />
            </label>
          </div>
          <small className="import-workspace-inline-note">
            Leave one side blank to export everything before or after that boundary.
          </small>
        </div>
      ) : null}

      {availableWorkspaceTransferDates.length > 0 && workspaceTransferSelectionMode === "specific" ? (
        <div className="settings-transfer-mode-panel">
          <div className="settings-transfer-panel-header">
            <div className="settings-transfer-panel-copy">
              <strong>Specific Days</strong>
              <span>Best when you only need to patch scattered dates on the other computer.</span>
            </div>
            <div className="settings-transfer-date-selector-controls">
              {workspaceExactDateMonthOptions.length > 1 ? (
                <label className="settings-transfer-month-filter import-workspace-field">
                  <span>Show Month</span>
                  <select
                    value={activeWorkspaceExactDateMonth}
                    onChange={(event) => setWorkspaceExactDateMonth(event.target.value)}
                  >
                    <option value="all">All Workspace Days</option>
                    {workspaceExactDateMonthOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label} ({option.count})
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                className="settings-transfer-quick-action"
                onClick={() =>
                  update({
                    workspaceExportSelectedDates: [],
                    workspaceExportStartDate: "",
                    workspaceExportEndDate: ""
                  })
                }
              >
                Clear Picks
              </Button>
            </div>
          </div>
          <div className="settings-transfer-selected-card">
            <div className="settings-transfer-selected-header">
              <span>Selected Days</span>
              <strong>{selectedWorkspaceExportDates.length.toLocaleString()}</strong>
            </div>
            {displaySelectedWorkspaceExportDates.length > 0 ? (
              <div className="settings-transfer-selected-list">
                {displaySelectedWorkspaceExportDates.map((tradeDate) => (
                  <button
                    key={`selected-${tradeDate}`}
                    type="button"
                    className="settings-transfer-date-chip settings-transfer-date-chip-active settings-transfer-selected-chip"
                    onClick={() => toggleWorkspaceExportDate(tradeDate)}
                  >
                    {tradeDate}
                  </button>
                ))}
              </div>
            ) : null}
            <p className="settings-transfer-selected-help">{specificDateSelectionHelp}</p>
          </div>
          <div className="settings-transfer-date-chip-grid">
            {filteredDisplayWorkspaceTransferDates.map((tradeDate) => {
              const selected = selectedWorkspaceExportDates.includes(tradeDate);

              return (
                <button
                  key={tradeDate}
                  type="button"
                  className={`settings-transfer-date-chip${selected ? " settings-transfer-date-chip-active" : ""}`}
                  onClick={() => toggleWorkspaceExportDate(tradeDate)}
                >
                  {tradeDate}
                </button>
              );
            })}
          </div>
          {activeWorkspaceExactDateMonth !== "all" && filteredDisplayWorkspaceTransferDates.length > 0 ? (
            <small className="import-workspace-inline-note">
              Showing {filteredDisplayWorkspaceTransferDates.length.toLocaleString()} workspace day
              {filteredDisplayWorkspaceTransferDates.length === 1 ? "" : "s"} from{" "}
              {formatWorkspaceDateMonth(activeWorkspaceExactDateMonth)}.
            </small>
          ) : null}
        </div>
      ) : null}

      <div className="import-workspace-actions">
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setWorkspaceTransferSelectionMode("window");
            update({
              workspaceExportStartDate: "",
              workspaceExportEndDate: "",
              workspaceExportSelectedDates: []
            });
          }}
        >
          Use Full Workspace
        </Button>
        <Button type="button" variant="primary" onClick={() => void onExportWorkspaceBundle()}>
          Create Sync File
        </Button>
      </div>

      <small className="import-workspace-inline-note">
        Leave everything blank for a full workspace file. Use a date window for one continuous block, or specific
        days for non-consecutive dates. Editing one mode automatically clears the other.
      </small>
      <small className="import-workspace-inline-note">{workspaceTransferModeSummary}</small>
    </section>
  );
};
