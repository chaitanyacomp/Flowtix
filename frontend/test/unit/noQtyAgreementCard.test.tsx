import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { NoQtyAgreementCard } from "../../src/components/erp/sales/NoQtyAgreementCard";

describe("NoQtyAgreementCard", () => {
  it("renders compact cycle and next RS status without table columns", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <NoQtyAgreementCard
          salesOrderId={1}
          docNo="SO-26-0001"
          customerName="Abhishek"
          agreementStatus="OPEN"
          currentCycleNo={1}
          currentStage="Work Order Pending"
          currentRsStatus="Locked"
          nextCycleNo={2}
          nextRsEligible={true}
        />
      </MemoryRouter>,
    );
    expect(html).toContain("SO-26-0001");
    expect(html).toContain("Abhishek");
    expect(html).toContain("Current Cycle");
    expect(html).toContain("Next RS");
    expect(html).toContain("Ready");
    expect(html).not.toContain("Blocked");
    expect(html).not.toContain("min-w-[1000px]");
  });
});
