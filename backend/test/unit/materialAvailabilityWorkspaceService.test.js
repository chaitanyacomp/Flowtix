const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  buildMaterialAvailabilityWorkspace,
  deriveCaseStoreAction,
  deriveLineBlocker,
  deriveRecommendedAction,
  assessPostGrnCreateWoEligibility,
} = require("../../src/services/materialAvailabilityWorkspaceService");

function availabilityLine(itemId, overrides = {}) {
  const requiredQty = overrides.requiredQty ?? 100;
  const physicalUsableStockQty = overrides.physicalUsableStockQty ?? 0;
  const legacyReservedQty = overrides.legacyReservedQty ?? 0;
  const freeStockQty = overrides.freeStockQty ?? Math.max(0, physicalUsableStockQty - legacyReservedQty);
  const incomingQty = overrides.incomingQty ?? 0;
  const issuedToProductionQty = overrides.issuedToProductionQty ?? 0;
  const shortageNowQty = Math.max(0, requiredQty - physicalUsableStockQty);
  const shortageAfterReservationQty =
    overrides.shortageAfterReservationQty ?? Math.max(0, requiredQty - freeStockQty);
  const coveredByIncomingQty = overrides.coveredByIncomingQty ?? Math.min(shortageAfterReservationQty, incomingQty);
  const netShortageAfterIncomingQty =
    overrides.netShortageAfterIncomingQty ?? Math.max(0, shortageAfterReservationQty - incomingQty);
  return {
    itemId,
    requiredQty,
    physicalUsableStockQty,
    legacyReservedQty,
    freeStockQty,
    incomingQty,
    issuedToProductionQty,
    shortageNowQty,
    shortageAfterReservationQty,
    coveredByIncomingQty,
    netShortageAfterIncomingQty,
    warnings: overrides.warnings || [],
  };
}

function makeWorkOrder(id, rmItemId, fgName = `FG ${id}`) {
  return {
    id,
    docNo: `WO-${id}`,
    status: "PENDING",
    holdReason: null,
    salesOrderId: id,
    salesOrder: {
      id,
      docNo: `SO-${id}`,
      orderType: "NORMAL",
      internalStatus: "APPROVED",
      customer: { name: `Customer ${id}` },
    },
    lines: [
      {
        id: id * 10,
        fgItemId: 1000 + rmItemId,
        qty: 10,
        plannedQty: 10,
        fgItem: { id: 1000 + rmItemId, itemName: fgName, unit: "Nos" },
      },
    ],
    _rmItemId: rmItemId,
  };
}

