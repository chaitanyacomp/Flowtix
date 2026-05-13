import * as React from "react";
import { cn } from "../../lib/utils";

/**
 * Sticky band inside `erp-main`: anchors SO / customer / cycle / document while scrolling.
 * Keep segments dense — no helper paragraphs here.
 */
export function OperationalContextSticky({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("erp-op-context-sticky", className)} role="banner">
      {children}
    </header>
  );
}

/** Single dense row of inline segments (use {@link OpCtxSep} between tokens). */
export function OperationalContextBar({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("erp-op-context-row", className)} aria-label="Operational context">
      {children}
    </div>
  );
}

export function OpCtxSep() {
  return (
    <span className="erp-op-context-sep" aria-hidden>
      |
    </span>
  );
}

export type OperationalFooterSection = {
  key: string;
  title?: string;
  children: React.ReactNode;
};

/**
 * Connected footer band: sections stack with shared chrome (not separate floating cards).
 */
export function OperationalWorkspaceFooter({
  sections,
  className,
}: {
  sections: OperationalFooterSection[];
  className?: string;
}) {
  const filtered = sections.filter((s) => s.children != null && s.children !== false);
  if (!filtered.length) return null;
  return (
    <footer className={cn("erp-operational-footer", className)} aria-label="Operational workspace footer">
      {filtered.map((s) => (
        <div key={s.key} className="erp-operational-footer-section">
          {s.title ? <div className="erp-operational-footer-section-title">{s.title}</div> : null}
          {s.children}
        </div>
      ))}
    </footer>
  );
}
