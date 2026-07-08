import { tradeTagFields, tradeTagOptionsByField as defaultTradeTagOptionsByField } from "./tradeTagCatalog";
import type { JournalPageRecord } from "../../types/journal";
import type { TradeSessionRecord } from "../../types/session";
import type { GameTag, GroupedTrade, TradeStatus } from "../../types/trade";
import type {
  EditableTradeTagField,
  TradeTagOptionsRecord,
  TradeTagOverrideRecord
} from "../../types/tradeTags";

export interface TradeTagCleanupExactGroup {
  id: string;
  field: EditableTradeTagField;
  target: string;
  variants: string[];
  totalCount: number;
}

export interface TradeTagCleanupSuggestion {
  id: string;
  field: EditableTradeTagField;
  left: string;
  right: string;
  leftCount: number;
  rightCount: number;
  similarity: number;
}

export interface TradeTagCleanupMerge {
  field: EditableTradeTagField;
  source: string;
  target: string;
}

export interface TradeTagCleanupReport {
  exactGroups: TradeTagCleanupExactGroup[];
  suggestions: TradeTagCleanupSuggestion[];
}

interface TradeTagCleanupReportInput {
  tradeTagOptions: TradeTagOptionsRecord;
  trades: GroupedTrade[];
  tradeSessions: TradeSessionRecord[];
  tradeTagOverrides: TradeTagOverrideRecord[];
  journalPages: JournalPageRecord[];
}

interface TradeTagCleanupApplyInput extends TradeTagCleanupReportInput {
  merges: TradeTagCleanupMerge[];
}

interface CollectedTagValue {
  value: string;
  count: number;
  firstSeenIndex: number;
  isDefaultOption: boolean;
  isCustomOption: boolean;
}

interface CollectedTagGroup {
  key: string;
  values: Map<string, CollectedTagValue>;
}

interface RenameResult {
  value: string;
  changed: boolean;
}

interface RenameListResult {
  values: string[];
  changed: boolean;
}

export interface TradeTagCleanupApplyResult {
  tradeTagOptions: TradeTagOptionsRecord;
  tradeTagOverrides: TradeTagOverrideRecord[];
  trades: GroupedTrade[];
  tradeSessions: TradeSessionRecord[];
  journalPages: JournalPageRecord[];
  changed: boolean;
  changedValueCount: number;
}

type CollectedTagGroupsByField = Record<EditableTradeTagField, Map<string, CollectedTagGroup>>;
type RenameMapsByField = Partial<Record<EditableTradeTagField, Map<string, string>>>;

const CLOSE_MATCH_FIELDS = new Set<EditableTradeTagField>(["mistake", "playbook", "catalyst", "outTag", "execution"]);

const APPROVED_TAG_CLEANUP_MERGES: TradeTagCleanupMerge[] = [
  { field: "mistake", source: "Too Slow on the exsit", target: "Late Exist" },
  { field: "mistake", source: "Late Cut", target: "Late Exist" },
  { field: "mistake", source: "Exit Hesitation", target: "Late Exist" },
  { field: "mistake", source: "Too Far from Level", target: "Late Exist" },
  { field: "mistake", source: "Too Slow on the exit", target: "Late Exist" },
  { field: "mistake", source: "Early Cut", target: "Early Exit" },
  { field: "mistake", source: "Late Entry", target: "Chased Price" }
];

const hasOwn = <T extends object>(value: T, key: keyof T): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

const normalizeTagKey = (value: string): string => value.trim().replace(/\s+/g, " ").toLowerCase();

const normalizeComparableTag = (value: string): string =>
  normalizeTagKey(value)
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const getDefaultOptionKeySet = (field: EditableTradeTagField): Set<string> =>
  new Set((defaultTradeTagOptionsByField[field] ?? []).map(normalizeTagKey));

const createEmptyCollectedGroups = (): CollectedTagGroupsByField =>
  tradeTagFields.reduce(
    (groups, field) => ({
      ...groups,
      [field]: new Map<string, CollectedTagGroup>()
    }),
    {} as CollectedTagGroupsByField
  );

let collectOrderIndex = 0;

