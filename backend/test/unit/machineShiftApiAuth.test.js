/**
 * Step 3 — Shift permissions + API authorization (focused).
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { createApp } = require("../../src/createApp");
const { signAccessToken } = require("../../src/utils/jwt");
const {
  SHIFT_ACTION,
  assertShiftActionAllowed,
  hasActiveProductionManager,
} = require("../../src/services/machineShiftPermissions");
const { stripActorFields } = require("../../src/routes/machineShiftSessions");
const { ERP_ROLES } = require("../../src/constants/erpRoles");
const { accessForRole } = require("../../src/constants/roleAccess");

function bearer(role, userId = 10) {
  return `Bearer ${signAccessToken({
    userId,
    email: `${role.toLowerCase()}@test.com`,
    role,
    name: role,
  })}`;
}

function mockDb({ managerCount = 0 } = {}) {
  return {
    user: {
      count: async ({ where } = {}) => {
        if (where?.role === "PRODUCTION_MANAGER" && where?.isActive === true) {
          return managerCount;
        }
        return 0;
      },
    },
  };
}

describe("PRODUCTION_MANAGER role constants", () => {
  it("includes PRODUCTION_MANAGER in ERP_ROLES and roleAccess", () => {
    assert.ok(ERP_ROLES.includes("PRODUCTION_MANAGER"));
    const access = accessForRole("PRODUCTION_MANAGER");
    assert.ok(access.permissions.includes("shift:manage"));
  });
});

describe("assertShiftActionAllowed", () => {
  it("ADMIN and PRODUCTION_MANAGER always allowed for manager actions", async () => {
    const db = mockDb({ managerCount: 1 });
    await assertShiftActionAllowed(db, { role: "ADMIN" }, SHIFT_ACTION.SHIFT_OVER);
    await assertShiftActionAllowed(db, { role: "PRODUCTION_MANAGER" }, SHIFT_ACTION.RETURN_VERIFY_REPORT);
  });

  it("PRODUCTION may save/submit and request without manager", async () => {
    const db = mockDb({ managerCount: 1 });
    await assertShiftActionAllowed(db, { role: "PRODUCTION" }, SHIFT_ACTION.VIEW);
    await assertShiftActionAllowed(db, { role: "PRODUCTION" }, SHIFT_ACTION.SAVE_SUBMIT_REPORT);
    await assertShiftActionAllowed(db, { role: "PRODUCTION" }, SHIFT_ACTION.REQUEST_REOPEN);
    await assertShiftActionAllowed(db, { role: "PRODUCTION" }, SHIFT_ACTION.REQUEST_ADJUSTMENT);
  });

  it("PRODUCTION fallback for manager actions when no active manager", async () => {
    const db = mockDb({ managerCount: 0 });
    const r = await assertShiftActionAllowed(db, { role: "PRODUCTION" }, SHIFT_ACTION.START_SESSION);
    assert.equal(r.via, "PRODUCTION_FALLBACK");
  });

  it("PRODUCTION rejected for manager actions when active manager exists", async () => {
    const db = mockDb({ managerCount: 2 });
    await assert.rejects(
      () => assertShiftActionAllowed(db, { role: "PRODUCTION" }, SHIFT_ACTION.SHIFT_OVER),
      (e) => e.code === "PRODUCTION_MANAGER_ACTION_REQUIRED" && e.statusCode === 403,
    );
    await assert.rejects(
      () => assertShiftActionAllowed(db, { role: "PRODUCTION" }, SHIFT_ACTION.CANCEL_SESSION),
      (e) => e.code === "PRODUCTION_MANAGER_ACTION_REQUIRED",
    );
  });

  it("CANCEL_SESSION is manager-owned (ADMIN always; PRODUCTION fallback when no PM)", async () => {
    const withPm = mockDb({ managerCount: 1 });
    await assertShiftActionAllowed(withPm, { role: "ADMIN" }, SHIFT_ACTION.CANCEL_SESSION);
    await assertShiftActionAllowed(withPm, { role: "PRODUCTION_MANAGER" }, SHIFT_ACTION.CANCEL_SESSION);
    const noPm = mockDb({ managerCount: 0 });
    const r = await assertShiftActionAllowed(noPm, { role: "PRODUCTION" }, SHIFT_ACTION.CANCEL_SESSION);
    assert.equal(r.via, "PRODUCTION_FALLBACK");
  });

  it("STORE and QA never authorized for shift actions", async () => {
    const db = mockDb({ managerCount: 0 });
    await assert.rejects(
      () => assertShiftActionAllowed(db, { role: "STORE" }, SHIFT_ACTION.VIEW),
      (e) => e.statusCode === 403,
    );
    await assert.rejects(
      () => assertShiftActionAllowed(db, { role: "QA" }, SHIFT_ACTION.SAVE_SUBMIT_REPORT),
      (e) => e.statusCode === 403,
    );
  });
});

describe("stripActorFields", () => {
  it("removes spoofable actor ids from body", () => {
    const cleaned = stripActorFields({
      machineId: 1,
      actorUserId: 999,
      declaredByUserId: 999,
      startedByUserId: 999,
      sessionDate: "2026-08-24",
    });
    assert.equal(cleaned.machineId, 1);
    assert.equal(cleaned.sessionDate, "2026-08-24");
    assert.equal(cleaned.actorUserId, undefined);
    assert.equal(cleaned.declaredByUserId, undefined);
  });
});

describe("machine-shift-sessions API authorization", () => {
  const app = createApp();

  it("rejects unauthenticated requests", async () => {
    const res = await request(app).get("/api/machine-shift-sessions/open").query({ machineId: 1 });
    assert.equal(res.status, 401);
  });

  it("rejects STORE for view", async () => {
    const res = await request(app)
      .get("/api/machine-shift-sessions/open")
      .query({ machineId: 1 })
      .set("Authorization", bearer("STORE"));
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, "SHIFT_ACTION_FORBIDDEN");
  });

  it("ADMIN passes auth gate (validation or not-found after)", async () => {
    const res = await request(app)
      .get("/api/machine-shift-sessions/open")
      .query({ machineId: "abc" })
      .set("Authorization", bearer("ADMIN"));
    assert.notEqual(res.status, 403);
    assert.notEqual(res.status, 401);
    assert.equal(res.status, 400);
  });

  it("PRODUCTION_MANAGER passes auth gate for shift-over path validation", async () => {
    const res = await request(app)
      .post("/api/machine-shift-sessions/1/shift-over")
      .set("Authorization", bearer("PRODUCTION_MANAGER"))
      .send({});
    assert.notEqual(res.status, 403);
    assert.equal(res.status, 400);
  });

  it("strict validation rejects unknown body fields on start", async () => {
    const res = await request(app)
      .post("/api/machine-shift-sessions")
      .set("Authorization", bearer("ADMIN"))
      .send({
        machineId: 1,
        sessionDate: "2026-08-24",
        operators: [{ operatorId: 1, isPrimary: true }],
        unexpected: true,
      });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "VALIDATION");
  });

  it("PRODUCTION may reach save-report path (always-allowed; validation/DB after)", async () => {
    const res = await request(app)
      .post("/api/machine-shift-sessions/1/report/draft")
      .set("Authorization", bearer("PRODUCTION"))
      .send({});
    assert.notEqual(res.status, 403);
    assert.notEqual(res.status, 401);
    assert.equal(res.status, 400);
  });

  it("PRODUCTION may reach reopen request path", async () => {
    const res = await request(app)
      .post("/api/machine-shift-sessions/1/reopen-requests")
      .set("Authorization", bearer("PRODUCTION"))
      .send({});
    assert.notEqual(res.status, 403);
    assert.equal(res.status, 400);
  });

  it("ignores spoofed actorUserId and still requires auth user", async () => {
    const res = await request(app)
      .post("/api/machine-shift-sessions")
      .set("Authorization", bearer("ADMIN", 42))
      .send({
        machineId: 1,
        sessionDate: "2026-08-24",
        operators: [{ operatorId: 1, isPrimary: true }],
        actorUserId: 999999,
        startedByUserId: 999999,
      });
    // Auth passed; business/validation/DB may fail — must not be 403 from spoof
    assert.notEqual(res.status, 403);
    assert.notEqual(res.status, 401);
  });
});

describe("hasActiveProductionManager query shape", () => {
  it("uses role + isActive filter", async () => {
    let seen = null;
    const db = {
      user: {
        count: async (args) => {
          seen = args;
          return 0;
        },
      },
    };
    const ok = await hasActiveProductionManager(db);
    assert.equal(ok, false);
    assert.deepEqual(seen.where, { role: "PRODUCTION_MANAGER", isActive: true });
  });
});
