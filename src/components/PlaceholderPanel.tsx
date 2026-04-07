import type { WorkspaceIconKey } from "../lib/ui/workspaceIcons";
import { WorkspaceIcon } from "./WorkspaceIcon";

interface PlaceholderPanelProps {
  title: string;
  description: string;
  detail?: string;
  icon?: WorkspaceIconKey;
}

export const PlaceholderPanel = ({ title, description, detail, icon }: PlaceholderPanelProps) => {
  return (
    <article className="placeholder-panel">
      <div className="panel-header">
        {icon ? <WorkspaceIcon icon={icon} alt={`${title} icon`} className="panel-header-icon" /> : null}
        <h2>{title}</h2>
      </div>
      <p>{description}</p>
      {detail ? <span>{detail}</span> : null}
    </article>
  );
};
