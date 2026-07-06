import * as React from "react";
import { Link } from "react-router-dom";
import { Eye, FileSearch, Printer } from "lucide-react";
import { Button, buttonVariants } from "../ui/button";
import { cn } from "../../lib/utils";
import { RmPoSupplierDocument } from "./RmPoSupplierDocument";
import { RmProcurementRecordBanner } from "./RmProcurementRecordBanner";
import { ProcurementRelatedDocuments } from "./ProcurementRelatedDocuments";
import type { RmPoCompanyProfile } from "../../lib/rmPoSupplierDocument";
import { buildRmPoTraceabilityHref, printRmPoSupplierSection } from "../../lib/rmPoDocumentActions";
import { buildRmPoRelatedDocuments } from "../../lib/procurementRelatedDocuments";
import { resolveProcurementRecordSummary } from "../../lib/rmProcurementRecordDisplay";
import type { RmPoTracePayload } from "../../lib/rmPoDocumentTrace";
import { formatRmPoNo, type RmPoRow } from "../../pages/rmPurchase/rmPurchaseShared";

export type RmPoDocumentViewProps = {
  po: RmPoRow;
  companyProfile: RmPoCompanyProfile | null;
  trace: RmPoTracePayload | null;
  traceError: string | null;
  receiveInfo: { ordered: number; received: number; pending: number } | null;
  billingTotals: { billed: number; pendingBilling: number; rebillable: number };
  poPrimaryUnit: string;
  stockStatusLabel: string;
  billingStatusLabel: string;
  canEditPo: boolean;
  showCancel: boolean;
  grnAllowed: boolean;
  isAdmin: boolean;
  reversingGrnId: number;
  /** Completed PO — supplier document only; no workflow actions on this page. */
  documentOnly?: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onCreateGrn: () => void;
  onReverseGrn: (grnId: number) => void;
};

export function RmPoDocumentView({
  po,
  companyProfile,
  trace,
  stockStatusLabel,
  canEditPo,
  showCancel,
  grnAllowed,
  documentOnly = false,
  onEdit,
  onCancel,
  onCreateGrn,
}: RmPoDocumentViewProps) {
  const [supplierCopyMode, setSupplierCopyMode] = React.useState(false);
  const traceabilityHref = buildRmPoTraceabilityHref(po.id);
  const showWorkflowActions = !documentOnly;
  const procurementSummary = documentOnly
    ? resolveProcurementRecordSummary(po, trace, stockStatusLabel)
    : null;
  const relatedDocuments = React.useMemo(
    () => buildRmPoRelatedDocuments(po, trace),
    [po, trace],
  );

  return (
    <article
      className="mx-auto max-w-5xl overflow-hidden rounded-lg border border-slate-300 bg-white shadow-md"
      data-testid="rm-po-document"
    >
      <div className="rm-po-no-print sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur-sm">
        <p className="text-sm font-bold uppercase tracking-wide text-slate-700">
          {documentOnly ? "RM Procurement Record — Completed" : "RM Purchase Order"}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5 text-sm"
            data-testid="rm-po-print-btn"
            onClick={() => printRmPoSupplierSection()}
          >
            <Printer className="h-4 w-4" />
            Print / Save as PDF
          </Button>
          <Button
            type="button"
            variant={supplierCopyMode ? "default" : "outline"}
            size="sm"
            className="gap-1.5 text-sm"
            data-testid="rm-po-supplier-copy-btn"
            onClick={() => setSupplierCopyMode((v) => !v)}
          >
            <Eye className="h-4 w-4" />
            {supplierCopyMode ? "Show full view" : "Supplier copy"}
          </Button>
          <Link
            to={traceabilityHref}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-1.5 text-sm no-underline")}
            data-testid="rm-po-view-traceability-btn"
          >
            <FileSearch className="h-4 w-4" />
            View Internal Traceability
          </Link>
          {documentOnly ? (
            <Link
              to={`${traceabilityHref}#grn-history`}
              className={cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-1.5 text-sm no-underline")}
              data-testid="rm-po-view-grn-history-btn"
            >
              View GRN History
            </Link>
          ) : null}
          {showWorkflowActions && grnAllowed ? (
            <Button type="button" size="sm" className="text-sm" data-testid="rm-po-create-grn-btn" onClick={onCreateGrn}>
              Create GRN
            </Button>
          ) : null}
          {showWorkflowActions && canEditPo ? (
            <Button type="button" variant="outline" size="sm" className="text-sm" data-testid="rm-po-edit-btn" onClick={onEdit}>
              Edit order
            </Button>
          ) : null}
          {showWorkflowActions && showCancel ? (
            <Button type="button" variant="outline" size="sm" className="text-sm" data-testid="rm-po-cancel-btn" onClick={onCancel}>
              Cancel order
            </Button>
          ) : null}
        </div>
      </div>

      {supplierCopyMode ? (
        <div className="rm-po-no-print border-b border-sky-200 bg-sky-50 px-4 py-2 text-sm text-sky-900 md:px-6">
          Supplier copy view — internal traceability is on a separate audit page. Use Print for a supplier-facing document.
        </div>
      ) : null}

      {documentOnly ? (
        <div className="rm-po-no-print border-b border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-700 md:px-6">
          This procurement record is complete. Continue workflow from{" "}
          <Link to="/pending-actions" className="font-semibold text-primary underline">
            Pending Actions
          </Link>
          . Internal traceability is available separately.
        </div>
      ) : null}

      {documentOnly && procurementSummary && !supplierCopyMode ? (
        <RmProcurementRecordBanner summary={procurementSummary} />
      ) : null}

      {!supplierCopyMode ? <ProcurementRelatedDocuments documents={relatedDocuments} /> : null}

      <RmPoSupplierDocument
        po={po}
        poDate={trace?.rmPo?.createdAt}
        companyProfile={companyProfile}
      />

      {!supplierCopyMode ? (
        <div className="rm-po-no-print border-t border-slate-200 bg-slate-50/80 px-4 py-4 text-sm text-slate-700 md:px-6">
          <p>
            <span className="font-semibold text-slate-900">{formatRmPoNo(po.id)}</span> — audit trail, GRN history, and receipt
            summary are on{" "}
            <Link to={traceabilityHref} className="font-semibold text-primary underline">
              Internal Procurement Traceability
            </Link>
            .
          </p>
        </div>
      ) : null}
    </article>
  );
}