const addCollectedValue = (
  groupsByField: CollectedTagGroupsByField,
  field: EditableTradeTagField,
  rawValue: unknown,
  options: { count?: number; isDefaultOption?: boolean; isCustomOption?: boolean } = {}
): void => {
  if (typeof rawValue !== "string") {
    return;
  }

  const value = rawValue.trim().replace(/\s+/g, " ");
  if (!value) {
    return;
  }

  const key = normalizeTagKey(value);
  const groups = groupsByField[field];
  const group = groups.get(key) ?? {
    key,
    values: new Map<string, CollectedTagValue>()
  };
  const existing = group.values.get(value);
  if (existing) {
    existing.count += options.count ?? 1;
    existing.isDefaultOption = existing.isDefaultOption || Boolean(options.isDefaultOption);
    existing.isCustomOption = existing.isCustomOption || Boolean(options.isCustomOption);
  } else {
    group.values.set(value, {
      value,
      count: options.count ?? 1,
      firstSeenIndex: collectOrderIndex,
      isDefaultOption: Boolean(options.isDefaultOption),
      isCustomOption: Boolean(options.isCustomOption)
    });
    collectOrderIndex += 1;
  }
  groups.set(key, group);
};

const addCollectedList = (
  groupsByField: CollectedTagGroupsByField,
  field: EditableTradeTagField,
  values: unknown
): void => {
  if (!Array.isArray(values)) {
    return;
  }

  for (const value of values) {
    addCollectedValue(groupsByField, field, value);
  }
};

const addTradeValues = (groupsByField: CollectedTagGroupsByField, trade: GroupedTrade): void => {
  addCollectedValue(groupsByField, "status", trade.status);
  addCollectedList(groupsByField, "mistake", trade.mistakes);
  addCollectedList(groupsByField, "playbook", trade.setups);
  addCollectedList(groupsByField, "catalyst", trade.catalyst);
  addCollectedValue(groupsByField, "game", trade.game);
  addCollectedList(groupsByField, "outTag", trade.outTag);
  addCollectedList(groupsByField, "execution", trade.execution);
};

const addOverrideValues = (
  groupsByField: CollectedTagGroupsByField,
  override: TradeTagOverrideRecord
): void => {
  addCollectedValue(groupsByField, "status", override.status);
  addCollectedValue(groupsByField, "mistake", override.mistake);
  addCollectedList(groupsByField, "mistake", override.mistakes);
  addCollectedValue(groupsByField, "playbook", override.playbook);
  addCollectedList(groupsByField, "catalyst", override.catalyst);
  addCollectedValue(groupsByField, "game", override.game);
  addCollectedValue(groupsByField, "outTag", override.outTag);
  addCollectedValue(groupsByField, "execution", override.execution);
};

const addJournalValues = (groupsByField: CollectedTagGroupsByField, page: JournalPageRecord): void => {
  for (const screenshotTag of page.screenshotTags) {
    addCollectedValue(groupsByField, "playbook", screenshotTag.playbook);
  }

  for (const tradeNote of page.tradeNotes) {
    addCollectedValue(groupsByField, "playbook", tradeNote.playbook);
    addCollectedList(groupsByField, "mistake", tradeNote.mistakes);
  }
};

const collectTagGroups = ({
  tradeTagOptions,
  trades,
  tradeSessions,
  tradeTagOverrides,
  journalPages
}: TradeTagCleanupReportInput): CollectedTagGroupsByField => {
  collectOrderIndex = 0;
  const groupsByField = createEmptyCollectedGroups();

  for (const field of tradeTagFields) {
    for (const option of defaultTradeTagOptionsByField[field] ?? []) {
      addCollectedValue(groupsByField, field, option, { count: 0, isDefaultOption: true });
    }

    for (const option of tradeTagOptions[field] ?? []) {
      addCollectedValue(groupsByField, field, option, { count: 0, isCustomOption: true });
    }
  }

  for (const trade of trades) {
    addTradeValues(groupsByField, trade);
  }

  for (const session of tradeSessions) {
    for (const trade of session.trades) {
      addTradeValues(groupsByField, trade);
    }
  }

  for (const override of tradeTagOverrides) {
    addOverrideValues(groupsByField, override);
  }

  for (const page of journalPages) {
    addJournalValues(groupsByField, page);
  }

  return groupsByField;
};

const pickPreferredValue = (values: CollectedTagValue[]): CollectedTagValue => {
  const sorted = [...values].sort((left, right) => {
    if (left.isDefaultOption !== right.isDefaultOption) {
      return left.isDefaultOption ? -1 : 1;
    }

    if (left.count !== right.count) {
      return right.count - left.count;
    }

    if (left.isCustomOption !== right.isCustomOption) {
      return left.isCustomOption ? -1 : 1;
    }

    return left.firstSeenIndex - right.firstSeenIndex;
  });

  return sorted[0] ?? values[0];
};

