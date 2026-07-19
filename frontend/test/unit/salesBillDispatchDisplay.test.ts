import { describe, expect, it } from "vitest";
import { salesBillDispatchDetails, salesBillDispatchLabel } from "../../src/lib/salesBillDispatchDisplay";

describe("Sales Bill dispatch display", () => {
  it("shows the source number for one dispatch", () => {
    expect(salesBillDispatchLabel([{ dispatchId: 2, allocatedQty: "4", dispatch: { docNo: "D-26-0002" } }])).toBe("D-26-0002");
  });

  it("shows a count and every allocation for multiple dispatches", () => {
    const sources = [
      { dispatchId: 2, allocatedQty: "4", dispatch: { docNo: "D-26-0002" } },
      { dispatchId: 3, allocatedQty: "6", dispatch: { docNo: "D-26-0003" } },
    ];
    expect(salesBillDispatchLabel(sources)).toBe("2 Dispatches");
    expect(salesBillDispatchDetails(sources)).toEqual(["D-26-0002 (4 allocated)", "D-26-0003 (6 allocated)"]);
  });
});