function createMockDb() {
  const workOrders = [
    makeWorkOrder(1, 10, "Blocked FG"),
    makeWorkOrder(2, 20, "Partial FG"),
    makeWorkOrder(3, 30, "Incoming FG"),
    makeWorkOrder(4, 40, "Reserved FG"),
    makeWorkOrder(5, 50, "Production Stock FG"),
    makeWorkOrder(6, 60, "PMR FG"),
    makeWorkOrder(7, 70, "Ready Issue FG"),
  ];

  const rmItems = [10, 20, 30, 40, 50, 60, 70, 80].map((id) => ({
    id,
    itemName: `RM ${id}`,
    unit: "KG",
    itemType: "RM",
  }));

  return {
    workOrder: {
      findMany: async (query) => {
        let rows = workOrders;
        if (query.where.id) rows = rows.filter((wo) => wo.id === query.where.id);
        if (query.where.salesOrderId) rows = rows.filter((wo) => wo.salesOrderId === query.where.salesOrderId);
        return rows;
      },
    },
    salesOrder: {
      findMany: async (query) => {
        if (query.where.id !== 81) return [];
        return [
          {
            id: 81,
            docNo: "SO-81",
            orderType: "NORMAL",
            internalStatus: "APPROVED",
            customer: { name: "Customer 81" },
            lines: [
              {
                id: 810,
                itemId: 1080,
                qty: 10,
                item: { id: 1080, itemName: "FG 81", itemType: "FG", unit: "Nos" },
              },
            ],
          },
        ];
      },
    },
    productionMaterialRequest: {
      findMany: async () => [
        {
          id: 601,
          docNo: "PMR-601",
          workOrderId: 6,
          status: "REQUESTED",
          requestedAt: new Date("2026-05-01T00:00:00Z"),
          lines: [
            {
              itemId: 60,
              requiredQty: 100,
              issuedQty: 0,
              item: { id: 60, itemName: "RM 60", unit: "KG" },
            },
          ],
        },
      ],
    },
    materialRequirement: {
      findMany: async () => [],
    },
    item: {
      findMany: async (query) => rmItems.filter((item) => query.where.id.in.includes(item.id)),
    },
    materialRequirementLine: {
      findMany: async (query) => {
        const rmItemId = query.where.rmItemId;
        if (rmItemId !== 30 && rmItemId !== 40) return [];
        return [
          {
            id: 3001 + rmItemId,
            materialRequirementId: 700 + rmItemId,
            rmItemId,
            requiredQty: 100,
            shortageQty: 100,
            procuredQty: rmItemId === 30 ? 100 : 0,
            rmItem: { id: rmItemId, itemName: `RM ${rmItemId}`, unit: "KG" },
            materialRequirement: {
              id: 700 + rmItemId,
              docNo: `MR-${rmItemId}`,
              status: "DRAFT",
              sourceType: "WORK_ORDER_PLANNING",
              salesOrderId: rmItemId,
              salesOrder: { id: rmItemId, docNo: `SO-${rmItemId}` },
              quotation: null,
            },
            purchaseRequestSourceLinks:
              rmItemId === 40
                ? []
                : [
                    {
                      purchaseRequestLine: {
                        id: 8001,
                        requiredQty: 100,
                        netRequiredQty: 100,
                        orderedQty: 100,
                        purchaseRequest: { id: 800, docNo: "PR-800", status: "ORDERED" },
                      },
                    },
                  ],
          },
        ];
      },
    },
    rmPurchaseOrderLine: {
      findMany: async (query) => {
        const rmItemId = query.where.itemId;
        if (rmItemId !== 30) return [];
        return [
          {
            id: 9001,
            rmPoId: 900,
            itemId: 30,
            qty: 100,
            item: { id: 30, itemName: "RM 30", unit: "KG" },
            rmPo: { id: 900, docNo: "RMPO-900", status: "PENDING", supplier: { id: 1, name: "Supplier A" } },
            grnLines: [{ receivedQty: 40, grn: { id: 901, date: new Date("2026-05-02T00:00:00Z"), reversedAt: null } }],
            procurementLinks: [
              {
                purchaseRequestLine: {
                  purchaseRequest: { id: 800, docNo: "PR-800", status: "ORDERED" },
                },
              },
            ],
          },
        ];
      },
    },
  };
}

function planningViewForSo(soId, fgItemId, plannedProductionQty) {
  return {
    salesOrderId: soId,
    bufferPercent: 0,
    lines: [
      {
        lineId: soId * 10,
        fgItemId,
        fgName: `FG ${soId}`,
        plannedProductionQty,
        rmPlanningQty: plannedProductionQty,
        toProduce: plannedProductionQty,
      },
    ],
  };
}

