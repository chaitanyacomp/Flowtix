import { describe, expect, it } from "vitest";

import {

  collectPreparedDispatchIdsFromPrepResponse,

  DISPATCH_DRAFT_DELETE_CONFIRM_MESSAGE,

  dispatchFullTargetQty,

  dispatchPrepareQtyCap,

  findOldestUnlockedDraft,

  formatDispatchCompactQty,

  headroomAfterDraftDelete,

  isDispatchCompactExecutionMode,

  resolveCompactDispatchSelection,

  resolvePostCompactDispatchQueueRow,

  shouldIncludeCompactQueueRow,

  sumDispatchCompactQueueQty,

  sumUnlockedDraftQtyForItem,

  buildCompactDispatchHistoryRows,

  buildDispatchSoCompleteMessage,

  formatCompactDispatchHistoryDate,

  sumCompactDispatchHistoryFinalizedQty,

  shouldSkipDispatchPrepareAsDuplicate,
  resolveDispatchFullPrepareAction,
  canCompactDispatchFull,
  isCompactDraftSavedIdleState,
  DISPATCH_FINALIZE_API_SUFFIX,

  type DispatchCompactQueueRow,

} from "../../src/lib/dispatchWorkspaceUx";

function compactQueueRow(
  row: Pick<DispatchCompactQueueRow, "lineId" | "itemId" | "itemName" | "readyQty"> &
    Partial<DispatchCompactQueueRow>,
): DispatchCompactQueueRow {
  return {
    draftQty: 0,
    dispatchedQty: 0,
    originalReadyQty: row.readyQty,
    statusLabel: "Ready",
    ...row,
  };
}