const getGroupTarget = (group: CollectedTagGroup): CollectedTagValue => pickPreferredValue([...group.values.values()]);

const getTotalCount = (values: CollectedTagValue[]): number =>
  values.reduce((sum, value) => sum + value.count, 0);

const calculateLevenshteinDistance = (left: string, right: string): number => {
  const leftLength = left.length;
  const rightLength = right.length;
  const distances = Array.from({ length: leftLength + 1 }, (_, index) => index);

  for (let rightIndex = 1; rightIndex <= rightLength; rightIndex += 1) {
    let previousDiagonal = distances[0];
    distances[0] = rightIndex;

    for (let leftIndex = 1; leftIndex <= leftLength; leftIndex += 1) {
      const previousLeft = distances[leftIndex];
      const cost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      distances[leftIndex] = Math.min(
        distances[leftIndex] + 1,
        distances[leftIndex - 1] + 1,
        previousDiagonal + cost
      );
      previousDiagonal = previousLeft;
    }
  }

  return distances[leftLength];
};

const getTokenOverlap = (left: string, right: string): number => {
  const leftTokens = new Set(left.split(" ").filter(Boolean));
  const rightTokens = new Set(right.split(" ").filter(Boolean));
  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0;
  }

  let intersectionCount = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      intersectionCount += 1;
    }
  }

  return intersectionCount / Math.max(leftTokens.size, rightTokens.size);
};

const shouldSuggestCloseMatch = (left: string, right: string): { suggested: boolean; similarity: number } => {
  const normalizedLeft = normalizeComparableTag(left);
  const normalizedRight = normalizeComparableTag(right);
  if (
    !normalizedLeft ||
    !normalizedRight ||
    normalizedLeft === normalizedRight ||
    Math.min(normalizedLeft.length, normalizedRight.length) < 6
  ) {
    return { suggested: false, similarity: 0 };
  }

  const distance = calculateLevenshteinDistance(normalizedLeft, normalizedRight);
  const maxLength = Math.max(normalizedLeft.length, normalizedRight.length);
  const similarity = 1 - distance / maxLength;
  const tokenOverlap = getTokenOverlap(normalizedLeft, normalizedRight);
  const maxDistance = maxLength >= 18 ? 3 : 2;

  return {
    suggested: distance <= maxDistance || (tokenOverlap >= 0.8 && distance <= 5 && similarity >= 0.75),
    similarity
  };
};

export const buildTradeTagCleanupReport = (input: TradeTagCleanupReportInput): TradeTagCleanupReport => {
  const groupsByField = collectTagGroups(input);
  const exactGroups: TradeTagCleanupExactGroup[] = [];
  const suggestions: TradeTagCleanupSuggestion[] = [];

  for (const field of tradeTagFields) {
    const fieldGroups = Array.from(groupsByField[field].values());
    for (const group of fieldGroups) {
      const values = Array.from(group.values.values());
      if (values.length <= 1) {
        continue;
      }

      const target = getGroupTarget(group);
      exactGroups.push({
        id: `${field}:${group.key}`,
        field,
        target: target.value,
        variants: values
          .map((value) => value.value)
          .sort((left, right) => left.localeCompare(right)),
        totalCount: getTotalCount(values)
      });
    }

    if (!CLOSE_MATCH_FIELDS.has(field)) {
      continue;
    }

    const canonicalValues = fieldGroups
      .map((group) => {
        const target = getGroupTarget(group);
        return {
          key: group.key,
          value: target.value,
          count: getTotalCount([...group.values.values()])
        };
      })
      .filter((entry) => entry.count > 0);

    for (let leftIndex = 0; leftIndex < canonicalValues.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < canonicalValues.length; rightIndex += 1) {
        const left = canonicalValues[leftIndex];
        const right = canonicalValues[rightIndex];
        if (left.key === right.key) {
          continue;
        }

        const match = shouldSuggestCloseMatch(left.value, right.value);
        if (!match.suggested) {
          continue;
        }

        const suggestionValues = [left.value, right.value].sort((leftValue, rightValue) =>
          leftValue.localeCompare(rightValue)
        );
        suggestions.push({
          id: `${field}:${normalizeTagKey(suggestionValues[0])}:${normalizeTagKey(suggestionValues[1])}`,
          field,
          left: left.value,
          right: right.value,
          leftCount: left.count,
          rightCount: right.count,
          similarity: match.similarity
        });
      }
    }
  }

  return {
    exactGroups: exactGroups.sort(
      (left, right) =>
        left.field.localeCompare(right.field) ||
        right.totalCount - left.totalCount ||
        left.target.localeCompare(right.target)
    ),
    suggestions: suggestions
      .sort(
        (left, right) =>
          right.similarity - left.similarity ||
          right.leftCount + right.rightCount - (left.leftCount + left.rightCount) ||
          left.field.localeCompare(right.field)
      )
      .slice(0, 20)
  };
};

