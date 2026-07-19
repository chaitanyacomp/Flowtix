import { describe, expect, it } from "vitest";
import { erpRefreshScopesForMutation } from "../../src/lib/erpRefresh";
import {
  aggregateSharedRmRequired,
  buildRmPreviewLinesSignature,
  isRequirementSheetRmPreviewPath,
  mergePlacementDraftQtys,
  resolveRmPreviewLines,
} from "../../src/lib/woPlanningRmPreview";

describe("woPlanningRmPreview — no continuous Updating RM loop", () => {
  it("builds a stable signature so unchanged quantities do not look like a new request", () => {
    const a = buildRmPreviewLinesSignature([
      { itemId: 2, qty: 3000 },
      { itemId: 1, qty: 5000 },
    ]);
    const b = buildRmPreviewLinesSignature([
      { itemId: 1, qty: 5000 },
      { itemId: 2, qty: 3000 },
    ]);
    expect(a).toBe(b);
    expect(a).toBe("1:5000|2:3000");
  });

  it("treats identical signatures as equal after rapid reordering (no refetch)", () => {
    const sig1 = buildRmPreviewLinesSignature([
      { itemId: 10, qty: 100 },
      { itemId: 20, qty: 50 },
    ]);
    const sig2 = buildRmPreviewLinesSignature([
      { itemId: 20, qty: 50 },
      { itemId: 10, qty: 100 },
    ]);
    expect(sig1).toBe(sig2);
  });

  it("prefers operator-entered quantities over suggested for preview lines", () => {
    const lines = resolveRmPreviewLines({
      requestedLines: [{ itemId: 1, qty: 1200 }],
      suggestedLines: [
        { itemId: 1, qty: 5000 },
        { itemId: 2, qty: 3000 },
      ],
    });
    expect(lines).toEqual([{ itemId: 1, qty: 1200 }]);
  });

  it("falls back to suggested lines only when no requested qty exists", () => {
    const lines = resolveRmPreviewLines({
      requestedLines: [],
      suggestedLines: [
        { itemId: 1, qty: 5000 },
        { itemId: 2, qty: 3000 },
      ],
    });
    expect(lines).toEqual([
      { itemId: 1, qty: 5000 },
      { itemId: 2, qty: 3000 },
    ]);
  });

  it("does not overwrite typed draft quantities when placement soft-refreshes", () => {
    const { next, changed } = mergePlacementDraftQtys({
      previous: { 1: "1200", 2: "3000" },
      lines: [
        { itemId: 1, suggestedExecutableQty: 5000 },
        { itemId: 2, suggestedExecutableQty: 3000 },
      ],
      formatQty: (n) => String(n),
    });
    expect(changed).toBe(false);
    expect(next[1]).toBe("1200");
    expect(next[2]).toBe("3000");
  });

  it("seeds only missing FG lines on first load / new line appearance", () => {
    const { next, changed } = mergePlacementDraftQtys({
      previous: { 1: "1200" },
      lines: [
        { itemId: 1, suggestedExecutableQty: 5000 },
        { itemId: 2, suggestedExecutableQty: 3000 },
      ],
      formatQty: (n) => String(n),
    });
    expect(changed).toBe(true);
    expect(next[1]).toBe("1200");
    expect(next[2]).toBe("3000");
  });

  it("aggregates shared RM required across two FG lines", () => {
    const map = aggregateSharedRmRequired([
      { rmItemId: 99, requiredQty: 40 },
      { rmItemId: 99, requiredQty: 58 },
      { rmItemId: 7, requiredQty: 10 },
    ]);
    expect(map.get(99)).toBe(98);
    expect(map.get(7)).toBe(10);
  });

  it("excludes execution/rm-preview from erp refresh mutation scopes (breaks the loop)", () => {
    expect(isRequirementSheetRmPreviewPath("/api/requirement-sheets/12/execution/rm-preview")).toBe(true);
    expect(erpRefreshScopesForMutation("/api/requirement-sheets/12/execution/rm-preview", "POST")).toEqual([]);
    expect(erpRefreshScopesForMutation("/api/requirement-sheets/12/create-wo", "POST")).toContain("requirement");
  });
});
