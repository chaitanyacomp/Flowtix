import type { PostGrnNextStep } from "./rmPurchaseWoContinuity";

/** Downstream FG/dispatch/sales steps — not shown on RM PO detail page. */
const RM_PO_SUPPRESSED_STAGE_KEYS = new Set([
  "SALES_BILL_PENDING",
  "DISPATCH_PENDING",
  "COMPLETED",
]);

const RM_PO_SUPPRESSED_PHRASES = [
  "complete sales billing",
  "dispatch finished goods",
  "dispatched goods",
];

export function shouldShowPostGrnStripOnRmPoPage(step: PostGrnNextStep | null | undefined): boolean {
  if (!step) return false;
  if (RM_PO_SUPPRESSED_STAGE_KEYS.has(step.stageKey)) return false;
  const blob = `${step.nextStepLine} ${step.headline} ${step.actionLabel}`.toLowerCase();
  return !RM_PO_SUPPRESSED_PHRASES.some((p) => blob.includes(p));
}

export function isRmPoIrrelevantNextStepText(text: string | null | undefined): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  return RM_PO_SUPPRESSED_PHRASES.some((p) => lower.includes(p));
}

const RM_PO_SUPPLIER_PRINT_BODY_CLASS = "rm-po-supplier-print";

export function printRmPoSupplierSection(): void {
  document.body.classList.add(RM_PO_SUPPLIER_PRINT_BODY_CLASS);
  window.print();
  window.addEventListener(
    "afterprint",
    () => {
      document.body.classList.remove(RM_PO_SUPPLIER_PRINT_BODY_CLASS);
    },
    { once: true },
  );
}

/** PDF via browser print-to-PDF (dedicated server PDF deferred). */
export function exportRmPoPdfPlaceholder(poDisplayNo: string): void {
  // eslint-disable-next-line no-alert
  window.alert(
    `To save ${poDisplayNo} as PDF, click Print and choose "Save as PDF" in your browser print dialog.`,
  );
}
