import { cn } from "../../lib/utils";
import { ErpOperationalWorkflowStrip } from "./foundation/ErpOperationalWorkflowStrip";

/** Use around `CommercialWorkflowStrip` on quotation / sales-order screens for consistent rhythm. */
export const commercialWorkflowStripFramedClassName = "erp-workflow-strip--horizontal";

/**
 * Tighter variant for compact ERP workspace headers (enquiry / quotation transaction screens).
 */
export const commercialWorkflowStripDenseFramedClassName = "erp-workflow-strip--horizontal erp-workflow-strip--dense";

/** Commercial / sales stages only — do not mix with operational (Production, QC, etc.). */
export type CommercialWorkflowStage = "enquiry" | "feasibility" | "quotation" | "sales_order";

const STEPS: { key: CommercialWorkflowStage; label: string }[] = [
  { key: "enquiry", label: "Enquiry" },
  { key: "feasibility", label: "Feasibility" },
  { key: "quotation", label: "Quotation" },
  { key: "sales_order", label: "Sales Order" },
];

/**
 * Compact horizontal strip for the commercial pipeline.
 * Highlights the current stage only (not a full app menu).
 */
/** Map enquiry workspace context → commercial strip stage (UI only). */
export function commercialStageFromEnquiryContext(
  panelMode: "idle" | "new" | "feasibility" | "details",
  row: { status: string; quotation: unknown } | null,
): CommercialWorkflowStage {
  if (panelMode === "new") return "enquiry";
  if (panelMode === "feasibility") return "feasibility";
  if (row) {
    if (row.quotation) return "quotation";
    if (row.status === "FEASIBLE") return "quotation";
    if (["OPEN", "DRAFT", "PENDING", "NOT_FEASIBLE"].includes(row.status)) return "feasibility";
  }
  return "enquiry";
}

/** Quotations list / new quotation — commercial strip stage (UI only). */
export function commercialStageFromQuotationContext(
  row: { workflowStatus: string; salesOrder?: { id: number } | null } | null,
): { active: CommercialWorkflowStage; allComplete?: boolean } {
  if (!row) return { active: "quotation" };
  if (row.salesOrder) return { active: "sales_order", allComplete: true };
  if (row.workflowStatus === "APPROVED") return { active: "sales_order" };
  return { active: "quotation" };
}

export function CommercialWorkflowStrip(props: {
  active: CommercialWorkflowStage;
  className?: string;
  allComplete?: boolean;
}) {
  const { active, className, allComplete } = props;
  const currentIndex = Math.max(0, STEPS.findIndex((s) => s.key === active));
  const dense = className?.includes("erp-workflow-strip--dense") ?? false;

  return (
    <ErpOperationalWorkflowStrip
      stages={STEPS}
      currentIndex={currentIndex}
      allComplete={allComplete}
      layout="horizontal"
      dense={dense}
      ariaLabel="Commercial workflow"
      className={cn(className)}
    />
  );
}
