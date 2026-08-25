import * as React from "react";
import { X } from "lucide-react";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";

export type ErpModalFrameSize = "sm" | "md" | "lg" | "xl";

const SIZE_CLASS: Record<ErpModalFrameSize, string> = {
  sm: "max-w-md",
  md: "max-w-lg",
  lg: "max-w-3xl",
  xl: "max-w-[900px]",
};

export type ErpModalFrameProps = {
  title: React.ReactNode;
  titleId?: string;
  onClose: () => void;
  /** Extra controls in the header (e.g. Quick Fill). Not used as the drag ignore zone alone — buttons are ignored by drag helper. */
  headerActions?: React.ReactNode;
  children: React.ReactNode;
  size?: ErpModalFrameSize;
  className?: string;
  closeButtonTestId?: string;
  /** When false, omit drag-handle attribute (rare). Default true for frame headers. */
  dragHandle?: boolean;
};

/**
 * Shared overflow-safe modal chrome: sticky header, flexible content slot, optional sticky footer via {@link ErpModalFrameFooter}.
 * Opt into dragging by placing this inside {@link ErpModal} with `draggable`.
 */
export function ErpModalFrame({
  title,
  titleId,
  onClose,
  headerActions,
  children,
  size = "lg",
  className,
  closeButtonTestId = "erp-modal-frame-close",
  dragHandle = true,
}: ErpModalFrameProps) {
  return (
    <div
      className={cn("erp-modal-frame", SIZE_CLASS[size], className)}
      data-testid="erp-modal-frame"
    >
      <div
        className="erp-modal-frame__header"
        {...(dragHandle ? { "data-erp-modal-drag-handle": "" } : {})}
      >
        <div className="min-w-0 flex-1">
          {typeof title === "string" || typeof title === "number" ? (
            <h2 id={titleId} className="text-base font-semibold text-slate-900">
              {title}
            </h2>
          ) : (
            <div id={titleId} className="min-w-0">
              {title}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {headerActions}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-9 w-9 shrink-0"
            aria-label="Close"
            data-testid={closeButtonTestId}
            onClick={onClose}
          >
            <X className="h-5 w-5" />
          </Button>
        </div>
      </div>
      <div className="erp-modal-frame__content">{children}</div>
    </div>
  );
}

export const ErpModalFrameBody = React.forwardRef<
  HTMLDivElement,
  { children: React.ReactNode; className?: string }
>(function ErpModalFrameBody({ children, className }, ref) {
  return (
    <div ref={ref} className={cn("erp-modal-frame__body", className)} data-testid="erp-modal-frame-body">
      {children}
    </div>
  );
});

export function ErpModalFrameFooter({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("erp-modal-frame__footer", className)} data-testid="erp-modal-frame-footer">
      {children}
    </div>
  );
}
