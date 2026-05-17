import calloutIcon from "../../assets/ui-icons/callout.png";
import astronautIcon from "../../assets/ui-icons/astronaut.png";
import cameraIcon from "../../assets/ui-icons/import.png";
import chartGalleryIcon from "../../assets/ui-icons/chart-gallery.png";
import chartScreenshotsIcon from "../../assets/ui-icons/chart-screenshots.png";
import clearScreenshotsIcon from "../../assets/ui-icons/clear-screenshots.png";
import checklistIcon from "../../assets/ui-icons/checklist.png";
import dashboardIcon from "../../assets/ui-icons/dashboard.png";
import dataIcon from "../../assets/ui-icons/data.png";
import executionIcon from "../../assets/ui-icons/execution.png";
import filterIcon from "../../assets/ui-icons/filter.png";
import headingIcon from "../../assets/ui-icons/heading.png";
import importIcon from "../../assets/ui-icons/import.png";
import journalChecklistIcon from "../../assets/ui-icons/journal-checklist.png";
import journalNotebookIcon from "../../assets/ui-icons/journal-notebook.png";
import journalIcon from "../../assets/ui-icons/journal.png";
import libraryIcon from "../../assets/ui-icons/library.png";
import monthBrowserIcon from "../../assets/ui-icons/month-browser.png";
import moneyIcon from "../../assets/ui-icons/money.png";
import planIcon from "../../assets/ui-icons/plan.png";
import playbooksIcon from "../../assets/ui-icons/playbooks.png";
import relatedTradesIcon from "../../assets/ui-icons/related-trades.png";
import reviewSliceIcon from "../../assets/ui-icons/review-slice.png";
import reviewWorkspaceIcon from "../../assets/ui-icons/review-workspace.png";
import reportsIcon from "../../assets/ui-icons/reports.png";
import settingsIcon from "../../assets/ui-icons/settings.png";
import tagsIcon from "../../assets/ui-icons/tags.png";
import textIcon from "../../assets/ui-icons/text.png";
import tradesIcon from "../../assets/ui-icons/trades.png";
import winIcon from "../../assets/ui-icons/win.png";
import type { JournalBlockType } from "../../types/journal";

export type WorkspaceIconKey =
  | "dashboard"
  | "astronaut"
  | "chart-gallery"
  | "chart-screenshots"
  | "clear-screenshots"
  | "trades"
  | "journal-checklist"
  | "journal-notebook"
  | "journal"
  | "library"
  | "month-browser"
  | "related-trades"
  | "reports"
  | "review-slice"
  | "review-workspace"
  | "import"
  | "data"
  | "settings"
  | "camera"
  | "money"
  | "win"
  | "filter"
  | "execution"
  | "tags"
  | "text"
  | "heading"
  | "checklist"
  | "callout"
  | "plan"
  | "playbooks";

export const workspaceIcons: Record<WorkspaceIconKey, string> = {
  dashboard: dashboardIcon,
  astronaut: astronautIcon,
  "chart-gallery": chartGalleryIcon,
  "chart-screenshots": chartScreenshotsIcon,
  "clear-screenshots": clearScreenshotsIcon,
  trades: tradesIcon,
  "journal-checklist": journalChecklistIcon,
  "journal-notebook": journalNotebookIcon,
  journal: journalIcon,
  library: libraryIcon,
  "month-browser": monthBrowserIcon,
  "related-trades": relatedTradesIcon,
  reports: reportsIcon,
  "review-slice": reviewSliceIcon,
  "review-workspace": reviewWorkspaceIcon,
  import: importIcon,
  data: dataIcon,
  settings: settingsIcon,
  camera: cameraIcon,
  money: moneyIcon,
  win: winIcon,
  filter: filterIcon,
  execution: executionIcon,
  tags: tagsIcon,
  text: textIcon,
  heading: headingIcon,
  checklist: checklistIcon,
  callout: calloutIcon,
  plan: planIcon,
  playbooks: playbooksIcon
};

export const journalBlockTypeIcons: Partial<Record<JournalBlockType, WorkspaceIconKey>> = {
  paragraph: "text",
  heading1: "heading",
  heading2: "heading",
  heading3: "heading",
  checklist: "checklist",
  callout: "callout"
};
