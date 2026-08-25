const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { buildScheduleWarning } = require("../../src/services/backupScheduleStatus");

describe("buildScheduleWarning", () => {
  const now = new Date("2026-08-25T12:00:00.000Z");

  test("no warning when disabled", () => {
    const w = buildScheduleWarning({ enabled: false, now });
    assert.equal(w.code, null);
  });

  test("error when latest scheduled backup failed", () => {
    const w = buildScheduleWarning({
      enabled: true,
      now,
      lastAutomaticSuccessAt: "2026-08-20T02:00:00.000Z",
      lastAutomaticFailureAt: "2026-08-25T02:00:00.000Z",
    });
    assert.equal(w.code, "LAST_SCHEDULED_BACKUP_FAILED");
    assert.equal(w.level, "error");
  });

  test("warning when overdue", () => {
    const w = buildScheduleWarning({
      enabled: true,
      now,
      lastAutomaticSuccessAt: "2026-08-20T02:00:00.000Z",
      lastAutomaticFailureAt: null,
      overdueHours: 36,
    });
    assert.equal(w.code, "SCHEDULED_BACKUP_OVERDUE");
    assert.equal(w.level, "warning");
  });

  test("no warning when recent success", () => {
    const w = buildScheduleWarning({
      enabled: true,
      now,
      lastAutomaticSuccessAt: "2026-08-25T02:00:00.000Z",
      lastAutomaticFailureAt: "2026-08-24T02:00:00.000Z",
    });
    assert.equal(w.code, null);
  });
});