function createDeps() {
  const demandByFgItemId = new Map([
    [1010, 10],
    [1020, 20],
    [1030, 30],
    [1040, 40],
    [1050, 50],
    [1060, 60],
    [1070, 70],
    [1080, 80],
  ]);
  const plannedQtyByFgItemId = new Map([
    [1080, 10],
  ]);

  return {
    buildRegularSoPlanningSnapshotView: async (soId) => {
      const fgItemId = 1000 + (soId === 81 ? 80 : soId);
      const planned =
        plannedQtyByFgItemId.get(fgItemId) ??
        (soId === 81 ? 10 : 10);
      return planningViewForSo(soId, soId === 81 ? 1080 : fgItemId, planned);
    },
    computeFgGapLinesForSalesOrder: async (so) => ({
      fgLines: (so.lines || [])
        .filter((l) => l.item?.itemType === "FG")
        .map((l) => ({
          lineId: l.id,
          fgItemId: l.itemId,
          fgName: l.item?.itemName ?? "",
          customerCommittedQty: Number(l.qty),
          orderQty: Number(l.qty),
          productionBufferPercent: 0,
          productionBufferQty: 0,
          plannedProductionQty: Number(l.qty),
          fgStock: 0,
          rmPlanningQty: Number(l.qty),
          toProduce: Number(l.qty),
        })),
      allFgEnough: false,
    }),
    evaluateWoPrepareReadiness: async () => ({
      pendingMaterialRequirements: [],
      materialReadiness: { shortageRmCount: 1 },
      totalShortageLines: 1,
    }),
    aggregateRmDemandForFgLines: async (_db, fgLines) => {
      const rmItemId = demandByFgItemId.get(fgLines[0].fgItemId);
      return { rmNeeded: new Map([[rmItemId, 100]]), missingChildBoms: [] };
    },
    getMaterialAvailabilityByItems: async ({ itemIds }) => {
      const itemId = itemIds[0];
      if (itemId === 10) return [availabilityLine(10, { physicalUsableStockQty: 0 })];
      if (itemId === 20) return [availabilityLine(20, { physicalUsableStockQty: 40, freeStockQty: 40 })];
      if (itemId === 30) return [availabilityLine(30, { physicalUsableStockQty: 0, incomingQty: 100 })];
      if (itemId === 40) return [availabilityLine(40, { physicalUsableStockQty: 100, legacyReservedQty: 100, freeStockQty: 0 })];
      if (itemId === 50) {
        return [
          availabilityLine(50, {
            physicalUsableStockQty: 0,
            issuedToProductionQty: 100,
            warnings: [{ code: "STOCK_IN_PRODUCTION_LOCATION", message: "Stock exists in Production/WIP location." }],
          }),
        ];
      }
      if (itemId === 60) return [availabilityLine(60, { physicalUsableStockQty: 100, freeStockQty: 100 })];
      if (itemId === 70) return [availabilityLine(70, { physicalUsableStockQty: 100, freeStockQty: 100 })];
      if (itemId === 80) return [availabilityLine(80, { physicalUsableStockQty: 0 })];
      return [];
    },
  };
}

