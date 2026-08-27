/**
 * Optional desktop drag helpers for {@link ErpModal} (opt-in via `draggable`).
 */

export const ERP_MODAL_DRAG_HANDLE_ATTR = "data-erp-modal-drag-handle";

/** Desktop only — match Tailwind `md` (768px). */
export const ERP_MODAL_DRAG_MEDIA_QUERY = "(min-width: 768px)";

const IGNORE_SELECTOR = "button, input, select, textarea, a, [data-no-drag], [role='button']";

function asClosestHost(target: EventTarget | null): { closest: (selector: string) => unknown } | null {
  if (!target || typeof (target as { closest?: unknown }).closest !== "function") return null;
  return target as unknown as { closest: (selector: string) => unknown };
}

export function isErpModalDragIgnoreTarget(target: EventTarget | null): boolean {
  const el = asClosestHost(target);
  if (!el) return true;
  return Boolean(el.closest(IGNORE_SELECTOR));
}

export function isErpModalDragHandleTarget(target: EventTarget | null): boolean {
  const el = asClosestHost(target);
  if (!el) return false;
  if (isErpModalDragIgnoreTarget(target)) return false;
  return Boolean(el.closest(`[${ERP_MODAL_DRAG_HANDLE_ATTR}]`));
}

/**
 * Clamp a proposed translate so the panel stays within the viewport (margin inset).
 * `startRect` must be the panel's getBoundingClientRect at drag start (includes then-current offset).
 */
export function clampModalDragOffset(
  nextX: number,
  nextY: number,
  startOffset: { x: number; y: number },
  startRect: { left: number; top: number; width: number; height: number },
  viewport: { width: number; height: number },
  margin = 8,
): { x: number; y: number } {
  let x = nextX;
  let y = nextY;
  const left = startRect.left + (x - startOffset.x);
  const top = startRect.top + (y - startOffset.y);
  const right = left + startRect.width;
  const bottom = top + startRect.height;

  if (left < margin) x += margin - left;
  if (top < margin) y += margin - top;
  if (right > viewport.width - margin) x -= right - (viewport.width - margin);
  if (bottom > viewport.height - margin) y -= bottom - (viewport.height - margin);

  return { x, y };
}

export function readErpModalDragEnabled(
  matchMedia: (query: string) => { matches: boolean } = typeof window !== "undefined" ? window.matchMedia.bind(window) : () => ({ matches: false }),
): boolean {
  try {
    return Boolean(matchMedia(ERP_MODAL_DRAG_MEDIA_QUERY).matches);
  } catch {
    return false;
  }
}
