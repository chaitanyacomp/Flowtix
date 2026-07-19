/**
 * DEV-only visual QA page for Material Issue RM card layout.
 * Route: /dev/material-issue-allowance-layout
 */
import { MaterialIssueAllowanceRow } from "../../components/erp/MaterialIssueAllowanceRow";
import { PageContainer } from "../../components/PageHeader";

const samples = [
  {
    key: "example",
    itemName: "PP",
    unit: "Kg",
    theoreticalQty: 40.5,
    issuedQty: 0,
    trueShortIssueQty: 0,
    pendingQty: 40.5,
    availableQty: 323,
    allowanceQty: "1.5",
    allowanceReason: "",
    issueQty: "42",
    disabled: false,
  },
  {
    key: "partial",
    itemName: "Masterbatch Ultramarine Blue Special Compound — Grade MB-4821-XL",
    unit: "Kg",
    theoreticalQty: 40.5,
    issuedQty: 20,
    trueShortIssueQty: 0,
    pendingQty: 20.5,
    availableQty: 100,
    allowanceQty: "1.5",
    allowanceReason: "",
    issueQty: "22",
    disabled: false,
  },
  {
    key: "approval",
    itemName: "Calcium Carbonate Filler",
    unit: "Kg",
    theoreticalQty: 72,
    issuedQty: 0,
    trueShortIssueQty: 0,
    pendingQty: 72,
    availableQty: 200,
    allowanceQty: "4",
    allowanceReason: "",
    issueQty: "76",
    disabled: false,
  },
  {
    key: "blocked",
    itemName: "HDPE Regrind",
    unit: "Kg",
    theoreticalQty: 27,
    issuedQty: 0,
    trueShortIssueQty: 0,
    pendingQty: 27,
    availableQty: 80,
    allowanceQty: "3",
    allowanceReason: "",
    issueQty: "30",
    disabled: false,
  },
  {
    key: "stock",
    itemName: "Titanium Dioxide",
    unit: "Kg",
    theoreticalQty: 12.75,
    issuedQty: 0,
    trueShortIssueQty: 0,
    pendingQty: 12.75,
    availableQty: 5,
    allowanceQty: "0",
    allowanceReason: "",
    issueQty: "12.75",
    disabled: false,
  },
  {
    key: "awaiting-approval",
    itemName: "Anti-Oxidant Master (Admin approval pending)",
    unit: "Kg",
    theoreticalQty: 60,
    issuedQty: 0,
    trueShortIssueQty: 0,
    pendingQty: 60,
    availableQty: 150,
    allowanceQty: "4.2",
    allowanceReason: "Recycled regrind absorbs extra moisture",
    issueQty: "64.2",
    disabled: false,
    approvalStatus: "PENDING_APPROVAL",
  },
  {
    key: "approved",
    itemName: "UV Stabilizer Concentrate",
    unit: "Kg",
    theoreticalQty: 45,
    issuedQty: 0,
    trueShortIssueQty: 0,
    pendingQty: 45,
    availableQty: 90,
    allowanceQty: "3",
    allowanceReason: "Extruder purge loss on colour change",
    issueQty: "48",
    disabled: false,
    approvalStatus: "APPROVED",
  },
  {
    key: "rejected",
    itemName: "Impact Modifier EPDM",
    unit: "Kg",
    theoreticalQty: 30,
    issuedQty: 0,
    trueShortIssueQty: 0,
    pendingQty: 30,
    availableQty: 60,
    allowanceQty: "3.5",
    allowanceReason: "Line startup scrap",
    issueQty: "33.5",
    disabled: false,
    approvalStatus: "REJECTED",
    approvalRejectionReason: "Reason too generic — resubmit with the specific machine/shift context.",
  },
] as const;

export function MaterialIssueAllowanceLayoutPreviewPage() {
  return (
    <PageContainer>
      <div className="mb-3 space-y-1">
        <h1 className="text-base font-semibold text-slate-900">Material Issue — RM card layout preview</h1>
        <p className="text-sm text-slate-600">
          DEV visual check: Qty (BOM) = applicable remaining · Add Qty → Allowance % · Issue Now · statuses.
        </p>
      </div>
      <div className="min-w-0 space-y-2" data-testid="material-issue-compact-grid">
        {samples.map((row) => (
          <MaterialIssueAllowanceRow
            key={row.key}
            row={{ ...row }}
            actorRole="STORE"
            onExtraQtyChange={() => undefined}
            onIssueQtyChange={() => undefined}
            onReasonChange={() => undefined}
          />
        ))}
      </div>
    </PageContainer>
  );
}
