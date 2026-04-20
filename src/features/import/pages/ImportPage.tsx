import type { DragEvent } from "react";
import { useState } from "react";
import { Button } from "../../../components/Button";
import { DropZone } from "../../../components/DropZone";
import { PageHero } from "../../../components/PageHero";
import { PreviewTable } from "../../../components/PreviewTable";
import type { EditableTradeRow, EditableTradeTagField } from "../../../types/tradeTags";

interface ImportPageProps {
  fileName: string;
  trades: EditableTradeRow[];
  busy: boolean;
  isCurrentImportSaved: boolean;
  onFileDrop: (file: File) => void;
  onSaveToDatabase: () => void;
  onExport: () => Promise<void>;
  onImport: () => Promise<void>;
  onClear: () => void;
  tagOptionsByField: Record<EditableTradeTagField, string[]>;
  onUpdateTradeTag: (trade: EditableTradeRow, field: EditableTradeTagField, value: string | string[] | null) => void;
  onCreateTradeTagOption: (field: EditableTradeTagField, rawValue: string) => void;
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
  tagOptionsByField,
  onUpdateTradeTag,
  onCreateTradeTagOption
}: ImportPageProps) => {
  const [selectedTradeIds, setSelectedTradeIds] = useState<string[]>([]);

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
      </div>
      <PreviewTable
        trades={trades}
        tagOptionsByField={tagOptionsByField}
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
      />
    </main>
  );
};
