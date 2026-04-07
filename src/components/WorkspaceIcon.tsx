import { workspaceIcons, type WorkspaceIconKey } from "../lib/ui/workspaceIcons";

interface WorkspaceIconProps {
  icon: WorkspaceIconKey;
  alt: string;
  className?: string;
}

export const WorkspaceIcon = ({ icon, alt, className = "" }: WorkspaceIconProps) => (
  <img className={`workspace-icon ${className}`.trim()} src={workspaceIcons[icon]} alt={alt} />
);
