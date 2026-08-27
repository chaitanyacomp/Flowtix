/**
 * Step 4A backend reads — capabilities, eligible-runs, open-downtime, master READ roles.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { createApp } = require("../../src/createApp");
const { signAccessToken } = require("../../src/utils/jwt");
const { getShiftCapabilities } = require("../../src/services/machineShiftPermissions");
const { listEligibleRunsForMachine, flowLabelFromWorkOrder } = require("../../src/services/machineShiftEligibleRunsService");
const { getOpenDowntimeForMachine } = require("../../src/services/machineShiftOpenDowntimeService");
const { assertWorkOrderRunUsable } = require("../../src/services/machineShiftSessionRunSegmentService");
const { WO_NOT_USABLE_FOR_SHIFT_RUN } = require("../../src/services/machineShiftSessionErrors");
const { READ_ROLES: MACHINE_READ } = require("../../src/routes/machines");
const { READ_ROLES: OPERATOR_READ, WRITE_ROLES: OPERATOR_WRITE } = require("../../src/routes/operators");
const { READ_ROLES: SHIFT_READ, WRITE_ROLES: SHIFT_WRITE } = require("../../src/routes/shifts");
const { WRITE_ROLES: MACHINE_WRITE } = require("../../src/routes/machines");

function bearer(role, userId = 10) {
  return `Bearer ${signAccessToken({
    userId,
    email: `${role.toLowerCase()}@test.com`,
    role,
    name: role,
  })}`;
}

describe("A — PRODUCTION_MANAGER master READ only", () => {
  it("adds PRODUCTION_MANAGER to machine/operator/shift READ, not WRITE", () => {
    assert.ok(MACHINE_READ.includes("PRODUCTION_MANAGER"));
    assert.ok(OPERATOR_READ.includes("PRODUCTION_MANAGER"));
    assert.ok(SHIFT_READ.includes("PRODUCTION_MANAGER"));
    assert.ok(!MACHINE_WRITE.includes("PRODUCTION_MANAGER"));
    assert.ok(!OPERATOR_WRITE.includes("PRODUCTION_MANAGER"));
    assert.ok(!SHIFT_WRITE.includes("PRODUCTION_MANAGER"));
    assert.deepEqual(
      MACHINE_READ.filter((r) => r !== "PRODUCTION_MANAGER").sort(),
      ["ADMIN", "PRODUCTION", "STORE"].sort(),
    );
  });

  it("allows PRODUCTION_MANAGER past machines list role gate", async () => {
    const app = createApp();
    const res = await request(app).get("/api/machines").set("Authorization", bearer("PRODUCTION_MANAGER"));
    assert.notEqual(res.status, 403);
    assert.notEqual(res.status, 401);
  });

  it("still rejects QA on machines list", async () => {
    const app = createApp();
    const res = await request(app).get("/api/machines").set("Authorization", bearer("QA"));
    assert.equal(res.status, 403);
  });
});

describe("B — getShiftCapabilities", () => {
  it("ADMIN and PRODUCTION_MANAGER always canPerformManagerActions", async () => {
    const db = { user: { count: async () => 1 } };
    const admin = await getShiftCapabilities({ role: "ADMIN" }, db);
    assert.equal(admin.canView, true);
    assert.equal(admin.canPerformManagerActions, true);
    assert.equal(admin.isFallbackControl, false);
    assert.equal(admin.productionManagerAssigned, true);

    const pm = await getShiftCapabilities({ role: "PRODUCTION_MANAGER" }, db);
    assert.equal(pm.canPerformManagerActions, true);
    assert.equal(pm.isFallbackControl, false);
  });

  it("PRODUCTION fallback when no active manager", async () => {
    const db = { user: { count: async () => 0 } };
    const caps = await getShiftCapabilities({ role: "PRODUCTION" }, db);
    assert.equal(caps.canView, true);
    assert.equal(caps.canPerformManagerActions, true);
    assert.equal(caps.productionManagerAssigned, false);
    assert.equal(caps.isFallbackControl, true);
  });

  it("PRODUCTION cannot manage when manager assigned; not fallback", async () => {
    const db = { user: { count: async () => 2 } };
    const caps = await getShiftCapabilities({ role: "PRODUCTION" }, db);
    assert.equal(caps.canPerformManagerActions, false);
    assert.equal(caps.canPauseProduction, true);
    assert.equal(caps.productionManagerAssigned, true);
    assert.equal(caps.isFallbackControl, false);
  });

  it("STORE cannot view", async () => {
    const caps = await getShiftCapabilities({ role: "STORE" }, { user: { count: async () => 0 } });
    assert.equal(caps.canView, false);
  });

  it("GET /capabilities returns flags for PRODUCTION_MANAGER", async () => {
    const app = createApp();
    const res = await request(app)
      .get("/api/machine-shift-sessions/capabilities")
      .set("Authorization", bearer("PRODUCTION_MANAGER"));
    assert.equal(res.status, 200);
    assert.equal(res.body.canView, true);
    assert.equal(res.body.canPerformManagerActions, true);
    assert.equal(res.body.isFallbackControl, false);
    assert.equal(typeof res.body.productionManagerAssigned, "boolean");
    assert.equal(res.body.userList, undefined);
    assert.equal(res.body.count, undefined);
  });

  it("GET /capabilities rejects STORE", async () => {
    const app = createApp();
    const res = await request(app)
      .get("/api/machine-shift-sessions/capabilities")
      .set("Authorization", bearer("STORE"));
    assert.equal(res.status, 403);
  });
});

describe("C — eligible runs reuse startRunSegment rules", () => {
  it("flowLabelFromWorkOrder distinguishes NO_QTY and Regular", () => {
    assert.equal(flowLabelFromWorkOrder({ sourceType: "CUSTOMER_REQUIREMENT", salesOrder: { orderType: "NO_QTY" } }), "NO_QTY");
    assert.equal(flowLabelFromWorkOrder({ sourceType: "CUSTOMER_REQUIREMENT", salesOrder: { orderType: "NORMAL" } }), "Regular SO");
    assert.equal(flowLabelFromWorkOrder({ sourceType: "GREEN_LEVEL_REPLENISHMENT" }), "Green Level");
  });

  it("filters with assertWorkOrderRunUsable (completed WO excluded)", async () => {
    const machineId = 7;
    const db = {
      machine: {
        findUnique: async () => ({ id: machineId, machineCode: "M1", machineName: "Press 1", isActive: true }),
      },
      workOrderProductionRunAllocation: {
        findMany: async () => [
          {
            id: 1,
            workOrderId: 10,
            fgItemId: 100,
            runSequence: 1,
            machineId,
            isActive: true,
            workOrder: { id: 10, docNo: "WO-1", status: "COMPLETED", sourceType: "CUSTOMER_REQUIREMENT", salesOrder: { orderType: "NORMAL" } },
            fgItem: { id: 100, itemName: "Cap", hsnCode: "3923" },
            machine: { id: machineId, machineCode: "M1", machineName: "Press 1" },
          },
          {
            id: 2,
            workOrderId: 11,
            fgItemId: 101,
            runSequence: 1,
            machineId,
            isActive: true,
            workOrder: { id: 11, docNo: "WO-2", status: "PENDING", sourceType: "CUSTOMER_REQUIREMENT", salesOrder: { orderType: "NO_QTY" } },
            fgItem: { id: 101, itemName: "Bottle", hsnCode: null },
            machine: { id: machineId, machineCode: "M1", machineName: "Press 1" },
          },
        ],
        findUnique: async ({ where }) => {
          if (where.id === 1) {
            return { id: 1, workOrderId: 10, machineId, isActive: true, runSequence: 1 };
          }
          if (where.id === 2) {
            return { id: 2, workOrderId: 11, machineId, isActive: true, runSequence: 1 };
          }
          return null;
        },
      },
      workOrder: {
        findUnique: async ({ where }) => {
          if (where.id === 10) return { id: 10, status: "COMPLETED", docNo: "WO-1" };
          if (where.id === 11) return { id: 11, status: "PENDING", docNo: "WO-2" };
          return null;
        },
      },
    };

    const result = await listEligibleRunsForMachine(machineId, db);
    assert.equal(result.runs.length, 1);
    assert.equal(result.runs[0].runAllocationId, 2);
    assert.equal(result.runs[0].workOrderNo, "WO-2");
    assert.equal(result.runs[0].productionFlow, "NO_QTY");
    assert.equal(result.runs[0].itemName, "Bottle");
    assert.ok(WO_NOT_USABLE_FOR_SHIFT_RUN.has("COMPLETED"));

    await assert.rejects(
      () => assertWorkOrderRunUsable(db, { runAllocationId: 1, sessionMachineId: machineId }),
      (e) => e.code === "WORK_ORDER_NOT_USABLE",
    );
  });

  it("GET /eligible-runs validates machineId", async () => {
    const app = createApp();
    const res = await request(app)
      .get("/api/machine-shift-sessions/eligible-runs")
      .query({ machineId: "x" })
      .set("Authorization", bearer("ADMIN"));
    assert.equal(res.status, 400);
  });
});

describe("D — open downtime read", () => {
  it("returns null when no open incident", async () => {
    const db = {
      machine: {
        findUnique: async () => ({ id: 1, machineCode: "M1", machineName: "M1" }),
      },
      machineShiftDowntimeIncident: {
        findFirst: async () => null,
      },
    };
    const out = await getOpenDowntimeForMachine(1, db);
    assert.equal(out, null);
  });

  it("marks canContinue when open session has no segment yet", async () => {
    const db = {
      machine: {
        findUnique: async () => ({ id: 5, machineCode: "M5", machineName: "Line 5" }),
      },
      machineShiftDowntimeIncident: {
        findFirst: async () => ({
          id: 99,
          machineId: 5,
          reason: "WAITING_FOR_RM",
          remarks: null,
          startedAt: new Date("2026-08-24T01:00:00Z"),
          endedAt: null,
        }),
      },
      machineShiftDowntimeSegment: {
        findFirst: async (args) => {
          if (args?.where?.sessionId != null) return null;
          return {
            id: 3,
            incidentId: 99,
            sessionId: 40,
            segmentStartAt: new Date("2026-08-24T01:00:00Z"),
            segmentEndAt: new Date("2026-08-24T08:00:00Z"),
            remarks: null,
            session: {
              id: 40,
              shiftSessionNo: "SS-26-0001",
              status: "SHIFT_OVER",
              sessionDate: new Date("2026-08-23"),
            },
          };
        },
      },
      machineShiftSession: {
        findFirst: async () => ({ id: 50, machineId: 5, status: "OPEN" }),
      },
    };
    const out = await getOpenDowntimeForMachine(5, db);
    assert.equal(out.incidentId, 99);
    assert.equal(out.canContinueIntoCurrentSession, true);
    assert.equal(out.currentOpenSessionId, 50);
    assert.equal(out.latestSegment.shiftSessionNo, "SS-26-0001");
  });

  it("GET /open-downtime returns incident null shape", async () => {
    const app = createApp();
    const res = await request(app)
      .get("/api/machine-shift-sessions/open-downtime")
      .query({ machineId: 999999001 })
      .set("Authorization", bearer("PRODUCTION"));
    // 404 machine or 200 with null — either is fine; not 403 for PRODUCTION
    assert.notEqual(res.status, 403);
    assert.notEqual(res.status, 401);
    if (res.status === 200) {
      assert.equal(res.body.incident, null);
    }
  });
});
