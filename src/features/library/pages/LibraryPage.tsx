import { useEffect, useMemo, useRef, useState } from "react";
import type { JSONContent } from "@tiptap/core";
import { JournalRichTextEditor } from "../../journal/components/JournalRichTextEditor";
import { PlaybooksPage } from "../../playbooks/pages/PlaybooksPage";
import { ChartLibraryPanel } from "../components/ChartLibraryPanel";
import { PageHero } from "../../../components/PageHero";
import { WorkspaceIcon } from "../../../components/WorkspaceIcon";
import { PropertyMultiSelect } from "../../../components/PropertyMultiSelect";
import { FilterSelect } from "../../../components/FilterSelect";
import { TagDrawer } from "../../../components/TagDrawer";
import { ErrorBoundary } from "../../../components/ErrorBoundary";
import { getTickerIcon, resolveTickerGroupIcon, tickerIcons } from "../../../lib/tickers/tickerIcons";
import { parseTickerList } from "../../../lib/tickers/tickerList";
import { useDebouncedSave } from "../../../lib/hooks/useDebouncedSave";
import { useEditableSelectOptions } from "../../../lib/select/useEditableSelectOptions";
import {
  createLibraryBookRow,
  createLibraryPage,
  createLibraryStrongViewRow,
  createLibraryQuoteRow,
  libraryCollections,
  loadLibraryPages,
  recoverLibraryPagesFromDesktopBackup,
  saveLibraryPages
} from "../../../lib/library/libraryStore";
import type { LibraryCollectionId, LibraryPageRecord } from "../../../types/library";
import type { JournalPageRecord, JournalScreenshotTagRecord, JournalScreenshotTradeLink } from "../../../types/journal";
import type { Settings } from "../../../types/trade";
import type { GroupedTrade } from "../../../types/trade";
import { ReviewDatabaseTable } from "../components/ReviewDatabaseTable";
import { TickerGroupIconPicker } from "../components/TickerGroupIconPicker";
import { ReviewReflectionPanel } from "../components/review/ReviewReflectionPanel";
import { coerceReviewReflectionState, loadReviewTemplates, saveReviewTemplates } from "../../../lib/review/reviewTemplateStore";
import { SYNC_HYDRATED_EVENT } from "../../../lib/sync/syncStore";
import { createEmptyJournalDoc } from "../../../lib/journal/journalContent";
import {
  LIBRARY_PAGES_STORAGE_KEY,
  collectWorkspaceAttachmentPaths,
  deleteWorkspaceAttachmentIfUnused,
  resolveWorkspaceAttachmentSrc,
  saveWorkspaceInlineImage,
  saveUploadedWorkspaceAttachment
} from "../../../lib/workspace/workspaceAttachmentClient";
import {
  buildReviewPropertiesPatch,
  computeOverallScore,
  computeReviewMetrics,
  getDailyShutdownRiskFromSettings,
  getReviewPeriodForCollection,
  getPreviousReviewRange,
  getReviewRangesFromTrades,
  getReviewRange,
  getReviewTitleForRange,
  REVIEW_PROPERTY_KEYS
} from "../lib/reviewUtils";

const statusOptions = ["Active", "Draft", "Review", "Archived"];
const REVIEW_REFLECTION_KEY = "__review_reflection_v1";
const BOOK_CUSTOM_TEXT_FIELDS_PROPERTY_KEY = "__book_custom_text_fields_v1";
const noteTypeOptions = [
  { label: "Ideas", tag: "idea" },
  { label: "Market Notes", tag: "market-notes" },
  { label: "Mental Game", tag: "mental-game" },
  { label: "Book Notes", tag: "book-notes" }
] as const;
const DEFAULT_NOTES_TAB = "All";
const ARCHIVED_NOTES_TAB = "Archived";
const defaultNoteTypeLabels = noteTypeOptions.map((option) => option.label);
const NOTE_TYPE_PROPERTY_KEY = "Note Type";
const NOTE_TYPE_LABEL_PROPERTY_KEY = "Note Type Label";
const noteTypeTagSet = new Set<string>(noteTypeOptions.map((option) => option.tag));

type NotesTab = string;

const formatUpdatedAt = (value: string): string => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "Just now";
  }

  return parsed.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
};

const getDateOnlyIsoString = (value: string): string => {
  if (!value) {
    return "";
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  return parsed.toISOString().slice(0, 10);
};

const renderPropertyValue = (
  page: LibraryPageRecord,
  propertyName: string,
  fallback = "-"
): string => {
  const value = page.properties?.[propertyName];
  if (Array.isArray(value)) {
    const parts = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
    return parts.length > 0 ? parts.join(", ") : fallback;
  }

  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }

  if (typeof value === "number") {
    return String(value);
  }

  if (typeof value === "string") {
    return value || fallback;
  }

  return fallback;
};

const renderPropertyList = (page: LibraryPageRecord, propertyName: string): string[] => {
  const value = page.properties?.[propertyName];
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  }

  if (typeof value === "string" && value.trim()) {
    return [value.trim()];
  }

  return [];
};

const normalizeTickerToken = (value: string): string => value.trim().replace(/^\$/, "").toUpperCase();

const isBookRow = (page: LibraryPageRecord): boolean => page.tags.includes("book-row");

const isQuoteRow = (page: LibraryPageRecord): boolean => page.tags.includes("quote-row");

const isStrongViewRow = (page: LibraryPageRecord): boolean => page.tags.includes("strong-view-row");

const bookReadingStatusOptions = ["To Read", "In Progress", "Completed", "Abandoned", "Imported"];

const getBookFieldValue = (page: LibraryPageRecord, propertyName: string): string =>
  renderPropertyValue(page, propertyName, "");

type BookCustomTextField = {
  id: string;
  label: string;
  content: JSONContent;
};

const isJournalDoc = (value: unknown): value is JSONContent =>
  !!value &&
  typeof value === "object" &&
  "type" in value &&
  (value as { type?: unknown }).type === "doc";

const createJournalDocFromPlainText = (text: string): JSONContent => {
  const normalized = text.replace(/\r\n/g, "\n");
  if (!normalized.trim()) {
    return createEmptyJournalDoc();
  }

  const content = normalized.split("\n").map((line) =>
    line.trim()
      ? ({
          type: "paragraph",
          content: [{ type: "text", text: line }]
        } satisfies JSONContent)
      : ({ type: "paragraph" } satisfies JSONContent)
  );

  return {
    type: "doc",
    content
  };
};

const getPropertyRichTextFieldValue = (page: LibraryPageRecord, propertyName: string): JSONContent => {
  const value = page.properties?.[propertyName];
  if (isJournalDoc(value)) {
    return value;
  }

  if (typeof value === "string") {
    return createJournalDocFromPlainText(value);
  }

  return createEmptyJournalDoc();
};

const sanitizeBookCustomTextField = (value: unknown, index: number): BookCustomTextField | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const label = typeof record.label === "string" ? record.label.trim() : "";
  if (!label) {
    return null;
  }

  const idValue = typeof record.id === "string" ? record.id.trim() : "";
  const id = idValue || `custom-field-${index + 1}`;
  const fieldContent = isJournalDoc(record.content)
    ? record.content
    : typeof record.value === "string"
      ? createJournalDocFromPlainText(record.value)
      : createEmptyJournalDoc();

  return {
    id,
    label,
    content: fieldContent
  };
};

const getBookCustomTextFields = (page: LibraryPageRecord): BookCustomTextField[] => {
  const raw = page.properties?.[BOOK_CUSTOM_TEXT_FIELDS_PROPERTY_KEY];
  if (!Array.isArray(raw)) {
    return [];
  }

  const fields = raw
    .map((entry, index) => sanitizeBookCustomTextField(entry, index))
    .filter((entry): entry is BookCustomTextField => entry !== null);

  const seen = new Set<string>();
  return fields.filter((field) => {
    if (seen.has(field.id)) {
      return false;
    }

    seen.add(field.id);
    return true;
  });
};

const getQuoteFieldValue = (page: LibraryPageRecord, propertyName: string): string =>
  renderPropertyValue(page, propertyName, "");

const getQuoteRichTextFieldValue = (page: LibraryPageRecord): JSONContent =>
  getPropertyRichTextFieldValue(page, "Quote");

const getLibraryDraftStorageKey = (pageId: string, fieldKey: string): string => `library:${pageId}:${fieldKey}`;

const getQuoteUsedValue = (page: LibraryPageRecord): boolean => {
  const value = page.properties?.Used;
  return typeof value === "boolean" ? value : false;
};

const getQuoteDateUsedValue = (page: LibraryPageRecord): string => {
  const value = page.properties?.["Date Used"];
  return typeof value === "string" ? value : "";
};

const getQuoteDateUsedForInput = (page: LibraryPageRecord): string =>
  getDateOnlyIsoString(getQuoteDateUsedValue(page));

const getStrongViewFieldValue = (page: LibraryPageRecord, propertyName: string): string =>
  renderPropertyValue(page, propertyName, "");

const getStrongViewTickerValue = (page: LibraryPageRecord): string =>
  getStrongViewFieldValue(page, "Ticker").trim().toUpperCase();

const getStrongViewTickerIcon = (page: LibraryPageRecord): string => {
  const ticker = getStrongViewTickerValue(page);
  return ticker ? getTickerIcon(ticker) ?? "" : "";
};

const getStrongViewDateValue = (page: LibraryPageRecord): string =>
  getDateOnlyIsoString(getStrongViewFieldValue(page, "Date"));

const formatReadableDate = (dateValue: string): string => {
  const normalized = getDateOnlyIsoString(dateValue);
  if (!normalized) {
    return "";
  }

  const parts = normalized.split("-");
  if (parts.length !== 3) {
    return normalized;
  }

  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return normalized;
  }

  const monthNames = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December"
  ];

  const monthName = monthNames[month - 1];
  if (!monthName) {
    return normalized;
  }

  const isTeen = day % 100 >= 11 && day % 100 <= 13;
  const suffix = isTeen ? "th" : day % 10 === 1 ? "st" : day % 10 === 2 ? "nd" : day % 10 === 3 ? "rd" : "th";

  return `${monthName} ${day}${suffix}, ${year}`;
};

const getStrongViewNumericValue = (page: LibraryPageRecord, propertyName: "ATR" | "RVOL"): number | null => {
  const rawValue = getStrongViewFieldValue(page, propertyName).trim();
  if (!rawValue) {
    return null;
  }

  const numeric = Number(rawValue);
  return Number.isFinite(numeric) ? numeric : null;
};

const formatStrongViewNumeric = (page: LibraryPageRecord, propertyName: "ATR" | "RVOL"): string => {
  const numeric = getStrongViewNumericValue(page, propertyName);
  return numeric === null ? "-" : String(numeric);
};

const getStrongViewMorningChatValue = (page: LibraryPageRecord): string =>
  getStrongViewFieldValue(page, "Morning Chat");

const getStrongViewMorningChatSrc = (page: LibraryPageRecord): string =>
  resolveWorkspaceAttachmentSrc(getStrongViewMorningChatValue(page));

const getStrongViewRichTextFieldValue = (page: LibraryPageRecord, propertyName: string): JSONContent =>
  getPropertyRichTextFieldValue(page, propertyName);

const normalizeStrongViewBiasValue = (value: string): string => value.trim().toLowerCase();

const getStrongViewBiasToneClass = (value: string): string => {
  const normalized = normalizeStrongViewBiasValue(value);
  if (normalized === "bullish") {
    return "library-status-pill-strong-view-bullish";
  }

  if (normalized === "bearish") {
    return "library-status-pill-strong-view-bearish";
  }

  if (normalized === "neutral") {
    return "library-status-pill-strong-view-neutral";
  }

  return "library-status-pill-strong-view-unset";
};

const getReadingStatusToneClass = (value: string): string => {
  switch (value) {
    case "Completed":
      return "library-status-pill-completed";
    case "In Progress":
      return "library-status-pill-progress";
    case "Abandoned":
      return "library-status-pill-abandoned";
    case "To Read":
      return "library-status-pill-toread";
    default:
      return "";
  }
};

const scoreOptions = ["", "1", "2", "3", "4", "5"];

const normalizeTagToken = (value: string): string =>
  value.trim().toLowerCase().replace(/\s+/g, "-");

const normalizeNoteTypeToken = (value: string): string => normalizeTagToken(value);

const resolveNoteTypeTokenFromInput = (value: string): string => {
  const normalized = normalizeNoteTypeToken(value);
  if (!normalized) {
    return "";
  }

  const matchedOption = noteTypeOptions.find(
    (option) => option.tag === normalized || normalizeTagToken(option.label) === normalized
  );

  return matchedOption?.tag ?? normalized;
};

const formatNoteTypeLabel = (token: string): string =>
  noteTypeOptions.find((option) => option.tag === token)?.label ?? token;

const getStoredNoteTypeTag = (page: LibraryPageRecord): string => {
  const value = page.properties?.[NOTE_TYPE_PROPERTY_KEY];
  return typeof value === "string" ? resolveNoteTypeTokenFromInput(value) : "";
};

const getStoredNoteTypeLabel = (page: LibraryPageRecord): string => {
  const value = page.properties?.[NOTE_TYPE_LABEL_PROPERTY_KEY];
  return typeof value === "string" ? value.trim() : "";
};

const resolveNoteTypeTag = (page: LibraryPageRecord): string => {
  const storedTypeTag = getStoredNoteTypeTag(page);
  if (storedTypeTag) {
    return storedTypeTag;
  }

  const tags = page.tags.map(normalizeTagToken);
  const matchedType = noteTypeOptions.find((option) => tags.includes(option.tag));
  return matchedType?.tag ?? "idea";
};

const resolveEditableNoteType = (page: LibraryPageRecord): string => {
  const resolvedTypeTag = resolveNoteTypeTag(page);
  const builtInLabel = noteTypeOptions.find((option) => option.tag === resolvedTypeTag)?.label;
  if (builtInLabel) {
    return builtInLabel;
  }

  const storedLabel = getStoredNoteTypeLabel(page);
  if (storedLabel && resolveNoteTypeTokenFromInput(storedLabel) === resolvedTypeTag) {
    return storedLabel;
  }

  return formatNoteTypeLabel(resolvedTypeTag);
};

const applyNoteTypeToTags = (page: LibraryPageRecord, nextTypeToken: string): string[] => {
  if (!nextTypeToken) {
    return page.tags.map(normalizeTagToken).filter(Boolean);
  }

  const normalizedTags = page.tags.map(normalizeTagToken).filter(Boolean);
  const currentTypeTag = resolveNoteTypeTag(page);
  const removableTypeTags = new Set<string>([...noteTypeTagSet, currentTypeTag]);
  const nonTypeTags = normalizedTags.filter((tag) => !removableTypeTags.has(tag));

  return Array.from(new Set([nextTypeToken, ...nonTypeTags]));
};

const resolveNoteType = (page: LibraryPageRecord): NotesTab => resolveEditableNoteType(page);

const getLibraryStatusToneClass = (value: string): string => {
  switch (value) {
    case "Archived":
      return "library-status-pill-archived";
    case "Imported":
      return "library-status-pill-imported";
    case "Draft":
      return "library-status-pill-draft";
    case "Review":
      return "library-status-pill-review";
    case "Active":
      return "library-status-pill-active";
    default:
      return "";
  }
};