export const createExactTradeTagCleanupMerges = (
  report: TradeTagCleanupReport
): TradeTagCleanupMerge[] => {
  const merges = report.exactGroups.flatMap((group) =>
    group.variants
      .filter((variant) => variant !== group.target)
      .map((variant) => ({
        field: group.field,
        source: variant,
        target: group.target
      }))
  );
  const seen = new Set<string>();
  const uniqueMerges: TradeTagCleanupMerge[] = [];

  for (const merge of [...merges, ...APPROVED_TAG_CLEANUP_MERGES]) {
    const sourceValue = merge.source.trim().replace(/\s+/g, " ");
    const targetValue = merge.target.trim().replace(/\s+/g, " ");
    const sourceKey = normalizeTagKey(merge.source);
    const targetKey = normalizeTagKey(merge.target);
    if (!sourceKey || !targetKey || sourceValue === targetValue) {
      continue;
    }

    const mergeKey = `${merge.field}:${sourceKey}:${targetKey}`;
    if (seen.has(mergeKey)) {
      continue;
    }

    seen.add(mergeKey);
    uniqueMerges.push(merge);
  }

  return uniqueMerges;
};

const createRenameMaps = (merges: TradeTagCleanupMerge[]): RenameMapsByField => {
  const maps: RenameMapsByField = {};

  for (const merge of merges) {
    const sourceKey = normalizeTagKey(merge.source);
    const target = merge.target.trim().replace(/\s+/g, " ");
    if (!sourceKey || !target) {
      continue;
    }

    const fieldMap = maps[merge.field] ?? new Map<string, string>();
    fieldMap.set(sourceKey, target);
    maps[merge.field] = fieldMap;
  }

  return maps;
};

const renameValue = (
  field: EditableTradeTagField,
  rawValue: string | null | undefined,
  maps: RenameMapsByField
): RenameResult => {
  const value = rawValue?.trim().replace(/\s+/g, " ") ?? "";
  if (!value) {
    return { value: "", changed: Boolean(rawValue && rawValue.length > 0) };
  }

  const nextValue = maps[field]?.get(normalizeTagKey(value)) ?? value;
  return {
    value: nextValue,
    changed: nextValue !== value
  };
};

const renameList = (
  field: EditableTradeTagField,
  rawValues: readonly string[] | null | undefined,
  maps: RenameMapsByField
): RenameListResult => {
  const values = Array.isArray(rawValues) ? rawValues : [];
  const nextValues: string[] = [];
  const seen = new Set<string>();
  let changed = false;

  for (const rawValue of values) {
    const renamed = renameValue(field, rawValue, maps);
    if (!renamed.value) {
      changed = true;
      continue;
    }

    const key = normalizeTagKey(renamed.value);
    if (seen.has(key)) {
      changed = true;
      continue;
    }

    seen.add(key);
    nextValues.push(renamed.value);
    changed = changed || renamed.changed || renamed.value !== rawValue;
  }

  return {
    values: nextValues,
    changed: changed || nextValues.length !== values.length
  };
};

