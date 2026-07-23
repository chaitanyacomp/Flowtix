import { describe, expect, it } from "vitest";
import {
  buildCreateGrnDeepLink,
  buildRmPoDetailHref,
  isCreateGrnDeepLinkSearch,
} from "../../src/lib/rmPurchaseWoContinuity";
import {
  buildPendingActionPreviewLine,
  pendingActionWorkspaceListHref,
} from "../../src/lib/pendingActionsWorkBuckets";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const detailSource = readFileSync(
  resolve(__dirname, "../../src/pages/rmPurchase/RmPurchasePoDetailPage.tsx"),
  "utf8",
);
const listSource = readFileSync(
  resolve(__dirname, "../../src/pages/rmPurchase/RmPurchaseListPage.tsx"),
  "utf8",
);

describe("Create GRN pending-action deep-link", () => {
  it("builds Purchase & GRN PO detail route with openGrn — not Dashboard or RMCC", () => {
    const href = buildCreateGrnDeepLink(167, { from: "pending-actions" });
    expect(href).toBe("/rm-po-grn/167?from=pending-actions&openGrn=1");
    expect(href).not.toContain("/dashboard");
    expect(href).not.toMatch(/material-availability|rm-control|control-center/i);
    expect(href).toContain("/rm-po-grn/167");
  });

  it("keeps internal PO id in the path for refresh / direct navigation", () => {
    expect(buildRmPoDetailHref(42, { openGrn: true, from: "pending-actions" })).toMatch(
      /^\/rm-po-grn\/42\?/,
    );
    expect(isCreateGrnDeepLinkSearch("openGrn=1&from=pending-actions")).toBe(true);
    expect(isCreateGrnDeepLinkSearch("from=pending-actions")).toBe(false);
  });

  it("detail page auto-opens Create GRN from openGrn query", () => {
    expect(detailSource).toContain("isCreateGrnDeepLinkSearch");
    expect(detailSource).toContain("setGrnModalOpen(true)");
    expect(detailSource).toContain("openGrnFromDeepLink");
    expect(detailSource).toContain("Create GRN is not available");
    expect(detailSource).not.toMatch(/openGrnFromDeepLink[\s\S]{0,400}navigate\(["']\/dashboard["']\)/);
  });

  it("legacy list ?poId= redirect preserves openGrn and pending-actions return", () => {
    expect(listSource).toContain('detailQs.set("openGrn", "1")');
    expect(listSource).toContain('from === "pending-actions" ? "/pending-actions"');
  });

  it("Create GRN card preview shows PO number, supplier, pending qty — not internal id as display", () => {
    const href = buildCreateGrnDeepLink(167);
    const line = buildPendingActionPreviewLine({
      priority: "LOW",
      action: "Create GRN",
      documentNo: "RMPO-167",
      ownerRole: "STORE",
      ageHours: null,
      href,
      itemName: "Acme Suppliers",
      qty: 50,
      uom: "KG",
    });
    expect(line.documentNo).toBe("RMPO-167");
    expect(line.detail).toContain("Acme Suppliers");
    expect(line.detail).toContain("50 KG");
    expect(line.detail).not.toMatch(/id\s*[:=]\s*167/i);
    expect(href).toContain("/rm-po-grn/167");
  });

  it("multi Create GRN list open stays on Purchase & GRN pending receipts — not Dashboard", () => {
    const listHref = pendingActionWorkspaceListHref(
      "/rm-po-grn/167?openGrn=1&from=pending-actions",
    );
    expect(listHref).toBe("/rm-po-grn?focus=pending-requests&from=pending-actions");
    expect(listHref).not.toContain("/dashboard");
    expect(listHref).not.toMatch(/material-availability|rm-control/i);
  });
});
