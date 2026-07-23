import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { timelineStepsForPhase } from "../../src/lib/rmGuidedWorkflow";
import {
  resolveStoreActionPrimaryPresentation,
  rmControlCenterCaseStatusLabel,
} from "../../src/lib/rmControlCenterReadinessUx";

const pageSource = readFileSync(
  resolve(__dirname, "../../src/pages/MaterialAvailabilityControlCenterPage.tsx"),
  "utf8",
);

describe("RM Control Center action uniqueness and placement", () => {
  it("maps CREATE_WO status chip to RM Ready (not Create Work Order CTA)", () => {
    expect(
      rmControlCenterCaseStatusLabel({
        storeActionKey: "CREATE_WO",
        storeActionLabel: "Create Work Order",
      }),
    ).toBe("RM Ready");
    expect(
      rmControlCenterCaseStatusLabel({
        storeActionKey: "AWAITING_PR",
        storeActionLabel: "Create Purchase Request",
      }),
    ).toBe("Awaiting PR");
  });

  it("emits exactly one Create Work Order primary presentation when RM Ready", () => {
    const ready = resolveStoreActionPrimaryPresentation({
      storeAction: { key: "CREATE_WO", label: "Create Work Order" },
      issueHref: "",
      grnHref: "/rm-po-grn",
      prepareWoHref: "/work-orders/prepare?salesOrderId=1&source=regular_so&from=rm-control-center",
    });
    expect(ready.kind).toBe("link");
    if (ready.kind === "link") {
      expect(ready.label).toBe("Create Work Order");
      expect(ready.href).toContain("/work-orders/prepare");
      expect(ready.href).not.toContain("/dashboard");
    }
    expect(rmControlCenterCaseStatusLabel({ storeActionKey: "CREATE_WO", storeActionLabel: "Create Work Order" })).not.toBe(
      "Create Work Order",
    );
  });

  it("places primary action block before secondary procurement nav in the page markup", () => {
    const primaryIdx = pageSource.indexOf('data-testid="rm-cc-primary-action"');
    const secondaryIdx = pageSource.indexOf('data-testid="rm-cc-secondary-nav"');
    expect(primaryIdx).toBeGreaterThan(-1);
    expect(secondaryIdx).toBeGreaterThan(-1);
    expect(primaryIdx).toBeLessThan(secondaryIdx);
    expect(pageSource).toContain("rm-cc-primary-action");
    expect(pageSource).toContain("rm-cc-actions-scroll");
    expect(pageSource).toContain("caseStatusChipLabel");
  });

  it("uses sticky primary action chrome so the CTA stays visible while the panel scrolls", () => {
    expect(pageSource).toContain("rm-cc-primary-action");
    const css = readFileSync(resolve(__dirname, "../../src/style.css"), "utf8");
    expect(css).toContain(".rm-cc-primary-action");
    expect(css).toMatch(/\.rm-cc-primary-action[\s\S]*sticky/);
  });
});

describe("RM Control Center GRN timeline wording", () => {
  it("shows GRN received when the GRN step is completed, not GRN pending ✓", () => {
    const completed = timelineStepsForPhase(4);
    const grnStep = completed.find((s) => s.done && (s.label.includes("GRN") || s.label.includes("grn")));
    expect(grnStep?.label).toBe("GRN received");
    expect(completed.some((s) => s.done && s.label === "GRN pending")).toBe(false);
    expect(completed.some((s) => s.active && s.label === "RM Ready")).toBe(true);
  });

  it("keeps GRN pending while receipt is still the active step", () => {
    const pending = timelineStepsForPhase(3);
    expect(pending[3]?.label).toBe("GRN pending");
    expect(pending[3]?.active).toBe(true);
    expect(pending[3]?.done).toBe(false);
  });
});
