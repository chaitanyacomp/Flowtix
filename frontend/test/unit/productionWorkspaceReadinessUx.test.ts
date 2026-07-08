import { describe, expect, it } from "vitest";
import {
  buildReadinessSeedFromQueueRow,
  canShowReadyToProduceLabel,
  classifyProductionQueueBucketFromBackend,
  deriveConciseRmLabelFromQueueRow,
  isQueueReadyToStart,
  isQueueRmGateBlocked,
} from "../../src/lib/productionWorkspaceReadinessUx";

const baseRow = {
  workOrderId: 1,
  workOrderNo: "WO-1",
  workOrderLineId: 10,
  itemName: "Cap",
  requiredQty: 100,
  producedQty: 0,
  balanceQty: 100,
  nextAction: "PRODUCTION_PENDING",
};

describe("productionWorkspaceReadinessUx", () => {
  it("never classifies readyToStart when backend RM gate is blocked", () => {
    const blocked = {
      ...baseRow,
      rmReadinessGate: "WAITING_STORE_ISSUE",
      rmReadyForProduction: false,
      rmProductionAllowedNowQty: 0,
    };
    expect(isQueueReadyToStart(blocked)).toBe(false);
    expect(classifyProductionQueueBucketFromBackend(blocked)).toBeNull();
    expect(canShowReadyToProduceLabel(blocked)).toBe(false);
  });

  it("classifies readyToStart when backend RM gate allows production", () => {
    const ready = {
      ...baseRow,
      rmReadinessGate: "READY_FOR_PRODUCTION",
      rmReadyForProduction: true,
      rmProductionAllowedNowQty: 100,
    };
    expect(isQueueReadyToStart(ready)).toBe(true);
    expect(classifyProductionQueueBucketFromBackend(ready)).toBe("readyToStart");
    expect(canShowReadyToProduceLabel(ready)).toBe(true);
  });

  it("maps queue row to concise RM label from backend gate only", () => {
    expect(
      deriveConciseRmLabelFromQueueRow({
        ...baseRow,
        rmReadinessGate: "READY_FOR_PRODUCTION",
        rmReadyForProduction: true,
        rmProductionAllowedNowQty: 50,
      }),
    ).toBe("READY");
    expect(
      deriveConciseRmLabelFromQueueRow({
        ...baseRow,
        rmReadinessGate: "WAITING_STORE_ISSUE",
        rmReadyForProduction: false,
      }),
    ).toBe("WAITING RM");
  });

  it("builds RM strip seed from queue row without re-deriving gate", () => {
    const seed = buildReadinessSeedFromQueueRow({
      ...baseRow,
      rmReadinessGate: "READY_FOR_PRODUCTION",
      rmReadyForProduction: true,
      rmProductionAllowedNowQty: 75,
      itemUnit: "Nos",
    });
    expect(seed?.gate).toBe("READY_FOR_PRODUCTION");
    expect(seed?.productionAllowedNowQty).toBe(75);
    expect(seed?.workOrderLineId).toBe(10);
    expect(isQueueRmGateBlocked({ rmReadinessGate: seed?.gate, rmReadyForProduction: true })).toBe(false);
  });
});
