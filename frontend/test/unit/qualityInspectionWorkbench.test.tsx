import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { QualityInspectionQueuePanel } from "../../src/components/erp/quality/QualityInspectionQueuePanel";
import {
  resolveQcSaveInspectionStatus,
  type QualityQueueRow,
} from "../../src/lib/qcWorkspaceUx";

const sampleRows: QualityQueueRow[] = [
  {
    id: "pending-qc-3",
    kind: "PENDING_QC",
    label: "PE-26-0003  ·  Square Box",
    subtitle: "WO-26-0003  ·  Awaiting 1,000 Nos",
    qtyLabel: "1,000",
    anchor: "#qc-production-pending",
    productionId: 3,
    productionDocNo: "PE-26-0003",
    workOrderLabel: "WO-26-0003",
    statusLabel: "Pending QC",
  },
  {
    id: "pending-qc-4",
    kind: "PENDING_QC",
    label: "PE-26-0004  ·  Square Box",
    subtitle: "WO-26-0003  ·  Awaiting 500 Nos",
    qtyLabel: "500",
    anchor: "#qc-production-pending",
    productionId: 4,
    productionDocNo: "PE-26-0004",
    workOrderLabel: "WO-26-0003",
    statusLabel: "Pending QC",
  },
];

describe("QualityInspectionQueuePanel", () => {
  it("renders exactly one quality queue list", () => {
    const html = renderToStaticMarkup(
      <QualityInspectionQueuePanel rows={sampleRows} activeRowId={null} onSelectRow={() => undefined} />,
    );
    expect(html.match(/data-testid="quality-inspection-queue"/g)).toHaveLength(1);
    expect(html.match(/data-testid="quality-queue-list"/g)).toHaveLength(1);
  });

  it("keeps same-WO batches distinguishable by production entry id", () => {
    const html = renderToStaticMarkup(
      <QualityInspectionQueuePanel rows={sampleRows} activeRowId="pending-qc-3" onSelectRow={() => undefined} />,
    );
    expect(html).toContain("PE-26-0003");
    expect(html).toContain("PE-26-0004");
    expect(html).toContain('data-production-id="3"');
    expect(html).toContain('data-production-id="4"');
    expect(html).toContain('aria-selected="true"');
  });
});

describe("resolveQcSaveInspectionStatus", () => {
  it("shows Nothing to save when no selection or no awaiting qty", () => {
    expect(
      resolveQcSaveInspectionStatus({
        hasSelection: false,
        awaitingQty: 100,
        canSubmit: false,
        inspectingQty: null,
        checkedQtyValid: false,
        rejectedQty: null,
        reasonTrimmed: "",
        inlineValidationMsg: null,
        readyQtyLabel: "",
      }),
    ).toBe("Nothing to save");
    expect(
      resolveQcSaveInspectionStatus({
        hasSelection: true,
        awaitingQty: 0,
        canSubmit: false,
        inspectingQty: null,
        checkedQtyValid: false,
        rejectedQty: null,
        reasonTrimmed: "",
        inlineValidationMsg: null,
        readyQtyLabel: "",
      }),
    ).toBe("Nothing to save");
  });

  it("requires a valid inspection quantity before save", () => {
    expect(
      resolveQcSaveInspectionStatus({
        hasSelection: true,
        awaitingQty: 1992,
        canSubmit: false,
        inspectingQty: null,
        checkedQtyValid: false,
        rejectedQty: 0,
        reasonTrimmed: "",
        inlineValidationMsg: "Enter Inspecting now qty.",
        readyQtyLabel: "",
      }),
    ).toBe("Enter a valid inspection quantity");
  });

  it("requires a rejection reason when rejected qty is present", () => {
    expect(
      resolveQcSaveInspectionStatus({
        hasSelection: true,
        awaitingQty: 1992,
        canSubmit: false,
        inspectingQty: 100,
        checkedQtyValid: true,
        rejectedQty: 10,
        reasonTrimmed: "",
        inlineValidationMsg: "Rejection reason is required.",
        readyQtyLabel: "100 Nos",
      }),
    ).toBe("Rejected quantity requires a reason");
  });

  it("enables ready-to-save copy when the entry is valid", () => {
    expect(
      resolveQcSaveInspectionStatus({
        hasSelection: true,
        awaitingQty: 1992,
        canSubmit: true,
        inspectingQty: 1992,
        checkedQtyValid: true,
        rejectedQty: 0,
        reasonTrimmed: "",
        inlineValidationMsg: null,
        readyQtyLabel: "1,992 Nos",
      }),
    ).toBe("1,992 Nos ready to save");
  });

  it("surfaces exact validation when totals or split are invalid", () => {
    expect(
      resolveQcSaveInspectionStatus({
        hasSelection: true,
        awaitingQty: 100,
        canSubmit: false,
        inspectingQty: 50,
        checkedQtyValid: true,
        rejectedQty: 10,
        reasonTrimmed: "Dent",
        inlineValidationMsg: "Rework + Hold + Scrap must equal rejected qty.",
        readyQtyLabel: "50 Nos",
      }),
    ).toBe("Rework + Hold + Scrap must equal rejected qty.");
  });
});