const renameTrade = (
  trade: GroupedTrade,
  maps: RenameMapsByField
): { trade: GroupedTrade; changedValueCount: number } => {
  let changedValueCount = 0;
  const status = renameValue("status", trade.status, maps);
  const mistakes = renameList("mistake", trade.mistakes, maps);
  const setups = renameList("playbook", trade.setups, maps);
  const catalyst = renameList("catalyst", trade.catalyst, maps);
  const game = renameValue("game", trade.game, maps);
  const outTag = renameList("outTag", trade.outTag, maps);
  const execution = renameList("execution", trade.execution, maps);

  changedValueCount += Number(status.changed);
  changedValueCount += Number(mistakes.changed);
  changedValueCount += Number(setups.changed);
  changedValueCount += Number(catalyst.changed);
  changedValueCount += Number(game.changed);
  changedValueCount += Number(outTag.changed);
  changedValueCount += Number(execution.changed);

  if (changedValueCount === 0) {
    return { trade, changedValueCount };
  }

  return {
    trade: {
      ...trade,
      status: status.value as TradeStatus,
      mistakes: mistakes.values,
      setups: setups.values,
      catalyst: catalyst.values,
      game: game.value as GameTag,
      outTag: outTag.values,
      execution: execution.values
    },
    changedValueCount
  };
};

const applyTradeRenames = (
  trades: GroupedTrade[],
  maps: RenameMapsByField
): { trades: GroupedTrade[]; changedValueCount: number } => {
  let changedValueCount = 0;
  const nextTrades = trades.map((trade) => {
    const result = renameTrade(trade, maps);
    changedValueCount += result.changedValueCount;
    return result.trade;
  });

  return {
    trades: changedValueCount > 0 ? nextTrades : trades,
    changedValueCount
  };
};

const applySessionRenames = (
  sessions: TradeSessionRecord[],
  maps: RenameMapsByField,
  updatedAt: string
): { tradeSessions: TradeSessionRecord[]; changedValueCount: number } => {
  let changedValueCount = 0;
  const nextSessions = sessions.map((session) => {
    const result = applyTradeRenames(session.trades, maps);
    changedValueCount += result.changedValueCount;
    return result.changedValueCount > 0
      ? {
          ...session,
          trades: result.trades,
          updatedAt
        }
      : session;
  });

  return {
    tradeSessions: changedValueCount > 0 ? nextSessions : sessions,
    changedValueCount
  };
};

const applyOverrideRenames = (
  overrides: TradeTagOverrideRecord[],
  maps: RenameMapsByField,
  updatedAt: string
): { tradeTagOverrides: TradeTagOverrideRecord[]; changedValueCount: number } => {
  let changedValueCount = 0;
  const nextOverrides = overrides.map((override) => {
    let nextOverride = override;
    let overrideChanged = false;

    const status = renameValue("status", override.status, maps);
    if (status.changed) {
      nextOverride = { ...nextOverride, status: status.value as TradeStatus };
      overrideChanged = true;
      changedValueCount += 1;
    }

    if (hasOwn(override, "mistakes") || hasOwn(override, "mistake")) {
      const sourceMistakes = Array.isArray(override.mistakes)
        ? override.mistakes
        : override.mistake
          ? [override.mistake]
          : [];
      const mistakes = renameList("mistake", sourceMistakes, maps);
      if (mistakes.changed) {
        nextOverride = {
          ...nextOverride,
          mistakes: hasOwn(override, "mistakes") ? mistakes.values : nextOverride.mistakes,
          mistake: hasOwn(override, "mistake") ? (mistakes.values[0] ?? null) : nextOverride.mistake
        };
        overrideChanged = true;
        changedValueCount += 1;
      }
    }

    const playbook = renameValue("playbook", override.playbook, maps);
    if (playbook.changed) {
      nextOverride = { ...nextOverride, playbook: playbook.value || null };
      overrideChanged = true;
      changedValueCount += 1;
    }

    if (hasOwn(override, "catalyst")) {
      const catalyst = renameList("catalyst", override.catalyst, maps);
      if (catalyst.changed) {
        nextOverride = { ...nextOverride, catalyst: catalyst.values };
        overrideChanged = true;
        changedValueCount += 1;
      }
    }

    const game = renameValue("game", override.game, maps);
    if (game.changed) {
      nextOverride = { ...nextOverride, game: (game.value || null) as GameTag | null };
      overrideChanged = true;
      changedValueCount += 1;
    }

    const outTag = renameValue("outTag", override.outTag, maps);
    if (outTag.changed) {
      nextOverride = { ...nextOverride, outTag: outTag.value || null };
      overrideChanged = true;
      changedValueCount += 1;
    }

    const execution = renameValue("execution", override.execution, maps);
    if (execution.changed) {
      nextOverride = { ...nextOverride, execution: execution.value || null };
      overrideChanged = true;
      changedValueCount += 1;
    }

    return overrideChanged
      ? {
          ...nextOverride,
          updatedAt
        }
      : override;
  });

  return {
    tradeTagOverrides: changedValueCount > 0 ? nextOverrides : overrides,
    changedValueCount
  };
};

