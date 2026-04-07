import calloutIcon from "../../assets/ui-icons/callout.png";
import cameraIcon from "../../assets/ui-icons/import.png";
import checklistIcon from "../../assets/ui-icons/checklist.png";
import dashboardIcon from "../../assets/ui-icons/dashboard.png";
import dataIcon from "../../assets/ui-icons/data.png";
import executionIcon from "../../assets/ui-icons/execution.png";
import filterIcon from "../../assets/ui-icons/filter.png";
import headingIcon from "../../assets/ui-icons/heading.png";
import importIcon from "../../assets/ui-icons/import.png";
import journalIcon from "../../assets/ui-icons/journal.png";
import moneyIcon from "../../assets/ui-icons/money.png";
import planIcon from "../../assets/ui-icons/plan.png";
import reportsIcon from "../../assets/ui-icons/reports.png";
import tagsIcon from "../../assets/ui-icons/tags.png";
import textIcon from "../../assets/ui-icons/text.png";
import tradesIcon from "../../assets/ui-icons/trades.png";
import winIcon from "../../assets/ui-icons/win.png";
import type { JournalBlockType } from "../../types/journal";

export type WorkspaceIconKey =
  | "dashboard"
  | "trades"
  | "journal"
  | "reports"
  | "import"
  | "data"
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
  | "plan";

export const workspaceIcons: Record<WorkspaceIconKey, string> = {
  dashboard: dashboardIcon,
  trades: tradesIcon,
  journal: journalIcon,
  reports: reportsIcon,
  import: importIcon,
  data: dataIcon,
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
  plan: planIcon
};

export const journalBlockTypeIcons: Partial<Record<JournalBlockType, WorkspaceIconKey>> = {
  paragraph: "text",
  heading1: "heading",
  heading2: "heading",
  heading3: "heading",
  checklist: "checklist",
  callout: "callout"
};
