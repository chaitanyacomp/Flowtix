import * as React from "react";
import { ErpKpiLabel, ErpKpiSegment, ErpKpiStrip, ErpKpiValue } from "../foundation/ErpKpiStrip";
import { cn } from "../../../lib/utils";

export type WorkbenchKpiItem = {
  key: string;
  label: string;
  value: React.ReactNode;
  tone?: "default" | "muted" | "warn" | "crit";
  title?: string;
  onClick?: () => void;
};

export type WorkbenchKpiStripProps = {
  items: WorkbenchKpiItem[];
  className?: string;
  "aria-label"?: string;
  /** FT-PD-066 / FT-PD-067 — maximum six segments, no duplicate keys */
  maxItems?: number;
};

const DEFAULT_MAX = 6;

/**
 * FT-PD-067 — Single horizontal KPI strip (max 6, deduped by key).
 */
export function WorkbenchKpiStrip({
  items,
  className,
  "aria-label": ariaLabel = "Workbench summary",
  maxItems = DEFAULT_MAX,
}: WorkbenchKpiStripProps) {
  const seen = new Set<string>();
  const visible: WorkbenchKpiItem[] = [];
  for (const item of items) {
    if (seen.has(item.key)) continue;
    seen.add(item.key);
    visible.push(item);
    if (visible.length >= maxItems) break;
  }

  if (visible.length === 0) return null;

  return (
    <ErpKpiStrip
      className={cn("erp-workbench-kpi erp-kpi-strip--compact shrink-0", className)}
      role="toolbar"
      aria-label={ariaLabel}
      data-testid="workbench-kpi-strip"
    >
      {visible.map((item) => (
        <ErpKpiSegment
          key={item.key}
          as={item.onClick ? "button" : "div"}
          type={item.onClick ? "button" : undefined}
          onClick={item.onClick}
          title={item.title}
          className={item.onClick ? undefined : "cursor-default"}
        >
          <ErpKpiLabel>{item.label}</ErpKpiLabel>
          <ErpKpiValue tone={item.tone === "default" ? undefined : item.tone}>{item.value}</ErpKpiValue>
        </ErpKpiSegment>
      ))}
    </ErpKpiStrip>
  );
}
