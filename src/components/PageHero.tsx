import type { ReactNode } from "react";
import type { WorkspaceIconKey } from "../lib/ui/workspaceIcons";
import { WorkspaceIcon } from "./WorkspaceIcon";

interface PageHeroProps {
  eyebrow: string;
  title: ReactNode;
  icon?: WorkspaceIconKey;
  className?: string;
}

export const PageHero = ({ eyebrow, title, icon, className }: PageHeroProps) => {
  return (
    <section className={`page-hero${className ? ` ${className}` : ""}`}>
      <div className="page-hero-layout">
        <div className="page-hero-copy">
          <span className="page-eyebrow">{eyebrow}</span>
          <h1>
            <span className="page-hero-title">
              {icon ? <WorkspaceIcon icon={icon} alt="" className="page-hero-title-icon" /> : null}
              <span>{title}</span>
            </span>
          </h1>
        </div>
      </div>
    </section>
  );
};