describe("materialAvailabilityWorkspaceService", () => {
  it("returns blocked WO due to no free stock", async () => {
    const data = await buildMaterialAvailabilityWorkspace(createMockDb(), { workOrderId: 1 }, createDeps());
    assert.equal(data.actionQueue[0].queueType, "WO_BLOCKED_RM_SHORTAGE");
    assert.equal(data.actionQueue[0].blockerReason, "RM not available in store");
  });

  it("returns WOs partially covered by free stock", async () => {
    const data = await buildMaterialAvailabilityWorkspace(createMockDb(), { workOrderId: 2 }, createDeps());
    assert.equal(data.actionQueue[0].queueType, "WO_PARTIALLY_COVERED");
    assert.equal(data.actionQueue[0].freeStockQty, 40);
    assert.equal(data.actionQueue[0].recommendedAction, "Raise / review RM Requisition");
  });

  it("marks partial GRN receipts as Store-tracked partial received", async () => {
    const data = await buildMaterialAvailabilityWorkspace(createMockDb(), { workOrderId: 3 }, createDeps());
    assert.equal(data.actionQueue[0].queueType, "PARTIAL_RM_RECEIVED");
    assert.equal(data.actionQueue[0].blockerReason, "Partial RM received");
    assert.equal(data.actionQueue[0].recommendedAction, "Issue partial RM / wait for balance GRN");
    assert.equal(data.actionQueue[0].netShortageAfterIncomingQty, 0);
  });

  it("uses PMR reservation as blocker reason", async () => {
    const data = await buildMaterialAvailabilityWorkspace(createMockDb(), { workOrderId: 4 }, createDeps());
    assert.equal(data.actionQueue[0].blockerReason, "Stock exists but reserved for other PMR");
    assert.equal(data.actionQueue[0].recommendedAction, "Review competing PMR reservation");
  });

  it("passes through production/WIP stock warning and blocker", async () => {
    const data = await buildMaterialAvailabilityWorkspace(createMockDb(), { workOrderId: 5 }, createDeps());
    const line = data.selectedDetail.rmLines[0];
    assert.ok(line.warnings.some((w) => w.code === "STOCK_IN_PRODUCTION_LOCATION"));
    assert.equal(line.blockerReason, "Stock exists in production/WIP, not store");
  });

  it("sets PMR waiting recommended action", async () => {
    const data = await buildMaterialAvailabilityWorkspace(createMockDb(), { workOrderId: 6 }, createDeps());
    assert.equal(data.actionQueue[0].queueType, "PMR_WAITING_ISSUE");
    assert.equal(data.actionQueue[0].recommendedAction, "Issue material to production");
  });

  it("selected workspace detail returns RM lines", async () => {
    const data = await buildMaterialAvailabilityWorkspace(createMockDb(), { workOrderId: 3 }, createDeps());
    assert.equal(data.selectedDetail.workOrder.id, 3);
    assert.equal(data.selectedDetail.rmLines.length, 1);
    assert.equal(data.selectedDetail.rmLines[0].rmItemId, 30);
    assert.ok(data.selectedWoShortageCase);
    assert.equal(data.selectedWoShortageCase.workOrderId, 3);
    assert.equal(data.caseSupplyPanel.workOrderId, 3);
  });

  it("exposes one WO shortage case per work order detail", async () => {
    const data = await buildMaterialAvailabilityWorkspace(createMockDb(), { workOrderId: 1 }, createDeps());
    assert.equal(data.selectedWoShortageCase.workOrderId, 1);
    assert.equal(data.selectedWoShortageCase.rmLines.length, data.selectedDetail.rmLines.length);
    assert.ok(data.selectedWoShortageCase.nextStoreAction?.key);
    assert.ok(data.selectedWoShortageCase.shortageSummary.rmLineCount >= 1);
    assert.equal(data.selectedWoShortageCase.escalationLifecycle.state, "NOT_ESCALATED");
  });

  it("derives escalation pending when WO MR exists without PR/PO", async () => {
    const db = createMockDb();
    db.materialRequirement.findMany = async (query) => {
      const woIds = query?.where?.workOrderId?.in || [];
      if (!woIds.includes(1)) return [];
      return [
        {
          id: 701,
          docNo: "MR-WO-1",
          status: "APPROVED",
          sourceType: "WORK_ORDER_PLANNING",
          workOrderId: 1,
          lines: [
            {
              id: 1,
              rmItemId: 10,
              requiredQty: 100,
              shortageQty: 100,
              procuredQty: 0,
              rmItem: { itemName: "RM 10", unit: "KG" },
            },
          ],
        },
      ];
    };
    const data = await buildMaterialAvailabilityWorkspace(db, { workOrderId: 1 }, createDeps());
    assert.equal(data.selectedWoShortageCase.escalationLifecycle.state, "ESCALATION_PENDING");
    assert.equal(data.selectedWoShortageCase.nextStoreAction.key, "CONTINUE_PROCUREMENT");
    assert.notEqual(data.selectedWoShortageCase.nextStoreAction.key, "ESCALATE");
  });

  it("supply panel shows PO and GRN pending qty", async () => {
    const data = await buildMaterialAvailabilityWorkspace(createMockDb(), { rmItemId: 30 }, createDeps());
    assert.equal(data.supplyPanel.rmItemId, 30);
    assert.equal(data.supplyPanel.openMrLines.length, 1);
    assert.equal(data.supplyPanel.prLines.length, 1);
    assert.equal(data.supplyPanel.poLines.length, 1);
    assert.equal(data.supplyPanel.poLines[0].receivedGrnQty, 40);
    assert.equal(data.supplyPanel.poLines[0].pendingGrnQty, 60);
  });

  it("does not require mutation methods on db", async () => {
    const db = createMockDb();
    assert.equal(db.workOrder.create, undefined);
    const data = await buildMaterialAvailabilityWorkspace(db, { onlyBlocked: true }, createDeps());
    assert.ok(data.actionQueue.length > 0);
  });

  it("keeps sent RM requisitions visible for dashboard Continue RM Resolution", async () => {
    const db = createMockDb();
    db.materialRequirementLine.findMany = async (query) => {
      const rmItemId = query.where.rmItemId;
      if (rmItemId !== 10) return [];
      return [
        {
          id: 1010,
          materialRequirementId: 710,
          rmItemId,
          requiredQty: 100,
          shortageQty: 100,
          procuredQty: 0,
          rmItem: { id: rmItemId, itemName: "RM 10", unit: "KG" },
          materialRequirement: {
            id: 710,
            docNo: "MR-WO-1",
            status: "SENT_TO_PURCHASE",
            sourceType: "WORK_ORDER_PLANNING",
            salesOrderId: 1,
            salesOrder: { id: 1, docNo: "SO-1" },
            workOrder: { id: 1, docNo: "WO-1" },
            quotation: null,
          },
          purchaseRequestSourceLinks: [],
        },
      ];
    };

    const data = await buildMaterialAvailabilityWorkspace(
      db,
      { workOrderId: 1, rmItemId: 10, onlyBlocked: true },
      createDeps(),
    );

    assert.equal(data.actionQueue.length, 1);
    assert.equal(data.actionQueue[0].queueType, "WAITING_PURCHASE_ACTION");
    assert.equal(data.actionQueue[0].requisitionStatus, "SENT_TO_PURCHASE");
    assert.equal(data.actionQueue[0].nextOwner, "Purchase Department");
    assert.equal(data.selectedDetail.workOrder.id, 1);
  });

  it("keeps stock-ready WOs visible until Store issues material", async () => {
    const data = await buildMaterialAvailabilityWorkspace(
      createMockDb(),
      { workOrderId: 7, onlyBlocked: true },
      createDeps(),
    );

    assert.equal(data.actionQueue.length, 1);
    assert.equal(data.actionQueue[0].queueType, "RM_READY_FOR_ISSUE");
    assert.equal(data.actionQueue[0].nextOwner, "Store Department");
    assert.equal(data.actionQueue[0].nextAction, "Issue material to production");
  });

  it("shows SO-level RM requisitions before a work order exists", async () => {
    const db = createMockDb();
    const soMr = {
      id: 880,
      docNo: "MR-SO-80",
      status: "APPROVED",
      sourceType: "WORK_ORDER_PLANNING",
      salesOrderId: 80,
      workOrderId: null,
      salesOrder: {
        id: 80,
        docNo: "SO-80",
        orderType: "NORMAL",
        internalStatus: "APPROVED",
        customer: { name: "Customer 80" },
        lines: [{ item: { id: 1080, itemName: "FG 80", itemType: "FG", unit: "Nos" } }],
      },
      lines: [
        {
          id: 8801,
          rmItemId: 80,
          requiredQty: 100,
          shortageQty: 100,
          procuredQty: 0,
          unitSnapshot: "KG",
          rmItem: { id: 80, itemName: "RM 80", unit: "KG" },
        },
      ],
    };
    db.materialRequirement.findMany = async (query) => {
      if (query?.where?.id && query.where.id !== 880) return [];
      if (query?.where?.salesOrderId && query.where.salesOrderId !== 80) return [];
      if (query?.where?.workOrderId !== null) return [];
      return [soMr];
    };
    db.materialRequirementLine.findMany = async (query) => {
      if (query.where.rmItemId !== 80) return [];
      return [
        {
          id: 8801,
          materialRequirementId: 880,
          rmItemId: 80,
          requiredQty: 100,
          shortageQty: 100,
          procuredQty: 0,
          rmItem: { id: 80, itemName: "RM 80", unit: "KG" },
          materialRequirement: {
            id: 880,
            docNo: "MR-SO-80",
            status: "APPROVED",
            sourceType: "WORK_ORDER_PLANNING",
            salesOrderId: 80,
            salesOrder: { id: 80, docNo: "SO-80" },
            workOrder: null,
            quotation: null,
          },
          purchaseRequestSourceLinks: [],
        },
      ];
    };

    const data = await buildMaterialAvailabilityWorkspace(
      db,
      { salesOrderId: 80, materialRequirementId: 880, onlyBlocked: true },
      createDeps(),
    );

    assert.equal(data.actionQueue.length, 1);
    assert.equal(data.actionQueue[0].workOrderId, null);
    assert.equal(data.actionQueue[0].materialRequirementId, 880);
    assert.equal(data.actionQueue[0].sourceStage, "SO_PLANNING");
    assert.equal(data.actionQueue[0].queueType, "WAITING_PURCHASE_ACTION");
    assert.equal(data.selectedDetail.workOrder.id, null);
    assert.equal(data.selectedWoShortageCase.materialRequirement.id, 880);
    assert.equal(data.selectedWoShortageCase.issueStatusLabel, "WO not created yet");
  });

  it("shows SO-level RM shortage before the requisition is raised", async () => {
    const data = await buildMaterialAvailabilityWorkspace(
      createMockDb(),
      { salesOrderId: 81, onlyBlocked: true },
      createDeps(),
    );

    assert.equal(data.actionQueue.length, 1);
    assert.equal(data.actionQueue[0].workOrderId, null);
    assert.equal(data.actionQueue[0].materialRequirementId, null);
    assert.equal(data.actionQueue[0].sourceStage, "SO_PLANNING");
    assert.equal(data.actionQueue[0].nextOwner, "Store Department");
    assert.equal(data.actionQueue[0].nextAction, "Raise Store Requisition");
    assert.equal(data.selectedDetail.workOrder.id, null);
    assert.equal(data.selectedWoShortageCase.materialRequirement, null);
  });

  it("keeps recommendation helpers readable", () => {
    const line = availabilityLine(10, { physicalUsableStockQty: 0 });
    const blocker = deriveLineBlocker(line);
    assert.equal(blocker, "RM not available in store");
    assert.equal(deriveRecommendedAction(line, blocker), "Raise / review RM Requisition");
  });

  it("uses buffer-aware planned production qty for SO planning shortage explosion", async () => {
    const db = createMockDb();
    const capturedFgQty = [];
    const deps = createDeps();
    deps.buildRegularSoPlanningSnapshotView = async () =>
      planningViewForSo(81, 1080, 8160);
    deps.aggregateRmDemandForFgLines = async (_db, fgLines) => {
      capturedFgQty.push(fgLines[0]?.fgQty);
      return { rmNeeded: new Map([[80, 329.26]]), missingChildBoms: [] };
    };

    const data = await buildMaterialAvailabilityWorkspace(
      db,
      { salesOrderId: 81, onlyBlocked: true },
      deps,
    );

    assert.equal(capturedFgQty.length, 1);
    assert.equal(capturedFgQty[0], 8160);
    assert.equal(data.actionQueue.length, 1);
    assert.equal(data.actionQueue[0].sourceStage, "SO_PLANNING");
  });

  it("surfaces SO planning shortage when plannedProductionQty=0 but rmPlanningQty>0", async () => {
    const db = createMockDb();
    const capturedFgQty = [];
    const deps = createDeps();
    // Planning view where the gross planned qty is 0 but the net RM planning qty is positive.
    deps.buildRegularSoPlanningSnapshotView = async () => ({
      salesOrderId: 81,
      bufferPercent: 0,
      lines: [
        { lineId: 810, fgItemId: 1080, fgName: "FG 81", plannedProductionQty: 0, rmPlanningQty: 8160, toProduce: 8160 },
      ],
    });
    deps.aggregateRmDemandForFgLines = async (_db, fgLines) => {
      capturedFgQty.push(fgLines[0]?.fgQty);
      return { rmNeeded: new Map([[80, 329.26]]), missingChildBoms: [] };
    };

    const data = await buildMaterialAvailabilityWorkspace(
      db,
      { salesOrderId: 81, onlyBlocked: true },
      deps,
    );

    assert.equal(capturedFgQty.length, 1);
    assert.equal(capturedFgQty[0], 8160);
    assert.equal(data.actionQueue.length, 1);
    assert.equal(data.actionQueue[0].sourceStage, "SO_PLANNING");
    assert.equal(data.actionQueue[0].workOrderId, null);
  });

  it("discovers SO planning shortages without salesOrderId filter", async () => {
    const db = createMockDb();
    db.salesOrder.findMany = async (query) => {
      if (query?.where?.id === 81) {
        return [
          {
            id: 81,
            docNo: "SO-81",
            orderType: "NORMAL",
            internalStatus: "APPROVED",
            customer: { name: "Customer 81" },
            lines: [
              {
                id: 810,
                itemId: 1080,
                qty: 8000,
                item: { id: 1080, itemName: "FG 81", itemType: "FG", unit: "Nos" },
              },
            ],
          },
        ];
      }
      if (query?.where?.orderType === "NORMAL") {
        return [
          {
            id: 81,
            docNo: "SO-81",
            orderType: "NORMAL",
            internalStatus: "APPROVED",
            customer: { name: "Customer 81" },
            lines: [
              {
                id: 810,
                itemId: 1080,
                qty: 8000,
                item: { id: 1080, itemName: "FG 81", itemType: "FG", unit: "Nos" },
              },
            ],
          },
        ];
      }
      return [];
    };

    const data = await buildMaterialAvailabilityWorkspace(db, { onlyBlocked: true }, createDeps());

    assert.ok(data.actionQueue.some((row) => row.salesOrderId === 81 && row.sourceStage === "SO_PLANNING"));
  });
});

