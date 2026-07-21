import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("DispatchPage Save Draft Qty header + transition contract", () => {
  const pageSrc = readFileSync(resolve(__dirname, "../../src/pages/DispatchPage.tsx"), "utf8");

  it("places Dispatch Qty and Save Draft Qty in Current Dispatch KPI header for NO_QTY", () => {
    expect(pageSrc).toContain('data-testid="dispatch-qty-header-entry"');
    expect(pageSrc).toContain("headerActions=");
    expect(pageSrc).toContain("resolveDispatchDraftSaveBusyLabel");
    expect(pageSrc).toContain("blockDecimalSpinnerKeys");
    expect(pageSrc).toContain("blockDecimalWheel");

    const headerEntry = pageSrc.slice(
      pageSrc.indexOf('data-testid="dispatch-qty-header-entry"'),
      pageSrc.indexOf('data-testid="dispatch-preparing-gate"'),
    );
    expect(headerEntry).toContain('data-testid="dispatch-qty-input"');
    expect(headerEntry).toContain('data-testid="prepare-dispatch-btn"');
    expect(headerEntry).toContain('data-testid="dispatch-qty-clear-btn"');
    expect(headerEntry).toContain("text-right");
  });

  it("does not keep a bottom duplicate Save Draft Qty for NO_QTY entry body", () => {
    // Bottom Clear-only mobile strip removed; Save lives in header entry.
    expect(pageSrc).not.toContain("mt-1 flex justify-end sm:hidden");
    const noQtyBodyStart = pageSrc.indexOf("return <OperationalDispatchSnapshot metrics={metrics} showFlowHint={false} compact />");
    expect(noQtyBodyStart).toBeGreaterThan(0);
    const afterSnapshot = pageSrc.slice(noQtyBodyStart, noQtyBodyStart + 2500);
    expect(afterSnapshot).not.toContain('data-testid="prepare-dispatch-btn"');
    expect(afterSnapshot).not.toContain('data-testid="dispatch-qty-input"');
  });

  it("uses a single parallel refresh and defers liveTick bump during Save Draft", () => {
    expect(pageSrc).toContain("shouldPreserveDispatchSelectionWithOpenDraft");
    expect(pageSrc).toContain("shouldDeferErpRefreshUntilAfterDraftSaveSettle");
    expect(pageSrc).toContain("suppressLiveReloadRef");
    expect(pageSrc).toContain("draftSaveSettling");
    expect(pageSrc).toContain("await Promise.all([loadSalesOrders(), loadLedger()])");
    expect(pageSrc).toContain('data-testid="dispatch-preparing-gate"');
    expect(pageSrc).toContain("Preparing dispatch…");
    // Must not bump then immediately await the same fetches (classic double-refresh flicker).
    expect(pageSrc).not.toMatch(
      /bumpErpRefresh\(\["dispatch", "dashboard", "pending-actions", "stock"\]\);\s*await loadSalesOrders\(\);\s*await loadLedger\(\);/,
    );
  });

  it("guards double submit and preserves qty on failure", () => {
    expect(pageSrc).toContain("if (dispatchSubmitLockRef.current || dispatching) return");
    expect(pageSrc).toContain("if (preservedQtyStr !== \"\") setDispatchQtyStr(preservedQtyStr)");
    expect(pageSrc).toContain("disabled={!canNoQtyDispatchNow || dispatching || draftSaveSettling}");
  });
});
