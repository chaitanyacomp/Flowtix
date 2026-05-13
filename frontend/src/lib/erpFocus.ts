/** Desktop / pointer-first ERP operators — avoid mobile keyboard popups from programmatic focus. */
export function prefersFinePointer(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  try {
    return window.matchMedia("(pointer: fine)").matches;
  } catch {
    return false;
  }
}
