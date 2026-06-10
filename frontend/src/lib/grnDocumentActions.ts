const GRN_PRINT_BODY_CLASS = "grn-document-print";

export function printGrnDocumentSection(): void {
  document.body.classList.add(GRN_PRINT_BODY_CLASS);
  window.print();
  window.addEventListener(
    "afterprint",
    () => {
      document.body.classList.remove(GRN_PRINT_BODY_CLASS);
    },
    { once: true },
  );
}

export function buildGrnDetailHref(grnId: number, returnTo?: string): string {
  const base = `/grn/${grnId}`;
  if (returnTo && returnTo.startsWith("/")) {
    return `${base}?returnTo=${encodeURIComponent(returnTo)}`;
  }
  return base;
}