describe("deriveCaseStoreAction — closed MR reopen", () => {
  it("returns REOPEN_REQUISITION when terminal MR exists and shortage remains", () => {
    const action = deriveCaseStoreAction({
      rmLines: [{ netShortageAfterIncomingQty: 10, shortageAfterReservationQty: 10, freeStockQty: 0 }],
      pmrStatus: { openPmrs: [] },
      woMr: null,
      terminalMr: { id: 1, docNo: "MR-26-0001", status: "CLOSED" },
      caseSupply: null,
      escalation: { state: "NOT_ESCALATED", procurementInitiated: false },
      shortageSummary: { blockedLineCount: 1, totalNetShortQty: 10 },
    });
    assert.equal(action.key, "REOPEN_REQUISITION");
    assert.match(action.label, /Reopen/i);
  });

  it("returns CREATE_WO for FULLY_PROCURED SO-level MR without work order", () => {
    const action = deriveCaseStoreAction({
      rmLines: [{ requiredQty: 10, freeStockQty: 10, shortageAfterReservationQty: 0, netShortageAfterIncomingQty: 0 }],
      pmrStatus: { openPmrs: [] },
      woMr: { id: 58, docNo: "MR-26-0003", status: "FULLY_PROCURED", workOrderId: null, lines: [] },
      terminalMr: null,
      caseSupply: { summary: { pendingGrnQty: 0, prLineCount: 1, poLineCount: 1 } },
      escalation: { state: "PROCUREMENT_COMPLETED", procurementInitiated: true },
      shortageSummary: { blockedLineCount: 0, totalNetShortQty: 0 },
    });
    assert.equal(action.key, "CREATE_WO");
    assert.match(action.label, /Create Work Order/i);
  });
});

