import { ensurePlaybooksForNames, loadPlaybooks, savePlaybooks } from "../playbooks/playbookStore";
import { upsertTradeTagOverride } from "./tradeTagOverrides";
import type {
  EditableTradeRow,
  EditableTradeTagField,
  TradeTagOptionsRecord,
  TradeTagOverrideRecord
} from "../../types/tradeTags";

const equalsOptionValue = (left: string, right: string): boolean =>
  left.trim().toLowerCase() === right.trim().toLowerCase();

interface CreateTradeTagActionsOptions {
  mergedTradeTagOptionsByField: Record<EditableTradeTagField, string[]>;
  tradeTagOptions: TradeTagOptionsRecord;
  candidateTrades: EditableTradeRow[];
  setTradeTagOverrides: (
    updater: (current: TradeTagOverrideRecord[]) => TradeTagOverrideRecord[]
  ) => void;
  setTradeTagOptions: (updater: (current: TradeTagOptionsRecord) => TradeTagOptionsRecord) => void;
  setMessage: (message: string) => void;
}

export interface TradeTagActions {
  updateTradeTag: (
    trade: EditableTradeRow,
    field: EditableTradeTagField,
    value: string | string[] | null
  ) => void;
  createTradeTagOption: (field: EditableTradeTagField, rawValue: string) => void;
  renameTradeTagOption: (
    field: EditableTradeTagField,
    currentValue: string,
    rawNextValue: string
  ) => void;
  deleteTradeTagOption: (field: EditableTradeTagField, rawValue: string) => void;
  bulkUpdateTradeTags: (
    tradeIds: string[],
    field: EditableTradeTagField,
    value: string | string[] | null
  ) => void;
}

