/**
 * Step 4B DTO — reopen actor display names (requestedByName / decidedByName).
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  mapReopenRequest,
  userDisplayName,
  getMappedReopenRequest,
} = require("../../src/services/machineShiftSessionReadService");

describe("mapReopenRequest actor display names", () => {
  it("exposes requestedByName and decidedByName from safe user relations", () => {
    const dto = mapReopenRequest({
      id: 1,
      status: "APPROVED",
      reopenReason: "Fix scrap",
      requestedAt: new Date("2026-08-24T10:00:00.000Z"),
      requestedByUserId: 7,
      requestedByUser: { id: 7, name: "Ops Lead", email: "ops@test.com" },
      decidedAt: new Date("2026-08-24T11:00:00.000Z"),
      decidedByUserId: 3,
      decidedByUser: { id: 3, name: "Prod Manager", email: "pm@test.com" },
      decisionNote: "ok",
    });
    assert.equal(dto.requestedByUserId, 7);
    assert.equal(dto.requestedByName, "Ops Lead");
    assert.equal(dto.decidedByUserId, 3);
    assert.equal(dto.decidedByName, "Prod Manager");
    assert.equal(dto.decisionNote, "ok");
  });

  it("uses Unknown user when relation missing but id / decision present", () => {
    const requested = mapReopenRequest({
      id: 2,
      status: "REQUESTED",
      reopenReason: "Need edit",
      requestedAt: new Date(),
      requestedByUserId: 99,
      requestedByUser: null,
      decidedAt: null,
      decidedByUserId: null,
      decisionNote: null,
    });
    assert.equal(requested.requestedByName, "Unknown user");
    assert.equal(requested.decidedByName, null);

    const decidedMissing = mapReopenRequest({
      id: 3,
      status: "DENIED",
      reopenReason: "Need edit",
      requestedAt: new Date(),
      requestedByUserId: 1,
      requestedByUser: { id: 1, name: "Alice" },
      decidedAt: new Date(),
      decidedByUserId: null,
      decidedByUser: null,
      decisionNote: "no",
    });
    assert.equal(decidedMissing.requestedByName, "Alice");
    assert.equal(decidedMissing.decidedByName, "Unknown user");
  });

  it("trims blank names to Unknown user when an id exists", () => {
    assert.equal(userDisplayName({ name: "  " }, 5), "Unknown user");
    assert.equal(userDisplayName({ name: "Neeraj" }, 5), "Neeraj");
    assert.equal(userDisplayName(null, null), null);
  });

  it("getMappedReopenRequest loads actor includes then maps", async () => {
    const db = {
      shiftSessionReopenRequest: {
        findUnique: async () => ({
          id: 8,
          status: "REQUESTED",
          reopenReason: "reason",
          requestedAt: new Date("2026-08-24T09:00:00.000Z"),
          requestedByUserId: 4,
          requestedByUser: { id: 4, name: "Requester", email: null },
          decidedAt: null,
          decidedByUserId: null,
          decidedByUser: null,
          decisionNote: null,
        }),
      },
    };
    const dto = await getMappedReopenRequest(8, db);
    assert.equal(dto.requestedByName, "Requester");
    assert.equal(dto.decidedByName, null);
  });
});
