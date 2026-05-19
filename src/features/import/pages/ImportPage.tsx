import type { DragEvent } from "react";
import { useState } from "react";
import { Button } from "../../../components/Button";
import { DropZone } from "../../../components/DropZone";
import { PageHero } from "../../../components/PageHero";
import { PreviewTable, type PreviewSortKey } from "../../../components/PreviewTable";
import { WorkspaceTransferExportPanel } from "../components/WorkspaceTransferExportPanel";
import type { Settings } from "../../../types/trade";
import type { EditableTradeRow, EditableTradeTagField } from "../../../types/tradeTags";

const importPreviewColumnOrder: PreviewSortKey[] = [
  "name",
  "symbol",
  "side",
  "openTime",
  "closeTime",
  "holdTime",
  "size",
  "entryPrice",
  "exitPrice",
  "netPnlUsd",
  "returnPerShare",
  "status",
  "mistake",
  "playbook",
  "catalyst",
  "game",
  "outTag",
  "execution",
  "tradeDate"
];

interface ImportPageProps {
  fileName: string;
  trades: EditableTradeRow[];
  busy: boolean;
  isCurrentImportSaved: boolean;
  settings: Settings;
  savedTradeDates: string[];
  onFileDrop: (file: File) => void;
  onSettingsChange: (settings: Settings) => void;
  onBrowseExportFolder: () => Promise<void>;
  onSaveToDatabase: () => void;
  onExport: () => Promise<void>;
  onImport: () => Promise<void>;
  onExportWorkspaceBundle: () => Promise<string>;
  onImportWorkspaceBundle: () => Promise<string>;
  onClear: () => void;
  tagOptionsByField: Record<EditableTradeTagField, string[]>;
  onUpdateTradeTag: (trade: EditableTradeRow, field: EditableTradeTagField, value: string | string[] | null) => void;
  onCreateTradeTagOption: (field: EditableTradeTagField, rawValue: string) => void;
  onRenameTradeTagOption: (field: EditableTradeTagField, currentValue: string, nextValue: string) => void;
  onDeleteTradeTagOption: (field: EditableTradeTagField, value: string) => void;
}

type ImportPageTab = "trade-csv" | "send-workspace" | "receive-workspace";
type ImportResultTone = "info" | "success" | "warning" | "danger";

const workspaceSyncTimestampFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short"
});

