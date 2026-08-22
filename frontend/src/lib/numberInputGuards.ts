/**
 * Global guards for native `input[type="number"]`.
 * Spinners are hidden via CSS in style.css; this module blocks wheel-driven value changes.
 */

export function isHtmlNumberInput(target: EventTarget | null): target is HTMLInputElement {
  if (!target || typeof (target as HTMLElement).tagName !== "string") return false;
  const el = target as HTMLInputElement;
  return el.tagName === "INPUT" && String(el.type || "").toLowerCase() === "number";
}

/**
 * Wheel over a focused number input must not change its value.
 * (Browsers only spin the value when the field is focused.)
 */
export function shouldBlockNumberInputWheel(opts: {
  target: EventTarget | null;
  activeElement: Element | null;
}): boolean {
  if (!isHtmlNumberInput(opts.target)) return false;
  return opts.activeElement === opts.target;
}

/**
 * @returns true when the wheel event was blocked
 */
export function blockNumberInputWheel(
  event: { target: EventTarget | null; preventDefault: () => void },
  activeElement: Element | null,
): boolean {
  if (!shouldBlockNumberInputWheel({ target: event.target, activeElement })) return false;
  event.preventDefault();
  return true;
}

/**
 * Install document-level capture wheel listener. Call once at app boot.
 * Returns an uninstall function (tests / HMR).
 */
export function installNumberInputGuards(
  doc: Document = typeof document !== "undefined" ? document : (null as unknown as Document),
): () => void {
  if (!doc || typeof doc.addEventListener !== "function") return () => {};

  const onWheel = (event: WheelEvent) => {
    const blocked = blockNumberInputWheel(event, doc.activeElement);
    if (!blocked) return;
    // After blocking the value change, blur so further wheel gestures can scroll the page.
    const target = event.target;
    if (isHtmlNumberInput(target) && typeof target.blur === "function") {
      target.blur();
    }
  };

  doc.addEventListener("wheel", onWheel, { capture: true, passive: false });
  return () => {
    doc.removeEventListener("wheel", onWheel, { capture: true } as AddEventListenerOptions);
  };
}
