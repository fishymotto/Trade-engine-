import type { DragEvent } from "react";
import { Button } from "../components/Button";
import { DropZone } from "../components/DropZone";
import { PageHero } from "../components/PageHero";
import { PreviewTable } from "../components/PreviewTable";
import { tradeTagOptionsByField } from "../lib/trades/tradeTagCatalog";
import type { EditableTradeRow } from "../types/tradeTags";
import type { GroupedTrade } from "../types/trade";

interface ImportPageProps {
  fileName: string;
  trades: GroupedTrade[];
  busy: boolean;
  isCurrentImportSaved: boolean;
  onFileDrop: (file: File) => void;
  onSaveToDatabase: () => void;
  onExport: () => Promise<void>;
  onImport: () => Promise<void>;
  onClear: () => void;
  onSettings: () => void;
}

export const ImportPage = ({
  fileName,
  trades,
  busy,
  isCurrentImportSaved,
  onFileDrop,
  onSaveToDatabase,
  onExport,
  onImport,
  onClear,
  onSettings
}: ImportPageProps) => {
  const previewRows: EditableTradeRow[] = trades.map((trade) => ({
    ...trade,
    overrideKey: trade.id,
    manualTags: {}
  }));

  const handleDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files.item(0);
    if (file) {
      onFileDrop(file);
    }
  };

  return (
    <main className="page-shell" onDragOver={(event) => event.preventDefault()} onDrop={handleDrop}>
      <PageHero
        eyebrow="Import"
        title="Bring In PPro8 Trade Detail CSVs"
        description="Load a raw export, review the grouped trades, then choose when to save that session into the local database."
      />
      <DropZone hasFile={Boolean(fileName)} fileName={fileName} onFileDrop={onFileDrop} />
      {trades.length > 0 ? (
        <div className={`import-stage-banner ${isCurrentImportSaved ? "import-stage-banner-saved" : ""}`}>
          {isCurrentImportSaved
            ? "This staged session is already saved in the local database."
            : "This file is staged in the workspace only. Click Save To Database when you're ready."}
        </div>
      ) : null}
      <div className="actions">
        <Button variant="primary" disabled={busy || trades.length === 0 || isCurrentImportSaved} onClick={onSaveToDatabase}>
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
        <Button variant="ghost" disabled={busy} onClick={onSettings}>
          Settings
        </Button>
      </div>
      <PreviewTable
        trades={previewRows}
        tagOptionsByField={tradeTagOptionsByField}
        selectedTradeIds={[]}
        onToggleTradeSelection={() => undefined}
        onToggleSelectAll={() => undefined}
        onUpdateTradeTag={() => undefined}
        onCreateTradeTagOption={() => undefined}
      />
    </main>
  );
};
