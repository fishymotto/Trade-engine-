import type { ReactNode } from "react";
import { WorkspaceIcon } from "./WorkspaceIcon";
import type { AppNavItem, AppRoute } from "../types/app";

interface AppLayoutProps {
  activeRoute: AppRoute;
  navItems: AppNavItem[];
  onNavigate: (route: AppRoute) => void;
  children: ReactNode;
}

export const AppLayout = ({ activeRoute, navItems, onNavigate, children }: AppLayoutProps) => {
  const highlightedRoute: AppRoute = activeRoute === "playbooks" ? "library" : activeRoute;

  return (
    <div className="workspace-shell">
      <header className="top-nav">
        <div className="brand-lockup">
          <span className="brand-pill">Trade Engine</span>
          <span className="brand-subtitle">Trading workspace</span>
        </div>
        <nav className="top-nav-links" aria-label="Primary">
          {navItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`top-nav-link ${item.id === highlightedRoute ? "top-nav-link-active" : ""}`}
              onClick={() => onNavigate(item.id)}
            >
              <WorkspaceIcon icon={item.icon} alt={`${item.label} icon`} className="top-nav-icon" />
              {item.label}
            </button>
          ))}
        </nav>
      </header>
      <div className="workspace-content">{children}</div>
    </div>
  );
};
