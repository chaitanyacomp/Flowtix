import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DispatchCurrentWorkbenchChrome } from "../../src/components/erp/dispatch/DispatchCurrentWorkbenchChrome";

describe("DispatchCurrentWorkbenchChrome", () => {
  it("renders KPI strip, collapsed allocation, single primary finalize, and guidance", () => {
    const html = renderToStaticMarkup(
      <DispatchCurrentWorkbenchChrome
        soBalance={1000}
        usableFg={900}
        dispatchingNow={82639}
        remainingAfter={917361}
        formatQty={(n) => String(n)}
        billingFallbackLabel="Draft — not billed yet"
        allocationSlices={[
          { cycleNo: 2, qty: 615 },
          { cycleNo: 3, qty: 82024 },
        ]}
        guidance={{ currentAction: "Dispatch draft ready", nextAction: "Finalize Dispatch" }}
        showFinalize
        showEditDraft
        showDiscard
        onFinalize={() => undefined}
        onEditDraft={() => undefined}
        onDiscard={() => undefined}
      >
        <div>Workbench body</div>
      </DispatchCurrentWorkbenchChrome>,
    );
    expect(html).toContain("dispatch-current-kpi-strip");
    expect(html).toContain("SO Balance");
    expect(html).toContain("Usable FG");
    expect(html).toContain("Dispatching Now");
    expect(html).toContain("Remaining After");
    expect(html).toContain("Billing Status");
    expect(html).toContain("Allocation Details");
    expect(html).toContain("Cycle 2");
    expect(html).toContain("615");
    expect(html).toContain("Finalize Dispatch");
    expect(html).toContain("Edit Draft Qty");
    expect(html).toContain("Discard Draft");
    expect(html).toContain("View Allocation");
    expect(html).toContain("Current Action");
    expect(html).toContain("Next Action");
    expect(html).toContain("Workbench body");
  });

  it("renders header qty actions in the KPI strip when provided", () => {
    const html = renderToStaticMarkup(
      <DispatchCurrentWorkbenchChrome
        soBalance={100}
        usableFg={80}
        dispatchingNow={20}
        remainingAfter={80}
        formatQty={(n) => String(n)}
        guidance={{ currentAction: "Enter qty", nextAction: "Save Draft Qty" }}
        headerActions={<div data-testid="dispatch-qty-header-entry">Qty entry</div>}
      />,
    );
    expect(html).toContain("dispatch-current-header-actions");
    expect(html).toContain("dispatch-qty-header-entry");
    expect(html.indexOf("dispatch-current-kpi-strip")).toBeLessThan(html.indexOf("dispatch-qty-header-entry"));
  });
});