const normalizeIsoTradeDate = (value: string): string => {
  if (!value) {
    return "";
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toISOString().slice(0, 10);
};

const formatSignedUsd = (value: number): string => {
  const amount = Number.isFinite(value) ? value : 0;
  const formatted = Math.abs(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return amount >= 0 ? `+$${formatted}` : `-$${formatted}`;
};

const formatUsd = (value: number): string => {
  const amount = Number.isFinite(value) ? value : 0;
  return `$${Math.abs(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const formatTradePrice = (value: number): string => (Number.isFinite(value) ? value.toFixed(4) : "-");

const formatSignedDecimal = (value: number, digits = 4): string => {
  const amount = Number.isFinite(value) ? value : 0;
  const formatted = Math.abs(amount).toFixed(digits);
  return amount >= 0 ? `+${formatted}` : `-${formatted}`;
};

const formatTradeNumber = (value: number): string => (Number.isFinite(value) ? value.toLocaleString() : "-");

type ReviewComparisonTone = "positive" | "negative" | "neutral";

type ReviewCompareCardData = {
  currentLabel: string;
  previousLabel: string;
  deltaLabel: string;
  deltaTone: ReviewComparisonTone;
};

type TaggedReviewChart = {
  screenshotUrl: string;
  taggedDate: string;
  journalTradeDate: string;
  updatedAt: string;
};

type ReviewTradeSpotlightData = {
  trade: GroupedTrade;
  taggedChart: TaggedReviewChart | null;
};

type ReviewTradeSpotlightKind = "best" | "worst";

const REVIEW_TRADE_LINK_SEPARATOR = "::";

const dedupeReviewScreenshotTradeLinks = (links: JournalScreenshotTradeLink[]): JournalScreenshotTradeLink[] => {
  const unique = new Map<string, JournalScreenshotTradeLink>();

  for (const link of links) {
    const tradeId = typeof link.tradeId === "string" ? link.tradeId.trim() : "";
    const tradeDate = typeof link.tradeDate === "string" ? normalizeIsoTradeDate(link.tradeDate) : "";
    if (!tradeId || !tradeDate) {
      continue;
    }

    unique.set(`${tradeId}${REVIEW_TRADE_LINK_SEPARATOR}${tradeDate}`, { tradeId, tradeDate });
  }

  return Array.from(unique.values());
};

const getReviewScreenshotTradeLinks = (
  screenshotTag: JournalScreenshotTagRecord | undefined
): JournalScreenshotTradeLink[] => {
  if (!screenshotTag) {
    return [];
  }

  const normalizedLinkedTrades = Array.isArray(screenshotTag.linkedTrades)
    ? screenshotTag.linkedTrades.map((link) => ({
        tradeId: typeof link.tradeId === "string" ? link.tradeId.trim() : "",
        tradeDate: typeof link.tradeDate === "string" ? normalizeIsoTradeDate(link.tradeDate) : ""
      }))
    : [];

  const legacyTradeId = typeof screenshotTag.linkedTradeId === "string" ? screenshotTag.linkedTradeId.trim() : "";
  const legacyTradeDate =
    typeof screenshotTag.linkedTradeDate === "string" ? normalizeIsoTradeDate(screenshotTag.linkedTradeDate) : "";
  const legacyLink =
    legacyTradeId && legacyTradeDate
      ? [
          {
            tradeId: legacyTradeId,
            tradeDate: legacyTradeDate
          }
        ]
      : [];

  return dedupeReviewScreenshotTradeLinks([...normalizedLinkedTrades, ...legacyLink]);
};

const findTaggedChartForTrade = (journalPages: JournalPageRecord[], trade: GroupedTrade): TaggedReviewChart | null => {
  const tradeDate = normalizeIsoTradeDate(trade.tradeDate);
  let match: TaggedReviewChart | null = null;

  for (const page of journalPages) {
    const screenshotUrls = Array.isArray(page.screenshotUrls) ? page.screenshotUrls : [];
    const screenshotTags = Array.isArray(page.screenshotTags) ? page.screenshotTags : [];
    const journalTradeDate = normalizeIsoTradeDate(page.tradeDate);

    for (const [index, screenshotUrl] of screenshotUrls.entries()) {
      if (typeof screenshotUrl !== "string" || !screenshotUrl.trim()) {
        continue;
      }

      const screenshotTag = screenshotTags[index];
      const isLinkedToTrade = getReviewScreenshotTradeLinks(screenshotTag).some(
        (link) => link.tradeId === trade.id && (!tradeDate || link.tradeDate === tradeDate)
      );

      if (!isLinkedToTrade) {
        continue;
      }

      const taggedDate =
        typeof screenshotTag?.taggedDate === "string" ? normalizeIsoTradeDate(screenshotTag.taggedDate) : "";
      const candidate: TaggedReviewChart = {
        screenshotUrl,
        taggedDate: taggedDate || journalTradeDate,
        journalTradeDate,
        updatedAt: page.updatedAt
      };

      if (!match || Date.parse(candidate.updatedAt || "") >= Date.parse(match.updatedAt || "")) {
        match = candidate;
      }
    }
  }

  return match;
};

const ReviewTradeSpotlightCard = ({
  kind,
  data,
  onSelectTrade,
  onOpenJournalDate
}: {
  kind: ReviewTradeSpotlightKind;
  data: ReviewTradeSpotlightData | null;
  onSelectTrade: (tradeId: string, tradeDate: string) => void;
  onOpenJournalDate: (tradeDate: string) => void;
}) => {
  const isWorst = kind === "worst";
  const title = isWorst ? "Worst Trade" : "Best Trade";
  const emptyTitle = isWorst ? "No worst trade yet." : "No best trade yet.";

  return (
    <section
      className={`journal-writing-section review-writing-section review-best-trade-section${
        isWorst ? " review-worst-trade-section" : ""
      }`}
    >
      <div className="journal-writing-header">
        <div className="journal-writing-header-title">
          <WorkspaceIcon icon={isWorst ? "execution" : "win"} alt="" className="mini-action-icon" />
          <strong>{title}</strong>
        </div>
        {data ? (
          <div className="journal-writing-header-actions">
            <button
              type="button"
              className="mini-action"
              onClick={() =>
                onSelectTrade(data.trade.id, normalizeIsoTradeDate(data.trade.tradeDate) || data.trade.tradeDate)
              }
            >
              Open Trade
            </button>
          </div>
        ) : null}
      </div>

      {data ? (
        (() => {
          const { trade, taggedChart } = data;
          const tradeDate = normalizeIsoTradeDate(trade.tradeDate);
          const symbolIcon = getTickerIcon(trade.symbol);
          const fillCount = trade.openingExecutions.length + trade.closingExecutions.length;
          const statCards: Array<{ label: string; value: string; tone?: "positive" | "negative" }> = [
            {
              label: "Net PnL",
              value: formatSignedUsd(trade.netPnlUsd),
              tone: trade.netPnlUsd >= 0 ? "positive" : "negative"
            },
            {
              label: "Gross PnL",
              value: formatSignedUsd(trade.grossPnlUsd),
              tone: trade.grossPnlUsd >= 0 ? "positive" : "negative"
            },
            { label: "Fees", value: formatUsd(trade.feesUsd) },
            {
              label: "Return / Share",
              value: formatSignedDecimal(trade.returnPerShare),
              tone: trade.returnPerShare >= 0 ? "positive" : "negative"
            },
            { label: "Size", value: formatTradeNumber(Math.abs(trade.size || 0)) },
            { label: "Entry", value: formatTradePrice(trade.entryPrice) },
            { label: "Exit", value: formatTradePrice(trade.exitPrice) },
            { label: "Hold", value: trade.holdTime || `${Math.round((trade.holdSeconds || 0) / 60)}m` },
            { label: "Side", value: trade.side },
            { label: "Fills", value: formatTradeNumber(fillCount) }
          ];
          const tagGroups = [
            { label: "Playbook", values: trade.setups.filter((value) => value && value !== "No Setup") },
            { label: "Mistakes", values: trade.mistakes },
            { label: "Catalyst", values: trade.catalyst },
            { label: "Execution", values: trade.execution },
            { label: "Out Tag", values: trade.outTag },
            { label: "Gateways", values: trade.gateways }
          ]
            .map((group) => ({
              ...group,
              values: Array.from(new Set(group.values.map((value) => value.trim()).filter(Boolean)))
            }))
            .filter((group) => group.values.length > 0);

          return (
            <div className="review-best-trade-layout">
              <div className="review-best-trade-details">
                <div className="review-best-trade-identity">
                  <span className="symbol-pill review-best-trade-symbol">
                    {symbolIcon ? (
                      <img src={symbolIcon} alt={`${trade.symbol} icon`} className="symbol-pill-icon" />
                    ) : (
                      <WorkspaceIcon icon="trades" alt="" className="symbol-pill-icon" />
                    )}
                    {trade.symbol}
                  </span>
                  <div className="review-best-trade-title">
                    <strong>{trade.name || `${trade.symbol} ${trade.side}`}</strong>
                    <span>
                      {tradeDate || trade.tradeDate} | {trade.openTime || "--"} to {trade.closeTime || "--"}
                    </span>
                  </div>
                  <span className={`review-best-trade-status review-best-trade-status-${trade.status.toLowerCase()}`}>
                    {trade.status}
                  </span>
                </div>

                <div className="review-best-trade-stats" aria-label={`${title} stats`}>
                  {statCards.map((stat) => (
                    <div
                      key={stat.label}
                      className={`review-best-trade-stat${stat.tone ? ` review-best-trade-stat-${stat.tone}` : ""}`}
                    >
                      <span>{stat.label}</span>
                      <strong>{stat.value}</strong>
                    </div>
                  ))}
                </div>

                <div className="review-best-trade-tag-area" aria-label={`${title} tags`}>
                  {tagGroups.length > 0 ? (
                    tagGroups.map((group) => (
                      <div key={group.label} className="review-best-trade-tag-group">
                        <span>{group.label}</span>
                        <div>
                          {group.values.map((value) => (
                            <em key={`${group.label}-${value}`}>{value}</em>
                          ))}
                        </div>
                      </div>
                    ))
                  ) : (
                    <span className="review-best-trade-tag-empty">No trade tags on this one yet.</span>
                  )}
                </div>
              </div>

              <div className="review-best-trade-chart">
                {taggedChart ? (
                  <>
                    <button
                      type="button"
                      className="review-best-trade-chart-button"
                      onClick={() => onSelectTrade(trade.id, tradeDate || trade.tradeDate)}
                      title={`Open ${trade.symbol} trade`}
                    >
                      <img
                        src={resolveWorkspaceAttachmentSrc(taggedChart.screenshotUrl)}
                        alt={`${trade.symbol} tagged chart`}
                      />
                    </button>
                    <div className="review-best-trade-chart-meta">
                      <strong>Tagged Chart</strong>
                      <span>
                        {taggedChart.taggedDate
                          ? `Tagged ${taggedChart.taggedDate}`
                          : `Journal ${taggedChart.journalTradeDate || tradeDate}`}
                      </span>
                    </div>
                  </>
                ) : (
                  <div className="review-best-trade-chart-empty">
                    <WorkspaceIcon icon="chart-screenshots" alt="" className="mini-action-icon" />
                    <strong>No tagged chart yet</strong>
                    <span>Tag a journal screenshot to this trade and it will show here.</span>
                    {tradeDate ? (
                      <button
                        type="button"
                        className="mini-action mini-action-soft"
                        onClick={() => onOpenJournalDate(tradeDate)}
                      >
                        Open Journal
                      </button>
                    ) : null}
                  </div>
                )}
              </div>
            </div>
          );
        })()
      ) : (
        <div className="review-best-trade-empty">
          <strong>{emptyTitle}</strong>
          <span>This review range does not have any trades to rank.</span>
        </div>
      )}
    </section>
  );
};

const parseReviewMppNumber = (value: string): number | null => {
  const normalized = value.replace(/[^0-9,.-]/g, "").replace(/,/g, "");
  if (!normalized || normalized === "-" || normalized === "." || normalized === "-.") {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

const formatSignedWhole = (value: number): string => {
  const rounded = Math.round(value);
  if (rounded === 0) {
    return "0";
  }

  return `${rounded > 0 ? "+" : "-"}${Math.abs(rounded).toLocaleString()}`;
};

const formatRelativeDeltaPercent = (delta: number, previous: number): string => {
  if (previous === 0) {
    return delta === 0 ? "0.0%" : "n/a";
  }

  const relative = (delta / Math.abs(previous)) * 100;
  return `${relative >= 0 ? "+" : ""}${relative.toFixed(1)}%`;
};

const formatSignedPercentPoints = (value: number): string => {
  if (value === 0) {
    return "0.0 pp";
  }

  return `${value > 0 ? "+" : "-"}${Math.abs(value).toFixed(1)} pp`;
};

const buildReviewCompareCardData = ({
  currentValue,
  previousValue,
  formatValue = (value: number) => value.toLocaleString(),
  favorableDirection = "increase",
  formatDeltaValue = formatSignedWhole
}: {
  currentValue: number | null;
  previousValue: number | null;
  formatValue?: (value: number) => string;
  favorableDirection?: "increase" | "decrease";
  formatDeltaValue?: (value: number) => string;
}): ReviewCompareCardData => {
  const currentLabel = currentValue === null ? "-" : formatValue(currentValue);
  const previousLabel = previousValue === null ? "-" : formatValue(previousValue);

  if (currentValue === null || previousValue === null) {
    return {
      currentLabel,
      previousLabel,
      deltaLabel: "",
      deltaTone: "neutral"
    };
  }

  const delta = currentValue - previousValue;
  const deltaTone: ReviewComparisonTone =
    delta === 0
      ? "neutral"
      : favorableDirection === "decrease"
        ? delta < 0
          ? "positive"
          : "negative"
        : delta > 0
          ? "positive"
          : "negative";

  return {
    currentLabel,
    previousLabel,
    deltaLabel: `${formatDeltaValue(delta)} (${formatRelativeDeltaPercent(delta, previousValue)})`,
    deltaTone
  };
};

const buildReviewMppCardData = (rawValue: string): ReviewCompareCardData => {
  const parts = rawValue
    .split("->")
    .map((part) => part.trim())
    .filter(Boolean);
  const previousValue = parts.length > 0 ? parseReviewMppNumber(parts[0]) : null;
  const currentValue = parts.length > 1 ? parseReviewMppNumber(parts[parts.length - 1]) : previousValue;

  return buildReviewCompareCardData({
    currentValue,
    previousValue
  });
};

const buildReviewCountCardData = (
  currentValue: number | null,
  previousValue: number | null,
  favorableDirection: "increase" | "decrease"
): ReviewCompareCardData =>
  buildReviewCompareCardData({
    currentValue,
    previousValue,
    favorableDirection,
    formatValue: (value) => Math.round(value).toLocaleString()
  });

const buildReviewMoneyCardData = (
  currentValue: number | null,
  previousValue: number | null
): ReviewCompareCardData =>
  buildReviewCompareCardData({
    currentValue,
    previousValue,
    favorableDirection: "increase",
    formatValue: formatSignedUsd,
    formatDeltaValue: formatSignedUsd
  });

const buildReviewPercentCardData = (
  currentValue: number | null,
  previousValue: number | null
): ReviewCompareCardData =>
  buildReviewCompareCardData({
    currentValue,
    previousValue,
    favorableDirection: "increase",
    formatValue: (value) => `${value.toFixed(1)}%`,
    formatDeltaValue: formatSignedPercentPoints
  });

type BookCellEditorState = {
  pageId: string;
  field: "Reading Status" | "Genre";
};

type QuoteCellEditorState = {
  pageId: string;
  field: "Author" | "Source";
};

type NotesTagEditorState = {
  pageId: string;
};

type NotesTypeEditorState = {
  pageId: string;
};

type BookSortKey = "title" | "author" | "rating" | "readingStatus";

type BookSortConfig = {
  key: BookSortKey;
  direction: "asc" | "desc";
};

type StrongViewSortDirection = "asc" | "desc";
type QuoteSaveStatus = "idle" | "saving" | "saved";

const toggleSortDirection = (direction: "asc" | "desc") => (direction === "asc" ? "desc" : "asc");

const normalizeForSearch = (value: string): string => value.trim().toLowerCase();

const ratingSortValue = (value: string): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : -Infinity;
};

interface LibraryPageProps {
  trades: GroupedTrade[];
  journalPages?: JournalPageRecord[];
  settings: Settings;
  onSelectTrade: (tradeId: string, tradeDate: string) => void;
  onOpenJournalDate?: (tradeDate: string) => void;
  onViewReportsForPlaybook?: (playbookName: string) => void;
  initialSection?: "collections" | "playbooks" | "chart-library";
}

export const LibraryPage = ({
  trades,
  journalPages = [],
  settings,
  onSelectTrade,
  onOpenJournalDate,
  onViewReportsForPlaybook,
  initialSection = "collections"
}: LibraryPageProps) => {
  const [activeSection, setActiveSection] = useState<"collections" | "playbooks" | "chart-library">(initialSection);
  const {
    options: strongViewTickerOptionsBase,
    addOption: addStrongViewTickerOption,
    renameOption: renameStrongViewTickerOption,
    removeOption: removeStrongViewTickerOption,
    isCustomOption: isCustomStrongViewTickerOption
  } = useEditableSelectOptions("strongViewTickers", Object.keys(tickerIcons).sort());
  const {
    options: tickerGroupTickerOptionsBase,
    addOption: addTickerGroupTickerOption,
    renameOption: renameTickerGroupTickerOption,
    removeOption: removeTickerGroupTickerOption,
    isCustomOption: isCustomTickerGroupTickerOption
  } = useEditableSelectOptions("tickerGroupTickers", Object.keys(tickerIcons).sort());
  const [pages, setPages] = useState<LibraryPageRecord[]>(() => loadLibraryPages());
  const pagesRef = useRef<LibraryPageRecord[]>([]);
  pagesRef.current = pages;
  const [selectedCollectionId, setSelectedCollectionId] =
    useState<LibraryCollectionId>("idea-inbox");
  const [selectedPageId, setSelectedPageId] = useState("");
  const [collectionView, setCollectionView] = useState<"list" | "page">("list");
  const [notesTab, setNotesTab] = useState<NotesTab>(DEFAULT_NOTES_TAB);
  const [notesTagFilterQuery, setNotesTagFilterQuery] = useState("");
  const [isNotesTagFilterDrawerOpen, setIsNotesTagFilterDrawerOpen] = useState(false);
  const [notesTagFilterSearchQuery, setNotesTagFilterSearchQuery] = useState("");
  const [bookSearchQuery, setBookSearchQuery] = useState("");
  const [isBookSearchDrawerOpen, setIsBookSearchDrawerOpen] = useState(false);
  const [bookSearchDrawerQuery, setBookSearchDrawerQuery] = useState("");
  const [bookStatusFilter, setBookStatusFilter] = useState("");
  const [bookGenreFilter, setBookGenreFilter] = useState<string[]>([]);
  const [bookSortConfig, setBookSortConfig] = useState<BookSortConfig>({
    key: "title",
    direction: "asc"
  });
  const [bookCellEditor, setBookCellEditor] = useState<BookCellEditorState | null>(null);
  const [bookCellEditorSearchQuery, setBookCellEditorSearchQuery] = useState("");
  const [isBookGenreFilterOpen, setIsBookGenreFilterOpen] = useState(false);
  const [bookGenreFilterSearchQuery, setBookGenreFilterSearchQuery] = useState("");
  const [quoteSearchQuery, setQuoteSearchQuery] = useState("");
  const [isQuoteSearchDrawerOpen, setIsQuoteSearchDrawerOpen] = useState(false);
  const [quoteSearchDrawerQuery, setQuoteSearchDrawerQuery] = useState("");
  const [quoteSaveStatus, setQuoteSaveStatus] = useState<QuoteSaveStatus>("idle");
  const [strongViewTickerQuery, setStrongViewTickerQuery] = useState("");
  const [strongViewDateFilter, setStrongViewDateFilter] = useState("");
  const [strongViewSortDirection, setStrongViewSortDirection] = useState<StrongViewSortDirection>("desc");
  const [isStrongViewTickerDrawerOpen, setIsStrongViewTickerDrawerOpen] = useState(false);
  const [strongViewTickerSearch, setStrongViewTickerSearch] = useState("");
  const [isTickerGroupTickerDrawerOpen, setIsTickerGroupTickerDrawerOpen] = useState(false);
  const [tickerGroupTickerSearch, setTickerGroupTickerSearch] = useState("");
  const [quoteCellEditor, setQuoteCellEditor] = useState<QuoteCellEditorState | null>(null);
  const [quoteCellEditorSearchQuery, setQuoteCellEditorSearchQuery] = useState("");
  const [notesTypeEditor, setNotesTypeEditor] = useState<NotesTypeEditorState | null>(null);
  const [notesTypeSearchQuery, setNotesTypeSearchQuery] = useState("");
  const [notesTagEditor, setNotesTagEditor] = useState<NotesTagEditorState | null>(null);
  const [notesTagSearchQuery, setNotesTagSearchQuery] = useState("");
  const [reviewTemplates, setReviewTemplates] = useState(() => loadReviewTemplates());
  const [selectedWeeklyReviewTemplateId, setSelectedWeeklyReviewTemplateId] = useState(
    () => reviewTemplates.weeklyTemplates[0]?.id ?? ""
  );
  const [selectedMonthlyReviewTemplateId, setSelectedMonthlyReviewTemplateId] = useState(
    () => reviewTemplates.monthlyTemplates[0]?.id ?? ""
  );
  const [showLegacyReviewNotes, setShowLegacyReviewNotes] = useState(false);
  const dailyShutdownRiskUsd = getDailyShutdownRiskFromSettings(settings);
  const hasRetriedDesktopRecoveryRef = useRef(false);
  const strongViewMorningChatInputRef = useRef<HTMLInputElement | null>(null);
  const quoteSaveStatusTimeoutRef = useRef<number | null>(null);

  const clearQuoteSaveStatusTimeout = () => {
    if (quoteSaveStatusTimeoutRef.current !== null) {
      window.clearTimeout(quoteSaveStatusTimeoutRef.current);
      quoteSaveStatusTimeoutRef.current = null;
    }
  };

  const markQuoteSaving = () => {
    clearQuoteSaveStatusTimeout();
    setQuoteSaveStatus("saving");
  };

  const createLibraryInlineImageInsertHandler = (pageId: string, fieldKey: string) => async (file: File) =>
    saveWorkspaceInlineImage({
      category: "library-inline-images",
      recordId: pageId,
      slotKey: fieldKey,
      file
    });

  const persistPages = (nextPages: LibraryPageRecord[]) => {
    pagesRef.current = nextPages;
    setPages(nextPages);
  };

  const deleteUnusedLibraryAttachments = (paths: string[], nextPages: LibraryPageRecord[]) => {
    const uniquePaths = Array.from(new Set(paths.map((path) => path.trim()).filter(Boolean)));
    for (const path of uniquePaths) {
      void deleteWorkspaceAttachmentIfUnused(path, {
        delayMs: 0,
        storageOverrides: {
          [LIBRARY_PAGES_STORAGE_KEY]: nextPages
        }
      }).catch(() => undefined);
    }
  };

  useEffect(() => {
    setActiveSection(initialSection);
    setCollectionView("list");
  }, [initialSection]);

  useEffect(() => {
    setPages((current) => {
      let changed = false;
      const next = current.map((page) => {
        if (page.collectionId !== "replay" && page.collectionId !== "signal-mapping") {
          return page;
        }

        changed = true;
        return {
          ...page,
          collectionId: "idea-inbox" as LibraryCollectionId
        };
      });

      return changed ? next : current;
    });
  }, []);

  useDebouncedSave(
    pages,
    900,
    (nextPages) => {
      saveLibraryPages(nextPages);
    },
    true,
    { skipInitialSave: true }
  );

  useDebouncedSave(
    reviewTemplates,
    500,
    (nextTemplates) => {
      saveReviewTemplates(nextTemplates);
    },
    true,
    { skipInitialSave: true }
  );

  useEffect(() => {
    if (quoteSaveStatus !== "saving") {
      return;
    }

    setQuoteSaveStatus("saved");
    clearQuoteSaveStatusTimeout();
    quoteSaveStatusTimeoutRef.current = window.setTimeout(() => {
      setQuoteSaveStatus("idle");
      quoteSaveStatusTimeoutRef.current = null;
    }, 1300);
  }, [pages, quoteSaveStatus]);

  useEffect(
    () => () => {
      clearQuoteSaveStatusTimeout();
    },
    []
  );

  useEffect(() => {
    if (hasRetriedDesktopRecoveryRef.current) {
      return;
    }

    hasRetriedDesktopRecoveryRef.current = true;
    void (async () => {
      const recoveredPages = await recoverLibraryPagesFromDesktopBackup(pagesRef.current);
      if (!recoveredPages) {
        return;
      }

      persistPages(recoveredPages);
    })();
  }, []);

  useEffect(() => {
    const handleHydrated = () => {
      const nextPages = loadLibraryPages();
      const nextTemplates = loadReviewTemplates();

      setPages(nextPages);
      setReviewTemplates(nextTemplates);
      setSelectedWeeklyReviewTemplateId(nextTemplates.weeklyTemplates[0]?.id ?? "");
      setSelectedMonthlyReviewTemplateId(nextTemplates.monthlyTemplates[0]?.id ?? "");
      void (async () => {
        const recoveredPages = await recoverLibraryPagesFromDesktopBackup(nextPages);
        if (!recoveredPages) {
          return;
        }

        persistPages(recoveredPages);
      })();
    };

    window.addEventListener(SYNC_HYDRATED_EVENT, handleHydrated);
    return () => window.removeEventListener(SYNC_HYDRATED_EVENT, handleHydrated);
  }, []);

  useEffect(() => {
    setPages((current) => {
      let changed = false;
      const now = new Date().toISOString();

      const next = current.map((page) => {
        const period = getReviewPeriodForCollection(page.collectionId);
        if (!period) {
          return page;
        }

        const range = getReviewRange(page.properties);
        if (!range) {
          return page;
        }

        const metrics = computeReviewMetrics({
          trades,
          rangeStart: range.start,
          rangeEnd: range.end,
          dailyShutdownRiskUsd
        });

        const nextProperties = buildReviewPropertiesPatch({
          metrics,
          existingProperties: page.properties
        });

        if (JSON.stringify(page.properties ?? {}) === JSON.stringify(nextProperties)) {
          return page;
        }

        changed = true;
        return { ...page, properties: nextProperties, updatedAt: now };
      });

      return changed ? next : current;
    });
  }, [dailyShutdownRiskUsd, trades]);

  useEffect(() => {
    if (trades.length === 0) {
      return;
    }

    setPages((current) => {
      const now = new Date().toISOString();
      const next = [...current];
      let changed = false;

      const ensureReviewPages = (collectionId: "weekly-review" | "monthly-review") => {
        const period = collectionId === "weekly-review" ? "weekly" : "monthly";
        const existingRangeKeys = new Set<string>();

        for (const page of current) {
          if (page.collectionId !== collectionId) {
            continue;
          }

          const range = getReviewRange(page.properties);
          if (!range) {
            continue;
          }

          existingRangeKeys.add(`${range.start}_${range.end}`);
        }

        const ranges = getReviewRangesFromTrades(trades, period);
        for (const range of ranges) {
          const key = `${range.start}_${range.end}`;
          if (existingRangeKeys.has(key)) {
            continue;
          }

          const base = createLibraryPage(collectionId);
          const endTimestamp = new Date(`${range.end}T23:59:59`);
          const timestamp = Number.isNaN(endTimestamp.getTime()) ? now : endTimestamp.toISOString();

          next.push({
            ...base,
            id: `${collectionId}-${range.start}`,
            title: getReviewTitleForRange(period, range.start, range.end),
            status: "Active",
            properties: {
              ...(base.properties ?? {}),
              [REVIEW_PROPERTY_KEYS.rangeStart]: range.start,
              [REVIEW_PROPERTY_KEYS.rangeEnd]: range.end
            },
            createdAt: timestamp,
            updatedAt: timestamp
          });

          existingRangeKeys.add(key);
          changed = true;
        }
      };

      ensureReviewPages("weekly-review");
      ensureReviewPages("monthly-review");

      return changed ? next : current;
    });
  }, [trades]);

  const selectedCollection = useMemo(
    () =>
      libraryCollections.find((collection) => collection.id === selectedCollectionId) ??
      libraryCollections[0],
    [selectedCollectionId]
  );

  const collectionPages = useMemo(
    () => pages.filter((page) => page.collectionId === selectedCollectionId),
    [pages, selectedCollectionId]
  );

  const isNotesCollection = selectedCollectionId === "idea-inbox";
  const isBookClub = selectedCollectionId === "book-club";
  const isStrongViews = selectedCollectionId === "strong-views";
  const isQuotes = selectedCollectionId === "quotes";
  const isTickerGroups = selectedCollectionId === "ticker-groups";
  const selectedReviewPeriod = getReviewPeriodForCollection(selectedCollectionId);
  const isReviewCollection = selectedReviewPeriod !== null;

  const notesPages = useMemo(() => {
    if (!isNotesCollection) {
      return collectionPages;
    }

    const typeFilteredPages =
      notesTab === DEFAULT_NOTES_TAB
        ? collectionPages
        : notesTab === ARCHIVED_NOTES_TAB
          ? collectionPages.filter((page) => page.status === "Archived")
          : collectionPages.filter((page) => resolveNoteType(page) === notesTab);

    const normalizedTagQuery = normalizeTagToken(notesTagFilterQuery);
    if (!normalizedTagQuery) {
      return typeFilteredPages;
    }

    return typeFilteredPages.filter((page) =>
      page.tags.map(normalizeTagToken).some((tag) => tag.includes(normalizedTagQuery))
    );
  }, [collectionPages, isNotesCollection, notesTab, notesTagFilterQuery]);

  const notesTagFilterToken = useMemo(
    () => normalizeTagToken(notesTagFilterQuery),
    [notesTagFilterQuery]
  );

  const notesTagFilterLabel = notesTagFilterToken.replace(/-/g, " ");

  const notesTagOptions = useMemo(
    () =>
      Array.from(
        new Set(
          pages
            .filter((page) => page.collectionId === "idea-inbox")
            .flatMap((page) => page.tags.map(normalizeTagToken))
            .filter(Boolean)
        )
      ).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })),
    [pages]
  );

  const notesTypePickerOptions = useMemo(() => {
    const customTypeLabelsByToken = new Map<string, string>();

    pages
      .filter((page) => page.collectionId === "idea-inbox")
      .forEach((page) => {
        const typeToken = resolveNoteTypeTag(page);
        if (!typeToken || noteTypeTagSet.has(typeToken)) {
          return;
        }

        customTypeLabelsByToken.set(typeToken, resolveEditableNoteType(page));
      });

    const customTypeOptions = Array.from(customTypeLabelsByToken.values()).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" })
    );

    return [...defaultNoteTypeLabels, ...customTypeOptions];
  }, [pages]);

  const notesTabs = useMemo(
    () => [DEFAULT_NOTES_TAB, ...notesTypePickerOptions, ARCHIVED_NOTES_TAB],
    [notesTypePickerOptions]
  );

  useEffect(() => {
    if (!isNotesCollection) {
      return;
    }

    if (notesTabs.includes(notesTab)) {
      return;
    }

    setNotesTab(DEFAULT_NOTES_TAB);
  }, [isNotesCollection, notesTab, notesTabs]);

  const notesTabCounts = useMemo(() => {
    if (!isNotesCollection) {
      return {} as Record<string, number>;
    }

    return notesTabs.reduce(
      (acc, tab) => {
        if (tab === DEFAULT_NOTES_TAB) {
          acc[tab] = collectionPages.length;
          return acc;
        }

        if (tab === ARCHIVED_NOTES_TAB) {
          acc[tab] = collectionPages.filter((page) => page.status === "Archived").length;
          return acc;
        }

        acc[tab] = collectionPages.filter((page) => resolveNoteType(page) === tab).length;
        return acc;
      },
      {} as Record<string, number>
    );
  }, [collectionPages, isNotesCollection, notesTabs]);

  const notesTypeTokensInUse = useMemo(
    () =>
      new Set(
        pages
          .filter((page) => page.collectionId === "idea-inbox")
          .map((page) => resolveNoteTypeTag(page))
          .filter(Boolean)
      ),
    [pages]
  );

  const tickerGroupTickerOptions = useMemo(() => {
    const fromTrades = trades
      .map((trade) => normalizeTickerToken(trade.symbol ?? ""))
      .filter(Boolean);
    const fromGroups = pages
      .filter((page) => page.collectionId === "ticker-groups")
      .flatMap((page) => renderPropertyList(page, "Tickers").map(normalizeTickerToken))
      .filter(Boolean);

    return Array.from(
      new Set([...tickerGroupTickerOptionsBase, ...fromTrades, ...fromGroups].map(normalizeTickerToken).filter(Boolean))
    ).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" })
    );
  }, [pages, tickerGroupTickerOptionsBase, trades]);

  const bookRows = useMemo(
    () => collectionPages.filter(isBookRow),
    [collectionPages]
  );

  const quoteRows = useMemo(
    () => (isQuotes ? collectionPages : collectionPages.filter(isQuoteRow)),
    [collectionPages, isQuotes]
  );

  const strongViewRows = useMemo(
    () => (isStrongViews ? collectionPages : collectionPages.filter(isStrongViewRow)),
    [collectionPages, isStrongViews]
  );

  const filteredStrongViewRows = useMemo(() => {
    const normalizedTickerQuery = normalizeForSearch(strongViewTickerQuery);
    const normalizedDateFilter = getDateOnlyIsoString(strongViewDateFilter);

    const filtered = strongViewRows.filter((page) => {
      if (normalizedTickerQuery) {
        const ticker = normalizeForSearch(getStrongViewFieldValue(page, "Ticker"));
        if (!ticker.includes(normalizedTickerQuery)) {
          return false;
        }
      }

      if (normalizedDateFilter) {
        const rowDate = getStrongViewDateValue(page);
        if (rowDate !== normalizedDateFilter) {
          return false;
        }
      }

      return true;
    });

    return [...filtered].sort((left, right) => {
      const leftDate = getStrongViewDateValue(left);
      const rightDate = getStrongViewDateValue(right);
      const leftFallback = left.createdAt.slice(0, 10);
      const rightFallback = right.createdAt.slice(0, 10);
      const leftComparable = leftDate || leftFallback;
      const rightComparable = rightDate || rightFallback;
      const compare = leftComparable.localeCompare(rightComparable, undefined, { sensitivity: "base" });
      return strongViewSortDirection === "asc" ? compare : -compare;
    });
  }, [strongViewDateFilter, strongViewRows, strongViewSortDirection, strongViewTickerQuery]);

  const strongViewTickerOptions = useMemo(() => {
    const fromStrongViews = strongViewRows
      .map((page) => getStrongViewFieldValue(page, "Ticker").trim().toUpperCase())
      .filter(Boolean);

    const merged = Array.from(
      new Set([...strongViewTickerOptionsBase, ...tickerGroupTickerOptions, ...fromStrongViews].map(normalizeTickerToken))
    );

    return merged.sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }));
  }, [strongViewRows, strongViewTickerOptionsBase, tickerGroupTickerOptions]);

  const filteredQuoteRows = useMemo(() => {
    const normalizedQuery = normalizeForSearch(quoteSearchQuery);

    if (!normalizedQuery) {
      return quoteRows;
    }

    return quoteRows.filter((page) =>
      normalizeForSearch(getQuoteFieldValue(page, "Author")).includes(normalizedQuery)
    );
  }, [quoteRows, quoteSearchQuery]);

  const quoteAuthorOptions = useMemo(() => {
    const authors = quoteRows
      .map((page) => getQuoteFieldValue(page, "Author").trim())
      .filter(Boolean);

    return Array.from(new Set(authors)).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [quoteRows]);

  const quoteSourceOptions = useMemo(() => {
    const sources = quoteRows
      .map((page) => getQuoteFieldValue(page, "Source").trim())
      .filter(Boolean);

    return Array.from(new Set(sources)).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [quoteRows]);

  const bookSearchOptions = useMemo(() => {
    const values = bookRows
      .flatMap((page) => [page.title.trim(), getBookFieldValue(page, "Author").trim()])
      .filter(Boolean);

    return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [bookRows]);

  const bookStatusFilterOptions = useMemo(
    () => [
      { label: "All statuses", value: "" },
      ...bookReadingStatusOptions.map((status) => ({ label: status, value: status }))
    ],
    []
  );

  const filteredBookRows = useMemo(() => {
    const normalizedQuery = normalizeForSearch(bookSearchQuery);

    const filtered = bookRows.filter((page) => {
      if (normalizedQuery) {
        const matchesTitle = normalizeForSearch(page.title).includes(normalizedQuery);
        const matchesAuthor = normalizeForSearch(getBookFieldValue(page, "Author")).includes(normalizedQuery);
        if (!matchesTitle && !matchesAuthor) {
          return false;
        }
      }

      if (bookStatusFilter) {
        const statusValue = getBookFieldValue(page, "Reading Status") || page.status;
        if (statusValue !== bookStatusFilter) {
          return false;
        }
      }

      if (bookGenreFilter.length > 0) {
        const genres = renderPropertyList(page, "Genre");
        const hasAnyGenre = bookGenreFilter.some((genre) => genres.includes(genre));
        if (!hasAnyGenre) {
          return false;
        }
      }

      return true;
    });

    const sorted = [...filtered].sort((left, right) => {
      const directionMultiplier = bookSortConfig.direction === "asc" ? 1 : -1;

      const compareStrings = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base" });
      const compareNumbers = (a: number, b: number) => (a === b ? 0 : a > b ? 1 : -1);

      switch (bookSortConfig.key) {
        case "title":
          return directionMultiplier * compareStrings(left.title, right.title);
        case "author":
          return (
            directionMultiplier *
            compareStrings(getBookFieldValue(left, "Author"), getBookFieldValue(right, "Author"))
          );
        case "readingStatus":
          return (
            directionMultiplier *
            compareStrings(getBookFieldValue(left, "Reading Status"), getBookFieldValue(right, "Reading Status"))
          );
        case "rating":
          return (
            directionMultiplier *
            compareNumbers(ratingSortValue(getBookFieldValue(left, "Rating")), ratingSortValue(getBookFieldValue(right, "Rating")))
          );
        default:
          return 0;
      }
    });

    return sorted;
  }, [bookGenreFilter, bookRows, bookSearchQuery, bookSortConfig, bookStatusFilter]);

  const databasePages = useMemo(
    () =>
      isBookClub && bookRows.length > 0
        ? bookRows
        : isNotesCollection
          ? notesPages
          : collectionPages,
    [bookRows, collectionPages, isBookClub, isNotesCollection, notesPages]
  );

  const allGenres = useMemo(
    () =>
      Array.from(
        new Set(
          collectionPages
            .flatMap((page) => renderPropertyList(page, "Genre"))
            .filter(Boolean)
        )
      ).sort(),
    [collectionPages]
  );

  const selectedPage = useMemo(
    () => pages.find((page) => page.id === selectedPageId) ?? null,
    [pages, selectedPageId]
  );
  const selectedReviewMppCardData = useMemo(() => {
    if (!selectedPage) {
      return null;
    }

    const rawMpp = renderPropertyValue(selectedPage, REVIEW_PROPERTY_KEYS.mpp, "");
    return buildReviewMppCardData(rawMpp);
  }, [selectedPage]);
  const selectedReviewComparisonData = useMemo(() => {
    if (!selectedPage || !isReviewCollection || !selectedReviewPeriod) {
      return null;
    }

    const range = getReviewRange(selectedPage.properties);
    if (!range) {
      return null;
    }

    const previousRange = getPreviousReviewRange(selectedReviewPeriod, range.start, range.end);
    if (!previousRange) {
      return null;
    }

    const currentMetrics = computeReviewMetrics({
      trades,
      rangeStart: range.start,
      rangeEnd: range.end,
      dailyShutdownRiskUsd
    });
    const previousMetrics = computeReviewMetrics({
      trades,
      rangeStart: previousRange.start,
      rangeEnd: previousRange.end,
      dailyShutdownRiskUsd
    });

    return {
      previousPeriodLabel: selectedReviewPeriod === "monthly" ? "Last month" : "Last week",
      trades: buildReviewCountCardData(currentMetrics.tradeCount, previousMetrics.tradeCount, "increase"),
      shares: buildReviewCountCardData(currentMetrics.shares, previousMetrics.shares, "increase"),
      winRate: buildReviewPercentCardData(currentMetrics.winRate, previousMetrics.winRate),
      net: buildReviewMoneyCardData(currentMetrics.net, previousMetrics.net),
      gross: buildReviewMoneyCardData(currentMetrics.gross, previousMetrics.gross),
      redDays: buildReviewCountCardData(currentMetrics.redDays, previousMetrics.redDays, "decrease"),
      greenDays: buildReviewCountCardData(currentMetrics.greenDays, previousMetrics.greenDays, "increase")
    };
  }, [dailyShutdownRiskUsd, isReviewCollection, selectedPage, selectedReviewPeriod, trades]);

  const bestDayEntries = useMemo(() => {
    if (!selectedPage) {
      return [];
    }

    if (!isReviewCollection || !selectedReviewPeriod) {
      return [];
    }

    const range = getReviewRange(selectedPage.properties);
    if (!range?.start || !range?.end) {
      return [];
    }

    const start = normalizeIsoTradeDate(range.start);
    const end = normalizeIsoTradeDate(range.end);
    if (!start || !end) {
      return [];
    }

    const dayNetMap = trades.reduce<Map<string, number>>((acc, trade) => {
      const date = normalizeIsoTradeDate(trade.tradeDate);
      if (!date || date < start || date > end) {
        return acc;
      }

      acc.set(date, (acc.get(date) ?? 0) + (trade.netPnlUsd || 0));
      return acc;
    }, new Map());

    const limit = selectedReviewPeriod === "monthly" ? 3 : 1;
    return Array.from(dayNetMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit);
  }, [isReviewCollection, selectedPage, selectedReviewPeriod, trades]);

  const selectedReviewRangeTrades = useMemo(() => {
    if (!selectedPage || !isReviewCollection || !selectedReviewPeriod) {
      return [];
    }

    const range = getReviewRange(selectedPage.properties);
    if (!range?.start || !range?.end) {
      return [];
    }

    const start = normalizeIsoTradeDate(range.start);
    const end = normalizeIsoTradeDate(range.end);
    if (!start || !end) {
      return [];
    }

    return trades.filter((trade) => {
      const date = normalizeIsoTradeDate(trade.tradeDate);
      return Boolean(date) && date >= start && date <= end;
    });
  }, [isReviewCollection, selectedPage, selectedReviewPeriod, trades]);

  const bestReviewTrade = useMemo<ReviewTradeSpotlightData | null>(() => {
    if (selectedReviewRangeTrades.length === 0) {
      return null;
    }

    const [trade] = [...selectedReviewRangeTrades].sort((left, right) => {
      const netDelta = right.netPnlUsd - left.netPnlUsd;
      if (netDelta !== 0) {
        return netDelta;
      }

      const grossDelta = right.grossPnlUsd - left.grossPnlUsd;
      if (grossDelta !== 0) {
        return grossDelta;
      }

      return `${right.tradeDate}-${right.openTime}`.localeCompare(`${left.tradeDate}-${left.openTime}`);
    });

    if (!trade) {
      return null;
    }

    return {
      trade,
      taggedChart: findTaggedChartForTrade(journalPages, trade)
    };
  }, [journalPages, selectedReviewRangeTrades]);

  const worstReviewTrade = useMemo<ReviewTradeSpotlightData | null>(() => {
    if (selectedReviewRangeTrades.length === 0) {
      return null;
    }

    const [trade] = [...selectedReviewRangeTrades].sort((left, right) => {
      const netDelta = left.netPnlUsd - right.netPnlUsd;
      if (netDelta !== 0) {
        return netDelta;
      }

      const grossDelta = left.grossPnlUsd - right.grossPnlUsd;
      if (grossDelta !== 0) {
        return grossDelta;
      }

      return `${left.tradeDate}-${left.openTime}`.localeCompare(`${right.tradeDate}-${right.openTime}`);
    });

    if (!trade) {
      return null;
    }

    return {
      trade,
      taggedChart: findTaggedChartForTrade(journalPages, trade)
    };
  }, [journalPages, selectedReviewRangeTrades]);

  const reviewReadingBookDefaults = useMemo(() => {
    const titles = pages
      .filter((page) => page.collectionId === "book-club" && isBookRow(page))
      .map((page) => page.title.trim())
      .filter(Boolean);

    return Array.from(new Set(titles)).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [pages]);

  const reviewReadingAuthorDefaults = useMemo(() => {
    const authors = pages
      .filter((page) => page.collectionId === "book-club" && isBookRow(page))
      .map((page) => getBookFieldValue(page, "Author").trim())
      .filter(Boolean);

    return Array.from(new Set(authors)).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [pages]);

  const handleSaveReviewTemplate = (period: "weekly" | "monthly", templateId: string, content: unknown) => {
    setReviewTemplates((current) => {
      const key = period === "weekly" ? "weeklyTemplates" : "monthlyTemplates";
      const templates = current[key].map((template) =>
        template.id === templateId ? { ...template, content: coerceReviewReflectionState(content) } : template
      );
      return { ...current, [key]: templates };
    });
  };

  const handleSaveReviewTemplateAs = (period: "weekly" | "monthly", name: string, content: unknown) => {
    const newTemplate = {
      id: `review-template-${Math.random().toString(36).slice(2, 10)}`,
      name,
      content: coerceReviewReflectionState(content)
    };

    setReviewTemplates((current) => {
      const key = period === "weekly" ? "weeklyTemplates" : "monthlyTemplates";
      return { ...current, [key]: [...current[key], newTemplate] };
    });

    if (period === "weekly") {
      setSelectedWeeklyReviewTemplateId(newTemplate.id);
    } else {
      setSelectedMonthlyReviewTemplateId(newTemplate.id);
    }
  };

  const handleDeleteReviewTemplate = (period: "weekly" | "monthly", templateId: string) => {
    setReviewTemplates((current) => {
      const key = period === "weekly" ? "weeklyTemplates" : "monthlyTemplates";
      const existing = current[key];
      const filtered = existing.filter((template) => template.id !== templateId);
      const nextTemplates = filtered.length > 0 ? filtered : existing;
      const fallbackSelected = nextTemplates[0]?.id ?? "";

      if (period === "weekly") {
        setSelectedWeeklyReviewTemplateId((selected) => (selected === templateId ? fallbackSelected : selected));
      } else {
        setSelectedMonthlyReviewTemplateId((selected) => (selected === templateId ? fallbackSelected : selected));
      }

      return { ...current, [key]: nextTemplates };
    });
  };

  const handleOpenJournalDate = (tradeDate: string) => {
    const normalized = normalizeIsoTradeDate(tradeDate);
    if (!normalized) {
      return;
    }

    onOpenJournalDate?.(normalized);
  };

  const bookCellEditorPage = useMemo(() => {
    if (!bookCellEditor) {
      return null;
    }

    return pages.find((page) => page.id === bookCellEditor.pageId) ?? null;
  }, [bookCellEditor, pages]);

  const quoteCellEditorPage = useMemo(() => {
    if (!quoteCellEditor) {
      return null;
    }

    return pages.find((page) => page.id === quoteCellEditor.pageId) ?? null;
  }, [pages, quoteCellEditor]);

  const notesTagEditorPage = useMemo(() => {
    if (!notesTagEditor) {
      return null;
    }

    return pages.find((page) => page.id === notesTagEditor.pageId) ?? null;
  }, [notesTagEditor, pages]);

  const notesTypeEditorPage = useMemo(() => {
    if (!notesTypeEditor) {
      return null;
    }

    return pages.find((page) => page.id === notesTypeEditor.pageId) ?? null;
  }, [notesTypeEditor, pages]);

  useEffect(() => {
    if (collectionView !== "page") {
      return;
    }

    if (!selectedPage) {
      setCollectionView("list");
      return;
    }

    if (selectedPage.collectionId !== selectedCollectionId) {
      setCollectionView("list");
      setSelectedPageId("");
    }
  }, [collectionView, selectedCollectionId, selectedPage]);

  const totalTags = useMemo(
    () => new Set(pages.flatMap((page) => page.tags.map((tag) => tag.toLowerCase()))).size,
    [pages]
  );

  const updatePage = (pageId: string, updates: Partial<LibraryPageRecord>) => {
    const nextPages = pagesRef.current.map((page) =>
        page.id === pageId
          ? {
              ...page,
              ...updates,
              updatedAt: new Date().toISOString()
            }
          : page
      );
    persistPages(nextPages);
  };

  const updatePageNoteType = (page: LibraryPageRecord, nextTypeLabel: string) => {
    const nextLabel = nextTypeLabel.trim();
    const nextTypeToken = resolveNoteTypeTokenFromInput(nextLabel);
    if (!nextTypeToken) {
      return;
    }

    const isBuiltInType = noteTypeTagSet.has(nextTypeToken);
    const nextTags = applyNoteTypeToTags(page, nextTypeToken);
    updatePage(page.id, {
      tags: nextTags,
      properties: {
        ...page.properties,
        [NOTE_TYPE_PROPERTY_KEY]: nextTypeToken,
        [NOTE_TYPE_LABEL_PROPERTY_KEY]: isBuiltInType ? "" : nextLabel
      }
    });
  };

  const renameNotesTypeOption = (currentValue: string, nextValue: string) => {
    const currentLabel = currentValue.trim();
    const nextLabel = nextValue.trim();
    if (!currentLabel || !nextLabel) {
      return;
    }

    const currentTypeToken = resolveNoteTypeTokenFromInput(currentValue);
    const nextTypeToken = resolveNoteTypeTokenFromInput(nextValue);
    if (!currentTypeToken || !nextTypeToken || noteTypeTagSet.has(currentTypeToken)) {
      return;
    }

    const isSameToken = currentTypeToken === nextTypeToken;
    if (isSameToken && currentLabel === nextLabel) {
      return;
    }

    const nextPages = pagesRef.current.map((page) => {
        if (page.collectionId !== "idea-inbox" || resolveNoteTypeTag(page) !== currentTypeToken) {
          return page;
        }

        const nextTags = isSameToken ? page.tags : applyNoteTypeToTags(page, nextTypeToken);
        const isBuiltInType = noteTypeTagSet.has(nextTypeToken);
        return {
          ...page,
          tags: nextTags,
          properties: {
            ...page.properties,
            [NOTE_TYPE_PROPERTY_KEY]: nextTypeToken,
            [NOTE_TYPE_LABEL_PROPERTY_KEY]: isBuiltInType ? "" : nextLabel
          },
          updatedAt: new Date().toISOString()
        };
      });
    persistPages(nextPages);
  };

  const deleteNotesTypeOption = (value: string) => {
    const typeToken = resolveNoteTypeTokenFromInput(value);
    if (!typeToken || noteTypeTagSet.has(typeToken)) {
      return;
    }

    const nextPages = pagesRef.current.map((page) => {
        if (page.collectionId !== "idea-inbox" || resolveNoteTypeTag(page) !== typeToken) {
          return page;
        }

        const nextTags = applyNoteTypeToTags(page, "idea");
        return {
          ...page,
          tags: nextTags,
          properties: {
            ...page.properties,
            [NOTE_TYPE_PROPERTY_KEY]: "idea",
            [NOTE_TYPE_LABEL_PROPERTY_KEY]: ""
          },
          updatedAt: new Date().toISOString()
        };
      });
    persistPages(nextPages);
  };

  const renameNotesTagOption = (currentValue: string, nextValue: string) => {
    const currentTag = normalizeTagToken(currentValue);
    const nextTag = normalizeTagToken(nextValue);
    if (!currentTag || !nextTag || currentTag === nextTag) {
      return;
    }

    const nextPages = pagesRef.current.map((page) => {
        if (page.collectionId !== "idea-inbox") {
          return page;
        }

        const normalizedTags = page.tags.map(normalizeTagToken).filter(Boolean);
        if (!normalizedTags.includes(currentTag)) {
          return page;
        }

        const nextTags = Array.from(
          new Set(normalizedTags.map((tag) => (tag === currentTag ? nextTag : tag)))
        );

        return {
          ...page,
          tags: nextTags,
          updatedAt: new Date().toISOString()
        };
      });
    persistPages(nextPages);
  };

  const deleteNotesTagOption = (value: string) => {
    const tag = normalizeTagToken(value);
    if (!tag) {
      return;
    }

    const nextPages = pagesRef.current.map((page) => {
        if (page.collectionId !== "idea-inbox") {
          return page;
        }

        const normalizedTags = page.tags.map(normalizeTagToken).filter(Boolean);
        if (!normalizedTags.includes(tag)) {
          return page;
        }

        return {
          ...page,
          tags: normalizedTags.filter((currentTag) => currentTag !== tag),
          updatedAt: new Date().toISOString()
        };
      });
    persistPages(nextPages);
  };

  const buildNextPagesWithUpdatedProperty = (
    page: LibraryPageRecord,
    propertyName: string,
    value: unknown
  ): LibraryPageRecord[] =>
    pagesRef.current.map((currentPage) =>
        currentPage.id === page.id
          ? {
              ...currentPage,
              properties: {
                ...(currentPage.properties ?? {}),
                [propertyName]: value
              },
              updatedAt: new Date().toISOString()
            }
          : currentPage
      );

  const updatePageProperty = (
    page: LibraryPageRecord,
    propertyName: string,
    value: unknown
  ) => {
    const nextPages = buildNextPagesWithUpdatedProperty(page, propertyName, value);
    persistPages(nextPages);
  };

  const updateTickerGroupIcon = (page: LibraryPageRecord, nextValue: string) => {
    const previousValue = typeof page.properties?.Icon === "string" ? page.properties.Icon : "";
    const nextPages = buildNextPagesWithUpdatedProperty(page, "Icon", nextValue);
    persistPages(nextPages);
    if (previousValue && previousValue !== nextValue) {
      deleteUnusedLibraryAttachments([previousValue], nextPages);
    }
  };

  const updateBookCustomTextFields = (
    page: LibraryPageRecord,
    updater: (fields: BookCustomTextField[]) => BookCustomTextField[]
  ) => {
    const nextPages = pagesRef.current.map((currentPage) => {
        if (currentPage.id !== page.id) {
          return currentPage;
        }

        const nextFields = updater(getBookCustomTextFields(currentPage));
        return {
          ...currentPage,
          properties: {
            ...(currentPage.properties ?? {}),
            [BOOK_CUSTOM_TEXT_FIELDS_PROPERTY_KEY]: nextFields
          },
          updatedAt: new Date().toISOString()
        };
      });
    persistPages(nextPages);
  };

  const addBookCustomTextField = (page: LibraryPageRecord) => {
    const suggestedName = "Opening Journal";
    const fieldLabel = window.prompt("Name for the new text field", suggestedName)?.trim() ?? "";
    if (!fieldLabel) {
      return;
    }

    updateBookCustomTextFields(page, (fields) => [
      ...fields,
      {
        id: `book-field-${Math.random().toString(36).slice(2, 10)}`,
        label: fieldLabel,
        content: createEmptyJournalDoc()
      }
    ]);
  };

  const updateBookCustomTextField = (
    page: LibraryPageRecord,
    fieldId: string,
    updates: Partial<BookCustomTextField>
  ) => {
    updateBookCustomTextFields(page, (fields) =>
      fields.map((field) => (field.id === fieldId ? { ...field, ...updates } : field))
    );
  };

  const removeBookCustomTextField = (page: LibraryPageRecord, fieldId: string) => {
    updateBookCustomTextFields(page, (fields) => fields.filter((field) => field.id !== fieldId));
  };

  const updateQuoteUsed = (page: LibraryPageRecord, nextUsed: boolean) => {
    markQuoteSaving();
    const nextPages = pagesRef.current.map((currentPage) => {
        if (currentPage.id !== page.id) {
          return currentPage;
        }

        const dateUsed =
          nextUsed ? getQuoteDateUsedForInput(currentPage) || new Date().toISOString().slice(0, 10) : "";

        return {
          ...currentPage,
          properties: {
            ...(currentPage.properties ?? {}),
            Used: nextUsed,
            "Date Used": dateUsed
          },
          updatedAt: new Date().toISOString()
        };
      });
    persistPages(nextPages);
  };

  const updateQuoteDateUsed = (page: LibraryPageRecord, nextDateUsed: string) => {
    markQuoteSaving();
    const normalized = getDateOnlyIsoString(nextDateUsed);

    if (!normalized) {
      updateQuoteUsed(page, false);
      return;
    }

    const nextPages = pagesRef.current.map((currentPage) =>
        currentPage.id === page.id
          ? {
              ...currentPage,
              properties: {
                ...(currentPage.properties ?? {}),
                Used: true,
                "Date Used": normalized
              },
              updatedAt: new Date().toISOString()
            }
          : currentPage
      );
    persistPages(nextPages);
  };

  const handleStrongViewMorningChatUpload = async (page: LibraryPageRecord, file: File | null) => {
    if (!file) {
      return;
    }

    try {
      const nextAttachmentPath = await saveUploadedWorkspaceAttachment({
        category: "library-strong-view",
        recordId: page.id,
        slotKey: "morning-chat",
        file
      });
      const previousAttachmentPath = getStrongViewMorningChatValue(page);
      const nextPages = buildNextPagesWithUpdatedProperty(page, "Morning Chat", nextAttachmentPath);
      persistPages(nextPages);
      if (previousAttachmentPath && previousAttachmentPath !== nextAttachmentPath) {
        deleteUnusedLibraryAttachments([previousAttachmentPath], nextPages);
      }
    } catch {
      window.alert("The Morning Chat image could not be read.");
    }
  };

  const renameQuoteOption = (field: "Author" | "Source", currentValue: string, nextValue: string) => {
    const currentNormalized = currentValue.trim();
    const nextNormalized = nextValue.trim();
    if (!currentNormalized || !nextNormalized || currentNormalized === nextNormalized) {
      return;
    }

    markQuoteSaving();
    const nextPages = pagesRef.current.map((page) => {
        if (page.collectionId !== "quotes") {
          return page;
        }

        const value = getQuoteFieldValue(page, field).trim();
        if (!value || value.toLowerCase() !== currentNormalized.toLowerCase()) {
          return page;
        }

        return {
          ...page,
          properties: {
            ...(page.properties ?? {}),
            [field]: nextNormalized
          },
          updatedAt: new Date().toISOString()
        };
      });
    persistPages(nextPages);
  };

  const deleteQuoteOption = (field: "Author" | "Source", value: string) => {
    const normalized = value.trim();
    if (!normalized) {
      return;
    }

    markQuoteSaving();
    const nextPages = pagesRef.current.map((page) => {
        if (page.collectionId !== "quotes") {
          return page;
        }

        const currentValue = getQuoteFieldValue(page, field).trim();
        if (!currentValue || currentValue.toLowerCase() !== normalized.toLowerCase()) {
          return page;
        }

        return {
          ...page,
          properties: {
            ...(page.properties ?? {}),
            [field]: ""
          },
          updatedAt: new Date().toISOString()
        };
      });
    persistPages(nextPages);
  };

  useEffect(() => {
    if (!selectedPage || !isReviewCollection) {
      return;
    }

    const current = selectedPage.properties?.[REVIEW_REFLECTION_KEY];
    if (current && typeof current === "object") {
      return;
    }

    updatePage(selectedPage.id, {
      properties: {
        ...(selectedPage.properties ?? {}),
        [REVIEW_REFLECTION_KEY]: coerceReviewReflectionState(null)
      }
    });
    setShowLegacyReviewNotes(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReviewCollection, selectedPage?.id]);

  const updateTickerGroupTickers = (groupPageId: string, nextTickers: string[]) => {
    const normalizedTickers = Array.from(
      new Set(nextTickers.map(normalizeTickerToken).filter(Boolean))
    ).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

    const now = new Date().toISOString();
    let changed = false;

    const nextPages = pagesRef.current.map((page) => {
      if (page.collectionId !== "ticker-groups") {
        return page;
      }

      const existingTickers = renderPropertyList(page, "Tickers").map(normalizeTickerToken).filter(Boolean);

      if (page.id === groupPageId) {
        const nextProperties = {
          ...(page.properties ?? {}),
          Tickers: normalizedTickers
        };

        if (JSON.stringify(existingTickers) === JSON.stringify(normalizedTickers)) {
          return page;
        }

        changed = true;
        return { ...page, properties: nextProperties, updatedAt: now };
      }

      const filtered = existingTickers.filter((ticker) => !normalizedTickers.includes(ticker));
      if (filtered.length === existingTickers.length) {
        return page;
      }

      changed = true;
      return {
        ...page,
        properties: {
          ...(page.properties ?? {}),
          Tickers: filtered
        },
        updatedAt: now
      };
    });

    if (changed) {
      persistPages(nextPages);
    }
  };

  const renameTickerGroupTickerEverywhere = (currentTicker: string, nextTicker: string) => {
    const normalizedCurrent = normalizeTickerToken(currentTicker);
    const normalizedNext = normalizeTickerToken(nextTicker);
    if (!normalizedCurrent || !normalizedNext || normalizedCurrent === normalizedNext) {
      return;
    }

    const selectedPageTickers = selectedPage
      ? renderPropertyList(selectedPage, "Tickers").map(normalizeTickerToken).filter(Boolean)
      : [];
    const recipientGroupId = selectedPageTickers.includes(normalizedCurrent)
      ? selectedPage?.id
      : pagesRef.current.find(
        (page) =>
          page.collectionId === "ticker-groups" &&
          renderPropertyList(page, "Tickers").map(normalizeTickerToken).includes(normalizedCurrent)
      )?.id;

    if (!recipientGroupId) {
      return;
    }

    const now = new Date().toISOString();
    let changed = false;

    const nextPages = pagesRef.current.map((page) => {
      if (page.collectionId !== "ticker-groups") {
        return page;
      }

      const existingTickers = renderPropertyList(page, "Tickers").map(normalizeTickerToken).filter(Boolean);
      let nextTickers = existingTickers;

      if (page.id === recipientGroupId) {
        nextTickers = existingTickers.map((ticker) =>
          ticker === normalizedCurrent ? normalizedNext : ticker
        );
      } else {
        nextTickers = existingTickers.filter((ticker) => ticker !== normalizedCurrent && ticker !== normalizedNext);
      }

      const normalizedTickers = Array.from(new Set(nextTickers)).sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: "base" })
      );

      if (JSON.stringify(existingTickers) === JSON.stringify(normalizedTickers)) {
        return page;
      }

      changed = true;
      return {
        ...page,
        properties: {
          ...(page.properties ?? {}),
          Tickers: normalizedTickers
        },
        updatedAt: now
      };
    });

    if (changed) {
      persistPages(nextPages);
    }
  };

  const removeTickerGroupTickerEverywhere = (ticker: string) => {
    const normalizedTicker = normalizeTickerToken(ticker);
    if (!normalizedTicker) {
      return;
    }

    const now = new Date().toISOString();
    let changed = false;

    const nextPages = pagesRef.current.map((page) => {
      if (page.collectionId !== "ticker-groups") {
        return page;
      }

      const existingTickers = renderPropertyList(page, "Tickers").map(normalizeTickerToken).filter(Boolean);
      const filteredTickers = existingTickers.filter((value) => value !== normalizedTicker);
      if (filteredTickers.length === existingTickers.length) {
        return page;
      }

      changed = true;
      return {
        ...page,
        properties: {
          ...(page.properties ?? {}),
          Tickers: filteredTickers
        },
        updatedAt: now
      };
    });

    if (changed) {
      persistPages(nextPages);
    }
  };

  const renderTickerGroupTickerPicker = (page: LibraryPageRecord) => {
    const tickers = renderPropertyList(page, "Tickers").map(normalizeTickerToken).filter(Boolean);
    const visibleTickers = tickers.slice(0, 24);
    const hiddenCount = Math.max(0, tickers.length - visibleTickers.length);

    return (
      <label className="library-open-page-property ticker-group-ticker-picker">
        <span>Tickers</span>
        <button
          type="button"
          className="library-property-pill-button ticker-group-ticker-select"
          onClick={() => {
            setTickerGroupTickerSearch("");
            setIsTickerGroupTickerDrawerOpen(true);
          }}
        >
          {tickers.length === 0 ? (
            <span className="ticker-group-ticker-placeholder">Select tickers...</span>
          ) : (
            <span className="ticker-group-selected-pills" aria-label={`Selected tickers: ${tickers.join(", ")}`}>
              {visibleTickers.map((ticker) => {
                const tickerIcon = getTickerIcon(ticker);

                return (
                  <span key={ticker} className="symbol-pill ticker-group-selected-pill">
                    {tickerIcon ? (
                      <img src={tickerIcon} alt={`${ticker} ticker icon`} className="symbol-pill-icon" />
                    ) : (
                      <WorkspaceIcon icon="trades" alt={`${ticker} ticker icon`} className="symbol-pill-icon" />
                    )}
                    {ticker}
                  </span>
                );
              })}
              {hiddenCount > 0 ? (
                <span className="ticker-group-overflow-pill">+{hiddenCount} more</span>
              ) : null}
            </span>
          )}
        </button>
      </label>
    );
  };

  const handleCreatePage = () => {
    const newPage = createLibraryPage(selectedCollectionId);
    const seededPage =
      selectedCollectionId === "idea-inbox"
        ? { ...newPage, title: "New Note", tags: ["idea"] }
        : newPage;
    persistPages([seededPage, ...pagesRef.current]);
    if (selectedCollectionId === "idea-inbox") {
      setNotesTab(DEFAULT_NOTES_TAB);
    }
    setSelectedPageId(seededPage.id);
    setCollectionView("page");
  };

  const handleCreateBookRow = () => {
    const newPage = createLibraryBookRow();
    persistPages([newPage, ...pagesRef.current]);
    setSelectedPageId(newPage.id);
    setCollectionView("page");
    setBookSearchQuery("");
    setBookStatusFilter("");
    setBookGenreFilter([]);
  };

  const handleCreateQuoteRow = () => {
    const newPage = createLibraryQuoteRow();
    persistPages([newPage, ...pagesRef.current]);
    setSelectedPageId(newPage.id);
    setCollectionView("list");
    setQuoteSearchQuery("");
    setQuoteCellEditor(null);
    setQuoteCellEditorSearchQuery("");
    setNotesTypeEditor(null);
    setNotesTypeSearchQuery("");
    setNotesTagEditor(null);
    setNotesTagSearchQuery("");
  };

  const handleCreateStrongViewRow = () => {
    const newPage = createLibraryStrongViewRow();
    persistPages([newPage, ...pagesRef.current]);
    setSelectedPageId(newPage.id);
    setCollectionView("page");
    setStrongViewTickerQuery("");
    setStrongViewDateFilter("");
    setStrongViewSortDirection("desc");
  };

  const handleDeletePage = (pageId: string) => {
    const targetPage = pages.find((page) => page.id === pageId);
    if (!targetPage) {
      return;
    }

    if (!window.confirm(`Delete "${targetPage.title}" from the library?`)) {
      return;
    }

    const nextPages = pagesRef.current.filter((page) => page.id !== pageId);
    persistPages(nextPages);
    deleteUnusedLibraryAttachments(collectWorkspaceAttachmentPaths(targetPage), nextPages);
    setSelectedPageId("");
    setCollectionView("list");
  };

  const openPage = (pageId: string) => {
    setSelectedPageId(pageId);
    setCollectionView("page");
    setBookCellEditor(null);
    setBookCellEditorSearchQuery("");
    setQuoteCellEditor(null);
    setQuoteCellEditorSearchQuery("");
    setNotesTypeEditor(null);
    setNotesTypeSearchQuery("");
    setNotesTagEditor(null);
    setNotesTagSearchQuery("");
  };

  const toggleBookSort = (key: BookSortKey) => {
    setBookSortConfig((current) => {
      if (current.key === key) {
        return { key, direction: toggleSortDirection(current.direction) };
      }

      return { key, direction: key === "rating" ? "desc" : "asc" };
    });
  };

  const toggleStrongViewDateSort = () => {
    setStrongViewSortDirection((current) => toggleSortDirection(current));
  };

  const getBookValidation = (page: LibraryPageRecord) => {
    const titleInvalid = page.title.trim().length === 0;
    const authorInvalid = getBookFieldValue(page, "Author").trim().length === 0;
    const ratingValue = getBookFieldValue(page, "Rating").trim();
    const ratingNumber = ratingValue ? Number(ratingValue) : NaN;
    const ratingInvalid =
      Boolean(ratingValue) &&
      (!Number.isFinite(ratingNumber) || !Number.isInteger(ratingNumber) || ratingNumber < 1 || ratingNumber > 5);

    return { titleInvalid, authorInvalid, ratingInvalid };
  };

  const renderBookTextFields = (page: LibraryPageRecord) => {
    const customFields = getBookCustomTextFields(page);

    return (
      <div className="library-open-page-notes">
        <div className="library-open-page-note">
          <span>Summary</span>
          <JournalRichTextEditor
            key={`${page.id}-book-summary-editor`}
            content={getPropertyRichTextFieldValue(page, "Summary")}
            onChange={(content) => updatePageProperty(page, "Summary", content)}
            onImageInsert={createLibraryInlineImageInsertHandler(page.id, "book-summary")}
            placeholder="Key ideas, takeaways, and notes from the book."
            appearance="notion"
            autosize
            draftStorageKey={getLibraryDraftStorageKey(page.id, "book-summary")}
            sourceUpdatedAt={page.updatedAt}
          />
        </div>
        <div className="library-open-page-note">
          <span>Review</span>
          <JournalRichTextEditor
            key={`${page.id}-book-review-editor`}
            content={getPropertyRichTextFieldValue(page, "Review")}
            onChange={(content) => updatePageProperty(page, "Review", content)}
            onImageInsert={createLibraryInlineImageInsertHandler(page.id, "book-review")}
            placeholder="What stood out, what mattered, and how it applies to trading."
            appearance="notion"
            autosize
            draftStorageKey={getLibraryDraftStorageKey(page.id, "book-review")}
            sourceUpdatedAt={page.updatedAt}
          />
        </div>
        {customFields.map((field) => (
          <div key={field.id} className="library-open-page-note">
            <span>{field.label}</span>
            <JournalRichTextEditor
              key={`${page.id}-${field.id}-editor`}
              content={field.content}
              onChange={(content) => updateBookCustomTextField(page, field.id, { content })}
              onImageInsert={createLibraryInlineImageInsertHandler(page.id, `book-custom-${field.id}`)}
              placeholder={`${field.label} notes`}
              appearance="notion"
              autosize
              draftStorageKey={getLibraryDraftStorageKey(page.id, `book-custom-${field.id}`)}
              sourceUpdatedAt={page.updatedAt}
            />
            <div className="library-book-note-actions">
              <button
                type="button"
                className="mini-action mini-action-soft"
                onClick={() => {
                  const nextLabel = window.prompt("Rename text field", field.label)?.trim() ?? "";
                  if (!nextLabel) {
                    return;
                  }

                  updateBookCustomTextField(page, field.id, { label: nextLabel });
                }}
              >
                Rename
              </button>
              <button
                type="button"
                className="mini-action mini-action-danger"
                onClick={() => removeBookCustomTextField(page, field.id)}
              >
                Remove
              </button>
            </div>
          </div>
        ))}
        <div className="library-book-note-actions">
          <button type="button" className="mini-action" onClick={() => addBookCustomTextField(page)}>
            + Add Text Field
          </button>
        </div>
      </div>
    );
  };

  return (
    <main className="page-shell library-page">
      {activeSection === "collections" ? (
        <PageHero
          eyebrow="Library"
          title="Library"
          icon="library"
          className="page-hero-library"
        />
      ) : null}

      <section className="library-layout">
        <aside className="library-collection-panel">
          <div className="panel-header">
            <WorkspaceIcon icon="library" alt="Library collections icon" className="panel-header-icon" />
            <h2>Collections</h2>
          </div>
          <div className="library-collection-list">
            {libraryCollections.map((collection) => {
              const collectionCount = pages.filter((page) => page.collectionId === collection.id).length;
              return (
                <button
                  key={collection.id}
                  type="button"
                  className={`library-collection-button${
                    activeSection === "collections" && collection.id === selectedCollectionId
                      ? " library-collection-button-active"
                      : ""
                  }`}
                  onClick={() => {
                    setActiveSection("collections");
                    setSelectedCollectionId(collection.id);
                    setSelectedPageId("");
                    setCollectionView("list");
                    setNotesTab(DEFAULT_NOTES_TAB);
                    setNotesTagFilterQuery("");
                    setIsNotesTagFilterDrawerOpen(false);
                    setNotesTagFilterSearchQuery("");
                    setBookSearchQuery("");
                    setIsBookSearchDrawerOpen(false);
                    setBookSearchDrawerQuery("");
                    setBookStatusFilter("");
                    setBookGenreFilter([]);
                    setBookCellEditor(null);
                    setBookCellEditorSearchQuery("");
                    setIsBookGenreFilterOpen(false);
                    setBookGenreFilterSearchQuery("");
                    setQuoteSearchQuery("");
                    setIsQuoteSearchDrawerOpen(false);
                    setQuoteSearchDrawerQuery("");
                    setQuoteCellEditor(null);
                    setQuoteCellEditorSearchQuery("");
                    setStrongViewTickerQuery("");
                    setStrongViewDateFilter("");
                    setStrongViewSortDirection("desc");
                    setIsStrongViewTickerDrawerOpen(false);
                    setStrongViewTickerSearch("");
                    setNotesTypeEditor(null);
                    setNotesTypeSearchQuery("");
                    setNotesTagEditor(null);
                    setNotesTagSearchQuery("");
                  }}
                >
                  <span>{collection.accent}</span>
                  <strong>{collection.name}</strong>
                  <small>{collectionCount} page{collectionCount === 1 ? "" : "s"}</small>
                </button>
              );
            })}

            <button
              type="button"
              className={`library-collection-button${
                activeSection === "playbooks" ? " library-collection-button-active" : ""
              }`}
              onClick={() => {
                setActiveSection("playbooks");
                setSelectedPageId("");
                setCollectionView("list");
                setNotesTab(DEFAULT_NOTES_TAB);
                setNotesTagFilterQuery("");
                setIsNotesTagFilterDrawerOpen(false);
                setNotesTagFilterSearchQuery("");
                setBookSearchQuery("");
                setIsBookSearchDrawerOpen(false);
                setBookSearchDrawerQuery("");
                setBookCellEditor(null);
                setBookCellEditorSearchQuery("");
                setIsBookGenreFilterOpen(false);
                setBookGenreFilterSearchQuery("");
                setQuoteSearchQuery("");
                setIsQuoteSearchDrawerOpen(false);
                setQuoteSearchDrawerQuery("");
                setQuoteCellEditor(null);
                setQuoteCellEditorSearchQuery("");
                setStrongViewTickerQuery("");
                setStrongViewDateFilter("");
                setStrongViewSortDirection("desc");
                setIsStrongViewTickerDrawerOpen(false);
                setStrongViewTickerSearch("");
                setNotesTypeEditor(null);
                setNotesTypeSearchQuery("");
                setNotesTagEditor(null);
                setNotesTagSearchQuery("");
              }}
            >
              <span>Setup</span>
              <strong>Playbooks</strong>
              <small>Open setup library</small>
            </button>

            <button
              type="button"
              className={`library-collection-button${
                activeSection === "chart-library" ? " library-collection-button-active" : ""
              }`}
              onClick={() => {
                setActiveSection("chart-library");
                setSelectedPageId("");
                setCollectionView("list");
                setNotesTab(DEFAULT_NOTES_TAB);
                setNotesTagFilterQuery("");
                setIsNotesTagFilterDrawerOpen(false);
                setNotesTagFilterSearchQuery("");
                setBookSearchQuery("");
                setIsBookSearchDrawerOpen(false);
                setBookSearchDrawerQuery("");
                setBookStatusFilter("");
                setBookGenreFilter([]);
                setBookCellEditor(null);
                setBookCellEditorSearchQuery("");
                setIsBookGenreFilterOpen(false);
                setBookGenreFilterSearchQuery("");
                setQuoteSearchQuery("");
                setIsQuoteSearchDrawerOpen(false);
                setQuoteSearchDrawerQuery("");
                setQuoteCellEditor(null);
                setQuoteCellEditorSearchQuery("");
                setStrongViewTickerQuery("");
                setStrongViewDateFilter("");
                setStrongViewSortDirection("desc");
                setIsStrongViewTickerDrawerOpen(false);
                setStrongViewTickerSearch("");
                setNotesTypeEditor(null);
                setNotesTypeSearchQuery("");
                setNotesTagEditor(null);
                setNotesTagSearchQuery("");
              }}
            >
              <span>Charts</span>
              <strong>Chart Library</strong>
              <small>Browse tagged screenshots</small>
            </button>
          </div>
        </aside>

        <section className="library-database-panel">
          {activeSection === "chart-library" ? (
            <ChartLibraryPanel
              journalPages={journalPages}
              trades={trades}
              onSelectTrade={onSelectTrade}
              onOpenJournalDate={onOpenJournalDate}
            />
          ) : null}

          {activeSection === "playbooks" ? (
            <ErrorBoundary label="Library Playbooks">
              <PlaybooksPage
                embedded
                trades={trades}
                journalPages={journalPages}
                onSelectTrade={onSelectTrade}
                onOpenJournalDate={onOpenJournalDate}
                onViewReportsForPlaybook={onViewReportsForPlaybook}
              />
            </ErrorBoundary>
          ) : null}

          {activeSection === "collections" && collectionView === "list" ? (
            <>
              <div className="library-database-header">
                <div>
                  <span className="page-eyebrow">{selectedCollection.accent}</span>
                  <h2>{selectedCollection.name}</h2>
                  <p>{selectedCollection.description}</p>
                </div>
                <button
                  className="button button-primary"
                  type="button"
                  onClick={isQuotes ? handleCreateQuoteRow : isStrongViews ? handleCreateStrongViewRow : handleCreatePage}
                >
                  {isReviewCollection
                    ? selectedReviewPeriod === "weekly"
                      ? "New Weekly Review"
                      : "New Monthly Review"
                    : isTickerGroups
                      ? "New Group"
                      : isStrongViews
                        ? "New Strong View"
                      : isQuotes
                        ? "New Quote"
                      : isNotesCollection
                        ? "New Note"
                        : "New Page"}
                </button>
              </div>

              {isNotesCollection ? (
                <div className="library-notes-controls">
                  <div className="library-notes-tabs" role="tablist" aria-label="Trading notes tabs">
                    {notesTabs.map((tab) => (
                      <button
                        key={tab}
                        type="button"
                        role="tab"
                        aria-selected={notesTab === tab}
                        className={`library-notes-tab${notesTab === tab ? " library-notes-tab-active" : ""}`}
                        onClick={() => setNotesTab(tab)}
                      >
                        {tab}
                        <span>{notesTabCounts[tab] ?? 0}</span>
                      </button>
                    ))}
                  </div>
                  <div className="library-notes-tag-search">
                    <label>Tag search</label>
                    <div className="library-notes-tag-search-row">
                      <button
                        type="button"
                        className={`library-notes-tag-search-trigger${notesTagFilterToken ? " library-notes-tag-search-trigger-active" : ""}`}
                        onClick={() => {
                          setNotesTagFilterSearchQuery(notesTagFilterQuery);
                          setIsNotesTagFilterDrawerOpen(true);
                        }}
                      >
                        {notesTagFilterToken ? `Tag: ${notesTagFilterLabel}` : "Open tag search"}
                      </button>
                      {notesTagFilterQuery.trim() ? (
                        <button type="button" className="mini-action" onClick={() => setNotesTagFilterQuery("")}>
                          Clear
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : null}

              {isTickerGroups ? (
                <div className="library-table-wrap" aria-label="Ticker groups database">
                  <table className="library-table">
                    <thead>
                      <tr>
                        <th>Group</th>
                        <th>Icon</th>
                        <th>Description</th>
                        <th>Tickers</th>
                        <th>Updated</th>
                      </tr>
                    </thead>
                    <tbody>
                      {collectionPages.length > 0 ? (
                        collectionPages.map((page) => {
                          const iconValue = typeof page.properties?.Icon === "string" ? page.properties.Icon : "";
                          const iconUrl = resolveTickerGroupIcon(iconValue);
                          const description = typeof page.properties?.Description === "string" ? page.properties.Description : "";
                          const tickers = renderPropertyList(page, "Tickers").map(normalizeTickerToken).filter(Boolean);

                          return (
                            <tr
                              key={page.id}
                              className={selectedPage?.id === page.id ? "library-table-row-active" : ""}
                              onClick={() => openPage(page.id)}
                            >
                              <td>
                                <button type="button" className="library-table-title" onClick={() => openPage(page.id)}>
                                  {page.title}
                                </button>
                              </td>
                              <td>
                                {iconUrl ? (
                                  <img src={iconUrl} alt={`${page.title} icon`} className="ticker-icon" />
                                ) : (
                                  <span className="library-table-muted">-</span>
                                )}
                              </td>
                              <td>{description || <span className="library-table-muted">-</span>}</td>
                              <td>{tickers.length}</td>
                              <td>{formatUpdatedAt(page.updatedAt)}</td>
                            </tr>
                          );
                        })
                      ) : (
                        <tr>
                          <td colSpan={5}>No groups yet. Create the first ticker group.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              ) : isBookClub && bookRows.length > 0 ? (
            <div className="library-table-wrap library-book-table-wrap" aria-label="Trading and Poker Books database">
              <div className="library-book-table-title">
                <WorkspaceIcon icon="library" alt="" className="panel-header-icon" />
                <div>
                  <h3>Trading and Poker Books</h3>
                  <span>
                    {filteredBookRows.length}
                    {bookSearchQuery.trim() || bookStatusFilter || bookGenreFilter.length > 0 ? ` of ${bookRows.length}` : ""}{" "}
                    books
                  </span>
                </div>
              </div>
              <div className="library-book-controls" aria-label="Book database controls">
                <button
                  type="button"
                  className={`library-book-search library-search-trigger${bookSearchQuery.trim() ? " library-search-trigger-active" : ""}`}
                  onClick={() => {
                    setBookSearchDrawerQuery(bookSearchQuery);
                    setIsBookSearchDrawerOpen(true);
                  }}
                >
                  {bookSearchQuery.trim() ? `Search: ${bookSearchQuery}` : "Search by book name or author"}
                </button>
                {bookSearchQuery.trim() ? (
                  <button type="button" className="mini-action" onClick={() => setBookSearchQuery("")}>
                    Clear
                  </button>
                ) : null}
                <FilterSelect
                  value={bookStatusFilter}
                  options={bookStatusFilterOptions}
                  ariaLabel="Filter books by reading status"
                  onChange={setBookStatusFilter}
                />
                <button
                  type="button"
                  className={`library-book-genre-trigger${bookGenreFilter.length > 0 ? " library-book-genre-trigger-active" : ""}`}
                  onClick={() => {
                    setIsBookGenreFilterOpen(true);
                    setBookGenreFilterSearchQuery("");
                  }}
                >
                  {bookGenreFilter.length > 0 ? `Genre: ${bookGenreFilter[0]}${bookGenreFilter.length > 1 ? ` +${bookGenreFilter.length - 1}` : ""}` : "Filter genre"}
                </button>
                <button className="button button-primary" type="button" onClick={handleCreateBookRow}>
                  New Book
                </button>
              </div>
              <table className="library-table library-book-table">
                <thead>
                  <tr>
                    <th>
                      <button type="button" className="sortable-header-button" onClick={() => toggleBookSort("title")}>
                        <span>Book Name</span>
                        <span
                          className={`sort-indicator ${bookSortConfig.key === "title" ? "sort-indicator-active" : ""}`}
                        >
                          {bookSortConfig.key === "title" ? bookSortConfig.direction : "sort"}
                        </span>
                      </button>
                    </th>
                    <th>
                      <button type="button" className="sortable-header-button" onClick={() => toggleBookSort("author")}>
                        <span>Author</span>
                        <span
                          className={`sort-indicator ${bookSortConfig.key === "author" ? "sort-indicator-active" : ""}`}
                        >
                          {bookSortConfig.key === "author" ? bookSortConfig.direction : "sort"}
                        </span>
                      </button>
                    </th>
                    <th>
                      <button
                        type="button"
                        className="sortable-header-button"
                        onClick={() => toggleBookSort("readingStatus")}
                      >
                        <span>Reading Status</span>
                        <span
                          className={`sort-indicator ${bookSortConfig.key === "readingStatus" ? "sort-indicator-active" : ""}`}
                        >
                          {bookSortConfig.key === "readingStatus" ? bookSortConfig.direction : "sort"}
                        </span>
                      </button>
                    </th>
                    <th>
                      <button type="button" className="sortable-header-button" onClick={() => toggleBookSort("rating")}>
                        <span>Rating</span>
                        <span
                          className={`sort-indicator ${bookSortConfig.key === "rating" ? "sort-indicator-active" : ""}`}
                        >
                          {bookSortConfig.key === "rating" ? bookSortConfig.direction : "sort"}
                        </span>
                      </button>
                    </th>
                    <th>Genre</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredBookRows.length > 0 ? (
                    filteredBookRows.map((page) => {
                      const statusValue = getBookFieldValue(page, "Reading Status") || page.status;
                      const genres = renderPropertyList(page, "Genre");
                      const { titleInvalid, authorInvalid, ratingInvalid } = getBookValidation(page);

                      return (
                        <tr
                          key={page.id}
                          className={selectedPage?.id === page.id ? "library-table-row-active" : ""}
                          onClick={() => openPage(page.id)}
                        >
                          <td>
                            <div className="library-book-title-cell">
                              <span className="library-book-icon" aria-hidden="true" />
                              <input
                                className={`library-cell-input${titleInvalid ? " library-cell-input-invalid" : ""}`}
                                value={page.title}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setSelectedPageId(page.id);
                                }}
                                onChange={(event) => updatePage(page.id, { title: event.target.value })}
                                placeholder="Book name"
                              />
                            </div>
                          </td>
                          <td>
                            <input
                              className={`library-cell-input${authorInvalid ? " library-cell-input-invalid" : ""}`}
                              value={getBookFieldValue(page, "Author")}
                              onClick={(event) => {
                                event.stopPropagation();
                                setSelectedPageId(page.id);
                              }}
                              onChange={(event) => updatePageProperty(page, "Author", event.target.value)}
                              placeholder="Author"
                            />
                          </td>
                          <td>
                            <button
                              type="button"
                              className={`library-status-pill ${getReadingStatusToneClass(statusValue)}`}
                              onClick={(event) => {
                                event.stopPropagation();
                                setSelectedPageId(page.id);
                                setBookCellEditor({ pageId: page.id, field: "Reading Status" });
                                setBookCellEditorSearchQuery("");
                              }}
                            >
                              {statusValue || "Set status"}
                            </button>
                          </td>
                          <td>
                            <select
                              className={`library-cell-select${ratingInvalid ? " library-cell-select-invalid" : ""}`}
                              value={getBookFieldValue(page, "Rating")}
                              onClick={(event) => {
                                event.stopPropagation();
                                setSelectedPageId(page.id);
                              }}
                              onChange={(event) => updatePageProperty(page, "Rating", event.target.value)}
                            >
                              <option value="">-</option>
                              {[1, 2, 3, 4, 5].map((value) => (
                                <option key={value} value={String(value)}>
                                  {value}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <button
                              type="button"
                              className="library-genre-cell"
                              onClick={(event) => {
                                event.stopPropagation();
                                setSelectedPageId(page.id);
                                setBookCellEditor({ pageId: page.id, field: "Genre" });
                                setBookCellEditorSearchQuery("");
                              }}
                            >
                              <div className="library-genre-list">
                                {genres.length > 0 ? (
                                  <>
                                    {genres.slice(0, 4).map((genre) => (
                                      <span key={genre}>{genre}</span>
                                    ))}
                                    {genres.length > 4 ? (
                                      <span className="library-genre-more">+{genres.length - 4}</span>
                                    ) : null}
                                  </>
                                ) : (
                                  <span className="library-genre-empty">Add genre</span>
                                )}
                              </div>
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={5} className="empty-state">
                        No books match the current filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          ) : isQuotes ? (
            <div className="library-table-wrap library-quotes-table-wrap" aria-label="Quotes database">
              <div className="library-quotes-table-title">
                <WorkspaceIcon icon="text" alt="" className="panel-header-icon" />
                <div>
                  <h3>Quotes</h3>
                  <span>
                    {filteredQuoteRows.length}
                    {quoteSearchQuery.trim() ? ` of ${quoteRows.length}` : ""} quotes
                  </span>
                  {quoteSaveStatus !== "idle" ? (
                    <span className={`library-quotes-save-status library-quotes-save-status-${quoteSaveStatus}`}>
                      {quoteSaveStatus === "saving" ? "Saving..." : "Saved"}
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="library-quotes-controls" aria-label="Quotes database controls">
                <button
                  type="button"
                  className={`library-quotes-search library-search-trigger${quoteSearchQuery.trim() ? " library-search-trigger-active" : ""}`}
                  onClick={() => {
                    setQuoteSearchDrawerQuery(quoteSearchQuery);
                    setIsQuoteSearchDrawerOpen(true);
                  }}
                >
                  {quoteSearchQuery.trim() ? `Author: ${quoteSearchQuery}` : "Search by author"}
                </button>
                {quoteSearchQuery.trim() ? (
                  <button type="button" className="mini-action" onClick={() => setQuoteSearchQuery("")}>
                    Clear
                  </button>
                ) : null}
                <button className="button button-primary" type="button" onClick={handleCreateQuoteRow}>
                  New Quote
                </button>
              </div>
              <table className="library-table library-quotes-table">
                <thead>
                  <tr>
                    <th>Quote</th>
                    <th>Author</th>
                    <th>Source</th>
                    <th>Used</th>
                    <th>Date Used</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredQuoteRows.length > 0 ? (
                    filteredQuoteRows.map((page) => (
                      <tr
                        key={page.id}
                        className={selectedPage?.id === page.id ? "library-table-row-active" : ""}
                        onClick={() => setSelectedPageId(page.id)}
                      >
                        <td>
                          <div
                            className="library-quotes-rich-editor"
                            onClick={(event) => {
                              event.stopPropagation();
                              setSelectedPageId(page.id);
                            }}
                          >
                            <JournalRichTextEditor
                              key={`${page.id}-quote-editor`}
                              content={getQuoteRichTextFieldValue(page)}
                              onChange={(content) => {
                                markQuoteSaving();
                                updatePageProperty(page, "Quote", content);
                              }}
                              onImageInsert={createLibraryInlineImageInsertHandler(page.id, "quote")}
                              placeholder="Type a quote..."
                              compact
                              draftStorageKey={getLibraryDraftStorageKey(page.id, "quote")}
                              sourceUpdatedAt={page.updatedAt}
                            />
                          </div>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="library-status-pill library-quotes-pill"
                            onClick={(event) => {
                              event.stopPropagation();
                              setSelectedPageId(page.id);
                              setQuoteCellEditor({ pageId: page.id, field: "Author" });
                              setQuoteCellEditorSearchQuery("");
                            }}
                          >
                            {getQuoteFieldValue(page, "Author") || "Set author"}
                          </button>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="library-status-pill library-quotes-pill"
                            onClick={(event) => {
                              event.stopPropagation();
                              setSelectedPageId(page.id);
                              setQuoteCellEditor({ pageId: page.id, field: "Source" });
                              setQuoteCellEditorSearchQuery("");
                            }}
                          >
                            {getQuoteFieldValue(page, "Source") || "Set source"}
                          </button>
                        </td>
                        <td>
                          <label className="library-quotes-used">
                            <input
                              type="checkbox"
                              checked={getQuoteUsedValue(page)}
                              aria-label="Used"
                              onClick={(event) => event.stopPropagation()}
                              onChange={(event) => updateQuoteUsed(page, event.target.checked)}
                            />
                          </label>
                        </td>
                        <td className="library-quotes-date-used">
                          <input
                            className="library-cell-input library-cell-date"
                            type="date"
                            value={getQuoteDateUsedForInput(page)}
                            disabled={!getQuoteUsedValue(page)}
                            onClick={(event) => {
                              event.stopPropagation();
                              setSelectedPageId(page.id);
                            }}
                            onChange={(event) => updateQuoteDateUsed(page, event.target.value)}
                            aria-label="Date used"
                          />
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5} className="empty-state">
                        {quoteRows.length > 0 ? "No quotes match the current search." : "No quotes yet. Create the first quote."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          ) : isStrongViews ? (
            <div className="library-table-wrap library-strong-view-table-wrap" aria-label="Strong Views database">
              <div className="library-strong-view-table-title">
                <WorkspaceIcon icon="trades" alt="" className="panel-header-icon" />
                <div>
                  <h3>Strong Views</h3>
                  <span>
                    {filteredStrongViewRows.length}
                    {strongViewTickerQuery.trim() || strongViewDateFilter ? ` of ${strongViewRows.length}` : ""} views
                  </span>
                </div>
              </div>
              <div className="library-book-controls" aria-label="Strong Views controls">
                <input
                  className="library-book-search"
                  value={strongViewTickerQuery}
                  onChange={(event) => setStrongViewTickerQuery(event.target.value)}
                  placeholder="Search ticker (ex: AAPL)"
                  aria-label="Search strong views by ticker"
                />
                <input
                  className="library-book-search library-strong-view-date-filter"
                  type="date"
                  value={strongViewDateFilter}
                  onChange={(event) => setStrongViewDateFilter(event.target.value)}
                  aria-label="Filter strong views by date"
                />
                {strongViewTickerQuery.trim() || strongViewDateFilter ? (
                  <button
                    type="button"
                    className="mini-action"
                    onClick={() => {
                      setStrongViewTickerQuery("");
                      setStrongViewDateFilter("");
                    }}
                  >
                    Clear
                  </button>
                ) : null}
                <button className="button button-primary" type="button" onClick={handleCreateStrongViewRow}>
                  New Strong View
                </button>
              </div>
              <table className="library-table library-strong-view-table">
                <thead>
                  <tr>
                    <th>Ticker</th>
                    <th>
                      <button type="button" className="sortable-header-button" onClick={toggleStrongViewDateSort}>
                        <span>Date</span>
                        <span className="sort-indicator sort-indicator-active">{strongViewSortDirection}</span>
                      </button>
                    </th>
                    <th>Key Level Up</th>
                    <th>Key Level Down</th>
                    <th>Bias</th>
                    <th>ATR</th>
                    <th>RVOL</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredStrongViewRows.length > 0 ? (
                    filteredStrongViewRows.map((page) => {
                      const ticker = getStrongViewTickerValue(page);
                      const date = getStrongViewDateValue(page);
                      const readableDate = formatReadableDate(date);
                      const keyLevelUp = getStrongViewFieldValue(page, "Key Level Up").trim();
                      const keyLevelDown = getStrongViewFieldValue(page, "Key Level Down").trim();
                      const bias = getStrongViewFieldValue(page, "Bias").trim();
                      const biasLabel = bias || "Unset";
                      const tickerIcon = ticker ? getTickerIcon(ticker) : "";

                      return (
                        <tr
                          key={page.id}
                          className={selectedPage?.id === page.id ? "library-table-row-active" : ""}
                          onClick={() => openPage(page.id)}
                        >
                          <td>
                            <button type="button" className="library-table-title" onClick={() => openPage(page.id)}>
                              <span className="library-strong-view-ticker-cell">
                                {tickerIcon ? (
                                  <img src={tickerIcon} alt={`${ticker} ticker icon`} className="symbol-pill-icon" />
                                ) : (
                                  <WorkspaceIcon icon="trades" alt="" className="symbol-pill-icon" />
                                )}
                                <span>{ticker || "-"}</span>
                              </span>
                            </button>
                          </td>
                          <td>{readableDate || <span className="library-table-muted">-</span>}</td>
                          <td>{keyLevelUp || <span className="library-table-muted">-</span>}</td>
                          <td>{keyLevelDown || <span className="library-table-muted">-</span>}</td>
                          <td>
                            <span className={`library-status-pill ${getStrongViewBiasToneClass(bias)}`}>{biasLabel}</span>
                          </td>
                          <td>{formatStrongViewNumeric(page, "ATR")}</td>
                          <td>{formatStrongViewNumeric(page, "RVOL")}</td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={7} className="empty-state">
                        {strongViewRows.length > 0
                          ? "No strong views match the current filters."
                          : "No strong views yet. Create your first view."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          ) : isReviewCollection && selectedReviewPeriod ? (
            <ReviewDatabaseTable
              pages={databasePages}
              period={selectedReviewPeriod}
              selectedPageId={selectedPage?.id ?? ""}
              onOpenPage={openPage}
            />
          ) : isNotesCollection ? (
            <div className="library-table-wrap" aria-label="Trading notes table">
              <table className="library-table">
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>Type</th>
                    <th>Tags</th>
                    <th>Status</th>
                    <th>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {databasePages.length > 0 ? (
                    databasePages.map((page) => (
                      <tr
                        key={page.id}
                        className={selectedPage?.id === page.id ? "library-table-row-active" : ""}
                        onClick={() => openPage(page.id)}
                      >
                        <td>
                          <button
                            type="button"
                            className="library-table-title"
                            onClick={() => openPage(page.id)}
                          >
                            {page.title}
                          </button>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="library-note-type-cell"
                            onClick={(event) => {
                              event.stopPropagation();
                              setSelectedPageId(page.id);
                              setNotesTypeEditor({ pageId: page.id });
                              setNotesTypeSearchQuery("");
                              setNotesTagEditor(null);
                              setNotesTagSearchQuery("");
                            }}
                          >
                            <span className={`library-note-type-pill ${
                              page.status === "Archived" ? "library-note-type-pill-archived" : ""
                            }`}
                            >
                              {resolveEditableNoteType(page)}
                            </span>
                          </button>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="library-genre-cell"
                            onClick={(event) => {
                              event.stopPropagation();
                              setSelectedPageId(page.id);
                              setNotesTypeEditor(null);
                              setNotesTypeSearchQuery("");
                              setNotesTagEditor({ pageId: page.id });
                              setNotesTagSearchQuery("");
                            }}
                          >
                            <div className="library-genre-list">
                              {page.tags.length > 0 ? (
                                <>
                                  {page.tags.map(normalizeTagToken).filter(Boolean).slice(0, 4).map((tag) => (
                                    <span key={tag}>{tag}</span>
                                  ))}
                                  {page.tags.map(normalizeTagToken).filter(Boolean).length > 4 ? (
                                    <span className="library-genre-more">+{page.tags.map(normalizeTagToken).filter(Boolean).length - 4}</span>
                                  ) : null}
                                </>
                              ) : (
                                <span className="library-genre-empty">Add tags</span>
                              )}
                            </div>
                          </button>
                        </td>
                        <td>
                          <span className={`library-status-pill ${getLibraryStatusToneClass(page.status)}`}>
                            {page.status || "Active"}
                          </span>
                        </td>
                        <td>{formatUpdatedAt(page.updatedAt)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5}>
                        {notesTagFilterToken
                          ? `No notes in "${notesTab}" match tag "${notesTagFilterLabel}".`
                          : "No notes match this tab yet."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="library-table-wrap" aria-label={`${selectedCollection.name} database view`}>
              <table className="library-table">
                <thead>
                  <tr>
                    <th>Page</th>
                    <th>Status</th>
                    <th>Author</th>
                    <th>Rating</th>
                    <th>Tags</th>
                    <th>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {databasePages.length > 0 ? (
                    databasePages.map((page) => (
                      <tr
                        key={page.id}
                        className={selectedPage?.id === page.id ? "library-table-row-active" : ""}
                        onClick={() => openPage(page.id)}
                      >
                        <td>
                          <button
                            type="button"
                            className="library-table-title"
                            onClick={() => openPage(page.id)}
                          >
                            {page.title}
                          </button>
                        </td>
                        <td>{renderPropertyValue(page, "Reading Status", page.status)}</td>
                        <td>{renderPropertyValue(page, "Author")}</td>
                        <td>{renderPropertyValue(page, "Rating")}</td>
                        <td>{page.tags.slice(0, 3).join(", ") || "-"}</td>
                        <td>{formatUpdatedAt(page.updatedAt)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={6}>No pages yet. Create the first page in this collection.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
              )}

            </>
          ) : null}

          {activeSection === "collections" && collectionView === "page" && selectedPage ? (
            <section
              className={`library-detail-card${
                (isBookClub && isBookRow(selectedPage)) || (isStrongViews && isStrongViewRow(selectedPage))
                  ? " library-open-page-card"
                  : isReviewCollection || isTickerGroups
                    ? " library-open-page-card"
                    : ""
              }${isReviewCollection ? " library-review-page-card" : ""}`}
            >
              <div className="library-detail-header">
                <button type="button" className="mini-action" onClick={() => setCollectionView("list")}>
                  Back to {selectedCollection.name}
                </button>
                <div className="library-title-stack">
                  <span className="page-eyebrow">
                    {isBookClub && isBookRow(selectedPage)
                      ? "Open Book Page"
                      : isStrongViews && isStrongViewRow(selectedPage)
                        ? "Open Strong View Page"
                        : selectedCollection.name}
                  </span>
                  <input
                    className="library-title-input"
                    value={selectedPage.title}
                    onChange={(event) => updatePage(selectedPage.id, { title: event.target.value })}
                    placeholder="Untitled"
                  />
                  {isReviewCollection && selectedReviewPeriod ? (
                    <div className="library-review-chip-row" aria-label="Tickers traded">
                      {(
                        Array.isArray(selectedPage.properties?.[REVIEW_PROPERTY_KEYS.tickersTraded])
                          ? (selectedPage.properties?.[REVIEW_PROPERTY_KEYS.tickersTraded] as string[])
                          : []
                      )
                        .map(normalizeTickerToken)
                        .filter(Boolean)
                        .map((ticker) => {
                          const iconUrl = getTickerIcon(ticker);

                          return (
                            <span key={ticker} className="symbol-pill">
                              {iconUrl ? (
                                <img src={iconUrl} alt={`${ticker} icon`} className="symbol-pill-icon" />
                              ) : (
                                <WorkspaceIcon icon="trades" alt="" className="symbol-pill-icon" />
                              )}
                              {ticker}
                            </span>
                          );
                        })}
                    </div>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="button button-danger"
                  onClick={() => handleDeletePage(selectedPage.id)}
                >
                  Delete Page
                </button>
              </div>

              {isTickerGroups ? (
                <>
                  <div className="library-open-page-properties ticker-group-open-page">
                    <TickerGroupIconPicker
                      label="Icon"
                      value={typeof selectedPage.properties?.Icon === "string" ? selectedPage.properties.Icon : ""}
                      onChange={(next) => updateTickerGroupIcon(selectedPage, next)}
                      attachmentRecordId={selectedPage.id}
                    />

                    <label className="library-open-page-property ticker-group-description">
                      <span>Description</span>
                      <JournalRichTextEditor
                        key={`${selectedPage.id}-ticker-group-description`}
                        content={getPropertyRichTextFieldValue(selectedPage, "Description")}
                        onChange={(content) => updatePageProperty(selectedPage, "Description", content)}
                        onImageInsert={createLibraryInlineImageInsertHandler(selectedPage.id, "ticker-group-description")}
                        placeholder="Optional short description"
                        compact
                        showBlockActions={false}
                        draftStorageKey={getLibraryDraftStorageKey(selectedPage.id, "ticker-group-description")}
                        sourceUpdatedAt={selectedPage.updatedAt}
                      />
                    </label>

                    {renderTickerGroupTickerPicker(selectedPage)}
                  </div>

                  <div className="ticker-group-chip-preview" aria-label="Ticker chip preview">
                    <span className="property-label">Preview</span>
                    <div className="ticker-group-chip-preview-row">
                      {renderPropertyList(selectedPage, "Tickers")
                        .map(normalizeTickerToken)
                        .filter(Boolean)
                        .slice(0, 14)
                        .map((ticker) => {
                          const iconUrl = resolveTickerGroupIcon(
                            typeof selectedPage.properties?.Icon === "string" ? selectedPage.properties.Icon : ""
                          );

                          return (
                            <span key={ticker} className="symbol-pill">
                              {iconUrl ? (
                                <img src={iconUrl} alt={`${selectedPage.title} icon`} className="symbol-pill-icon" />
                              ) : (
                                <WorkspaceIcon icon="trades" alt={`${ticker} ticker icon`} className="symbol-pill-icon" />
                              )}
                              {ticker}
                            </span>
                          );
                        })}
                      {renderPropertyList(selectedPage, "Tickers").length === 0 ? (
                        <span className="ticker-group-chip-preview-empty">Add tickers to preview chips.</span>
                      ) : null}
                    </div>
                    <p className="ticker-group-hint">One ticker can only belong to one group at a time.</p>
                  </div>
                </>
              ) : isReviewCollection && selectedReviewPeriod ? (
                <>
                  <div className="library-open-page-properties">
                    <label className="library-open-page-property">
                      <span>{selectedReviewPeriod === "weekly" ? "Week Start" : "Month Start"}</span>
                      <input
                        type="date"
                        value={renderPropertyValue(selectedPage, REVIEW_PROPERTY_KEYS.rangeStart, "")}
                        onChange={(event) => updatePageProperty(selectedPage, REVIEW_PROPERTY_KEYS.rangeStart, event.target.value)}
                      />
                    </label>
                    <label className="library-open-page-property">
                      <span>{selectedReviewPeriod === "weekly" ? "Week End" : "Month End"}</span>
                      <input
                        type="date"
                        value={renderPropertyValue(selectedPage, REVIEW_PROPERTY_KEYS.rangeEnd, "")}
                        onChange={(event) => updatePageProperty(selectedPage, REVIEW_PROPERTY_KEYS.rangeEnd, event.target.value)}
                      />
                    </label>
                    <label className="library-open-page-property">
                      <span>Daily Shutdown Risk</span>
                      <input type="text" readOnly value={`$${dailyShutdownRiskUsd.toFixed(2)}`} />
                    </label>
                    <label className="library-open-page-property">
                      <span>Closed Orders</span>
                      <input type="text" readOnly value={renderPropertyValue(selectedPage, REVIEW_PROPERTY_KEYS.closedOrders, "-")} />
                    </label>
                    <label className="library-open-page-property library-open-page-property-compare">
                      <span>Trades</span>
                      <strong>
                        {selectedReviewComparisonData?.trades.currentLabel ??
                          renderPropertyValue(selectedPage, REVIEW_PROPERTY_KEYS.trades, "-")}
                      </strong>
                      {selectedReviewComparisonData ? (
                        <small>
                          {selectedReviewComparisonData.previousPeriodLabel} {selectedReviewComparisonData.trades.previousLabel}
                        </small>
                      ) : null}
                      {selectedReviewComparisonData?.trades.deltaLabel ? (
                        <em className={`report-period-delta report-period-delta-${selectedReviewComparisonData.trades.deltaTone}`}>
                          {selectedReviewComparisonData.trades.deltaLabel}
                        </em>
                      ) : null}
                    </label>
                    <label className="library-open-page-property library-open-page-property-compare">
                      <span>Shares</span>
                      <strong>
                        {selectedReviewComparisonData?.shares.currentLabel ??
                          renderPropertyValue(selectedPage, REVIEW_PROPERTY_KEYS.shares, "-")}
                      </strong>
                      {selectedReviewComparisonData ? (
                        <small>
                          {selectedReviewComparisonData.previousPeriodLabel} {selectedReviewComparisonData.shares.previousLabel}
                        </small>
                      ) : null}
                      {selectedReviewComparisonData?.shares.deltaLabel ? (
                        <em className={`report-period-delta report-period-delta-${selectedReviewComparisonData.shares.deltaTone}`}>
                          {selectedReviewComparisonData.shares.deltaLabel}
                        </em>
                      ) : null}
                    </label>
                    <label className="library-open-page-property library-open-page-property-compare">
                      <span>Win Rate</span>
                      <strong>
                        {selectedReviewComparisonData?.winRate.currentLabel ??
                          renderPropertyValue(selectedPage, REVIEW_PROPERTY_KEYS.winRate, "-")}
                      </strong>
                      {selectedReviewComparisonData ? (
                        <small>
                          {selectedReviewComparisonData.previousPeriodLabel} {selectedReviewComparisonData.winRate.previousLabel}
                        </small>
                      ) : null}
                      {selectedReviewComparisonData?.winRate.deltaLabel ? (
                        <em className={`report-period-delta report-period-delta-${selectedReviewComparisonData.winRate.deltaTone}`}>
                          {selectedReviewComparisonData.winRate.deltaLabel}
                        </em>
                      ) : null}
                    </label>

                    <label className="library-open-page-property library-open-page-property-compare">
                      <span>Net</span>
                      <strong>
                        {selectedReviewComparisonData?.net.currentLabel ??
                          renderPropertyValue(selectedPage, REVIEW_PROPERTY_KEYS.net, "-")}
                      </strong>
                      {selectedReviewComparisonData ? (
                        <small>
                          {selectedReviewComparisonData.previousPeriodLabel} {selectedReviewComparisonData.net.previousLabel}
                        </small>
                      ) : null}
                      {selectedReviewComparisonData?.net.deltaLabel ? (
                        <em className={`report-period-delta report-period-delta-${selectedReviewComparisonData.net.deltaTone}`}>
                          {selectedReviewComparisonData.net.deltaLabel}
                        </em>
                      ) : null}
                    </label>
                    <label className="library-open-page-property library-open-page-property-compare">
                      <span>Gross</span>
                      <strong>
                        {selectedReviewComparisonData?.gross.currentLabel ??
                          renderPropertyValue(selectedPage, REVIEW_PROPERTY_KEYS.gross, "-")}
                      </strong>
                      {selectedReviewComparisonData ? (
                        <small>
                          {selectedReviewComparisonData.previousPeriodLabel} {selectedReviewComparisonData.gross.previousLabel}
                        </small>
                      ) : null}
                      {selectedReviewComparisonData?.gross.deltaLabel ? (
                        <em className={`report-period-delta report-period-delta-${selectedReviewComparisonData.gross.deltaTone}`}>
                          {selectedReviewComparisonData.gross.deltaLabel}
                        </em>
                      ) : null}
                    </label>
                    <label className="library-open-page-property library-open-page-property-compare library-open-page-property-mpp">
                      <span>MPP</span>
                      <strong>{selectedReviewMppCardData?.currentLabel ?? "-"}</strong>
                      <small>Prev {selectedReviewMppCardData?.previousLabel ?? "-"}</small>
                      {selectedReviewMppCardData?.deltaLabel ? (
                        <em className={`report-period-delta report-period-delta-${selectedReviewMppCardData.deltaTone}`}>
                          {selectedReviewMppCardData.deltaLabel}
                        </em>
                      ) : null}
                    </label>
                    <label className="library-open-page-property library-open-page-property-compare library-open-page-property-red-days">
                      <span>Red Days</span>
                      <strong>
                        {selectedReviewComparisonData?.redDays.currentLabel ??
                          renderPropertyValue(selectedPage, REVIEW_PROPERTY_KEYS.redDays, "-")}
                      </strong>
                      {selectedReviewComparisonData ? (
                        <small>
                          {selectedReviewComparisonData.previousPeriodLabel} {selectedReviewComparisonData.redDays.previousLabel}
                        </small>
                      ) : null}
                      {selectedReviewComparisonData?.redDays.deltaLabel ? (
                        <em className={`report-period-delta report-period-delta-${selectedReviewComparisonData.redDays.deltaTone}`}>
                          {selectedReviewComparisonData.redDays.deltaLabel}
                        </em>
                      ) : null}
                    </label>
                    <label className="library-open-page-property library-open-page-property-compare library-open-page-property-green-days">
                      <span>Green Days</span>
                      <strong>
                        {selectedReviewComparisonData?.greenDays.currentLabel ??
                          renderPropertyValue(selectedPage, REVIEW_PROPERTY_KEYS.greenDays, "-")}
                      </strong>
                      {selectedReviewComparisonData ? (
                        <small>
                          {selectedReviewComparisonData.previousPeriodLabel} {selectedReviewComparisonData.greenDays.previousLabel}
                        </small>
                      ) : null}
                      {selectedReviewComparisonData?.greenDays.deltaLabel ? (
                        <em className={`report-period-delta report-period-delta-${selectedReviewComparisonData.greenDays.deltaTone}`}>
                          {selectedReviewComparisonData.greenDays.deltaLabel}
                        </em>
                      ) : null}
                    </label>

                    <label className="library-open-page-property">
                      <span>Risk Management (1-5)</span>
                      <select
                        value={renderPropertyValue(selectedPage, REVIEW_PROPERTY_KEYS.risk, "")}
                        onChange={(event) => updatePageProperty(selectedPage, REVIEW_PROPERTY_KEYS.risk, event.target.value)}
                      >
                        {scoreOptions.map((score) => (
                          <option key={score || "empty"} value={score}>
                            {score || "\u2014"}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="library-open-page-property">
                      <span>Psychology (1-5)</span>
                      <select
                        value={renderPropertyValue(selectedPage, REVIEW_PROPERTY_KEYS.psychology, "")}
                        onChange={(event) => updatePageProperty(selectedPage, REVIEW_PROPERTY_KEYS.psychology, event.target.value)}
                      >
                        {scoreOptions.map((score) => (
                          <option key={score || "empty"} value={score}>
                            {score || "\u2014"}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="library-open-page-property">
                      <span>Trading Plans (1-5)</span>
                      <select
                        value={renderPropertyValue(selectedPage, REVIEW_PROPERTY_KEYS.tradingPlans, "")}
                        onChange={(event) => updatePageProperty(selectedPage, REVIEW_PROPERTY_KEYS.tradingPlans, event.target.value)}
                      >
                        {scoreOptions.map((score) => (
                          <option key={score || "empty"} value={score}>
                            {score || "\u2014"}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="library-open-page-property">
                      <span>Overall (1-5)</span>
                      {(() => {
                        const raw = renderPropertyValue(selectedPage, REVIEW_PROPERTY_KEYS.overall, "");
                        const parsed = raw ? Number(raw) : Number.NaN;
                        const normalized =
                          Number.isFinite(parsed) && Math.abs(parsed - Math.round(parsed)) < 1e-6 && parsed >= 1 && parsed <= 5
                            ? String(Math.round(parsed))
                            : raw;

                        return (
                          <select
                            value={normalized}
                            onChange={(event) => updatePageProperty(selectedPage, REVIEW_PROPERTY_KEYS.overall, event.target.value)}
                          >
                            {scoreOptions.map((score) => (
                              <option key={score || "empty"} value={score}>
                                {score || "\u2014"}
                              </option>
                            ))}
                          </select>
                        );
                      })()}
                    </label>
                  </div>

                  <div className="review-breach-days">
                    <span>Breach Days</span>
                    <div className="review-breach-day-list" aria-label="Shutdown-risk breach days">
                      {Array.isArray(selectedPage.properties?.[REVIEW_PROPERTY_KEYS.breachDays]) &&
                      (selectedPage.properties?.[REVIEW_PROPERTY_KEYS.breachDays] as unknown[]).length > 0 ? (
                        (selectedPage.properties?.[REVIEW_PROPERTY_KEYS.breachDays] as unknown[])
                          .filter((day): day is string => typeof day === "string" && day.trim().length > 0)
                          .map((day) => (
                            <button
                              key={day}
                              type="button"
                              className="review-day-pill review-breach-day-pill"
                              onClick={() => handleOpenJournalDate(day)}
                              title={`Open journal for ${normalizeIsoTradeDate(day)}`}
                            >
                              {normalizeIsoTradeDate(day)}
                            </button>
                          ))
                      ) : (
                        <span className="review-breach-day-empty">None</span>
                      )}
                    </div>
                  </div>

                  <div className="review-breach-days">
                    <span>Best Days</span>
                    <div className="review-breach-day-list" aria-label="Best trading days">
                      {bestDayEntries.length > 0 ? (
                        bestDayEntries.map(([day, net]) => (
                          <button
                            key={day}
                            type="button"
                            className="review-day-pill review-best-day-pill"
                            onClick={() => handleOpenJournalDate(day)}
                            title={`${day} · ${formatSignedUsd(net)}`}
                          >
                            {day}
                          </button>
                        ))
                      ) : (
                        <span className="review-breach-day-empty">None</span>
                      )}
                    </div>
                  </div>

                  <ReviewTradeSpotlightCard
                    kind="best"
                    data={bestReviewTrade}
                    onSelectTrade={onSelectTrade}
                    onOpenJournalDate={handleOpenJournalDate}
                  />
                  <ReviewTradeSpotlightCard
                    kind="worst"
                    data={worstReviewTrade}
                    onSelectTrade={onSelectTrade}
                    onOpenJournalDate={handleOpenJournalDate}
                  />

                  <ReviewReflectionPanel
                    period={selectedReviewPeriod ?? "weekly"}
                    pageId={selectedPage.id}
                    timeLabels={
                      selectedReviewPeriod === "monthly"
                        ? ["Week 1", "Week 2", "Week 3", "Week 4", "Week 5"]
                        : ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]
                    }
                    improvementGoalsLabel={
                      selectedReviewPeriod === "monthly" ? "Next Month Improvement Goals" : "Next Week Improvement Goals"
                    }
                    templates={
                      selectedReviewPeriod === "monthly" ? reviewTemplates.monthlyTemplates : reviewTemplates.weeklyTemplates
                    }
                    selectedTemplateId={
                      selectedReviewPeriod === "monthly" ? selectedMonthlyReviewTemplateId : selectedWeeklyReviewTemplateId
                    }
                    reflection={coerceReviewReflectionState(selectedPage.properties?.[REVIEW_REFLECTION_KEY])}
                    defaultBookOptions={reviewReadingBookDefaults}
                    defaultAuthorOptions={reviewReadingAuthorDefaults}
                    onSelectTemplateId={
                      selectedReviewPeriod === "monthly"
                        ? setSelectedMonthlyReviewTemplateId
                        : setSelectedWeeklyReviewTemplateId
                    }
                    onChangeReflection={(next) =>
                      persistPages(
                        pagesRef.current.map((page) => {
                          if (page.id !== selectedPage.id) {
                            return page;
                          }

                          const currentReflection = coerceReviewReflectionState(page.properties?.[REVIEW_REFLECTION_KEY]);
                          const nextReflection = typeof next === "function" ? next(currentReflection) : next;

                          return {
                            ...page,
                            properties: {
                              ...(page.properties ?? {}),
                              [REVIEW_REFLECTION_KEY]: nextReflection
                            },
                            updatedAt: new Date().toISOString()
                          };
                        })
                      )
                    }
                    onSaveTemplate={(templateId, content) =>
                      handleSaveReviewTemplate(selectedReviewPeriod === "monthly" ? "monthly" : "weekly", templateId, content)
                    }
                    onSaveTemplateAs={(name, content) =>
                      handleSaveReviewTemplateAs(selectedReviewPeriod === "monthly" ? "monthly" : "weekly", name, content)
                    }
                    onDeleteTemplate={(templateId) =>
                      handleDeleteReviewTemplate(selectedReviewPeriod === "monthly" ? "monthly" : "weekly", templateId)
                    }
                    onTakeawayImageInsert={createLibraryInlineImageInsertHandler(selectedPage.id, "review-takeaway")}
                    onImprovementGoalsImageInsert={
                      createLibraryInlineImageInsertHandler(selectedPage.id, "review-improvement-goals")
                    }
                  />

                  <section className="journal-writing-section review-writing-section review-legacy-notes">
                    <div className="journal-writing-header">
                      <div className="journal-writing-header-title">
                        <WorkspaceIcon icon="journal" alt="" className="mini-action-icon" />
                        <strong>Notes</strong>
                      </div>
                      <div className="journal-writing-header-actions">
                        <button
                          type="button"
                          className="mini-action"
                          onClick={() => setShowLegacyReviewNotes((current) => !current)}
                        >
                          {showLegacyReviewNotes ? "Hide" : "Show"}
                        </button>
                      </div>
                    </div>
                    {showLegacyReviewNotes ? (
                      <JournalRichTextEditor
                        key={`${selectedPage.id}-review-legacy-notes`}
                        content={selectedPage.content}
                        onChange={(content) => updatePage(selectedPage.id, { content })}
                        onImageInsert={createLibraryInlineImageInsertHandler(selectedPage.id, "review-legacy-notes")}
                        placeholder="Optional extra notes (legacy editor)"
                        taskListColumns={2}
                        draftStorageKey={getLibraryDraftStorageKey(selectedPage.id, "review-legacy-notes")}
                        sourceUpdatedAt={selectedPage.updatedAt}
                      />
                    ) : null}
                  </section>
                </>
              ) : isBookClub && isBookRow(selectedPage) ? (
                <>
                  <div className="library-open-page-properties">
                    <label className="library-open-page-property">
                      <span>Author</span>
                      <input
                        value={getBookFieldValue(selectedPage, "Author")}
                        onChange={(event) => updatePageProperty(selectedPage, "Author", event.target.value)}
                        placeholder="Author"
                      />
                    </label>
                    <label className="library-open-page-property">
                      <span>Status</span>
                      <select
                        value={getBookFieldValue(selectedPage, "Reading Status") || selectedPage.status}
                        onChange={(event) => updatePageProperty(selectedPage, "Reading Status", event.target.value)}
                      >
                        {["To Read", "In Progress", "Completed", "Abandoned", "Imported"].map((status) => (
                          <option key={status} value={status}>
                            {status}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="library-open-page-property">
                      <span>Rating</span>
                      <input
                        value={getBookFieldValue(selectedPage, "Rating")}
                        onChange={(event) => updatePageProperty(selectedPage, "Rating", event.target.value)}
                        placeholder="Optional rating"
                      />
                    </label>
                    <PropertyMultiSelect
                      label="Genres"
                      values={renderPropertyList(selectedPage, "Genre")}
                      onChange={(genres) => updatePageProperty(selectedPage, "Genre", genres)}
                      predefinedOptions={allGenres}
                      placeholder="Add genre"
                      allowCustom
                    />
                  </div>

                  {renderBookTextFields(selectedPage)}
                </>
              ) : isStrongViews && isStrongViewRow(selectedPage) ? (
                <>
                  <div className="library-open-page-properties library-strong-view-properties">
                    <label className="library-open-page-property">
                      <span>Ticker</span>
                      <button
                        type="button"
                        className="library-property-pill-button"
                        onClick={() => {
                          setIsStrongViewTickerDrawerOpen(true);
                          setStrongViewTickerSearch(getStrongViewTickerValue(selectedPage));
                        }}
                      >
                        <span className="library-strong-view-ticker-cell">
                          {getStrongViewTickerIcon(selectedPage) ? (
                            <img
                              src={getStrongViewTickerIcon(selectedPage)}
                              alt={`${getStrongViewTickerValue(selectedPage)} ticker icon`}
                              className="symbol-pill-icon"
                            />
                          ) : (
                            <WorkspaceIcon icon="trades" alt="" className="symbol-pill-icon" />
                          )}
                          <span>{getStrongViewTickerValue(selectedPage) || "Select ticker"}</span>
                        </span>
                      </button>
                    </label>
                    <label className="library-open-page-property">
                      <span>Date</span>
                      <input
                        type="date"
                        value={getStrongViewDateValue(selectedPage)}
                        onChange={(event) => updatePageProperty(selectedPage, "Date", event.target.value)}
                      />
                    </label>
                    <label className="library-open-page-property">
                      <span>Key Level Up</span>
                      <input
                        value={getStrongViewFieldValue(selectedPage, "Key Level Up")}
                        onChange={(event) => updatePageProperty(selectedPage, "Key Level Up", event.target.value)}
                        placeholder="Ex: 548.20"
                      />
                    </label>
                    <label className="library-open-page-property">
                      <span>Key Level Down</span>
                      <input
                        value={getStrongViewFieldValue(selectedPage, "Key Level Down")}
                        onChange={(event) => updatePageProperty(selectedPage, "Key Level Down", event.target.value)}
                        placeholder="Ex: 533.80"
                      />
                    </label>
                    <label className="library-open-page-property">
                      <span>Bias</span>
                      <select
                        value={getStrongViewFieldValue(selectedPage, "Bias")}
                        onChange={(event) => updatePageProperty(selectedPage, "Bias", event.target.value)}
                      >
                        <option value="">Unset</option>
                        <option value="Bullish">Bullish</option>
                        <option value="Bearish">Bearish</option>
                        <option value="Neutral">Neutral</option>
                      </select>
                    </label>
                    <label className="library-open-page-property">
                      <span>ATR</span>
                      <input
                        type="number"
                        step="0.01"
                        value={getStrongViewFieldValue(selectedPage, "ATR")}
                        onChange={(event) => updatePageProperty(selectedPage, "ATR", event.target.value)}
                        placeholder="0.00"
                      />
                    </label>
                    <label className="library-open-page-property">
                      <span>RVOL</span>
                      <input
                        type="number"
                        step="0.01"
                        value={getStrongViewFieldValue(selectedPage, "RVOL")}
                        onChange={(event) => updatePageProperty(selectedPage, "RVOL", event.target.value)}
                        placeholder="0.00"
                      />
                    </label>
                  </div>

                  <div className="library-strong-view-level-grid">
                    <label className="library-open-page-note">
                      <span>Open / Close</span>
                      <JournalRichTextEditor
                        key={`${selectedPage.id}-strong-view-open-close`}
                        content={getStrongViewRichTextFieldValue(selectedPage, "Open / Close")}
                        onChange={(content) => updatePageProperty(selectedPage, "Open / Close", content)}
                        onImageInsert={createLibraryInlineImageInsertHandler(selectedPage.id, "strong-view-open-close")}
                        placeholder="Open/close behavior to watch."
                        compact
                        showBlockActions={false}
                        draftStorageKey={getLibraryDraftStorageKey(selectedPage.id, "strong-view-open-close")}
                        sourceUpdatedAt={selectedPage.updatedAt}
                      />
                    </label>
                    <label className="library-open-page-note">
                      <span>Support</span>
                      <JournalRichTextEditor
                        key={`${selectedPage.id}-strong-view-support`}
                        content={getStrongViewRichTextFieldValue(selectedPage, "Support")}
                        onChange={(content) => updatePageProperty(selectedPage, "Support", content)}
                        onImageInsert={createLibraryInlineImageInsertHandler(selectedPage.id, "strong-view-support")}
                        placeholder="Support levels and context."
                        compact
                        showBlockActions={false}
                        draftStorageKey={getLibraryDraftStorageKey(selectedPage.id, "strong-view-support")}
                        sourceUpdatedAt={selectedPage.updatedAt}
                      />
                    </label>
                    <label className="library-open-page-note">
                      <span>Resistance</span>
                      <JournalRichTextEditor
                        key={`${selectedPage.id}-strong-view-resistance`}
                        content={getStrongViewRichTextFieldValue(selectedPage, "Resistance")}
                        onChange={(content) => updatePageProperty(selectedPage, "Resistance", content)}
                        onImageInsert={createLibraryInlineImageInsertHandler(selectedPage.id, "strong-view-resistance")}
                        placeholder="Resistance levels and context."
                        compact
                        showBlockActions={false}
                        draftStorageKey={getLibraryDraftStorageKey(selectedPage.id, "strong-view-resistance")}
                        sourceUpdatedAt={selectedPage.updatedAt}
                      />
                    </label>
                  </div>

                  <div className="library-strong-view-story-grid">
                    <label className="library-open-page-note">
                      <span>Notes</span>
                      <JournalRichTextEditor
                        key={`${selectedPage.id}-strong-view-notes`}
                        content={getStrongViewRichTextFieldValue(selectedPage, "Notes")}
                        onChange={(content) => updatePageProperty(selectedPage, "Notes", content)}
                        onImageInsert={createLibraryInlineImageInsertHandler(selectedPage.id, "strong-view-notes")}
                        placeholder="Additional context and observations."
                        compact
                        showBlockActions={false}
                        draftStorageKey={getLibraryDraftStorageKey(selectedPage.id, "strong-view-notes")}
                        sourceUpdatedAt={selectedPage.updatedAt}
                      />
                    </label>
                    <label className="library-open-page-note">
                      <span>Catalyst</span>
                      <JournalRichTextEditor
                        key={`${selectedPage.id}-strong-view-catalyst`}
                        content={getStrongViewRichTextFieldValue(selectedPage, "Catalyst")}
                        onChange={(content) => updatePageProperty(selectedPage, "Catalyst", content)}
                        onImageInsert={createLibraryInlineImageInsertHandler(selectedPage.id, "strong-view-catalyst")}
                        placeholder="Upcoming catalysts and event risk."
                        compact
                        showBlockActions={false}
                        draftStorageKey={getLibraryDraftStorageKey(selectedPage.id, "strong-view-catalyst")}
                        sourceUpdatedAt={selectedPage.updatedAt}
                      />
                    </label>
                  </div>

                  <div className="library-strong-view-story-grid">
                    <label className="library-open-page-note">
                      <span>Game Plan</span>
                      <JournalRichTextEditor
                        key={`${selectedPage.id}-strong-view-game-plan`}
                        content={getStrongViewRichTextFieldValue(selectedPage, "Game Plan")}
                        onChange={(content) => updatePageProperty(selectedPage, "Game Plan", content)}
                        onImageInsert={createLibraryInlineImageInsertHandler(selectedPage.id, "strong-view-game-plan")}
                        placeholder="Execution plan and invalidation."
                        compact
                        showBlockActions={false}
                        draftStorageKey={getLibraryDraftStorageKey(selectedPage.id, "strong-view-game-plan")}
                        sourceUpdatedAt={selectedPage.updatedAt}
                      />
                    </label>
                    <section className="library-strong-view-attachment library-strong-view-attachment-inline">
                      <div className="library-strong-view-attachment-header">
                        <span>Morning Chat</span>
                        <div className="library-strong-view-attachment-actions">
                          <input
                            ref={strongViewMorningChatInputRef}
                            type="file"
                            accept="image/*"
                            className="library-strong-view-file-input"
                            onChange={(event) => {
                              const file = event.target.files?.[0] ?? null;
                              void handleStrongViewMorningChatUpload(selectedPage, file);
                              event.currentTarget.value = "";
                            }}
                          />
                          <button
                            type="button"
                            className="mini-action"
                            onClick={() => strongViewMorningChatInputRef.current?.click()}
                          >
                            Attach Morning Chat
                          </button>
                          {getStrongViewMorningChatValue(selectedPage) ? (
                            <button
                              type="button"
                              className="mini-action"
                              onClick={() => {
                                const previousAttachmentPath = getStrongViewMorningChatValue(selectedPage);
                                const nextPages = buildNextPagesWithUpdatedProperty(
                                  selectedPage,
                                  "Morning Chat",
                                  ""
                                );
                                persistPages(nextPages);
                                deleteUnusedLibraryAttachments([previousAttachmentPath], nextPages);
                              }}
                            >
                              Remove
                            </button>
                          ) : null}
                        </div>
                      </div>
                      {getStrongViewMorningChatValue(selectedPage) ? (
                        <img
                          src={getStrongViewMorningChatSrc(selectedPage)}
                          alt={`${getStrongViewFieldValue(selectedPage, "Ticker") || "Strong View"} Morning Chat`}
                          className="library-strong-view-attachment-image"
                        />
                      ) : (
                        <p className="library-strong-view-attachment-empty">Attach an image for the pre-market morning chat.</p>
                      )}
                    </section>
                  </div>
                </>
              ) : (
                <>
                  <div className="library-property-grid">
                    {isNotesCollection ? (
                      <label>
                        <span>Type</span>
                        <button
                          type="button"
                          className="library-property-pill-button"
                          onClick={() => {
                            setSelectedPageId(selectedPage.id);
                            setNotesTagEditor(null);
                            setNotesTagSearchQuery("");
                            setNotesTypeEditor({ pageId: selectedPage.id });
                            setNotesTypeSearchQuery("");
                          }}
                        >
                          <span
                            className={`library-note-type-pill ${
                              selectedPage.status === "Archived" ? "library-note-type-pill-archived" : ""
                            }`}
                          >
                            {resolveEditableNoteType(selectedPage)}
                          </span>
                        </button>
                      </label>
                    ) : null}
                    <label>
                      <span>Status</span>
                      <select
                        value={selectedPage.status}
                        onChange={(event) => updatePage(selectedPage.id, { status: event.target.value })}
                      >
                        {statusOptions.map((status) => (
                          <option key={status} value={status}>
                            {status}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>Tags</span>
                      <button
                        type="button"
                        className="library-property-pill-button"
                        onClick={() => {
                          setNotesTypeEditor(null);
                          setNotesTypeSearchQuery("");
                          setNotesTagEditor({ pageId: selectedPage.id });
                          setNotesTagSearchQuery("");
                        }}
                      >
                        <div className="library-genre-list">
                          {selectedPage.tags.map(normalizeTagToken).filter(Boolean).length > 0 ? (
                            selectedPage.tags
                              .map(normalizeTagToken)
                              .filter(Boolean)
                              .map((tag, index) => <span key={`${tag}-${index}`}>{tag}</span>)
                          ) : (
                            <span className="library-genre-empty">Add tags</span>
                          )}
                        </div>
                      </button>
                    </label>
                  </div>

                  {isBookClub ? (
                    renderBookTextFields(selectedPage)
                  ) : null}

                  <JournalRichTextEditor
                    key={`${selectedPage.id}-library-content`}
                    content={selectedPage.content}
                    onChange={(content) => updatePage(selectedPage.id, { content })}
                    onImageInsert={createLibraryInlineImageInsertHandler(selectedPage.id, "library-content")}
                    placeholder="Type '/' for commands"
                    draftStorageKey={getLibraryDraftStorageKey(selectedPage.id, "library-content")}
                    sourceUpdatedAt={selectedPage.updatedAt}
                  />
                </>
              )}
            </section>
          ) : null}
        </section>
      </section>
      {isBookSearchDrawerOpen ? (
        <TagDrawer
          isOpen={isBookSearchDrawerOpen}
          title="Search - Trading and Poker Books"
          options={bookSearchOptions}
          selectionMode="single"
          currentValue={bookSearchQuery}
          allowClear
          clearLabel="All books"
          searchValue={bookSearchDrawerQuery}
          onSearchChange={setBookSearchDrawerQuery}
          onSelect={(value) => {
            if (typeof value === "string") {
              setBookSearchQuery(value);
            } else {
              setBookSearchQuery("");
            }

            setIsBookSearchDrawerOpen(false);
            setBookSearchDrawerQuery("");
          }}
          onCreateOption={(value) => {
            setBookSearchQuery(value);
            setIsBookSearchDrawerOpen(false);
            setBookSearchDrawerQuery("");
          }}
          onClose={() => {
            setIsBookSearchDrawerOpen(false);
            setBookSearchDrawerQuery("");
          }}
        />
      ) : null}
      {isQuoteSearchDrawerOpen ? (
        <TagDrawer
          isOpen={isQuoteSearchDrawerOpen}
          title="Search - Quotes"
          options={quoteAuthorOptions}
          selectionMode="single"
          currentValue={quoteSearchQuery}
          allowClear
          clearLabel="All authors"
          searchValue={quoteSearchDrawerQuery}
          onSearchChange={setQuoteSearchDrawerQuery}
          onSelect={(value) => {
            if (typeof value === "string") {
              setQuoteSearchQuery(value);
            } else {
              setQuoteSearchQuery("");
            }

            setIsQuoteSearchDrawerOpen(false);
            setQuoteSearchDrawerQuery("");
          }}
          onCreateOption={(value) => {
            setQuoteSearchQuery(value);
            setIsQuoteSearchDrawerOpen(false);
            setQuoteSearchDrawerQuery("");
          }}
          onClose={() => {
            setIsQuoteSearchDrawerOpen(false);
            setQuoteSearchDrawerQuery("");
          }}
        />
      ) : null}
      {isStrongViewTickerDrawerOpen && selectedPage && isStrongViews && isStrongViewRow(selectedPage) ? (
        <TagDrawer
          isOpen={isStrongViewTickerDrawerOpen}
          title="Strong View - Ticker"
          options={strongViewTickerOptions}
          selectionMode="single"
          currentValue={normalizeTickerToken(getStrongViewFieldValue(selectedPage, "Ticker"))}
          allowClear
          clearLabel="Clear ticker"
          searchValue={strongViewTickerSearch}
          onSearchChange={(value) => setStrongViewTickerSearch(value.toUpperCase())}
          onSelect={(value) => {
            if (typeof value === "string") {
              updatePageProperty(selectedPage, "Ticker", normalizeTickerToken(value));
            } else {
              updatePageProperty(selectedPage, "Ticker", "");
            }

            setIsStrongViewTickerDrawerOpen(false);
            setStrongViewTickerSearch("");
          }}
          onCreateOption={(value) => {
            const nextTicker = normalizeTickerToken(value);
            if (!nextTicker) {
              return;
            }

            const added = addStrongViewTickerOption(nextTicker);
            updatePageProperty(selectedPage, "Ticker", normalizeTickerToken(added ?? nextTicker));
            setIsStrongViewTickerDrawerOpen(false);
            setStrongViewTickerSearch("");
          }}
          onRenameOption={(currentValue, nextValue) => {
            const currentTicker = normalizeTickerToken(currentValue);
            const nextTicker = normalizeTickerToken(nextValue);
            if (!currentTicker || !nextTicker || currentTicker === nextTicker) {
              return;
            }

            if (!renameStrongViewTickerOption(currentTicker, nextTicker)) {
              return;
            }

            persistPages(
              pagesRef.current.map((page) => {
                if (page.collectionId !== "strong-views") {
                  return page;
                }

                const pageTicker = normalizeTickerToken(getStrongViewFieldValue(page, "Ticker"));
                if (pageTicker !== currentTicker) {
                  return page;
                }

                return {
                  ...page,
                  properties: {
                    ...(page.properties ?? {}),
                    Ticker: nextTicker
                  },
                  updatedAt: new Date().toISOString()
                };
              })
            );
          }}
          onDeleteOption={(value) => {
            const ticker = normalizeTickerToken(value);
            if (!ticker || !removeStrongViewTickerOption(ticker)) {
              return;
            }

            persistPages(
              pagesRef.current.map((page) => {
                if (page.collectionId !== "strong-views") {
                  return page;
                }

                const pageTicker = normalizeTickerToken(getStrongViewFieldValue(page, "Ticker"));
                if (pageTicker !== ticker) {
                  return page;
                }

                return {
                  ...page,
                  properties: {
                    ...(page.properties ?? {}),
                    Ticker: ""
                  },
                  updatedAt: new Date().toISOString()
                };
              })
            );
          }}
          canManageOption={isCustomStrongViewTickerOption}
          onClose={() => {
            setIsStrongViewTickerDrawerOpen(false);
            setStrongViewTickerSearch("");
          }}
        />
      ) : null}
      {isTickerGroupTickerDrawerOpen && selectedPage && isTickerGroups ? (
        <TagDrawer
          isOpen={isTickerGroupTickerDrawerOpen}
          title={`${selectedPage.title} - Tickers`}
          options={tickerGroupTickerOptions}
          selectionMode="multi"
          currentValues={renderPropertyList(selectedPage, "Tickers").map(normalizeTickerToken).filter(Boolean)}
          allowClear
          clearLabel="Clear tickers"
          searchValue={tickerGroupTickerSearch}
          onSearchChange={(value) => setTickerGroupTickerSearch(value.toUpperCase())}
          onSelect={(value) => {
            const nextTickers = Array.isArray(value)
              ? value.map(normalizeTickerToken).filter(Boolean)
              : [];
            updateTickerGroupTickers(selectedPage.id, nextTickers);
          }}
          onCreateOption={(value) => {
            const additions = parseTickerList(value)
              .map((ticker) => addTickerGroupTickerOption(ticker))
              .filter((ticker): ticker is string => Boolean(ticker))
              .map(normalizeTickerToken);

            if (additions.length === 0) {
              return;
            }

            const currentTickers = renderPropertyList(selectedPage, "Tickers").map(normalizeTickerToken).filter(Boolean);
            updateTickerGroupTickers(selectedPage.id, [...currentTickers, ...additions]);
            setTickerGroupTickerSearch("");
          }}
          onRenameOption={(currentValue, nextValue) => {
            const currentTicker = normalizeTickerToken(currentValue);
            const nextTicker = normalizeTickerToken(nextValue);
            if (!currentTicker || !nextTicker || currentTicker === nextTicker) {
              return;
            }

            if (!renameTickerGroupTickerOption(currentTicker, nextTicker)) {
              return;
            }

            renameTickerGroupTickerEverywhere(currentTicker, nextTicker);
          }}
          onDeleteOption={(value) => {
            const ticker = normalizeTickerToken(value);
            if (!ticker || !removeTickerGroupTickerOption(ticker)) {
              return;
            }

            removeTickerGroupTickerEverywhere(ticker);
          }}
          canManageOption={isCustomTickerGroupTickerOption}
          onClose={() => {
            setIsTickerGroupTickerDrawerOpen(false);
            setTickerGroupTickerSearch("");
          }}
        />
      ) : null}
      {bookCellEditor && bookCellEditorPage ? (
        <TagDrawer
          isOpen={!!bookCellEditor}
          title={`${bookCellEditor.field} - ${bookCellEditorPage.title}`}
          options={bookCellEditor.field === "Reading Status" ? bookReadingStatusOptions : allGenres}
          selectionMode={bookCellEditor.field === "Genre" ? "multi" : "single"}
          currentValue={
            bookCellEditor.field === "Reading Status"
              ? getBookFieldValue(bookCellEditorPage, "Reading Status") || bookCellEditorPage.status
              : ""
          }
          currentValues={bookCellEditor.field === "Genre" ? renderPropertyList(bookCellEditorPage, "Genre") : []}
          allowClear={bookCellEditor.field === "Genre"}
          clearLabel={bookCellEditor.field === "Genre" ? "Clear genres" : undefined}
          searchValue={bookCellEditorSearchQuery}
          onSearchChange={setBookCellEditorSearchQuery}
          onSelect={(value) => {
            if (bookCellEditor.field === "Genre") {
              updatePageProperty(bookCellEditorPage, "Genre", Array.isArray(value) ? value : []);
              return;
            }

            if (typeof value === "string") {
              updatePageProperty(bookCellEditorPage, "Reading Status", value);
            }

            setBookCellEditor(null);
            setBookCellEditorSearchQuery("");
          }}
          onCreateOption={
            bookCellEditor.field === "Genre"
              ? (value) => {
                  const current = renderPropertyList(bookCellEditorPage, "Genre");
                  const next = current.includes(value) ? current : [...current, value];
                  updatePageProperty(bookCellEditorPage, "Genre", next);
                }
              : undefined
          }
          onClose={() => {
            setBookCellEditor(null);
            setBookCellEditorSearchQuery("");
          }}
        />
      ) : null}
      {isBookGenreFilterOpen ? (
        <TagDrawer
          isOpen={isBookGenreFilterOpen}
          title="Filter: Genre"
          options={allGenres}
          selectionMode="multi"
          currentValues={bookGenreFilter}
          allowClear
          clearLabel="All genres"
          searchValue={bookGenreFilterSearchQuery}
          onSearchChange={setBookGenreFilterSearchQuery}
          onSelect={(value) => setBookGenreFilter(Array.isArray(value) ? value : [])}
          onClose={() => {
            setIsBookGenreFilterOpen(false);
            setBookGenreFilterSearchQuery("");
          }}
        />
      ) : null}
      {notesTypeEditor && notesTypeEditorPage ? (
        <TagDrawer
          isOpen={!!notesTypeEditor}
          title={`Type - ${notesTypeEditorPage.title}`}
          options={notesTypePickerOptions}
          selectionMode="single"
          currentValue={resolveEditableNoteType(notesTypeEditorPage)}
          searchValue={notesTypeSearchQuery}
          onSearchChange={setNotesTypeSearchQuery}
          onSelect={(value) => {
            if (typeof value === "string") {
              updatePageNoteType(notesTypeEditorPage, value);
            }

            setNotesTypeEditor(null);
            setNotesTypeSearchQuery("");
          }}
          onCreateOption={(value) => {
            updatePageNoteType(notesTypeEditorPage, value);
            setNotesTypeEditor(null);
            setNotesTypeSearchQuery("");
          }}
          onRenameOption={renameNotesTypeOption}
          onDeleteOption={deleteNotesTypeOption}
          canManageOption={(value) => !noteTypeTagSet.has(resolveNoteTypeTokenFromInput(value))}
          onClose={() => {
            setNotesTypeEditor(null);
            setNotesTypeSearchQuery("");
          }}
        />
      ) : null}
      {isNotesTagFilterDrawerOpen ? (
        <TagDrawer
          isOpen={isNotesTagFilterDrawerOpen}
          title="Tag Filter - Trading Notes"
          options={notesTagOptions}
          selectionMode="single"
          currentValue={notesTagFilterToken}
          allowClear
          clearLabel="All tags"
          searchValue={notesTagFilterSearchQuery}
          onSearchChange={setNotesTagFilterSearchQuery}
          onSelect={(value) => {
            if (typeof value === "string") {
              setNotesTagFilterQuery(value);
            } else {
              setNotesTagFilterQuery("");
            }

            setIsNotesTagFilterDrawerOpen(false);
            setNotesTagFilterSearchQuery("");
          }}
          onClose={() => {
            setIsNotesTagFilterDrawerOpen(false);
            setNotesTagFilterSearchQuery("");
          }}
        />
      ) : null}
      {notesTagEditor && notesTagEditorPage ? (
        <TagDrawer
          isOpen={!!notesTagEditor}
          title={`Tags - ${notesTagEditorPage.title}`}
          options={notesTagOptions}
          selectionMode="multi"
          currentValues={notesTagEditorPage.tags.map(normalizeTagToken).filter(Boolean)}
          allowClear
          clearLabel="Clear tags"
          searchValue={notesTagSearchQuery}
          onSearchChange={setNotesTagSearchQuery}
          onSelect={(value) => {
            const nextTags = Array.isArray(value)
              ? Array.from(new Set(value.map(normalizeTagToken).filter(Boolean)))
              : [];
            updatePage(notesTagEditorPage.id, { tags: nextTags });
          }}
          onCreateOption={(value) => {
            const normalizedValue = normalizeTagToken(value);
            if (!normalizedValue) {
              return;
            }

            const currentTags = notesTagEditorPage.tags.map(normalizeTagToken).filter(Boolean);
            const nextTags = currentTags.includes(normalizedValue)
              ? currentTags
              : [...currentTags, normalizedValue];
            updatePage(notesTagEditorPage.id, { tags: nextTags });
          }}
          onRenameOption={renameNotesTagOption}
          onDeleteOption={deleteNotesTagOption}
          canManageOption={(value) => !notesTypeTokensInUse.has(normalizeTagToken(value))}
          onClose={() => {
            setNotesTagEditor(null);
            setNotesTagSearchQuery("");
          }}
        />
      ) : null}
      {quoteCellEditor && quoteCellEditorPage ? (
        <TagDrawer
          isOpen={!!quoteCellEditor}
          title={`${quoteCellEditor.field} - Quotes`}
          options={quoteCellEditor.field === "Author" ? quoteAuthorOptions : quoteSourceOptions}
          selectionMode="single"
          currentValue={getQuoteFieldValue(quoteCellEditorPage, quoteCellEditor.field)}
          allowClear
          clearLabel={`Clear ${quoteCellEditor.field.toLowerCase()}`}
          searchValue={quoteCellEditorSearchQuery}
          onSearchChange={setQuoteCellEditorSearchQuery}
          onSelect={(value) => {
            if (typeof value === "string") {
              markQuoteSaving();
              updatePageProperty(quoteCellEditorPage, quoteCellEditor.field, value);
            } else if (value === null) {
              markQuoteSaving();
              updatePageProperty(quoteCellEditorPage, quoteCellEditor.field, "");
            }

            setQuoteCellEditor(null);
            setQuoteCellEditorSearchQuery("");
          }}
          onCreateOption={(value) => {
            markQuoteSaving();
            updatePageProperty(quoteCellEditorPage, quoteCellEditor.field, value);
            setQuoteCellEditor(null);
            setQuoteCellEditorSearchQuery("");
          }}
          onRenameOption={(currentValue, nextValue) =>
            renameQuoteOption(quoteCellEditor.field, currentValue, nextValue)
          }
          onDeleteOption={(value) => deleteQuoteOption(quoteCellEditor.field, value)}
          onClose={() => {
            setQuoteCellEditor(null);
            setQuoteCellEditorSearchQuery("");
          }}
        />
      ) : null}
    </main>
  );
};

