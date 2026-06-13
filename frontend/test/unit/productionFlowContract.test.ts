import { describe, expect, it } from "vitest";
import {
  parseProductionFlowParam,
  validateProductionFlowVsOrderType,
  PRODUCTION_FLOW_NO_QTY,
  PRODUCTION_FLOW_REGULAR,
  appendProductionFlowToHref,
} from "../../src/lib/productionFlowContract";
import {
  formatNoQtyNextRsBlockReason,
  presentNoQtyNextRsStatus,
} from "../../src/lib/noQtyNextRsBlockerPresentation";

describe("productionFlowContract", () => {
  it("parses explicit flow params", () => {
    expect(parseProductionFlowParam("NO_QTY")).toBe(PRODUCTION_FLOW_NO_QTY);
    expect(parseProductionFlowParam("REGULAR_SO")).toBe(PRODUCTION_FLOW_REGULAR);
    expect(parseProductionFlowParam("regular")).toBe(PRODUCTION_FLOW_REGULAR);
  });

  it("rejects flow vs order type mismatch", () => {
    const v = validateProductionFlowVsOrderType(PRODUCTION_FLOW_REGULAR, "NO_QTY");
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.message).toMatch(/NO_QTY agreement/);
  });

  it("appends flow to href", () => {
    expect(appendProductionFlowToHref("/production?workOrderId=1", PRODUCTION_FLOW_REGULAR)).toContain(
      "flow=REGULAR_SO",
    );
  });
});

describe("noQtyNextRsBlockerPresentation", () => {
  it("maps draft RS block reason without execution-stage wording", () => {
    const msg = formatNoQtyNextRsBlockReason({
      reason: "DRAFT_RS_ON_CYCLE",
    });
    expect(msg).toMatch(/not locked/i);
    expect(msg).not.toMatch(/RM Issue/i);
  });

  it("always presents blocked status", () => {
    const s = presentNoQtyNextRsStatus({
      eligible: false,
      reason: "NO_LOCKED_RS",
    });
    expect(s.canCreate).toBe(false);
    expect(s.reason).toMatch(/not locked/i);
  });
});