const formatWorkspaceSyncTimestamp = (value: string): string => {
  if (!value.trim()) {
    return "";
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : workspaceSyncTimestampFormatter.format(parsed);
};

const classifyWorkspaceTransferResult = (message: string): ImportResultTone => {
  const normalized = message.toLowerCase();

  if (
    normalized.includes("failed") ||
    normalized.includes("could not") ||
    normalized.includes("must be") ||
    normalized.includes("choose an export destination")
  ) {
    return "danger";
  }

  if (normalized.includes("canceled") || normalized.includes("no workspace file selected")) {
    return "warning";
  }

  if (normalized.includes("imported") || normalized.includes("merged")) {
    return "success";
  }

  return "info";
};

export const ImportPage = ({
  fileName,
  trades,
  busy,
  isCurrentImportSaved,
  settings,
  savedTradeDates,
  onFileDrop,
  onSettingsChange,
  onBrowseExportFolder,
  onSaveToDatabase,
  onExport,
  onImport,
  onExportWorkspaceBundle,
  onImportWorkspaceBundle,
  onClear,
  tagOptionsByField,
  onUpdateTradeTag,
  onCreateTradeTagOption,
  onRenameTradeTagOption,
  onDeleteTradeTagOption
}: ImportPageProps) => {
  const [selectedTradeIds, setSelectedTradeIds] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<ImportPageTab>("trade-csv");
  const [receiveWorkspaceResult, setReceiveWorkspaceResult] = useState<{
    tone: ImportResultTone;
    message: string;
  } | null>(null);
  const isTradeCsvTab = activeTab === "trade-csv";
  const isSendWorkspaceTab = activeTab === "send-workspace";
  const lastExportedLabel = formatWorkspaceSyncTimestamp(settings.workspaceTransferLastExportedAt);
  const lastImportedLabel = formatWorkspaceSyncTimestamp(settings.workspaceTransferLastImportedAt);
  const importHeroTitle =
    activeTab === "trade-csv"
      ? "Bring In Trade Detail CSVs"
      : activeTab === "send-workspace"
        ? "Create Workspace Sync Files"
        : "Receive Workspace Sync Files";

  const handleDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    if (!isTradeCsvTab) {
      return;
    }

    const file = event.dataTransfer.files.item(0);
    if (file) {
      onFileDrop(file);
    }
  };

  const handleReceiveWorkspaceImport = async () => {
    setReceiveWorkspaceResult({
      tone: "info",
      message: "Importing transfer file..."
    });
    const resultMessage = await onImportWorkspaceBundle();
    setReceiveWorkspaceResult({
      tone: classifyWorkspaceTransferResult(resultMessage),
      message: resultMessage
    });
  };

  return (
    <main
      className="page-shell"
      onDragOver={isTradeCsvTab ? (event) => event.preventDefault() : undefined}
      onDrop={isTradeCsvTab ? handleDrop : undefined}
    >
      <PageHero
        eyebrow="Imports"
        title={importHeroTitle}
        icon="import"
      />
      <div className="import-page-tabs" role="tablist" aria-label="Import types">
        <button
          type="button"
          className={`import-page-tab${isTradeCsvTab ? " import-page-tab-active" : ""}`}
          onClick={() => setActiveTab("trade-csv")}
          aria-pressed={isTradeCsvTab}
        >
          <strong>Trade Detail CSV</strong>
          <span>Stage raw PPro8 trade exports before saving them into the workspace.</span>
        </button>
        <button
          type="button"
          className={`import-page-tab${isSendWorkspaceTab ? " import-page-tab-active" : ""}`}
          onClick={() => setActiveTab("send-workspace")}
          aria-pressed={isSendWorkspaceTab}
        >
          <strong>Send Workspace</strong>
          <span>Create a sync file for the other computer.</span>
        </button>
        <button
          type="button"
          className={`import-page-tab${
            activeTab === "receive-workspace" ? " import-page-tab-active" : ""
          }`}
          onClick={() => setActiveTab("receive-workspace")}
          aria-pressed={activeTab === "receive-workspace"}
        >
          <strong>Receive Workspace</strong>
          <span>Apply a sync file from another computer.</span>
        </button>
      </div>
      {isTradeCsvTab ? (
        <>
          <DropZone hasFile={Boolean(fileName)} fileName={fileName} onFileDrop={onFileDrop} />
          {trades.length > 0 ? (
            <div className={`import-stage-banner ${isCurrentImportSaved ? "import-stage-banner-saved" : ""}`}>
              {isCurrentImportSaved
                ? "This staged session is already saved in the local database."
                : "This file is staged in the workspace only. Click Save To Database when you're ready."}
            </div>
          ) : null}
          <div className="actions">
            <Button
              variant="primary"
              disabled={busy || trades.length === 0 || isCurrentImportSaved}
              onClick={onSaveToDatabase}
            >
              Save To Database
            </Button>
            <Button variant="secondary" disabled={busy || trades.length === 0} onClick={onExport}>
              Export CSV
            </Button>
            <Button variant="secondary" disabled={busy || trades.length === 0} onClick={onImport}>
              Import to Notion
            </Button>
            <Button variant="ghost" disabled={busy} onClick={onClear}>
              Clear File
            </Button>
          </div>
          <div className="import-stage-note">
            CSV exports save to{" "}
            {settings.exportFolder.trim() ? (
              <strong title={settings.exportFolder}>{settings.exportFolder}</strong>
            ) : (
              <strong>the export destination set in Send Workspace</strong>
            )}
            .
          </div>
          <PreviewTable
            trades={trades}
            tagOptionsByField={tagOptionsByField}
            visibleColumnKeys={importPreviewColumnOrder}
            pinLeadingColumns
            maxTableHeight="clamp(360px, calc(100vh - 340px), 760px)"
            selectedTradeIds={selectedTradeIds}
            onToggleTradeSelection={(tradeId) =>
              setSelectedTradeIds((current) =>
                current.includes(tradeId) ? current.filter((id) => id !== tradeId) : [...current, tradeId]
              )
            }
            onToggleSelectAll={(tradeIds) =>
              setSelectedTradeIds((current) =>
                tradeIds.every((tradeId) => current.includes(tradeId))
                  ? current.filter((tradeId) => !tradeIds.includes(tradeId))
                  : Array.from(new Set([...current, ...tradeIds]))
              )
            }
            onUpdateTradeTag={onUpdateTradeTag}
            onCreateTradeTagOption={onCreateTradeTagOption}
            onRenameTradeTagOption={onRenameTradeTagOption}
            onDeleteTradeTagOption={onDeleteTradeTagOption}
          />
        </>
      ) : isSendWorkspaceTab ? (
        <WorkspaceTransferExportPanel
          settings={settings}
          savedTradeDates={savedTradeDates}
          onChange={onSettingsChange}
          onBrowse={onBrowseExportFolder}
          onExportWorkspaceBundle={onExportWorkspaceBundle}
        />
      ) : (
        <section className="placeholder-panel import-workspace-panel">
          <div className="import-workspace-panel-copy">
            <h2>Receive Sync File</h2>
            <p className="import-workspace-lead">
              Apply a workspace sync file exported from the other computer.
            </p>
            <span className="import-workspace-note">
              This is the receive side of the manual sync. Import here after creating the file from Send Workspace on the source machine.
            </span>
          </div>
          <div className="import-workspace-summary">
            <div className="import-workspace-summary-card">
              <span>Date-Filtered Files</span>
              <strong>Merge only the included dates</strong>
              <small>Best for missing sessions plus shared tags, templates, and workspace definitions.</small>
            </div>
            <div className="import-workspace-summary-card">
              <span>Full Files</span>
              <strong>Replace imported workspace data</strong>
              <small>Useful when you want this machine to match the source workspace more completely.</small>
            </div>
            <div className="import-workspace-summary-card">
              <span>This Machine Keeps</span>
              <strong>Saved API keys</strong>
              <small>Notion and Twelve Data keys stay local even after a workspace file import.</small>
            </div>
            <div className="import-workspace-summary-card">
              <span>Last Received</span>
              <strong>{lastImportedLabel || "Not yet"}</strong>
              <small>
                {lastExportedLabel
                  ? `This machine last sent updates on ${lastExportedLabel}.`
                  : "This machine has not sent a sync file yet."}
              </small>
            </div>
          </div>
          <div className="import-workspace-actions">
            <Button variant="primary" onClick={() => void handleReceiveWorkspaceImport()}>
              Import Sync File
            </Button>
          </div>
          {receiveWorkspaceResult ? (
            <div className={`import-result-banner import-result-banner-${receiveWorkspaceResult.tone}`}>
              {receiveWorkspaceResult.message}
            </div>
          ) : null}
          <span className="import-workspace-footnote">
            Use Send Workspace on the source computer to build the file first.
          </span>
        </section>
      )}
    </main>
  );
};
