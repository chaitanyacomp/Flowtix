import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const detailPath = resolve(__dirname, "../../src/pages/rmPurchase/RmPurchasePoDetailPage.tsx");
const documentPath = resolve(__dirname, "../../src/components/rmPurchase/RmPoDocumentView.tsx");
const supplierDocPath = resolve(__dirname, "../../src/components/rmPurchase/RmPoSupplierDocument.tsx");
const detailSource = readFileSync(detailPath, "utf8");
const documentSource = readFileSync(documentPath, "utf8");
const supplierDocSource = readFileSync(supplierDocPath, "utf8");

describe("RmPoDocumentView P4D-B", () => {
  it("exports document component", async () => {
    const mod = await import("../../src/components/rmPurchase/RmPoDocumentView");
    expect(typeof mod.RmPoDocumentView).toBe("function");
  });

  it("renders supplier document before internal trace", () => {
    const supplierIdx = documentSource.indexOf("RmPoSupplierDocument");
    const internalIdx = documentSource.indexOf('data-testid="rm-po-internal-trace-section"');
    expect(supplierIdx).toBeGreaterThan(-1);
    expect(internalIdx).toBeGreaterThan(supplierIdx);
  });

  it("renders internal trace section separately", () => {
    expect(documentSource).toContain('data-testid="rm-po-internal-trace-section"');
    expect(documentSource).toContain("Internal procurement traceability");
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

  it("trace chain still visible in internal section", () => {
    expect(documentSource).toContain("TraceChainInline");
    expect(documentSource).toContain("po-line-trace-");
  });

  it("delegates supplier document to RmPoSupplierDocument", () => {
    expect(documentSource).toContain("RmPoSupplierDocument");
    expect(supplierDocSource).toContain('testId="rm-po-vendor-block"');
    expect(supplierDocSource).toContain('testId="rm-po-deliver-to-block"');
  });

  it("has responsive card layouts", () => {
    expect(supplierDocSource).toContain('data-testid="rm-po-supplier-line-cards"');
    expect(documentSource).toContain('data-testid="rm-po-line-cards"');
    expect(supplierDocSource).toContain("md:hidden");
  });

  it("GRN history in internal section", () => {
    expect(documentSource).toContain('data-testid="rm-po-grn-history"');
    expect(documentSource).toContain("No GRN posted yet");
  });

  it("GRN history cards link to dedicated GRN document", () => {
    expect(documentSource).toContain("buildGrnDetailHref");
    expect(documentSource).toContain("Open GRN");
    expect(documentSource).toContain('data-testid={`grn-open-${grn.id}`}');
  });

  it("create GRN edit cancel actions preserved", () => {
    expect(documentSource).toContain("rm-po-create-grn-btn");
    expect(documentSource).toContain("rm-po-edit-btn");
    expect(documentSource).toContain("rm-po-cancel-btn");
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

  it("fetches procurement trace API", () => {
    expect(detailSource).toContain("/api/procurement-trace/rm-po/");
  });

  it("keeps GRN modal post flow", () => {
    expect(detailSource).toContain("grnModalOpen");
    expect(detailSource).toContain('apiFetch("/api/purchase/grns"');
  });
});