export const createTradeTagActions = ({
  mergedTradeTagOptionsByField,
  tradeTagOptions,
  candidateTrades,
  setTradeTagOverrides,
  setTradeTagOptions,
  setMessage
}: CreateTradeTagActionsOptions): TradeTagActions => {
  const ensurePlaybookExists = (value: string | string[] | null) => {
    const nextPlaybookName = Array.isArray(value) ? (value[0] ?? "") : value ?? "";
    if (!nextPlaybookName.trim()) {
      return;
    }

    const { playbooks, addedPlaybookIds } = ensurePlaybooksForNames(loadPlaybooks(), [nextPlaybookName]);
    if (addedPlaybookIds.length > 0) {
      savePlaybooks(playbooks);
    }
  };

  const updateTradeTag = (
    trade: EditableTradeRow,
    field: EditableTradeTagField,
    value: string | string[] | null
  ) => {
    setTradeTagOverrides((current) => upsertTradeTagOverride(current, trade, field, value));

    if (field === "playbook") {
      ensurePlaybookExists(value);
    }
  };

  const createTradeTagOption = (field: EditableTradeTagField, rawValue: string) => {
    const value = rawValue.trim();
    if (!value) {
      return;
    }

    if (mergedTradeTagOptionsByField[field].some((option) => option.toLowerCase() === value.toLowerCase())) {
      return;
    }

    setTradeTagOptions((current) => ({
      ...current,
      [field]: [...(current[field] ?? []), value]
    }));

    setMessage(`Added "${value}" to the ${field} tag list.`);
  };

  const renameTradeTagOption = (
    field: EditableTradeTagField,
    currentValue: string,
    rawNextValue: string
  ) => {
    const sourceValue = currentValue.trim();
    const nextValue = rawNextValue.trim();
    if (!sourceValue || !nextValue || sourceValue === nextValue) {
      return;
    }

    const isCaseOnlyRename = equalsOptionValue(sourceValue, nextValue);
    const customOptionsForField = tradeTagOptions[field] ?? [];
    if (!customOptionsForField.some((option) => equalsOptionValue(option, sourceValue))) {
      setMessage(`Only custom ${field} options can be renamed here.`);
      return;
    }

    if (
      !isCaseOnlyRename &&
      mergedTradeTagOptionsByField[field].some((option) => equalsOptionValue(option, nextValue))
    ) {
      setMessage(`"${nextValue}" already exists in the ${field} tag list.`);
      return;
    }

    setTradeTagOptions((current) => {
      const existing = current[field] ?? [];
      const filtered = existing.filter((option) => !equalsOptionValue(option, sourceValue));
      return {
        ...current,
        [field]: [...filtered, nextValue]
      };
    });

    setTradeTagOverrides((current) =>
      current.map((override) => {
        const now = new Date().toISOString();

        if (field === "mistake") {
          let changed = false;
          let nextMistakes = override.mistakes;
          let nextMistake = override.mistake;

          if (Array.isArray(override.mistakes)) {
            const renamed = override.mistakes.map((value) =>
              equalsOptionValue(value, sourceValue) ? nextValue : value
            );
            changed = renamed.some((value, index) => value !== override.mistakes?.[index]);
            nextMistakes = renamed;
          }

          if (typeof override.mistake === "string" && equalsOptionValue(override.mistake, sourceValue)) {
            nextMistake = nextValue;
            changed = true;
          }

          return changed
            ? {
                ...override,
                mistakes: nextMistakes,
                mistake: nextMistake,
                updatedAt: now
              }
            : override;
        }

        if (field === "catalyst") {
          if (!Array.isArray(override.catalyst)) {
            return override;
          }

          const renamed = override.catalyst.map((value) =>
            equalsOptionValue(value, sourceValue) ? nextValue : value
          );
          const changed = renamed.some((value, index) => value !== override.catalyst?.[index]);
          return changed
            ? {
                ...override,
                catalyst: renamed,
                updatedAt: now
              }
            : override;
        }

        const currentFieldValue = override[field];
        if (typeof currentFieldValue === "string" && equalsOptionValue(currentFieldValue, sourceValue)) {
          return {
            ...override,
            [field]: nextValue,
            updatedAt: now
          };
        }

        return override;
      })
    );

    if (field === "playbook") {
      ensurePlaybookExists(nextValue);
    }

    setMessage(`Renamed "${sourceValue}" to "${nextValue}" in the ${field} tag list.`);
  };

  const deleteTradeTagOption = (field: EditableTradeTagField, rawValue: string) => {
    const value = rawValue.trim();
    if (!value) {
      return;
    }

    const customOptionsForField = tradeTagOptions[field] ?? [];
    if (!customOptionsForField.some((option) => equalsOptionValue(option, value))) {
      setMessage(`Only custom ${field} options can be removed here.`);
      return;
    }

    setTradeTagOptions((current) => ({
      ...current,
      [field]: (current[field] ?? []).filter((option) => !equalsOptionValue(option, value))
    }));

    setTradeTagOverrides((current) =>
      current.map((override) => {
        const now = new Date().toISOString();

        if (field === "mistake") {
          const nextMistakes = Array.isArray(override.mistakes)
            ? override.mistakes.filter((option) => !equalsOptionValue(option, value))
            : override.mistakes;
          const mistakeCleared =
            typeof override.mistake === "string" && equalsOptionValue(override.mistake, value)
              ? null
              : override.mistake;

          const mistakesChanged =
            Array.isArray(override.mistakes) &&
            nextMistakes &&
            nextMistakes.length !== override.mistakes.length;
          const mistakeChanged = mistakeCleared !== override.mistake;

          return mistakesChanged || mistakeChanged
            ? {
                ...override,
                mistakes: nextMistakes,
                mistake: mistakeCleared,
                updatedAt: now
              }
            : override;
        }

        if (field === "catalyst") {
          if (!Array.isArray(override.catalyst)) {
            return override;
          }

          const nextCatalyst = override.catalyst.filter((option) => !equalsOptionValue(option, value));
          return nextCatalyst.length !== override.catalyst.length
            ? {
                ...override,
                catalyst: nextCatalyst,
                updatedAt: now
              }
            : override;
        }

        const currentFieldValue = override[field];
        if (typeof currentFieldValue === "string" && equalsOptionValue(currentFieldValue, value)) {
          return {
            ...override,
            [field]: null,
            updatedAt: now
          };
        }

        return override;
      })
    );

    setMessage(`Removed "${value}" from the ${field} tag list.`);
  };

  const bulkUpdateTradeTags = (
    tradeIds: string[],
    field: EditableTradeTagField,
    value: string | string[] | null
  ) => {
    const tradeLookup = new Map<string, EditableTradeRow>();
    for (const trade of candidateTrades) {
      if (!tradeLookup.has(trade.id)) {
        tradeLookup.set(trade.id, trade);
      }
    }

    const targetTrades = tradeIds
      .map((tradeId) => tradeLookup.get(tradeId))
      .filter((trade): trade is EditableTradeRow => trade !== undefined);
    if (targetTrades.length === 0) {
      return;
    }

    setTradeTagOverrides((current) =>
      targetTrades.reduce(
        (nextOverrides, trade) => upsertTradeTagOverride(nextOverrides, trade, field, value),
        current
      )
    );

    if (field === "playbook") {
      ensurePlaybookExists(value);
    }

    setMessage(
      `${value && (!Array.isArray(value) || value.length > 0) ? "Applied" : "Cleared"} ${field} for ${targetTrades.length} selected trade${targetTrades.length === 1 ? "" : "s"}.`
    );
  };

  return {
    updateTradeTag,
    createTradeTagOption,
    renameTradeTagOption,
    deleteTradeTagOption,
    bulkUpdateTradeTags
  };
};
