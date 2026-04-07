import { useMemo, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { journalBlockTypeIcons } from "../lib/ui/workspaceIcons";
import type { JournalBlock, JournalBlockType } from "../types/journal";
import { WorkspaceIcon } from "./WorkspaceIcon";

const blockTypeLabels: Record<JournalBlockType, string> = {
  paragraph: "Text",
  heading1: "Heading 1",
  heading2: "Heading 2",
  heading3: "Heading 3",
  bullet: "Bullet",
  checklist: "Checklist",
  quote: "Quote",
  callout: "Callout",
  divider: "Divider"
};

const blockTypeOptions = Object.entries(blockTypeLabels) as Array<[JournalBlockType, string]>;

interface JournalBlockEditorProps {
  blocks: JournalBlock[];
  onUpdateBlock: (blockId: string, updates: Partial<JournalBlock>) => void;
  onAddBlock: (afterBlockId?: string, type?: JournalBlockType) => void;
  onMoveBlock: (blockId: string, direction: "up" | "down") => void;
  onDuplicateBlock: (blockId: string) => void;
  onRemoveBlock: (blockId: string) => void;
  hideInlineAddControls?: boolean;
  hideFooterAddControls?: boolean;
  compact?: boolean;
}

export const JournalBlockEditor = ({
  blocks,
  onUpdateBlock,
  onAddBlock,
  onMoveBlock,
  onDuplicateBlock,
  onRemoveBlock,
  hideInlineAddControls = false,
  hideFooterAddControls = false,
  compact = false
}: JournalBlockEditorProps) => {
  const [commandBlockId, setCommandBlockId] = useState<string | null>(null);
  const [commandQuery, setCommandQuery] = useState("");

  const handleTypeChange = (blockId: string, event: ChangeEvent<HTMLSelectElement>) => {
    const type = event.target.value as JournalBlockType;
    onUpdateBlock(blockId, {
      type,
      checked: type === "checklist" ? false : undefined
    });
  };

  const commandMatches = useMemo(() => {
    const normalized = commandQuery.trim().toLowerCase();
    return blockTypeOptions.filter(([, label]) => label.toLowerCase().includes(normalized));
  }, [commandQuery]);

  const handleTextChange = (blockId: string, value: string) => {
    onUpdateBlock(blockId, { text: value });

    if (value.startsWith("/")) {
      setCommandBlockId(blockId);
      setCommandQuery(value.slice(1));
      return;
    }

    if (commandBlockId === blockId) {
      setCommandBlockId(null);
      setCommandQuery("");
    }
  };

  const applyCommand = (blockId: string, type: JournalBlockType) => {
    onUpdateBlock(blockId, {
      type,
      text: type === "divider" ? "" : "",
      checked: type === "checklist" ? false : undefined
    });
    setCommandBlockId(null);
    setCommandQuery("");
  };

  const handleChecklistKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>, blockId: string) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      onAddBlock(blockId, "checklist");
    }
  };

  return (
    <div className={`block-editor ${compact ? "block-editor-compact" : ""}`}>
      {blocks.map((block, index) => (
        <div
          key={block.id}
          className={`journal-block journal-block-${block.type} ${block.checked ? "journal-block-checked" : ""} ${
            compact ? "journal-block-compact" : ""
          }`}
        >
          <div className={`journal-block-controls ${compact ? "journal-block-controls-compact" : ""}`}>
            {!compact ? (
              <>
              <select
                className="block-type-select"
                value={block.type}
                onChange={(event) => handleTypeChange(block.id, event)}
              >
                {blockTypeOptions.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="mini-action"
                disabled={index === 0}
                onClick={() => onMoveBlock(block.id, "up")}
              >
                Move Up
              </button>
              <button
                type="button"
                className="mini-action"
                disabled={index === blocks.length - 1}
                onClick={() => onMoveBlock(block.id, "down")}
              >
                Move Down
              </button>
              <button type="button" className="mini-action" onClick={() => onDuplicateBlock(block.id)}>
                Duplicate
              </button>
              {!hideInlineAddControls ? (
                <button type="button" className="mini-action" onClick={() => onAddBlock(block.id)}>
                  Add Below
                </button>
              ) : null}
              </>
            ) : null}
            <button
              type="button"
              className={`mini-action ${compact ? "mini-action-compact-delete" : ""}`}
              onClick={() => onRemoveBlock(block.id)}
            >
              Remove
            </button>
          </div>
          {block.type === "divider" ? (
            <div className="journal-divider-preview" />
          ) : block.type === "checklist" ? (
            <>
              <label className="journal-checklist-field">
                <input
                  type="checkbox"
                  className="journal-checklist-box"
                  checked={Boolean(block.checked)}
                  onChange={(event) => onUpdateBlock(block.id, { checked: event.target.checked })}
                />
                <textarea
                  className={`journal-block-input journal-block-input-${block.type}`}
                  value={block.text}
                  onChange={(event) => handleTextChange(block.id, event.target.value)}
                  onKeyDown={(event) => handleChecklistKeyDown(event, block.id)}
                  placeholder={`Write ${blockTypeLabels[block.type].toLowerCase()}... Use / for commands.`}
                />
              </label>
              {commandBlockId === block.id && commandMatches.length > 0 ? (
                <div className="slash-menu">
                  {commandMatches.map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      className="slash-menu-item"
                      onClick={() => applyCommand(block.id, value)}
                    >
                      <div className="slash-menu-title">
                        {journalBlockTypeIcons[value] ? (
                          <WorkspaceIcon
                            icon={journalBlockTypeIcons[value]}
                            alt={`${label} icon`}
                            className="mini-action-icon"
                          />
                        ) : null}
                        <strong>{label}</strong>
                      </div>
                      <span>Convert this block</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </>
          ) : (
            <>
              <textarea
                className={`journal-block-input journal-block-input-${block.type}`}
                value={block.text}
                onChange={(event) => handleTextChange(block.id, event.target.value)}
                placeholder={`Write ${blockTypeLabels[block.type].toLowerCase()}... Use / for commands.`}
              />
              {commandBlockId === block.id && commandMatches.length > 0 ? (
                <div className="slash-menu">
                  {commandMatches.map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      className="slash-menu-item"
                      onClick={() => applyCommand(block.id, value)}
                    >
                      <div className="slash-menu-title">
                        {journalBlockTypeIcons[value] ? (
                          <WorkspaceIcon
                            icon={journalBlockTypeIcons[value]}
                            alt={`${label} icon`}
                            className="mini-action-icon"
                          />
                        ) : null}
                        <strong>{label}</strong>
                      </div>
                      <span>Convert this block</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </>
          )}
        </div>
      ))}
      {!hideFooterAddControls ? (
        <div className="block-editor-footer">
          <button type="button" className="mini-action" onClick={() => onAddBlock(undefined, "paragraph")}>
            <WorkspaceIcon icon="text" alt="Text icon" className="mini-action-icon" />
            Add Text
          </button>
          <button type="button" className="mini-action" onClick={() => onAddBlock(undefined, "heading2")}>
            <WorkspaceIcon icon="heading" alt="Heading icon" className="mini-action-icon" />
            Add Heading
          </button>
          <button type="button" className="mini-action" onClick={() => onAddBlock(undefined, "checklist")}>
            <WorkspaceIcon icon="checklist" alt="Checklist icon" className="mini-action-icon" />
            Add Checklist
          </button>
          <button type="button" className="mini-action" onClick={() => onAddBlock(undefined, "callout")}>
            <WorkspaceIcon icon="callout" alt="Callout icon" className="mini-action-icon" />
            Add Callout
          </button>
        </div>
      ) : null}
    </div>
  );
};