const applyOptionRenames = (
  options: TradeTagOptionsRecord,
  maps: RenameMapsByField
): { tradeTagOptions: TradeTagOptionsRecord; changedValueCount: number } => {
  let changedValueCount = 0;
  const nextOptions: TradeTagOptionsRecord = {};

  for (const field of tradeTagFields) {
    const defaultKeys = getDefaultOptionKeySet(field);
    const targets = Array.from(maps[field]?.values() ?? []);
    const sourceOptions = options[field] ?? [];
    const renamed = renameList(field, sourceOptions, maps);
    const nextFieldOptions = renamed.values.filter((value) => !defaultKeys.has(normalizeTagKey(value)));
    const seen = new Set(nextFieldOptions.map(normalizeTagKey));

    for (const target of targets) {
      const key = normalizeTagKey(target);
      if (defaultKeys.has(key) || seen.has(key)) {
        continue;
      }

      seen.add(key);
      nextFieldOptions.push(target);
      changedValueCount += 1;
    }

    if (renamed.changed || nextFieldOptions.length !== sourceOptions.length) {
      changedValueCount += 1;
    }

    if (nextFieldOptions.length > 0) {
      nextOptions[field] = nextFieldOptions;
    }
  }

  return {
    tradeTagOptions: changedValueCount > 0 ? nextOptions : options,
    changedValueCount
  };
};

const applyJournalRenames = (
  journalPages: JournalPageRecord[],
  maps: RenameMapsByField,
  updatedAt: string
): { journalPages: JournalPageRecord[]; changedValueCount: number } => {
  let changedValueCount = 0;
  const nextPages = journalPages.map((page) => {
    let pageChanged = false;
    const screenshotTags = page.screenshotTags.map((tag) => {
      const playbook = renameValue("playbook", tag.playbook, maps);
      if (!playbook.changed) {
        return tag;
      }

      pageChanged = true;
      changedValueCount += 1;
      return {
        ...tag,
        playbook: playbook.value
      };
    });
    const tradeNotes = page.tradeNotes.map((note) => {
      const playbook = renameValue("playbook", note.playbook, maps);
      const mistakes = renameList("mistake", note.mistakes, maps);
      if (!playbook.changed && !mistakes.changed) {
        return note;
      }

      pageChanged = true;
      changedValueCount += Number(playbook.changed) + Number(mistakes.changed);
      return {
        ...note,
        playbook: playbook.value,
        mistakes: mistakes.values,
        ...(playbook.changed ? { playbookUpdatedAt: updatedAt } : {}),
        ...(mistakes.changed ? { mistakesUpdatedAt: updatedAt } : {}),
        updatedAt
      };
    });

    return pageChanged
      ? {
          ...page,
          screenshotTags,
          tradeNotes,
          updatedAt
        }
      : page;
  });

  return {
    journalPages: changedValueCount > 0 ? nextPages : journalPages,
    changedValueCount
  };
};

export const applyTradeTagCleanupMerges = ({
  tradeTagOptions,
  tradeTagOverrides,
  trades,
  tradeSessions,
  journalPages,
  merges
}: TradeTagCleanupApplyInput): TradeTagCleanupApplyResult => {
  const maps = createRenameMaps(merges);
  const updatedAt = new Date().toISOString();
  const nextOptions = applyOptionRenames(tradeTagOptions, maps);
  const nextOverrides = applyOverrideRenames(tradeTagOverrides, maps, updatedAt);
  const nextTrades = applyTradeRenames(trades, maps);
  const nextTradeSessions = applySessionRenames(tradeSessions, maps, updatedAt);
  const nextJournalPages = applyJournalRenames(journalPages, maps, updatedAt);
  const changedValueCount =
    nextOptions.changedValueCount +
    nextOverrides.changedValueCount +
    nextTrades.changedValueCount +
    nextTradeSessions.changedValueCount +
    nextJournalPages.changedValueCount;

  return {
    tradeTagOptions: nextOptions.tradeTagOptions,
    tradeTagOverrides: nextOverrides.tradeTagOverrides,
    trades: nextTrades.trades,
    tradeSessions: nextTradeSessions.tradeSessions,
    journalPages: nextJournalPages.journalPages,
    changed: changedValueCount > 0,
    changedValueCount
  };
};
