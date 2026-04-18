import type { JournalSlashCommandItem } from "../../../types/journalEditor";

interface JournalSlashMenuProps {
  items: JournalSlashCommandItem[];
  query: string;
  activeIndex: number;
  onSelect: (item: JournalSlashCommandItem) => void;
  onHover: (index: number) => void;
}

export const JournalSlashMenu = ({
  items,
  query,
  activeIndex,
  onSelect,
  onHover
}: JournalSlashMenuProps) => {
  if (items.length === 0) {
    return null;
  }

  return (
    <div className="journal-slash-menu">
      <div className="journal-slash-menu-header">
        <strong>Insert block</strong>
        <span>{query ? `/${query}` : "/"}</span>
      </div>
      <div className="journal-slash-menu-list">
        {items.map((item, index) => (
          <button
            key={item.key}
            type="button"
            className={`journal-slash-item ${index === activeIndex ? "journal-slash-item-active" : ""}`}
            onClick={() => onSelect(item)}
            onMouseEnter={() => onHover(index)}
          >
            <strong>{item.label}</strong>
            <span>{item.description}</span>
          </button>
        ))}
      </div>
    </div>
  );
};
