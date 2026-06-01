import * as React from "react";
import { cn } from "../../lib/utils";
import { registerErpModal } from "../../lib/erpModalEscape";
import { useModalFocusRestore } from "../../hooks/useModalFocusRestore";

export type ErpModalProps = {
  open?: boolean;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
  backdropClassName?: string;
  closeOnBackdropClick?: boolean;
  disableEscape?: boolean;
  /** When true, Escape does not close (e.g. while submitting). */
  escapeDisabled?: () => boolean;
  role?: string;
  "aria-modal"?: boolean | "true" | "false";
  "aria-labelledby"?: string;
  "aria-label"?: string;
};

/**
 * Shared ERP modal backdrop — registers with the global Escape stack while open.
 * Press Escape to invoke {@link onClose} (same as Cancel) for the topmost modal only.
 */
export function ErpModal({
  open = true,
  onClose,
  children,
  className,
  backdropClassName,
  closeOnBackdropClick = false,
  disableEscape = false,
  escapeDisabled,
  role = "dialog",
  "aria-modal": ariaModal = true,
  "aria-labelledby": ariaLabelledby,
  "aria-label": ariaLabel,
}: ErpModalProps) {
  const onCloseRef = React.useRef(onClose);
  onCloseRef.current = onClose;

  useModalFocusRestore(open);

  React.useEffect(() => {
    if (!open || disableEscape) return;
    return registerErpModal(() => onCloseRef.current(), { disabled: escapeDisabled });
  }, [open, disableEscape, escapeDisabled]);

  if (!open) return null;

  return (
    <div
      className={cn("erp-modal-backdrop", backdropClassName, className)}
      role={role}
      aria-modal={ariaModal === true ? "true" : ariaModal === false ? undefined : ariaModal}
      aria-labelledby={ariaLabelledby}
      aria-label={ariaLabel}
      onClick={
        closeOnBackdropClick
          ? (e) => {
              if (e.target === e.currentTarget) onCloseRef.current();
            }
          : undefined
      }
    >
      {children}
    </div>
  );
}
