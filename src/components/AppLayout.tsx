import type { ReactNode } from "react";
import { WorkspaceIcon } from "./WorkspaceIcon";
import type { AppNavItem, AppRoute } from "../types/app";

interface AppLayoutProps {
  activeRoute: AppRoute;
  navItems: AppNavItem[];
  onNavigate: (route: AppRoute) => void;
  onNavigateBack?: () => void;
  canNavigateBack?: boolean;
  accountLabel?: string;
  onSignOut?: () => void;
  children: ReactNode;
}

const BackNavIcon = () => (
  <svg className="top-nav-back-icon" viewBox="0 0 28 28" aria-hidden="true" focusable="false">
    <path d="M6 5v18" />
    <path d="M21.5 6.5 13 14l8.5 7.5z" />
    <path d="M13 6.5 4.5 14 13 21.5z" />
  </svg>
);

export const AppLayout = ({
  activeRoute,
  navItems,
  onNavigate,
  onNavigateBack,
  canNavigateBack = false,
  accountLabel,
  onSignOut,
  children
}: AppLayoutProps) => {
  const highlightedRoute: AppRoute = activeRoute === "playbooks" ? "library" : activeRoute;

  return (
    <div className="workspace-shell">
      <header className="top-nav">
        <div className="brand-lockup">
          <span className="brand-pill">Trade Engine</span>
          <span className="brand-subtitle">Offline trading workspace</span>
        </div>
        <nav className="top-nav-links" aria-label="Primary">
          {onNavigateBack ? (
            <button
              type="button"
              className="top-nav-back-button"
              onClick={onNavigateBack}
              disabled={!canNavigateBack}
              aria-label="Back"
              title="Back"
            >
              <BackNavIcon />
            </button>
          ) : null}
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
        {accountLabel ? (
          <div className="top-nav-account">
            <span className="top-nav-account-label">{accountLabel}</span>
            {onSignOut ? (
              <button type="button" className="top-nav-link top-nav-signout" onClick={onSignOut}>
                Sign Out
              </button>
            ) : null}
          </div>
        ) : null}
      </header>
      <div className="workspace-content">{children}</div>
    </div>
  );
};
