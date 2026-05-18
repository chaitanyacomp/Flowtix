import { describe, expect, it } from "vitest";

import { displayWorkOrderNo, displayWorkOrderTraceNo } from "../../src/lib/docNoDisplay";

describe("displayWorkOrderTraceNo", () => {
  it("always uses database id for operational traceability", () => {
    expect(displayWorkOrderTraceNo(167)).toBe("WO-167");
    expect(displayWorkOrderTraceNo(168)).toBe("WO-168");
    expect(displayWorkOrderTraceNo(170)).toBe("WO-170");
  });

  it("does not use PREFIX-YY docNo even when passed to displayWorkOrderNo", () => {
    expect(displayWorkOrderNo(169, "WO-26-0003")).toBe("WO-26-0003");
    expect(displayWorkOrderTraceNo(169)).toBe("WO-169");
  });
});
