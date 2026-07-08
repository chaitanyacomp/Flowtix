import { describe, expect, it } from "vitest";

import {
  displayMaterialIssueNo,
  displayMaterialRequirementNo,
  displayPmrNo,
  displayProductionEntryNo,
  displayQcEntryNo,
  displaySalesOrderNo,
  displayWorkOrderNo,
  displayWorkOrderTraceNo,
} from "../../src/lib/docNoDisplay";

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

describe("manufacturing document identity helpers", () => {
  it("prefers API docNo for all manufacturing document types", () => {
    expect(displaySalesOrderNo(5, "SO-26-0001")).toBe("SO-26-0001");
    expect(displayPmrNo(12, "PMR-26-0004")).toBe("PMR-26-0004");
    expect(displayMaterialRequirementNo(3, "MR-26-0002")).toBe("MR-26-0002");
    expect(displayMaterialIssueNo(7, "MIN-26-0009")).toBe("MIN-26-0009");
    expect(displayProductionEntryNo(44, "PE-26-0011")).toBe("PE-26-0011");
    expect(displayQcEntryNo(9, "QC-26-0007")).toBe("QC-26-0007");
  });

  it("falls back to padded legacy labels when docNo is absent", () => {
    expect(displayPmrNo(12, null)).toBe("PMR-012");
    expect(displayMaterialIssueNo(7, null)).toBe("MIN-007");
    expect(displayProductionEntryNo(44, null)).toBe("PE-044");
    expect(displayQcEntryNo(9, null)).toBe("QC-009");
  });
});
