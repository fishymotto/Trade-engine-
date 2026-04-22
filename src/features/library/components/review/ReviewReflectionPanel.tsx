import type { JSONContent } from "@tiptap/core";
import { useEffect, useMemo, useState } from "react";
import { WorkspaceIcon } from "../../../../components/WorkspaceIcon";
import { useEditableSelectOptions } from "../../../../lib/select/useEditableSelectOptions";
import type { NamedReviewTemplate, ReviewPeriod, ReviewReflectionState } from "../../../../types/libraryReview";
import { JournalRichTextEditor } from "../../../journal/components/JournalRichTextEditor";

const ADD_OPTION_VALUE = "__add_option__";

const checklistGroupLabels = {
  meditation: "Meditation",
  riskCheck: "Risk Check",
  morningJournal: "Morning Journal",
  closingJournal: "Closing Journal"
} as const;

const cloneJson = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const ensureTwoRows = (rows: ReviewReflectionState["reading"]) =>
  rows.length >= 2 ? rows : [...rows, ...Array.from({ length: 2 - rows.length }, () => ({ book: "", author: "", pages: "" }))];

type ReviewReflectionPanelProps = {
  period: ReviewPeriod;
  pageId: string;
  timeLabels: string[];
  improvementGoalsLabel: string;
  templates: NamedReviewTemplate[];
  selectedTemplateId: string;
  reflection: ReviewReflectionState;
  defaultBookOptions: string[];
  defaultAuthorOptions: string[];
  onSelectTemplateId: (templateId: string) => void;
  onChangeReflection: (
    next: ReviewReflectionState | ((current: ReviewReflectionState) => ReviewReflectionState)
  ) => void;
  onSaveTemplate: (templateId: string, content: ReviewReflectionState) => void;
  onSaveTemplateAs: (name: string, content: ReviewReflectionState) => void;
  onDeleteTemplate: (templateId: string) => void;
};

