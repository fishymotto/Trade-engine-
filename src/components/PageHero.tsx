import type { ReactNode } from "react";

interface PageHeroProps {
  eyebrow: string;
  title: string;
  description: string;
  children?: ReactNode;
}

export const PageHero = ({ eyebrow, title, description, children }: PageHeroProps) => {
  return (
    <section className="page-hero">
      <div className={`page-hero-layout${children ? " page-hero-layout-with-aside" : ""}`}>
        <div className="page-hero-copy">
          <span className="page-eyebrow">{eyebrow}</span>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
        {children ? <div className="page-hero-aside">{children}</div> : null}
      </div>
    </section>
  );
};