describe("post-GRN SO planning MR (FULLY_PROCURED, no WO)", () => {
  function procuredMrFixture(overrides = {}) {
    return {
      id: 58,
      docNo: "MR-26-0003",
      status: "FULLY_PROCURED",
      sourceType: "WORK_ORDER_PLANNING",
      salesOrderId: 139,
      workOrderId: null,
      salesOrder: {
        id: 139,
        docNo: "SO-26-0003",
        orderType: "NORMAL",
        internalStatus: "APPROVED",
        customer: { name: "Customer 139" },
        lines: [
          {
            id: 1,
            itemId: 2001,
            qty: 100,
            customerPoQty: 100,
            item: { id: 2001, itemName: "Nozzle FG", itemType: "FG", unit: "Nos" },
          },
        ],
      },
      lines: [
        {
          id: 5801,
          rmItemId: 301,
          requiredQty: 4.116,
          shortageQty: 4.116,
          procuredQty: 4.116,
          unitSnapshot: "KG",
          rmItem: { id: 301, itemName: "PP", unit: "KG" },
        },
        {
          id: 5802,
          rmItemId: 302,
          requiredQty: 0.128,
          shortageQty: 0.128,
          procuredQty: 0.128,
          unitSnapshot: "KG",
          rmItem: { id: 302, itemName: "Powder", unit: "KG" },
        },
      ],
      ...overrides,
    };
  }

  function mockDbForProcuredMr(procuredMr, { existingWorkOrder = null, dispatchRecords = [] } = {}) {
    const db = createMockDb();
    db.materialRequirement.findMany = async (query) => {
      const statuses = query?.where?.status?.in ?? [];
      if (statuses.includes("FULLY_PROCURED")) return [procuredMr];
      return [];
    };
    db.workOrder.findFirst = async (query) => {
      if (query?.where?.salesOrderId === procuredMr.salesOrderId && existingWorkOrder) {
        return existingWorkOrder;
      }
      return null;
    };
    db.salesOrder.findUnique = async (query) => {
      if (query?.where?.id !== procuredMr.salesOrderId) return null;
      return {
        ...procuredMr.salesOrder,
        lines: procuredMr.salesOrder.lines,
        dispatch: dispatchRecords,
      };
    };
    return db;
  }

  it("surfaces RM_RECEIVED_CREATE_WO case instead of empty workspace", async () => {
    const procuredMr = procuredMrFixture();
    const db = mockDbForProcuredMr(procuredMr);

    const deps = createDeps();
    deps.getMaterialAvailabilityByItems = async ({ itemIds }) =>
      itemIds.map((itemId) =>
        availabilityLine(itemId, {
          requiredQty: itemId === 301 ? 4.116 : 0.128,
          physicalUsableStockQty: itemId === 301 ? 4.116 : 0.128,
          freeStockQty: itemId === 301 ? 4.116 : 0.128,
          shortageAfterReservationQty: 0,
          netShortageAfterIncomingQty: 0,
        }),
      );

    const data = await buildMaterialAvailabilityWorkspace(
      db,
      { salesOrderId: 139, materialRequirementId: 58 },
      deps,
    );

    assert.equal(data.actionQueue.length, 1);
    assert.equal(data.actionQueue[0].queueType, "RM_RECEIVED_CREATE_WO");
    assert.equal(data.actionQueue[0].salesOrderId, 139);
    assert.equal(data.actionQueue[0].materialRequirementId, 58);
    assert.equal(data.selectedWoShortageCase?.allocationFirstStatus?.key, "RM_RECEIVED");
    assert.equal(data.selectedWoShortageCase?.nextStoreAction?.key, "CREATE_WO");
    assert.equal(data.selectedDetail?.rmLines.length, 2);
    assert.match(data.selectedDetail?.rmLines[0].blockerReason ?? "", /create Work Order/i);
  });

  it("excludes fully dispatched SO with existing work order from post-GRN Create WO queue", async () => {
    const procuredMr = procuredMrFixture({
      id: 11,
      docNo: "MR-26-0001",
      salesOrderId: 101,
      salesOrder: {
        id: 101,
        docNo: "SO-26-0001",
        orderType: "NORMAL",
        internalStatus: "APPROVED",
        customer: { name: "Customer 101" },
        lines: [
          {
            id: 11,
            itemId: 2001,
            qty: 100,
            customerPoQty: 100,
            item: { id: 2001, itemName: "Nozzle FG", itemType: "FG", unit: "Nos" },
          },
        ],
      },
    });
    const db = mockDbForProcuredMr(procuredMr, {
      existingWorkOrder: { id: 501 },
      dispatchRecords: [{ itemId: 2001, dispatchedQty: 100, workflowStatus: "LOCKED" }],
    });

    const assessment = await assessPostGrnCreateWoEligibility(db, procuredMr, createDeps());
    assert.equal(assessment.eligible, false);
    assert.equal(assessment.reason, "WO_ALREADY_EXISTS");

    const data = await buildMaterialAvailabilityWorkspace(db, { salesOrderId: 101 }, createDeps());
    assert.equal(data.actionQueue.filter((r) => r.queueType === "RM_RECEIVED_CREATE_WO").length, 0);
  });

  it("excludes fully dispatched SO without work order from post-GRN Create WO queue", async () => {
    const procuredMr = procuredMrFixture({
      id: 12,
      docNo: "MR-26-0002",
      salesOrderId: 102,
      salesOrder: {
        id: 102,
        docNo: "SO-26-0002",
        orderType: "NORMAL",
        internalStatus: "COMPLETED",
        customer: { name: "Customer 102" },
        lines: [
          {
            id: 12,
            itemId: 2001,
            qty: 50,
            customerPoQty: 50,
            item: { id: 2001, itemName: "Nozzle FG", itemType: "FG", unit: "Nos" },
          },
        ],
      },
    });
    const db = mockDbForProcuredMr(procuredMr, {
      dispatchRecords: [{ itemId: 2001, dispatchedQty: 50, workflowStatus: "LOCKED" }],
    });

    const assessment = await assessPostGrnCreateWoEligibility(db, procuredMr, createDeps());
    assert.equal(assessment.eligible, false);

    const data = await buildMaterialAvailabilityWorkspace(db, { salesOrderId: 102 }, createDeps());
    assert.equal(data.actionQueue.filter((r) => r.queueType === "RM_RECEIVED_CREATE_WO").length, 0);
  });

  it("does not emit RM_READY_FOR_ISSUE for SO-level stock without work order", () => {
    const blocker = deriveLineBlocker(
      availabilityLine(301, {
        requiredQty: 4.116,
        freeStockQty: 4.116,
        shortageAfterReservationQty: 0,
      }),
      { hasWorkOrder: false },
    );
    assert.match(blocker, /create Work Order/i);
    assert.notEqual(blocker, "Ready for material issue");
  });
});
