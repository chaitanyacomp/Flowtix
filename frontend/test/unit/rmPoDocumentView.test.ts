import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const detailPath = resolve(__dirname, "../../src/pages/rmPurchase/RmPurchasePoDetailPage.tsx");
const traceabilityPagePath = resolve(__dirname, "../../src/pages/rmPurchase/RmPurchasePoTraceabilityPage.tsx");
const grnModalPath = resolve(__dirname, "../../src/components/rmPurchase/GrnPostReceiptModal.tsx");
const documentPath = resolve(__dirname, "../../src/components/rmPurchase/RmPoDocumentView.tsx");
const internalTracePath = resolve(__dirname, "../../src/components/rmPurchase/RmPoInternalTraceabilityView.tsx");
const supplierDocPath = resolve(__dirname, "../../src/components/rmPurchase/RmPoSupplierDocument.tsx");
const appPath = resolve(__dirname, "../../src/App.tsx");
const detailSource = readFileSync(detailPath, "utf8");
const traceabilityPageSource = readFileSync(traceabilityPagePath, "utf8");
const grnModalSource = readFileSync(grnModalPath, "utf8");
const documentSource = readFileSync(documentPath, "utf8");
const internalTraceSource = readFileSync(internalTracePath, "utf8");
const supplierDocSource = readFileSync(supplierDocPath, "utf8");
const appSource = readFileSync(appPath, "utf8");

describe("RmPoDocumentView P4D-B", () => {
  it("exports document component", async () => {
    const mod = await import("../../src/components/rmPurchase/RmPoDocumentView");
    expect(typeof mod.RmPoDocumentView).toBe("function");
  });

  it("renders supplier document only (internal trace on separate page)", () => {
    expect(documentSource).toContain("RmPoSupplierDocument");
    expect(documentSource).not.toContain('data-testid="rm-po-internal-trace-section"');
    expect(documentSource).toContain("buildRmPoTraceabilityHref");
    expect(documentSource).toContain('data-testid="rm-po-view-traceability-btn"');
  });

  it("has print and supplier copy actions", () => {
    expect(documentSource).toContain('data-testid="rm-po-print-btn"');
    expect(documentSource).toContain("Print / Save as PDF");
    expect(documentSource).not.toContain('data-testid="rm-po-export-pdf-btn"');
    expect(documentSource).not.toContain("Export PDF");
    expect(documentSource).toContain('data-testid="rm-po-supplier-copy-btn"');
    expect(documentSource).toContain("printRmPoSupplierSection");
  });

  it("supplier section is printable container", () => {
    expect(supplierDocSource).toContain('id="rm-po-supplier-section-printable"');
  });

  it("internal traceability lives on dedicated component/page", () => {
    expect(internalTraceSource).toContain('data-testid="rm-po-internal-trace-section"');
    expect(internalTraceSource).toContain("Internal Procurement Traceability");
    expect(internalTraceSource).toContain("TraceChainInline");
    expect(internalTraceSource).toContain("po-line-trace-");
    expect(traceabilityPageSource).toContain("RmPoInternalTraceabilityView");
    expect(appSource).toContain(":poId/traceability");
  });

  it("delegates supplier document to RmPoSupplierDocument", () => {
    expect(documentSource).toContain("RmPoSupplierDocument");
    expect(supplierDocSource).toContain('testId="rm-po-vendor-block"');
    expect(supplierDocSource).toContain('testId="rm-po-deliver-to-block"');
  });

  it("has responsive card layouts on traceability page", () => {
    expect(supplierDocSource).toContain('data-testid="rm-po-supplier-line-cards"');
    expect(internalTraceSource).toContain('data-testid="rm-po-line-cards"');
    expect(supplierDocSource).toContain("md:hidden");
  });

  it("GRN history on internal traceability page", () => {
    expect(internalTraceSource).toContain('data-testid="rm-po-grn-history"');
    expect(internalTraceSource).toContain("No GRN posted yet");
    expect(documentSource).toContain('data-testid="rm-po-view-grn-history-btn"');
  });

  it("GRN history cards link to dedicated GRN document", () => {
    expect(internalTraceSource).toContain("buildGrnDetailHref");
    expect(internalTraceSource).toContain("Open GRN");
    expect(internalTraceSource).toContain('data-testid={`grn-open-${grn.id}`}');
  });

  it("create GRN edit cancel actions gated by documentOnly and grnAllowed", () => {
    expect(documentSource).toContain("showWorkflowActions && grnAllowed");
    expect(documentSource).toContain('data-testid="rm-po-create-grn-btn"');
    expect(documentSource).toContain("documentOnly");
    expect(documentSource).toContain("rm-po-edit-btn");
    expect(documentSource).toContain("rm-po-cancel-btn");
    expect(documentSource).toContain('data-testid="rm-po-print-btn"');
    expect(documentSource).toContain('data-testid="rm-po-supplier-copy-btn"');
  });

  it("completed procurement record identity and lifecycle banner", () => {
    expect(documentSource).toContain("RM Procurement Record — Completed");
    expect(documentSource).toContain("RmProcurementRecordBanner");
    expect(documentSource).toContain("resolveProcurementRecordSummary");
  });

  it("related documents cross-navigation on RM PO page", () => {
    expect(documentSource).toContain("ProcurementRelatedDocuments");
    expect(documentSource).toContain("buildRmPoRelatedDocuments");
  });

  it("supplier terminology on supplier document", () => {
    expect(supplierDocSource).toContain('title="Supplier"');
    expect(supplierDocSource).toContain("Supplier Name");
    expect(supplierDocSource).toContain("Supplier Address");
    expect(supplierDocSource).toContain("Supplier GSTIN");
    expect(supplierDocSource).not.toContain('title="Vendor"');
    expect(supplierDocSource).toContain("Document Type: Supplier PO Copy");
    expect(supplierDocSource).toContain("Purchase Order");
  });
});

describe("RmPurchasePoDetailPage P4D-B", () => {
  it("loads company profile for supplier document", () => {
    expect(detailSource).toContain("/api/company-profile");
    expect(detailSource).toContain("companyProfile");
  });

  it("filters sales billing banner from next step strip", () => {
    expect(detailSource).toContain("shouldShowPostGrnStripOnRmPoPage");
    expect(detailSource).toContain("isRmPoIrrelevantNextStepText");
  });

  it("suppresses workflow strip on completed PO", () => {
    expect(detailSource).toContain("isRmPoDocumentOnly(po.status)");
    expect(detailSource).toContain("documentOnly={isRmPoDocumentOnly(po.status)}");
  });

  it("redirects to pending actions after final GRN", () => {
    expect(detailSource).toContain("RM_PO_FINAL_GRN_COMPLETION_TOAST");
    expect(detailSource).toContain("RM_PO_FINAL_GRN_REDIRECT_DELAY_MS");
    expect(detailSource).toContain('navigate("/pending-actions")');
    expect(detailSource).toContain("toast.showSuccess");
  });

  it("fetches procurement trace API", () => {
    expect(detailSource).toContain("/api/procurement-trace/rm-po/");
  });

  it("keeps GRN modal post flow", () => {
    expect(detailSource).toContain("grnModalOpen");
    expect(detailSource).toContain('apiFetch("/api/purchase/grns"');
    expect(detailSource).toContain("GrnPostReceiptModal");
    expect(detailSource).toContain("requestCloseGrnModal");
    expect(grnModalSource).toContain('data-testid="grn-post-receipt-modal"');
    expect(grnModalSource).toContain("Balance after receipt");
    expect(grnModalSource).not.toContain("rounded-md border border-slate-200 bg-white p-2");
  });
});