describe("QcEntryPage workbench source contract", () => {
  const pageSrc = readFileSync(resolve(__dirname, "../../src/pages/QcEntryPage.tsx"), "utf8");

  it("uses a single QualityInspectionQueuePanel and no legacy Production QC table", () => {
    const panelUsages = pageSrc.match(/<QualityInspectionQueuePanel\b/g) ?? [];
    expect(panelUsages).toHaveLength(1);
    expect(pageSrc).not.toContain("Production QC queue");
    expect(pageSrc).not.toContain("OperatorMainSplit");
    expect(pageSrc).toContain('data-testid="qc-inspection-workbench"');
    expect(pageSrc).toContain('data-testid="qc-inspect-selected-panel"');
  });

  it("places Save Inspection in the inspect-panel header with no bottom duplicate", () => {
    expect(pageSrc).toContain('data-testid="qc-inspect-selected-header"');
    expect(pageSrc).toContain('data-testid="qc-inspect-header-actions"');
    expect(pageSrc).toContain('data-testid="qc-save-status"');
    expect(pageSrc).toContain('data-testid="qc-save-btn"');
    expect(pageSrc).toContain("resolveQcSaveInspectionStatus");
    expect(pageSrc).not.toContain("mt-auto flex justify-end border-t");
    expect(pageSrc).not.toContain("lg:h-[min(calc(100dvh-10rem),40rem)]");

    const headerBlock = pageSrc.slice(
      pageSrc.indexOf('data-testid="qc-inspect-selected-header"'),
      pageSrc.indexOf('data-testid="qc-inspect-selected-body"'),
    );
    expect(headerBlock).toContain('data-testid="qc-save-btn"');
    expect(headerBlock).toContain("Save Inspection");
    expect(headerBlock).toContain("{qcSaveInspectionStatus}");

    const bodyStart = pageSrc.indexOf('data-testid="qc-inspect-selected-body"');
    const bodyEnd = pageSrc.indexOf("{fromNoQtySo && focusSoIdValid && olderCycleHistoryRows.length > 0", bodyStart);
    const bodyBlock = pageSrc.slice(bodyStart, bodyEnd > bodyStart ? bodyEnd : bodyStart + 12000);
    expect(bodyBlock).toContain('data-testid="qc-rejection-details"');
    expect(bodyBlock).toContain("overflow-y-auto");
    expect(bodyBlock).not.toContain('data-testid="qc-save-btn"');
  });

  it("keeps Save disabled until valid and prevents duplicate submission", () => {
    expect(pageSrc).toContain("disabled={saving || !qcFormCanSubmit}");
    expect(pageSrc).toMatch(/async function onSubmit\(\)[\s\S]*?if \(saving\) return/);
    expect(pageSrc).toContain("qcFormCanSubmit");
  });

  it("wires decimal spinner/wheel guards on quantity inputs", () => {
    expect(pageSrc).toContain("blockDecimalSpinnerKeys");
    expect(pageSrc).toContain("blockDecimalWheel");
    expect(pageSrc).toContain('data-testid="qc-rejection-details"');
    expect(pageSrc).toContain("Save Inspection");
  });
});