export const ReviewReflectionPanel = ({
  period,
  pageId,
  timeLabels,
  improvementGoalsLabel,
  templates,
  selectedTemplateId,
  reflection,
  defaultBookOptions,
  defaultAuthorOptions,
  onSelectTemplateId,
  onChangeReflection,
  onSaveTemplate,
  onSaveTemplateAs,
  onDeleteTemplate
}: ReviewReflectionPanelProps) => {
  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === selectedTemplateId) ?? templates[0] ?? null,
    [selectedTemplateId, templates]
  );

  useEffect(() => {
    if (!selectedTemplateId && templates[0]) {
      onSelectTemplateId(templates[0].id);
      return;
    }

    if (selectedTemplateId && !templates.some((template) => template.id === selectedTemplateId)) {
      onSelectTemplateId(templates[0]?.id ?? "");
    }
  }, [onSelectTemplateId, selectedTemplateId, templates]);

  const { options: bookOptions, addOption: addBookOption } = useEditableSelectOptions(
    "review.reading.books",
    defaultBookOptions
  );
  const { options: authorOptions, addOption: addAuthorOption } = useEditableSelectOptions(
    "review.reading.authors",
    defaultAuthorOptions
  );

  const [pendingTemplateName, setPendingTemplateName] = useState("");

  const setTakeaway = (takeaway: JSONContent) =>
    onChangeReflection((current) => ({ ...current, takeaway }));
  const setImprovementGoals = (improvementGoals: JSONContent) =>
    onChangeReflection((current) => ({ ...current, improvementGoals }));

  const setReadingRow = (index: number, updates: Partial<ReviewReflectionState["reading"][number]>) => {
    onChangeReflection((current) => {
      const rows = ensureTwoRows(current.reading);
      const next = rows.map((row, rowIndex) => (rowIndex === index ? { ...row, ...updates } : row));
      return { ...current, reading: next };
    });
  };

  const removeReadingRow = (index: number) => {
    onChangeReflection((current) => {
      const rows = ensureTwoRows(current.reading);
      if (rows.length <= 2) {
        return current;
      }

      return { ...current, reading: rows.filter((_, rowIndex) => rowIndex !== index) };
    });
  };

  const addReadingRow = () =>
    onChangeReflection((current) => {
      const rows = ensureTwoRows(current.reading);
      return { ...current, reading: [...rows, { book: "", author: "", pages: "" }] };
    });

  const toggleChecklistCell = (groupKey: keyof ReviewReflectionState["checklist"], index: number) => {
    onChangeReflection((current) => {
      const row = Array.isArray(current.checklist[groupKey]) ? current.checklist[groupKey] : [];
      const nextRow = Array.from({ length: 5 }, (_, idx) => Boolean(row[idx]));
      nextRow[index] = !nextRow[index];

      return {
        ...current,
        checklist: {
          ...current.checklist,
          [groupKey]: nextRow
        }
      };
    });
  };

  const loadTemplate = () => {
    if (!selectedTemplate) {
      return;
    }

    const confirmed = window.confirm(`Load template \"${selectedTemplate.name}\" and overwrite the current reflection?`);
    if (!confirmed) {
      return;
    }

    onChangeReflection(cloneJson(selectedTemplate.content));
  };

  const overwriteTemplate = () => {
    if (!selectedTemplate) {
      return;
    }

    const confirmed = window.confirm(`Overwrite template \"${selectedTemplate.name}\" with the current reflection?`);
    if (!confirmed) {
      return;
    }

    onSaveTemplate(selectedTemplate.id, cloneJson(reflection));
  };

  const saveAsTemplate = () => {
    const defaultName = pendingTemplateName.trim() || (period === "weekly" ? "Weekly Template" : "Monthly Template");
    const templateName = window.prompt("Template name", defaultName)?.trim() ?? "";
    if (!templateName) {
      return;
    }

    setPendingTemplateName(templateName);
    onSaveTemplateAs(templateName, cloneJson(reflection));
  };

  const deleteTemplate = () => {
    if (!selectedTemplate) {
      return;
    }

    const confirmed = window.confirm(`Delete template \"${selectedTemplate.name}\"?`);
    if (!confirmed) {
      return;
    }

    onDeleteTemplate(selectedTemplate.id);
  };

  const handleSelectWithAdd = (
    value: string,
    addOption: (value: string) => string | null,
    onChange: (nextValue: string) => void,
    promptLabel: string
  ) => {
    if (value !== ADD_OPTION_VALUE) {
      onChange(value);
      return;
    }

    const next = window.prompt(`Add ${promptLabel}`)?.trim() ?? "";
    if (!next) {
      return;
    }

    const added = addOption(next);
    if (added) {
      onChange(added);
    }
  };

  return (
    <section className="review-reflection-area" aria-label={`${period} reflection`}>
      <section className="journal-writing-section review-writing-section review-template-toolbar">
        <div className="journal-writing-header">
          <div className="journal-writing-header-title">
            <WorkspaceIcon icon="checklist" alt="" className="mini-action-icon" />
            <strong>{period === "weekly" ? "Weekly Review Template" : "Monthly Review Template"}</strong>
          </div>
          <div className="journal-writing-header-actions">
            <select
              className="calendar-date-select"
              value={selectedTemplate?.id ?? ""}
              onChange={(event) => onSelectTemplateId(event.target.value)}
            >
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
            <button type="button" className="mini-action mini-action-soft" onClick={loadTemplate} disabled={!selectedTemplate}>
              Load Template
            </button>
            <button type="button" className="mini-action" onClick={overwriteTemplate} disabled={!selectedTemplate}>
              Save Template
            </button>
            <button type="button" className="mini-action" onClick={saveAsTemplate}>
              Save As
            </button>
            <button
              type="button"
              className="mini-action mini-action-danger"
              onClick={deleteTemplate}
              disabled={templates.length <= 1 || !selectedTemplate}
            >
              Delete Template
            </button>
          </div>
        </div>
      </section>

      <section className="journal-writing-section review-writing-section">
        <div className="journal-writing-header">
          <div className="journal-writing-header-title">
            <WorkspaceIcon icon="journal" alt="" className="mini-action-icon" />
            <strong>Takeaway</strong>
          </div>
        </div>
        <JournalRichTextEditor
          key={`${pageId}-takeaway`}
          content={reflection.takeaway}
          onChange={setTakeaway}
          placeholder="Main takeaway / summary reflection"
          compact
        />
      </section>

      <section className="journal-writing-section review-writing-section">
        <div className="journal-writing-header">
          <div className="journal-writing-header-title">
            <WorkspaceIcon icon="library" alt="" className="mini-action-icon" />
            <strong>Reading</strong>
          </div>
          <div className="journal-writing-header-actions">
            <button type="button" className="mini-action" onClick={addReadingRow}>
              Add Row
            </button>
          </div>
        </div>

        <div className="review-reading-list" role="group" aria-label="Reading entries">
          {ensureTwoRows(reflection.reading).map((row, index) => (
            <div key={`reading-${index}`} className="review-reading-row">
              <label className="review-reading-field">
                <span>Book</span>
                <select
                  value={row.book}
                  onChange={(event) =>
                    handleSelectWithAdd(event.target.value, addBookOption, (book) => setReadingRow(index, { book }), "book")
                  }
                >
                  <option value="">Select...</option>
                  {bookOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                  <option value={ADD_OPTION_VALUE}>+ Add...</option>
                </select>
              </label>

              <label className="review-reading-field">
                <span>Author</span>
                <select
                  value={row.author}
                  onChange={(event) =>
                    handleSelectWithAdd(
                      event.target.value,
                      addAuthorOption,
                      (author) => setReadingRow(index, { author }),
                      "author"
                    )
                  }
                >
                  <option value="">Select...</option>
                  {authorOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                  <option value={ADD_OPTION_VALUE}>+ Add...</option>
                </select>
              </label>

              <label className="review-reading-field review-reading-field-pages">
                <span>Pages</span>
                <input
                  value={row.pages}
                  onChange={(event) => setReadingRow(index, { pages: event.target.value })}
                  placeholder="e.g. 22-40"
                />
              </label>

              {index >= 2 ? (
                <button
                  type="button"
                  className="mini-action mini-action-danger review-reading-remove"
                  onClick={() => removeReadingRow(index)}
                  aria-label="Remove reading row"
                  title="Remove row"
                >
                  Remove
                </button>
              ) : (
                <span className="review-reading-remove-spacer" aria-hidden="true" />
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="journal-writing-section review-writing-section">
        <div className="journal-writing-header">
          <div className="journal-writing-header-title">
            <WorkspaceIcon icon="checklist" alt="" className="mini-action-icon" />
            <strong>Checklist</strong>
          </div>
        </div>

        <div className="review-checklist-grid" role="group" aria-label="Checklist grid">
          {(Object.keys(checklistGroupLabels) as Array<keyof typeof checklistGroupLabels>).map((groupKey) => (
            <section key={groupKey} className="review-checklist-card" aria-label={checklistGroupLabels[groupKey]}>
              <div className="review-checklist-card-header">
                <strong>{checklistGroupLabels[groupKey]}</strong>
                <span>{timeLabels.length} checks</span>
              </div>
              <div className="review-checklist-items">
                {timeLabels.map((label, index) => (
                  <label
                    key={`${groupKey}-${label}`}
                    className={`journal-checklist-field review-checklist-item${
                      reflection.checklist[groupKey]?.[index] ? " journal-block-checked" : ""
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="journal-checklist-box"
                      checked={Boolean(reflection.checklist[groupKey]?.[index])}
                      onChange={() => toggleChecklistCell(groupKey, index)}
                    />
                    <div className="journal-block-input journal-block-input-checklist">{label}</div>
                  </label>
                ))}
              </div>
            </section>
          ))}
        </div>
      </section>

      <section className="journal-writing-section review-writing-section">
        <div className="journal-writing-header">
          <div className="journal-writing-header-title">
            <WorkspaceIcon icon="journal" alt="" className="mini-action-icon" />
            <strong>{improvementGoalsLabel}</strong>
          </div>
        </div>
        <JournalRichTextEditor
          key={`${pageId}-improvement-goals`}
          content={reflection.improvementGoals}
          onChange={setImprovementGoals}
          placeholder="Focus areas, goals, and habits to improve"
          compact
        />
      </section>
    </section>
  );
};
