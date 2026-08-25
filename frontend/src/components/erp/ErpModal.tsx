import * as React from "react";
import { cn } from "../../lib/utils";
import { registerErpModal } from "../../lib/erpModalEscape";
import {
  clampModalDragOffset,
  isErpModalDragHandleTarget,
  readErpModalDragEnabled,
} from "../../lib/erpModalDrag";
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
  /**
   * Opt-in desktop dragging via an element marked `[data-erp-modal-drag-handle]`.
   * Disabled automatically on small screens. Unrelated modals stay non-draggable by default.
   */
  draggable?: boolean;
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
  draggable = false,
  role = "dialog",
  "aria-modal": ariaModal = true,
  "aria-labelledby": ariaLabelledby,
  "aria-label": ariaLabel,
}: ErpModalProps) {
  const onCloseRef = React.useRef(onClose);
  onCloseRef.current = onClose;
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const [offset, setOffset] = React.useState({ x: 0, y: 0 });
  const offsetRef = React.useRef(offset);
  offsetRef.current = offset;
  const [dragEnabled, setDragEnabled] = React.useState(false);
  const dragRef = React.useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    startRect: DOMRect;
  } | null>(null);

  useModalFocusRestore(open);

  React.useEffect(() => {
    if (!open || disableEscape) return;
    return registerErpModal(() => onCloseRef.current(), { disabled: escapeDisabled });
  }, [open, disableEscape, escapeDisabled]);

  React.useEffect(() => {
    if (!open) return;
    setOffset({ x: 0, y: 0 });
  }, [open]);

  React.useEffect(() => {
    if (!draggable || !open || typeof window === "undefined") {
      setDragEnabled(false);
      return;
    }
    const mq = window.matchMedia("(min-width: 768px)");
    const sync = () => setDragEnabled(readErpModalDragEnabled((q) => (q === mq.media ? mq : window.matchMedia(q))));
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, [draggable, open]);

  React.useEffect(() => {
    if (!dragEnabled || !open) return;
    const panel = panelRef.current;
    if (!panel) return;

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      if (!isErpModalDragHandleTarget(e.target)) return;
      const current = offsetRef.current;
      dragRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        originX: current.x,
        originY: current.y,
        startRect: panel.getBoundingClientRect(),
      };
      panel.setPointerCapture(e.pointerId);
      e.preventDefault();
    };

    const onPointerMove = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      const next = clampModalDragOffset(
        drag.originX + (e.clientX - drag.startX),
        drag.originY + (e.clientY - drag.startY),
        { x: drag.originX, y: drag.originY },
        drag.startRect,
        { width: window.innerWidth, height: window.innerHeight },
      );
      setOffset(next);
    };

    const endDrag = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      dragRef.current = null;
      if (panel.hasPointerCapture(e.pointerId)) {
        panel.releasePointerCapture(e.pointerId);
      }
    };

    panel.addEventListener("pointerdown", onPointerDown);
    panel.addEventListener("pointermove", onPointerMove);
    panel.addEventListener("pointerup", endDrag);
    panel.addEventListener("pointercancel", endDrag);
    return () => {
      panel.removeEventListener("pointerdown", onPointerDown);
      panel.removeEventListener("pointermove", onPointerMove);
      panel.removeEventListener("pointerup", endDrag);
      panel.removeEventListener("pointercancel", endDrag);
    };
  }, [dragEnabled, open]);

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
      <div
        ref={panelRef}
        className={cn("erp-modal-panel", dragEnabled && "erp-modal-panel--draggable")}
        style={
          dragEnabled || offset.x !== 0 || offset.y !== 0
            ? { transform: `translate(${offset.x}px, ${offset.y}px)` }
            : undefined
        }
        data-erp-modal-draggable={dragEnabled ? "true" : undefined}
      >
        {children}
      </div>
    </div>
  );
}
