import type { ReactNode } from "react";

interface PageHeroProps {
  eyebrow: string;
  title: string;
  description?: string;
  content?: ReactNode;
  children?: ReactNode;
  className?: string;
}

export const PageHero = ({ eyebrow, title, description, content, children, className }: PageHeroProps) => {
  return (
    <section className={`page-hero${className ? ` ${className}` : ""}`}>
      <div className={`page-hero-layout${children ? " page-hero-layout-with-aside" : ""}`}>
        <div className="page-hero-copy">
          <span className="page-eyebrow">{eyebrow}</span>
          <h1>{title}</h1>
          {description ? <p>{description}</p> : null}
          {content ? <div className="page-hero-content">{content}</div> : null}
        </div>
        {children ? <div className="page-hero-aside">{children}</div> : null}
      </div>
    </section>
  );
};
