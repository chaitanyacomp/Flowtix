import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

/** Global ERP status chip — fixed height, shared radius, tone families. */
const badgeVariants = cva("erp-status-chip inline-flex max-w-full items-center truncate leading-none", {
  variants: {
    variant: {
      default: "erp-status-chip--neutral",
      success: "erp-status-chip--success",
      warning: "erp-status-chip--warning",
      info: "erp-status-chip--info",
      rejected: "erp-status-chip--danger",
    },
    density: {
      default: "h-5 min-h-5 px-2 text-[11px] font-semibold",
      compact: "h-[18px] min-h-[18px] px-1.5 text-[10px] font-semibold",
    },
  },
  defaultVariants: { variant: "default", density: "default" },
});

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, density, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant, density }), className)} {...props} />;
}

export { Badge, badgeVariants };
