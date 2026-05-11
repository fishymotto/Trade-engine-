import { useEffect, useMemo, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { JournalRichTextEditor } from "../../journal/components/JournalRichTextEditor";
import { WorkspaceIcon } from "../../../components/WorkspaceIcon";
import { createEmptyJournalDoc, hasJournalDocContent } from "../../../lib/journal/journalContent";
import {
  addPlaybookAPlusExample,
  removePlaybookAPlusExample,
  updatePlaybookAPlusExample
} from "../../../lib/playbooks/playbookStore";
import {
  deletePlaybookAttachment,
  pickAndSavePlaybookAttachment,
  resolvePlaybookAttachmentSrc
} from "../../../lib/playbooks/playbookAttachmentClient";
import {
  collectWorkspaceAttachmentPaths,
  saveWorkspaceInlineImage
} from "../../../lib/workspace/workspaceAttachmentClient";
import type { PlaybookExampleRating, PlaybookRecord } from "../../../types/playbook";
import type { GroupedTrade } from "../../../types/trade";

type ExampleRecord = PlaybookRecord["aPlusExamples"][number];

const ratingOptions: PlaybookExampleRating[] = ["A+", "A", "B+"];
const eligibleGameTags = new Set(["A Game", "B+ Game"]);
const MAX_DISMISSED_TRADE_IDS = 400;

const getSyncedExampleRating = (trade: GroupedTrade): PlaybookExampleRating | null => {
  if (trade.game === "A Game") {
    return "A+";
  }
  if (trade.game === "B+ Game") {
    return "B+";
  }
  return null;
};

const createExampleId = (): string => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `example-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const formatSignedMoney = (value: number): string =>
  `${value >= 0 ? "+" : "-"}$${Math.abs(value).toFixed(2)}`;

const formatCurrency = (value: number): string => `$${Math.abs(value).toFixed(2)}`;
const formatMoney = (value: number): string => `$${value.toFixed(2)}`;

const formatPrice = (value: number): string => {
  if (!Number.isFinite(value)) {
    return "-";
  }
  return `$${value.toFixed(Math.abs(value) >= 100 ? 2 : 4)}`;
};

const formatSize = (value: number): string =>
  Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "-";

const formatSignedPerShare = (value: number): string =>
  `${value >= 0 ? "+" : "-"}$${Math.abs(value).toFixed(4)}`;

const getSignedValueClassName = (value: number): "positive-value" | "negative-value" =>
  value >= 0 ? "positive-value" : "negative-value";
const getHoldLabel = (trade: GroupedTrade): string => {
  const trimmedHoldTime = trade.holdTime.trim();
  if (trimmedHoldTime.length > 0) {
    return trimmedHoldTime;
  }
  return `${Math.max(0, Math.round(trade.holdSeconds / 60))}m`;
};
const toSafeText = (value: unknown): string => (typeof value === "string" ? value : "");
const toSafeArray = <T,>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);
const isExampleRating = (value: unknown): value is PlaybookExampleRating =>
  value === "A+" || value === "A" || value === "B+";

const normalizeExampleRecord = (entry: unknown): ExampleRecord | null => {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const now = new Date().toISOString();
  const record = entry as Record<string, unknown>;
  return {
    id: toSafeText(record.id) || createExampleId(),
    tradeId: toSafeText(record.tradeId),
    tradeDate: toSafeText(record.tradeDate),
    rating: isExampleRating(record.rating) ? record.rating : "A+",
    notes: hasJournalDocContent(record.notes as Parameters<typeof hasJournalDocContent>[0])
      ? (record.notes as ExampleRecord["notes"])
      : createEmptyJournalDoc(),
    screenshotPaths: toSafeArray<string>(record.screenshotPaths)
      .map((value) => toSafeText(value))
      .filter((value) => value.length > 0),
    recordingPath: toSafeText(record.recordingPath),
    createdAt: toSafeText(record.createdAt) || now,
    updatedAt: toSafeText(record.updatedAt) || now
  };
};

const parseSortableDate = (value: string): number | null => {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Date.parse(trimmed);
  return Number.isNaN(parsed) ? null : parsed;
};

const compareDateStrings = (leftValue: string, rightValue: string): number => {
  const leftParsed = parseSortableDate(leftValue);
  const rightParsed = parseSortableDate(rightValue);
  if (leftParsed !== null && rightParsed !== null && leftParsed !== rightParsed) {
    return leftParsed - rightParsed;
  }
  if (leftValue !== rightValue) {
    return leftValue.localeCompare(rightValue);
  }
  return 0;
};

const toComparableScreenshotPath = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed.startsWith("data:")) {
    return trimmed;
  }

  let normalized = trimmed;
  try {
    const url = new URL(normalized);
    if (url.pathname) {
      normalized = url.pathname;
    }
  } catch {
    // Keep raw string when value is not a URL.
  }

  if (normalized.includes("?")) {
    normalized = normalized.split("?")[0] ?? normalized;
  }
  if (normalized.includes("#")) {
    normalized = normalized.split("#")[0] ?? normalized;
  }

  try {
    normalized = decodeURIComponent(normalized);
  } catch {
    // Keep original when decode fails.
  }

  return normalized.replace(/\\/g, "/").toLowerCase();
};

const mergeScreenshotPaths = (primary: string[], secondary: string[]): string[] => {
  const merged: string[] = [];
  const seen = new Set<string>();
  for (const path of [...primary, ...secondary]) {
    const comparable = toComparableScreenshotPath(path);
    if (!comparable || seen.has(comparable)) {
      continue;
    }
    seen.add(comparable);
    merged.push(path);
  }
  return merged;
};

const hasScreenshotPathOverlap = (left: string[], right: string[]): boolean => {
  if (left.length === 0 || right.length === 0) {
    return false;
  }
  const rightComparable = new Set(right.map((value) => toComparableScreenshotPath(value)).filter(Boolean));
  return left.some((value) => rightComparable.has(toComparableScreenshotPath(value)));
};

const parseDismissedTradeIds = (raw: string | null): string[] => {
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  } catch {
    return [];
  }
};

const pruneDismissedTradeIds = (value: string[]): string[] => {
  const unique = Array.from(new Set(value.map((item) => item.trim()).filter((item) => item.length > 0)));
  if (unique.length <= MAX_DISMISSED_TRADE_IDS) {
    return unique;
  }
  return unique.slice(unique.length - MAX_DISMISSED_TRADE_IDS);
};

const readFileAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }

      reject(new Error("File could not be read."));
    };
    reader.onerror = () => reject(reader.error ?? new Error("File could not be read."));
    reader.readAsDataURL(file);
  });

interface APlusExampleLibraryProps {
  playbook: PlaybookRecord;
  matchedTrades: GroupedTrade[];
  taggedCharts: {
    screenshotUrl: string;
    linkedTrades: GroupedTrade[];
  }[];
  onSelectTrade: (tradeId: string, tradeDate: string) => void;
  onExpandImage: (src: string) => void;
  setPlaybooks: React.Dispatch<React.SetStateAction<PlaybookRecord[]>>;
}

export const APlusExampleLibrary = ({
  playbook,
  matchedTrades,
  taggedCharts,
  onSelectTrade,
  onExpandImage,
  setPlaybooks
}: APlusExampleLibraryProps) => {
  const dismissedTradeIdsStorageKey = `playbook-aplus-dismissed:${playbook.id}`;
  const aPlusExamples = useMemo(() => {
    const candidates = toSafeArray<unknown>(playbook.aPlusExamples);
    return candidates
      .map((entry) => normalizeExampleRecord(entry))
      .filter((entry): entry is ExampleRecord => entry !== null);
  }, [playbook.aPlusExamples]);
  const [pendingAttachmentExampleId, setPendingAttachmentExampleId] = useState("");
  const [pendingAttachmentKind, setPendingAttachmentKind] = useState<"screenshot" | "recording">(
    "screenshot"
  );
  const [dismissedTradeIds, setDismissedTradeIds] = useState<string[]>([]);
  const [exampleSearchQuery, setExampleSearchQuery] = useState("");
  const [exampleDateSort, setExampleDateSort] = useState<"date-desc" | "date-asc">("date-desc");
  const [relinkFeedbackByExampleId, setRelinkFeedbackByExampleId] = useState<Record<string, string>>({});
  const screenshotInputRef = useRef<HTMLInputElement | null>(null);
  const dismissedTradeIdSet = useMemo(() => new Set(dismissedTradeIds), [dismissedTradeIds]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      const nextDismissedTradeIds = pruneDismissedTradeIds(
        parseDismissedTradeIds(window.localStorage.getItem(dismissedTradeIdsStorageKey))
      );
      setDismissedTradeIds(nextDismissedTradeIds);
    } catch {
      setDismissedTradeIds([]);
    }
  }, [dismissedTradeIdsStorageKey]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const pruned = pruneDismissedTradeIds(dismissedTradeIds);
    try {
      window.localStorage.setItem(dismissedTradeIdsStorageKey, JSON.stringify(pruned));
    } catch {
      // Never let storage quota errors crash rendering.
      try {
        window.localStorage.removeItem(dismissedTradeIdsStorageKey);
      } catch {
        // Ignore cleanup failures.
      }
    }
  }, [dismissedTradeIds, dismissedTradeIdsStorageKey]);

  const tradeById = useMemo(() => new Map(matchedTrades.map((trade) => [trade.id, trade])), [matchedTrades]);

  const autoExampleScreenshotsByTrade = useMemo(() => {
    const grouped = new Map<string, { trade: GroupedTrade; screenshotPaths: string[] }>();
    for (const chart of taggedCharts) {
      const screenshotPath = chart.screenshotUrl;
      if (!screenshotPath) {
        continue;
      }

      for (const trade of chart.linkedTrades) {
        if (!eligibleGameTags.has(trade.game)) {
          continue;
        }

        const current = grouped.get(trade.id);
        if (current) {
          if (!current.screenshotPaths.includes(screenshotPath)) {
            current.screenshotPaths.push(screenshotPath);
          }
          continue;
        }

        grouped.set(trade.id, {
          trade,
          screenshotPaths: [screenshotPath]
        });
      }
    }

    return grouped;
  }, [taggedCharts]);

  const eligibleTrades = useMemo(
    () =>
      matchedTrades
        .filter((trade) => eligibleGameTags.has(trade.game))
        .sort(
          (left, right) =>
            toSafeText(right.tradeDate).localeCompare(toSafeText(left.tradeDate)) ||
            toSafeText(left.openTime).localeCompare(toSafeText(right.openTime))
        ),
    [matchedTrades]
  );

  const existingTradeIds = useMemo(
    () => new Set(aPlusExamples.map((entry) => entry.tradeId)),
    [aPlusExamples]
  );

  const availableEligibleTrades = useMemo(
    () => eligibleTrades.filter((trade) => !existingTradeIds.has(trade.id)),
    [eligibleTrades, existingTradeIds]
  );

  const visibleExamples = useMemo(() => {
    const normalizedQuery = exampleSearchQuery.trim().toLowerCase();
    const filtered = aPlusExamples.filter((entry) => {
      if (!normalizedQuery) {
        return true;
      }
      const trade = tradeById.get(entry.tradeId);
      const searchTokens = [
        trade?.name ?? "",
        trade?.symbol ?? "",
        trade?.tradeDate ?? "",
        entry.tradeDate,
        entry.rating,
        trade?.status ?? "",
        trade?.side ?? "",
        trade?.game ?? "",
        ...(trade?.setups ?? [])
      ];
      return searchTokens.join(" ").toLowerCase().includes(normalizedQuery);
    });

    return filtered.sort((left, right) => {
      const leftTrade = tradeById.get(left.tradeId);
      const rightTrade = tradeById.get(right.tradeId);
      const leftDate = leftTrade?.tradeDate || left.tradeDate || "";
      const rightDate = rightTrade?.tradeDate || right.tradeDate || "";
      const dateComparison = compareDateStrings(leftDate, rightDate);
      if (dateComparison !== 0) {
        return exampleDateSort === "date-asc" ? dateComparison : -dateComparison;
      }

      const updatedAtComparison = compareDateStrings(left.updatedAt, right.updatedAt);
      if (updatedAtComparison !== 0) {
        return exampleDateSort === "date-asc" ? updatedAtComparison : -updatedAtComparison;
      }

      return left.id.localeCompare(right.id);
    });
  }, [aPlusExamples, exampleDateSort, exampleSearchQuery, tradeById]);

  const createExampleInlineImageInsertHandler = (exampleId: string) => async (file: File) =>
    saveWorkspaceInlineImage({
      category: "playbook-aplus-inline-images",
      recordId: playbook.id,
      slotKey: exampleId,
      file
    });

  useEffect(() => {
    if (autoExampleScreenshotsByTrade.size === 0) {
      return;
    }

    setPlaybooks((current) => {
      const targetPlaybook = current.find((candidate) => candidate.id === playbook.id);
      if (!targetPlaybook) {
        return current;
      }

      const now = new Date().toISOString();
      let hasChanges = false;
      let nextExamples = [...(targetPlaybook.aPlusExamples ?? [])];

      for (const [tradeId, candidate] of autoExampleScreenshotsByTrade) {
        if (candidate.screenshotPaths.length === 0) {
          continue;
        }
        if (dismissedTradeIdSet.has(tradeId)) {
          continue;
        }

        const existingIndex = nextExamples.findIndex((entry) => entry.tradeId === tradeId);
        if (existingIndex >= 0) {
          const trade = tradeById.get(tradeId) ?? candidate.trade;
          let targetIndex = existingIndex;
          const existing = nextExamples[targetIndex];
          let mergedScreenshotPaths = mergeScreenshotPaths(existing.screenshotPaths ?? [], candidate.screenshotPaths);

          // Clean up stale orphan examples that point to the same screenshot(s).
          const orphanIndex = nextExamples.findIndex(
            (entry, index) =>
              index !== targetIndex &&
              !tradeById.has(entry.tradeId) &&
              hasScreenshotPathOverlap(entry.screenshotPaths, mergedScreenshotPaths)
          );
          if (orphanIndex >= 0) {
            const orphan = nextExamples[orphanIndex];
            mergedScreenshotPaths = mergeScreenshotPaths(mergedScreenshotPaths, orphan.screenshotPaths);
            nextExamples.splice(orphanIndex, 1);
            if (orphanIndex < targetIndex) {
              targetIndex -= 1;
            }
            hasChanges = true;
          }

          const syncedRating = getSyncedExampleRating(trade) ?? existing.rating;
          const shouldUpdateExisting =
            mergedScreenshotPaths.length !== (existing.screenshotPaths ?? []).length ||
            existing.tradeDate !== trade.tradeDate ||
            existing.rating !== syncedRating;
          if (shouldUpdateExisting) {
            nextExamples[targetIndex] = {
              ...existing,
              tradeDate: trade.tradeDate,
              rating: syncedRating,
              screenshotPaths: mergedScreenshotPaths,
              updatedAt: now
            };
            hasChanges = true;
          }
          continue;
        }

        let relinkIndex = nextExamples.findIndex(
          (entry) =>
            !tradeById.has(entry.tradeId) &&
            hasScreenshotPathOverlap(entry.screenshotPaths, candidate.screenshotPaths)
        );
        if (relinkIndex < 0) {
          const tradeDateMatches = nextExamples
            .map((entry, index) => ({ entry, index }))
            .filter(
              ({ entry }) =>
                !tradeById.has(entry.tradeId) &&
                entry.tradeDate === candidate.trade.tradeDate
            );
          if (tradeDateMatches.length === 1) {
            relinkIndex = tradeDateMatches[0].index;
          }
        }
        if (relinkIndex >= 0) {
          const trade = tradeById.get(tradeId) ?? candidate.trade;
          const existing = nextExamples[relinkIndex];
          const mergedScreenshotPaths = mergeScreenshotPaths(existing.screenshotPaths ?? [], candidate.screenshotPaths);
          const syncedRating = getSyncedExampleRating(trade) ?? existing.rating;
          nextExamples[relinkIndex] = {
            ...existing,
            tradeId,
            tradeDate: trade.tradeDate,
            rating: syncedRating,
            screenshotPaths: mergedScreenshotPaths,
            updatedAt: now
          };
          hasChanges = true;
          continue;
        }

        const trade = tradeById.get(tradeId) ?? candidate.trade;
        const inferredRating = getSyncedExampleRating(trade) ?? "A+";
        nextExamples = [
          {
            id: createExampleId(),
            tradeId,
            tradeDate: trade.tradeDate,
            rating: inferredRating,
            notes: createEmptyJournalDoc(),
            screenshotPaths: [...candidate.screenshotPaths],
            recordingPath: "",
            createdAt: now,
            updatedAt: now
          },
          ...nextExamples
        ];
        hasChanges = true;
      }

      if (!hasChanges) {
        return current;
      }

      return current.map((candidate) =>
        candidate.id === playbook.id
          ? {
              ...candidate,
              updatedAt: now,
              aPlusExamples: nextExamples
            }
          : candidate
      );
    });
  }, [autoExampleScreenshotsByTrade, dismissedTradeIdSet, playbook.id, setPlaybooks, tradeById]);

  useEffect(() => {
    if (aPlusExamples.length === 0) {
      return;
    }

    setPlaybooks((current) => {
      const targetPlaybook = current.find((candidate) => candidate.id === playbook.id);
      if (!targetPlaybook) {
        return current;
      }

      const now = new Date().toISOString();
      let hasChanges = false;
      const nextExamples = targetPlaybook.aPlusExamples.map((entry) => {
        const trade = tradeById.get(entry.tradeId);
        if (!trade) {
          return entry;
        }

        const syncedRating = getSyncedExampleRating(trade);
        if (!syncedRating || entry.rating === syncedRating) {
          return entry;
        }

        hasChanges = true;
        return {
          ...entry,
          rating: syncedRating,
          updatedAt: now
        };
      });

      if (!hasChanges) {
        return current;
      }

      return current.map((candidate) =>
        candidate.id === playbook.id
          ? {
              ...candidate,
              updatedAt: now,
              aPlusExamples: nextExamples
            }
          : candidate
      );
    });
  }, [aPlusExamples.length, playbook.id, setPlaybooks, tradeById]);

  const getEntryFromState = (playbooks: PlaybookRecord[], exampleId: string): ExampleRecord | undefined => {
    const entries = playbooks.find((candidate) => candidate.id === playbook.id)?.aPlusExamples;
    return toSafeArray<unknown>(entries)
      .map((entry) => normalizeExampleRecord(entry))
      .find((entry): entry is ExampleRecord => Boolean(entry && entry.id === exampleId));
  };

  const dismissTradeIds = (tradeIds: string[]) => {
    const uniqueIds = Array.from(new Set(tradeIds.filter((value) => value.trim().length > 0)));
    if (uniqueIds.length === 0) {
      return;
    }
    setDismissedTradeIds((current) => pruneDismissedTradeIds([...current, ...uniqueIds]));
  };

  const clearDismissedTradeId = (tradeId: string) => {
    const trimmed = tradeId.trim();
    if (!trimmed) {
      return;
    }
    setDismissedTradeIds((current) => current.filter((value) => value !== trimmed));
  };

  const addExampleFromTrade = (trade: GroupedTrade) => {
    clearDismissedTradeId(trade.id);
    const now = new Date().toISOString();
    const example: ExampleRecord = {
      id: createExampleId(),
      tradeId: trade.id,
      tradeDate: trade.tradeDate,
      rating: getSyncedExampleRating(trade) ?? "A+",
      notes: createEmptyJournalDoc(),
      screenshotPaths: [],
      recordingPath: "",
      createdAt: now,
      updatedAt: now
    };

    setPlaybooks((current) => addPlaybookAPlusExample(current, playbook.id, example));
  };

  const pickScreenshot = (exampleId: string) => {
    setPendingAttachmentExampleId(exampleId);
    setPendingAttachmentKind("screenshot");

    if (isTauri()) {
      void pickAndSavePlaybookAttachment(playbook.id, exampleId, "screenshot")
        .then((path) => {
          if (!path) {
            return;
          }
          setPlaybooks((current) => {
            const entry = getEntryFromState(current, exampleId);
            const nextPaths = entry ? [...entry.screenshotPaths, path] : [path];
            return updatePlaybookAPlusExample(current, playbook.id, exampleId, { screenshotPaths: nextPaths });
          });
        })
        .finally(() => setPendingAttachmentExampleId(""));
      return;
    }

    screenshotInputRef.current?.click();
  };

  const pickRecording = (exampleId: string) => {
    setPendingAttachmentExampleId(exampleId);
    setPendingAttachmentKind("recording");

    if (!isTauri()) {
      return;
    }

    const previousRecordingPath =
      aPlusExamples.find((candidate) => candidate.id === exampleId)?.recordingPath ?? "";

    void pickAndSavePlaybookAttachment(playbook.id, exampleId, "recording")
      .then((path) => {
        if (!path) {
          return;
        }

        setPlaybooks((current) =>
          updatePlaybookAPlusExample(current, playbook.id, exampleId, { recordingPath: path })
        );
        if (previousRecordingPath && previousRecordingPath !== path) {
          void deletePlaybookAttachment(previousRecordingPath).catch(() => undefined);
        }
      })
      .finally(() => setPendingAttachmentExampleId(""));
  };

  const removeScreenshot = (exampleId: string, path: string) => {
    if (path && !path.startsWith("data:")) {
      void deletePlaybookAttachment(path).catch(() => undefined);
    }
    setPlaybooks((current) => {
      const entry = getEntryFromState(current, exampleId);
      const nextPaths = entry ? entry.screenshotPaths.filter((candidate) => candidate !== path) : [];
      return updatePlaybookAPlusExample(current, playbook.id, exampleId, { screenshotPaths: nextPaths });
    });
  };

  const clearRecording = (exampleId: string, path: string) => {
    if (path && !path.startsWith("data:")) {
      void deletePlaybookAttachment(path).catch(() => undefined);
    }
    setPlaybooks((current) =>
      updatePlaybookAPlusExample(current, playbook.id, exampleId, { recordingPath: "" })
    );
  };

  const removeExample = (exampleId: string) => {
    const entry = aPlusExamples.find((candidate) => candidate.id === exampleId);
    if (entry) {
      const tradeIdsToDismiss = new Set<string>();
      if (entry.tradeId.trim().length > 0) {
        tradeIdsToDismiss.add(entry.tradeId);
      }

      for (const [tradeId, candidate] of autoExampleScreenshotsByTrade) {
        if (hasScreenshotPathOverlap(entry.screenshotPaths, candidate.screenshotPaths)) {
          tradeIdsToDismiss.add(tradeId);
        }
      }

      for (const attachmentPath of collectWorkspaceAttachmentPaths(entry)) {
        void deletePlaybookAttachment(attachmentPath).catch(() => undefined);
      }

      dismissTradeIds(Array.from(tradeIdsToDismiss));
    }

    setPlaybooks((current) => removePlaybookAPlusExample(current, playbook.id, exampleId));
  };

  const relinkExampleByDate = (entry: ExampleRecord) => {
    const exactDateMatches = matchedTrades.filter((candidate) => candidate.tradeDate === entry.tradeDate);
    if (exactDateMatches.length === 0) {
      setRelinkFeedbackByExampleId((current) => ({
        ...current,
        [entry.id]: `No matching trade found for ${entry.tradeDate}.`
      }));
      return;
    }

    if (exactDateMatches.length > 1) {
      setRelinkFeedbackByExampleId((current) => ({
        ...current,
        [entry.id]: `Found ${exactDateMatches.length} trades on ${entry.tradeDate}. Open Trades and relink manually.`
      }));
      return;
    }

    const candidate = exactDateMatches[0];
    const isLinkedElsewhere = aPlusExamples.some(
      (existing) => existing.id !== entry.id && existing.tradeId === candidate.id
    );
    if (isLinkedElsewhere) {
      setRelinkFeedbackByExampleId((current) => ({
        ...current,
        [entry.id]: `Trade ${candidate.symbol} ${candidate.tradeDate} is already linked to another example.`
      }));
      return;
    }

    clearDismissedTradeId(candidate.id);
    setPlaybooks((current) =>
      updatePlaybookAPlusExample(current, playbook.id, entry.id, {
        tradeId: candidate.id,
        tradeDate: candidate.tradeDate,
        rating: getSyncedExampleRating(candidate) ?? entry.rating
      })
    );
    setRelinkFeedbackByExampleId((current) => ({
      ...current,
      [entry.id]: `Relinked to ${candidate.symbol} on ${candidate.tradeDate}.`
    }));
  };

  return (
    <div className="playbook-sections-column">
      <input
        ref={screenshotInputRef}
        type="file"
        accept="image/png,image/jpeg,image/jpg,image/webp,image/gif"
        className="drop-zone-input"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          const exampleId = pendingAttachmentExampleId;
          if (!exampleId || pendingAttachmentKind !== "screenshot" || files.length === 0) {
            event.currentTarget.value = "";
            return;
          }

          void readFileAsDataUrl(files[0])
            .then((dataUrl) => {
              setPlaybooks((current) => {
                const entry = getEntryFromState(current, exampleId);
                const nextPaths = entry ? [...entry.screenshotPaths, dataUrl] : [dataUrl];
                return updatePlaybookAPlusExample(current, playbook.id, exampleId, { screenshotPaths: nextPaths });
              });
            })
            .catch(() => undefined);

          setPendingAttachmentExampleId("");
          event.currentTarget.value = "";
        }}
      />

      <article className="placeholder-panel playbook-section-card playbook-aplus-panel">
        <div className="panel-header">
          <WorkspaceIcon icon="library" alt="A+ example library icon" className="panel-header-icon" />
          <h2>A+ Example Library</h2>
        </div>
        <span className="playbook-example-subtitle">
          Curate your best B+ and A game trades with screenshots, recordings, and notes. Tagged chart screenshots for
          B+ and A game trades are added here automatically.
        </span>
        {aPlusExamples.length > 0 ? (
          <div className="playbook-aplus-controls">
            <div className="playbook-database-search-row">
              <input
                type="search"
                className="playbook-search-input playbook-aplus-search-input"
                value={exampleSearchQuery}
                onChange={(event) => setExampleSearchQuery(event.target.value)}
                placeholder="Search examples by trade, symbol, setup, rating, or date"
                aria-label="Search A plus examples"
              />
              <label className="playbook-aplus-sort-field">
                <span>Sort Date</span>
                <select
                  className="journal-header-select"
                  value={exampleDateSort}
                  onChange={(event) => setExampleDateSort(event.target.value as "date-desc" | "date-asc")}
                  aria-label="Sort examples by date"
                >
                  <option value="date-desc">Newest first</option>
                  <option value="date-asc">Oldest first</option>
                </select>
              </label>
              {exampleSearchQuery.trim().length > 0 ? (
                <button type="button" className="mini-action mini-action-soft" onClick={() => setExampleSearchQuery("")}>
                  Clear
                </button>
              ) : null}
            </div>
            <span className="playbook-aplus-controls-meta">
              Showing {visibleExamples.length} of {aPlusExamples.length} example
              {aPlusExamples.length === 1 ? "" : "s"}
            </span>
          </div>
        ) : null}

        <div className="playbook-aplus-entry-list">
          {aPlusExamples.length === 0 ? (
            <div className="empty-state">
              No examples yet. Add a tagged B+ or A game trade below to start building your A+ library.
            </div>
          ) : visibleExamples.length === 0 ? (
            <div className="empty-state">
              No examples match the current search. Try a different symbol, setup, or date.
            </div>
          ) : (
            visibleExamples.map((entry) => {
              const trade = tradeById.get(entry.tradeId);
              const screenshotSrcs = entry.screenshotPaths.map((path) =>
                path.startsWith("data:") ? path : resolvePlaybookAttachmentSrc(path)
              );
              const recordingSrc = entry.recordingPath
                ? entry.recordingPath.startsWith("data:")
                  ? entry.recordingPath
                  : resolvePlaybookAttachmentSrc(entry.recordingPath)
                : "";
              const openingExecutions = trade ? toSafeArray<unknown>(trade.openingExecutions) : [];
              const closingExecutions = trade ? toSafeArray<unknown>(trade.closingExecutions) : [];
              const addSignals = trade ? toSafeArray<{ averagedDown?: boolean; addedToWinner?: boolean }>(trade.addSignals) : [];
              const executionCount = trade
                ? openingExecutions.length + closingExecutions.length
                : 0;
              const addCount = trade ? addSignals.length : 0;
              const averagedDownCount = trade
                ? addSignals.filter((signal) => Boolean(signal?.averagedDown)).length
                : 0;
              const addedToWinnerCount = trade
                ? addSignals.filter((signal) => Boolean(signal?.addedToWinner)).length
                : 0;
              const setupLabel =
                toSafeArray<string>(trade?.setups).find((candidate) => toSafeText(candidate).trim().length > 0)?.trim() ??
                playbook.name;
              const headerDate = trade?.tradeDate || entry.tradeDate || "-";
              const priceEdgePerShare = trade
                ? trade.side === "Long"
                  ? trade.exitPrice - trade.entryPrice
                  : trade.entryPrice - trade.exitPrice
                : 0;

              return (
                <section key={entry.id} className="playbook-aplus-entry">
                  <header className="playbook-aplus-entry-header">
                    <div className="playbook-aplus-entry-title">
                      <strong>{trade ? trade.name : "Unlinked Example"}</strong>
                      <span className="playbook-aplus-entry-subtitle">
                        {trade ? `${trade.symbol} - ${trade.tradeDate}` : `Trade date ${entry.tradeDate} - link missing`}
                      </span>
                      <div className="playbook-aplus-entry-meta">
                        <span className="playbook-meta-pill">Date {headerDate}</span>
                        <span className="playbook-meta-pill">
                          {trade ? `Setup ${setupLabel}` : "Awaiting relink"}
                        </span>
                        <span className="playbook-meta-pill">
                          {trade ? `${trade.side} ${trade.status}` : "Link missing"}
                        </span>
                      </div>
                    </div>
                    <div className="playbook-aplus-entry-actions">
                      <label className="playbook-aplus-rating">
                        <span>Rating</span>
                        <select
                          className="journal-header-select"
                          value={entry.rating}
                          onChange={(event) =>
                            setPlaybooks((current) =>
                              updatePlaybookAPlusExample(current, playbook.id, entry.id, {
                                rating: event.target.value as PlaybookExampleRating
                              })
                            )
                          }
                        >
                          {ratingOptions.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="playbook-aplus-entry-action-buttons">
                        {trade ? (
                          <button
                            type="button"
                            className="mini-action mini-action-soft"
                            onClick={() => onSelectTrade(trade.id, trade.tradeDate)}
                          >
                            Open Trade
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="mini-action mini-action-soft"
                            onClick={() => relinkExampleByDate(entry)}
                          >
                            Relink by Date
                          </button>
                        )}
                        <button
                          type="button"
                          className="mini-action mini-action-danger"
                          onClick={() => removeExample(entry.id)}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  </header>

                  <div className="playbook-aplus-attachment-row">
                    <button
                      type="button"
                      className="mini-action"
                      disabled={pendingAttachmentExampleId === entry.id}
                      onClick={() => pickScreenshot(entry.id)}
                    >
                      <WorkspaceIcon icon="camera" alt="Add screenshot icon" className="mini-action-icon" />
                      Add Screenshot
                    </button>
                    <button
                      type="button"
                      className="mini-action"
                      disabled={!isTauri() || pendingAttachmentExampleId === entry.id}
                      onClick={() => pickRecording(entry.id)}
                    >
                      <WorkspaceIcon icon="plan" alt="Add recording icon" className="mini-action-icon" />
                      Add Recording
                    </button>
                    {!isTauri() ? (
                      <span className="playbook-aplus-hint">
                        Recording uploads require the desktop app.
                      </span>
                    ) : null}
                  </div>

                  <div className="playbook-aplus-highlight-grid">
                    <section
                      className={`playbook-aplus-media-panel${recordingSrc ? "" : " playbook-aplus-media-panel-single"}`}
                      aria-label="Example media"
                    >
                      {screenshotSrcs.length > 0 ? (
                        <div className="playbook-aplus-screenshot-grid">
                          {screenshotSrcs.map((src, index) => (
                            <div key={`${entry.id}-shot-${index}`} className="playbook-aplus-screenshot-card">
                              <button
                                type="button"
                                className="journal-screenshot-preview-button playbook-aplus-screenshot-button"
                                style={{ backgroundImage: `url("${src}")` }}
                                onClick={() => onExpandImage(src)}
                              >
                                <img
                                  className="journal-screenshot-image playbook-aplus-screenshot-image"
                                  src={src}
                                  alt="Example screenshot"
                                />
                              </button>
                              <div className="journal-screenshot-actions">
                                <button
                                  type="button"
                                  className="mini-action mini-action-danger"
                                  onClick={() => removeScreenshot(entry.id, entry.screenshotPaths[index])}
                                >
                                  Remove
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="playbook-aplus-media-empty">
                          Add a screenshot to highlight your best execution for this trade.
                        </div>
                      )}

                      {recordingSrc ? (
                        <div className="playbook-aplus-recording">
                          <video className="playbook-aplus-recording-player" controls src={recordingSrc} />
                          <button
                            type="button"
                            className="mini-action mini-action-danger"
                            onClick={() => clearRecording(entry.id, entry.recordingPath)}
                          >
                            Remove Recording
                          </button>
                        </div>
                      ) : null}
                    </section>

                    <section
                      className={`playbook-aplus-trade-stats${trade ? "" : " playbook-aplus-trade-stats-missing"}`}
                      aria-label="Trade stats snapshot"
                    >
                      {trade ? (
                        <>
                          <div className="playbook-aplus-trade-stats-header">
                            <strong>Trade Stats</strong>
                            <span>
                              {trade.status} - {trade.side} - {trade.game || "No game tag"}
                            </span>
                          </div>
                          <div className="playbook-aplus-meta-grid">
                            <div className="playbook-aplus-meta-tile">
                              <span>Symbol</span>
                              <strong>{trade.symbol || "-"}</strong>
                            </div>
                            <div className="playbook-aplus-meta-tile">
                              <span>Setup</span>
                              <strong>{setupLabel}</strong>
                            </div>
                            <div className="playbook-aplus-meta-tile">
                              <span>Win / Loss</span>
                              <strong>{trade.status}</strong>
                            </div>
                          </div>
                          <div className="playbook-aplus-stat-grid">
                            <div className="playbook-aplus-stat-tile">
                              <span>Net PnL</span>
                              <strong className={getSignedValueClassName(trade.netPnlUsd)}>
                                {formatSignedMoney(trade.netPnlUsd)}
                              </strong>
                            </div>
                            <div className="playbook-aplus-stat-tile">
                              <span>Return / Share</span>
                              <strong className={getSignedValueClassName(trade.returnPerShare)}>
                                {formatSignedPerShare(trade.returnPerShare)}
                              </strong>
                            </div>
                            <div className="playbook-aplus-stat-tile">
                              <span>Price Edge / Share</span>
                              <strong className={getSignedValueClassName(priceEdgePerShare)}>
                                {formatSignedPerShare(priceEdgePerShare)}
                              </strong>
                            </div>
                            <div className="playbook-aplus-stat-tile">
                              <span>Size</span>
                              <strong>{formatSize(trade.size)}</strong>
                            </div>
                            <div className="playbook-aplus-stat-tile">
                              <span>Entry</span>
                              <strong>{formatPrice(trade.entryPrice)}</strong>
                            </div>
                            <div className="playbook-aplus-stat-tile">
                              <span>Exit</span>
                              <strong>{formatPrice(trade.exitPrice)}</strong>
                            </div>
                            <div className="playbook-aplus-stat-tile">
                              <span>Hold Time</span>
                              <strong>{trade.holdTime || "-"}</strong>
                            </div>
                            <div className="playbook-aplus-stat-tile">
                              <span>Executions</span>
                              <strong>{executionCount}</strong>
                            </div>
                            <div className="playbook-aplus-stat-tile">
                              <span>Adds</span>
                              <strong>
                                {addCount} total ({averagedDownCount} avg down / {addedToWinnerCount} winner)
                              </strong>
                            </div>
                            <div className="playbook-aplus-stat-tile">
                              <span>Fees</span>
                              <strong>{formatCurrency(trade.feesUsd)}</strong>
                            </div>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="playbook-aplus-trade-stats-header">
                            <strong>Trade Stats</strong>
                            <span>Linked trade unavailable</span>
                          </div>
                          <div className="playbook-aplus-meta-grid">
                            <div className="playbook-aplus-meta-tile">
                              <span>Status</span>
                              <strong>Link missing</strong>
                            </div>
                            <div className="playbook-aplus-meta-tile">
                              <span>Trade Date</span>
                              <strong>{entry.tradeDate || "-"}</strong>
                            </div>
                            <div className="playbook-aplus-meta-tile">
                              <span>Rating</span>
                              <strong>{entry.rating}</strong>
                            </div>
                          </div>
                          <p className="playbook-aplus-missing-copy">
                            This example is still saved, but its original trade record is no longer in the library.
                          </p>
                          {relinkFeedbackByExampleId[entry.id] ? (
                            <p className="playbook-aplus-relink-feedback">{relinkFeedbackByExampleId[entry.id]}</p>
                          ) : null}
                        </>
                      )}
                    </section>
                  </div>

                  <div className="playbook-aplus-notes">
                    <JournalRichTextEditor
                      content={entry.notes}
                      onChange={(content) =>
                        setPlaybooks((current) =>
                          updatePlaybookAPlusExample(current, playbook.id, entry.id, { notes: content })
                        )
                      }
                      onImageInsert={createExampleInlineImageInsertHandler(entry.id)}
                      placeholder="Add why this is an A+ example, execution notes, and what to repeat."
                    />
                  </div>
                </section>
              );
            })
          )}
        </div>
      </article>

      <article className="placeholder-panel playbook-section-card playbook-aplus-panel">
        <div className="panel-header">
          <WorkspaceIcon icon="trades" alt="Tagged trades icon" className="panel-header-icon" />
          <h2>Eligible Trades (B+ and A Game)</h2>
        </div>
        <span className="playbook-example-subtitle">
          Trades are eligible when they match this playbook and have a game tag of B+ Game or A Game.
        </span>
        <div className="playbook-aplus-eligible-list">
          {availableEligibleTrades.length === 0 ? (
            <div className="empty-state">
              No eligible trades found. Tag more trades with {playbook.name} and make sure their game score is B+ or A.
            </div>
          ) : (
            availableEligibleTrades.slice(0, 24).map((trade) => (
              <div key={trade.id} className="playbook-aplus-eligible-row">
                <div className="playbook-aplus-eligible-copy">
                  <div className="playbook-aplus-eligible-top">
                    <strong>{trade.name}</strong>
                    <span className={getSignedValueClassName(trade.netPnlUsd)}>
                      {formatSignedMoney(trade.netPnlUsd)}
                    </span>
                  </div>
                  <span className="playbook-aplus-eligible-inline-row">
                    <span>Date {trade.tradeDate}</span>
                    <span>{trade.symbol}</span>
                    <span>
                      {trade.openTime} to {trade.closeTime}
                    </span>
                    <span>Hold {getHoldLabel(trade)}</span>
                  </span>
                  <span className="playbook-aplus-eligible-inline-row playbook-aplus-eligible-inline-row-tight">
                    <span>
                      {trade.side} - {trade.status}
                    </span>
                    <span>Size {formatSize(trade.size)}</span>
                    <span>In {formatMoney(trade.entryPrice)}</span>
                    <span>Out {formatMoney(trade.exitPrice)}</span>
                    <span>Fees {formatMoney(trade.feesUsd)}</span>
                  </span>
                </div>
                <div className="playbook-aplus-eligible-actions">
                  <button type="button" className="mini-action" onClick={() => addExampleFromTrade(trade)}>
                    Add To Library
                  </button>
                  <button
                    type="button"
                    className="mini-action mini-action-soft"
                    onClick={() => onSelectTrade(trade.id, trade.tradeDate)}
                  >
                    Review
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </article>
    </div>
  );
};

