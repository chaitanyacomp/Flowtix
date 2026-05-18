import type { ReactNode } from "react";
import { Badge, type BadgeProps } from "../../ui/badge";
import { cn } from "../../../lib/utils";
import {
  erpStatusToneToBadgeVariant,
  formatErpStatusLabel,
  resolveErpStatusTone,
  type ErpStatusTone,
  type ErpStatusToneInput,
} from "../../../lib/erpStatusTone";

export type ErpStatusChipProps = Omit<BadgeProps, "variant"> & {
  /** Table / toolbar density */
  density?: "default" | "compact";
  /** Explicit tone or raw status label from API */
  tone?: ErpStatusToneInput;
  /** When set, shown instead of formatted `children` */
  label?: string;
  children?: ReactNode;
};

/** Standard status chip — maps operational labels to global tone families. */
export function ErpStatusChip({
  className,
  density = "default",
  tone,
  label,
  children,
  ...rest
}: ErpStatusChipProps) {
  const text = label ?? (typeof children === "string" ? children : "");
  const resolved: ErpStatusTone = tone != null ? resolveErpStatusTone(tone) : resolveErpStatusTone(text);
  const variant = erpStatusToneToBadgeVariant(resolved);
  const display = text ? formatErpStatusLabel(text) : children;

  return (
    <Badge variant={variant} density={density} className={cn(className)} {...rest}>
      {display}
    </Badge>
  );
}
