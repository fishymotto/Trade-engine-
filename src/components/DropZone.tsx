import { useRef, type ChangeEvent, type DragEvent } from "react";
import { Button } from "./Button";

interface DropZoneProps {
  hasFile: boolean;
  fileName: string;
  onFileDrop: (file: File) => void;
}

export const DropZone = ({ hasFile, fileName, onFileDrop }: DropZoneProps) => {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files.item(0);
    if (file) {
      onFileDrop(file);
    }
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.item(0);
    if (file) {
      onFileDrop(file);
    }

    event.target.value = "";
  };

  return (
    <div
      className={`drop-zone ${hasFile ? "drop-zone-active" : ""}`}
      onDragOver={(event) => event.preventDefault()}
      onDrop={handleDrop}
    >
      <div className="drop-zone-copy">
        <h1>Trade Engine</h1>
        <p>Drop one PPro8 Trade Detail CSV anywhere in this panel.</p>
        <input
          ref={inputRef}
          className="drop-zone-input"
          type="file"
          accept=".csv,text/csv"
          onChange={handleFileChange}
        />
        <Button variant="secondary" type="button" onClick={() => inputRef.current?.click()}>
          Choose CSV File
        </Button>
        <span>{hasFile ? fileName : "No file loaded"}</span>
      </div>
    </div>
  );
};