describe("dispatchWorkspaceUx", () => {

  it("detects compact mode from pending-actions source", () => {

    expect(isDispatchCompactExecutionMode("pending-actions", "")).toBe(true);

    expect(isDispatchCompactExecutionMode("", "pending-actions")).toBe(true);

    expect(isDispatchCompactExecutionMode("dashboard", "")).toBe(false);

  });



  it("formats compact qty as integer when whole", () => {

    expect(formatDispatchCompactQty(9593)).toBe("9593");

    expect(formatDispatchCompactQty(40.5)).toBe("40.5");

  });



  it("sums queue ready qty", () => {

    expect(

      sumDispatchCompactQueueQty([

        { lineId: 1, itemId: 10, itemName: "A", readyQty: 2000 },

        { lineId: 2, itemId: 11, itemName: "B", readyQty: 2448 },

      ]),

    ).toBe(4448);

  });



  it("advances FIFO after full dispatch", () => {

    const queue = [

      { lineId: 1, itemId: 10, itemName: "A", readyQty: 2000 },

      { lineId: 2, itemId: 11, itemName: "B", readyQty: 2448 },

    ];

    expect(

      resolvePostCompactDispatchQueueRow({ queue, dispatchedItemId: 10, sameItemRemainingQty: 0 }),

    ).toMatchObject({ itemId: 11 });

    expect(

      resolvePostCompactDispatchQueueRow({ queue, dispatchedItemId: 11, sameItemRemainingQty: 0 }),

    ).toBeNull();

  });



  it("stays on same item after partial dispatch", () => {

    const queue = [

      { lineId: 1, itemId: 10, itemName: "A", readyQty: 500 },

      { lineId: 2, itemId: 11, itemName: "B", readyQty: 2448 },

    ];

    expect(

      resolvePostCompactDispatchQueueRow({ queue, dispatchedItemId: 10, sameItemRemainingQty: 500 }),

    ).toMatchObject({ itemId: 10 });

  });



  it("collects draft ids from prepare response", () => {

    expect(

      collectPreparedDispatchIdsFromPrepResponse({

        dispatch: { id: 5 },

        dispatches: [{ id: 5 }, { id: 6 }],

      }),

    ).toEqual([5, 6]);

  });



  it("queue rows are FG item level without WO identifiers", () => {

    const queue = [

      { lineId: 1, itemId: 10, itemName: "Dummy Plug", readyQty: 1993 },

      { lineId: 2, itemId: 11, itemName: "PVC Angle", readyQty: 2445 },

    ];

    for (const row of queue) {

      expect(row).not.toHaveProperty("workOrderId");

      expect(row).not.toHaveProperty("workOrderNo");

      expect(row).not.toHaveProperty("cycleNo");

    }

    expect(sumDispatchCompactQueueQty(queue)).toBe(4438);

  });



  it("returns null when final FG item is fully dispatched and queue empties", () => {

    expect(

      resolvePostCompactDispatchQueueRow({

        queue: [],

        dispatchedItemId: 13,

        sameItemRemainingQty: 0,

      }),

    ).toBeNull();

  });



  it("partial dispatch on last item stays on same row until balance clears", () => {

    const queue = [{ lineId: 4, itemId: 13, itemName: "Square Box", readyQty: 500 }];

    expect(

      resolvePostCompactDispatchQueueRow({ queue, dispatchedItemId: 13, sameItemRemainingQty: 500 }),

    ).toMatchObject({ itemId: 13, readyQty: 500 });

    expect(

      resolvePostCompactDispatchQueueRow({ queue, dispatchedItemId: 13, sameItemRemainingQty: 0 }),

    ).toBeNull();

  });



  it("uses standard delete draft confirmation copy", () => {

    expect(DISPATCH_DRAFT_DELETE_CONFIRM_MESSAGE).toContain("Delete this dispatch draft?");

    expect(DISPATCH_DRAFT_DELETE_CONFIRM_MESSAGE).toContain("restore the dispatch quantity");

  });



  it("keeps queue row visible when only an open draft exists", () => {

    expect(shouldIncludeCompactQueueRow(0, 3000)).toBe(true);

  });



  it("restores headroom after draft delete", () => {

    expect(headroomAfterDraftDelete(500, 1500)).toBe(2000);

  });



  it("finds oldest unlocked draft for resume", () => {

    const draft = findOldestUnlockedDraft([

      { id: 12, itemId: 10, dispatchedQty: 500, workflowStatus: "UNLOCKED" },

      { id: 9, itemId: 11, dispatchedQty: 800, workflowStatus: "UNLOCKED" },

      { id: 15, itemId: 10, dispatchedQty: 200, workflowStatus: "LOCKED" },

    ]);

    expect(draft).toMatchObject({ id: 9, itemId: 11 });

  });



  it("sums unlocked draft qty per FG item", () => {

    expect(

      sumUnlockedDraftQtyForItem(

        [

          { id: 1, itemId: 13, dispatchedQty: 1000, workflowStatus: "UNLOCKED" },

          { id: 2, itemId: 13, dispatchedQty: 500, workflowStatus: "UNLOCKED" },

          { id: 3, itemId: 13, dispatchedQty: 200, workflowStatus: "LOCKED" },

        ],

        13,

      ),

    ).toBe(1500);

  });



  it("resolveCompactDispatchSelection keeps active item when still in queue", () => {

    const queue = [

      { lineId: 1, itemId: 10, itemName: "PVC Angle", readyQty: 2445 },

      { lineId: 2, itemId: 11, itemName: "Round Plate", readyQty: 2653 },

    ];

    expect(

      resolveCompactDispatchSelection({ queue, activeItemId: 11 }),

    ).toMatchObject({ itemId: 11 });

  });



  it("resolveCompactDispatchSelection picks oldest draft when active item gone", () => {

    const queue = [

      { lineId: 1, itemId: 10, itemName: "PVC Angle", readyQty: 2445 },

      { lineId: 2, itemId: 11, itemName: "Round Plate", readyQty: 500, hasOpenDraft: true },

    ];

    expect(

      resolveCompactDispatchSelection({

        queue,

        activeItemId: 99,

        drafts: [{ id: 5, itemId: 11, dispatchedQty: 500, workflowStatus: "UNLOCKED" }],

      }),

    ).toMatchObject({ itemId: 11 });

  });



  it("resolveCompactDispatchSelection defaults to first FIFO row", () => {

    const queue = [

      { lineId: 1, itemId: 10, itemName: "PVC Angle", readyQty: 2445 },

      { lineId: 2, itemId: 11, itemName: "Round Plate", readyQty: 2653 },

    ];

    expect(resolveCompactDispatchSelection({ queue, activeItemId: null })).toMatchObject({ itemId: 10 });

  });



  it("dispatchPrepareQtyCap treats open draft as replaceable headroom", () => {

    expect(

      dispatchPrepareQtyCap({ existingDraftQty: 2445, headroomToPrepare: 0, usableStockCap: 2445 }),

    ).toBe(2445);

    expect(dispatchPrepareQtyCap({ existingDraftQty: 1000, headroomToPrepare: 500 })).toBe(1500);

  });



  it("dispatchFullTargetQty equals total dispatchable with open draft", () => {

    expect(dispatchFullTargetQty({ existingDraftQty: 2445, headroomToPrepare: 0 })).toBe(2445);

  });



  it("shouldSkipDispatchPrepareAsDuplicate when qty matches open draft", () => {

    expect(shouldSkipDispatchPrepareAsDuplicate({ existingDraftQty: 2445, dispatchQty: 2445 })).toBe(true);

    expect(shouldSkipDispatchPrepareAsDuplicate({ existingDraftQty: 2445, dispatchQty: 2000 })).toBe(false);

    expect(shouldSkipDispatchPrepareAsDuplicate({ existingDraftQty: 0, dispatchQty: 2445 })).toBe(false);

  });



  it("resolveDispatchFullPrepareAction prepares once then skips duplicate full draft", () => {

    expect(

      resolveDispatchFullPrepareAction({ existingDraftQty: 0, headroomToPrepare: 2445 }),

    ).toBe("prepare");

    expect(

      resolveDispatchFullPrepareAction({ existingDraftQty: 2445, headroomToPrepare: 0 }),

    ).toBe("skip_duplicate");

    expect(

      resolveDispatchFullPrepareAction({ existingDraftQty: 1000, headroomToPrepare: 500 }),

    ).toBe("prepare");

  });



  it("canCompactDispatchFull disables when ready qty is zero and draft matches input", () => {

    expect(

      canCompactDispatchFull({

        headroomToPrepare: 0,

        existingDraftQty: 2445,

        dispatchQty: 2445,

        dispatchQtyValid: true,

      }),

    ).toBe(false);

    expect(

      canCompactDispatchFull({

        headroomToPrepare: 0,

        existingDraftQty: 2445,

        dispatchQty: 2000,

        dispatchQtyValid: true,

      }),

    ).toBe(true);

    expect(

      canCompactDispatchFull({

        headroomToPrepare: 500,

        existingDraftQty: 0,

        dispatchQty: 500,

        dispatchQtyValid: true,

      }),

    ).toBe(true);

  });



  it("isCompactDraftSavedIdleState after full draft save with zero ready qty", () => {

    expect(

      isCompactDraftSavedIdleState({

        hasOpenDraft: true,

        headroomToPrepare: 0,

        existingDraftQty: 2445,

        dispatchQty: 2445,

        dispatchQtyValid: true,

      }),

    ).toBe(true);

    expect(

      isCompactDraftSavedIdleState({

        hasOpenDraft: true,

        headroomToPrepare: 0,

        existingDraftQty: 2445,

        dispatchQty: 2000,

        dispatchQtyValid: true,

      }),

    ).toBe(false);

  });



  it("finalize uses lock endpoint not draft prepare", () => {

    expect(DISPATCH_FINALIZE_API_SUFFIX).toBe("/lock");

    expect(resolveDispatchFullPrepareAction({ existingDraftQty: 2445, headroomToPrepare: 0 })).not.toBe("prepare");

  });



  it("builds dispatch history rows in chronological dispatch sequence", () => {

    const rows = buildCompactDispatchHistoryRows([

      {

        id: 2,

        docNo: "DC-002",

        date: "2026-07-01T12:00:00.000Z",

        itemName: "PVC Angle",

        dispatchedQty: 2445,

        reversalOfId: null,

        workflowStatus: "LOCKED",

      },

      {

        id: 1,

        docNo: "DC-001",

        date: "2026-07-01T08:00:00.000Z",

        itemName: "Dummy Plug",

        dispatchedQty: 1993,

        reversalOfId: null,

        workflowStatus: "LOCKED",

      },

    ]);

    expect(rows.map((r) => r.id)).toEqual([1, 2]);

    expect(rows[0]).toMatchObject({ statusLabel: "Finalized", qty: 1993 });

    expect(rows[1]).toMatchObject({ statusLabel: "Finalized", qty: 2445 });

  });



  it("excludes reversal rows and sums finalized qty only", () => {

    const rows = buildCompactDispatchHistoryRows([

      {

        id: 1,

        docNo: "DC-001",

        date: "2026-07-01T08:00:00.000Z",

        itemName: "Dummy Plug",

        dispatchedQty: 1000,

        reversalOfId: null,

        workflowStatus: "LOCKED",

      },

      {

        id: 2,

        docNo: "DC-002",

        date: "2026-07-01T09:00:00.000Z",

        itemName: "Dummy Plug",

        dispatchedQty: 993,

        reversalOfId: null,

        workflowStatus: "LOCKED",

      },

      {

        id: 3,

        docNo: null,

        date: "2026-07-02T08:00:00.000Z",

        itemName: "Dummy Plug",

        dispatchedQty: 1000,

        reversalOfId: 1,

        workflowStatus: "LOCKED",

      },

      {

        id: 4,

        docNo: "DC-004",

        date: "2026-07-03T08:00:00.000Z",

        itemName: "Round Plate",

        dispatchedQty: 50,

        reversalOfId: null,

        workflowStatus: "UNLOCKED",

      },

    ]);

    expect(rows).toHaveLength(3);

    expect(sumCompactDispatchHistoryFinalizedQty(rows)).toBe(1993);

  });



  it("formats compact dispatch history dates as dd-Mon", () => {

    expect(formatCompactDispatchHistoryDate("2026-07-01T00:00:00.000Z")).toBe("01-Jul");

  });



  it("builds SO complete message with sales order label", () => {

    expect(buildDispatchSoCompleteMessage("SO-26-0001")).toBe(

      "✓ All dispatches for Sales Order SO-26-0001 have been completed.",

    );

  });

});

