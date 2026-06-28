import { describe, expect, it } from "vitest";
import {
  filterExecutableProductionLines,
  pickFirstExecutableProductionLine,
  sortProductionLinesFifo,
} from "../../src/lib/productionWorkspaceQueue";

describe("productionWorkspaceQueue", () => {
  it("sorts lines FIFO by work order then line id", () => {
    const sorted = sortProductionLinesFifo([
      { id: 20, workOrderId: 5, remainingQty: 100 },
      { id: 10, workOrderId: 2, remainingQty: 50 },
      { id: 11, workOrderId: 5, remainingQty: 80 },
    ]);
    expect(sorted.map((l) => l.id)).toEqual([10, 11, 20]);
  });

  it("picks first executable line and skips QC-only rows", () => {
    const pick = pickFirstExecutableProductionLine([
      { id: 1, workOrderId: 1, remainingQty: 0, qcPendingQty: 5 },
      { id: 2, workOrderId: 2, remainingQty: 120 },
      { id: 3, workOrderId: 3, remainingQty: 80 },
    ]);
    expect(pick?.id).toBe(2);
    expect(filterExecutableProductionLines([{ id: 1, workOrderId: 1, remainingQty: 0, qcPendingQty: 5 }])).toEqual([]);
  });
});
