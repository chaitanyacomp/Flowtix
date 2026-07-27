import { describe, expect, it } from "vitest";
import {
  normalizeRegularSoBufferFingerprint,
  regularSoBufferApprovalFingerprintsMatch,
  resolveRegularSoBufferApprovalUiStatus,
  sumRegularSoPlannedProductionQtyForBuffer,
  REGULAR_SO_BUFFER_APPROVAL_ACTION,
  resolveBufferApprovalIdFromAction,
} from "../../src/lib/regularSoBufferApprovalApi";
import {
  classifyRegularSoBufferPercent,
  clampRegularSoBufferPercent,
} from "../../src/lib/regularSoProductionPlanning";

describe("regularSoBufferApprovalApi — reload / fingerprint", () => {
  it("10% is allowed (requires admin); >10% blocked", () => {
    expect(classifyRegularSoBufferPercent(10)).toBe("REQUIRES_ADMIN_APPROVAL");
    expect(classifyRegularSoBufferPercent(10.0)).toBe("REQUIRES_ADMIN_APPROVAL");
    expect(classifyRegularSoBufferPercent(10.004)).toBe("REQUIRES_ADMIN_APPROVAL"); // rounds to 10.00
    expect(classifyRegularSoBufferPercent(10.01)).toBe("BLOCKED");
    expect(clampRegularSoBufferPercent(10)).toBe(10);
  });

  it("matches approved fingerprint after normalize (reload simulation)", () => {
    const approval = {
      bufferPercent: 10,
      plannedProductionQty: 1100,
      storeReason: "Scrap risk cover",
    };
    // Hydrated UI state after new Store login
    expect(
      regularSoBufferApprovalFingerprintsMatch(approval, {
        bufferPercent: clampRegularSoBufferPercent(10),
        plannedProductionQty: 1100,
        storeReason: "Scrap risk cover",
      }),
    ).toBe(true);
    // Blank reason before hydration must not match
    expect(
      regularSoBufferApprovalFingerprintsMatch(approval, {
        bufferPercent: 10,
        plannedProductionQty: 1100,
        storeReason: "",
      }),
    ).toBe(false);
  });

  it("SO-level planned qty sum matches multi-FG fingerprint", () => {
    const lines = [
      { customerCommittedQty: 1000 },
      { customerCommittedQty: 500 },
    ];
    // 1000*1.10=1100, 500*1.10=550 → 1650
    expect(sumRegularSoPlannedProductionQtyForBuffer(lines, 10)).toBe(1650);
    const approval = {
      bufferPercent: 10,
      plannedProductionQty: 1650,
      storeReason: "Need buffer",
    };
    expect(
      regularSoBufferApprovalFingerprintsMatch(approval, {
        bufferPercent: 10,
        plannedProductionQty: sumRegularSoPlannedProductionQtyForBuffer(lines, 10),
        storeReason: "Need buffer",
      }),
    ).toBe(true);
  });

  it("genuine buffer/reason/qty change invalidates approval match", () => {
    const approval = {
      bufferPercent: 10,
      plannedProductionQty: 1100,
      storeReason: "Scrap risk",
    };
    expect(
      regularSoBufferApprovalFingerprintsMatch(approval, {
        bufferPercent: 9,
        plannedProductionQty: 1100,
        storeReason: "Scrap risk",
      }),
    ).toBe(false);
    expect(
      regularSoBufferApprovalFingerprintsMatch(approval, {
        bufferPercent: 10,
        plannedProductionQty: 1100,
        storeReason: "Changed reason",
      }),
    ).toBe(false);
    expect(
      regularSoBufferApprovalFingerprintsMatch(approval, {
        bufferPercent: 10,
        plannedProductionQty: 1200,
        storeReason: "Scrap risk",
      }),
    ).toBe(false);
  });

  it("UI status stays approved during hydration; stale only after user edit mismatch", () => {
    const approval = {
      id: 1,
      status: "APPROVED" as const,
      bufferPercent: 10,
      plannedProductionQty: 1100,
      storeReason: "Scrap risk",
    };
    expect(
      resolveRegularSoBufferApprovalUiStatus({
        requiresAdmin: true,
        approval: approval as never,
        fingerprintMatches: false,
        hydrated: false,
        userEdited: false,
      }),
    ).toBe("approved");
    expect(
      resolveRegularSoBufferApprovalUiStatus({
        requiresAdmin: true,
        approval: approval as never,
        fingerprintMatches: true,
        hydrated: true,
        userEdited: false,
      }),
    ).toBe("approved");
    expect(
      resolveRegularSoBufferApprovalUiStatus({
        requiresAdmin: true,
        approval: approval as never,
        fingerprintMatches: false,
        hydrated: true,
        userEdited: true,
      }),
    ).toBe("stale");
  });

  it("normalize clamps percent and trims reason", () => {
    expect(
      normalizeRegularSoBufferFingerprint({
        bufferPercent: 10.004,
        plannedProductionQty: 1100.0004,
        storeReason: "  Scrap  ",
      }),
    ).toEqual({
      bufferPercent: 10,
      plannedProductionQty: 1100,
      storeReason: "Scrap",
    });
  });

  it("resolves bufferApprovalId and keeps action label", () => {
    expect(REGULAR_SO_BUFFER_APPROVAL_ACTION).toBe("Production Buffer Approval");
    expect(
      resolveBufferApprovalIdFromAction({
        metadata: { bufferApprovalId: 42 },
        href: "/pending-actions",
      }),
    ).toBe(42);
  });
});
