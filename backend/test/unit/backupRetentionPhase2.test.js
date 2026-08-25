const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const {
  planAutomaticRetention,
  DEFAULT_DAILY,
  DEFAULT_WEEKLY,
  DEFAULT_MONTHLY,
} = require("../../../deployment/lib/backupRetention");

function row(id, backupType, status, createdAt) {
  return { id, backupType, status, createdAt, fileName: `f-${id}.sql`, filePath: `C:\\b\\f-${id}.sql` };
}

describe("planAutomaticRetention", () => {
  test("never deletes MANUAL, DEPLOYMENT, PRE_RESTORE_AUTO, or FAILED", () => {
    const rows = [
      row(1, "MANUAL", "CREATED", "2026-01-01T10:00:00Z"),
      row(2, "DEPLOYMENT", "CREATED", "2026-01-02T10:00:00Z"),
      row(3, "PRE_RESTORE_AUTO", "CREATED", "2026-01-03T10:00:00Z"),
      row(4, "AUTOMATIC", "FAILED", "2026-01-04T10:00:00Z"),
      row(5, "AUTOMATIC", "CREATED", "2026-01-05T10:00:00Z"),
    ];
    const plan = planAutomaticRetention(rows);
    assert.ok(plan.keepIds.has(1));
    assert.ok(plan.keepIds.has(2));
    assert.ok(plan.keepIds.has(3));
    assert.ok(plan.keepIds.has(4));
    assert.ok(plan.keepIds.has(5));
    assert.deepEqual(plan.deleteIds, []);
  });

  test("never deletes the latest successful backup even if AUTOMATIC would otherwise age out", () => {
    const rows = [row(99, "AUTOMATIC", "CREATED", "2026-08-20T02:00:00Z")];
    for (let i = 0; i < 20; i++) {
      const d = new Date(Date.UTC(2026, 0, 1 + i, 2, 0, 0));
      rows.push(row(i + 1, "AUTOMATIC", "CREATED", d.toISOString()));
    }
    const plan = planAutomaticRetention(rows);
    assert.ok(plan.keepIds.has(99), "latest successful must be kept");
    assert.ok(!plan.deleteIds.includes(99));
  });

  test("keeps at most daily/weekly/monthly AUTOMATIC recovery points and deletes surplus AUTOMATIC only", () => {
    const rows = [];
    // 40 distinct days of AUTOMATIC success
    for (let i = 0; i < 40; i++) {
      const d = new Date(Date.UTC(2025, 0, 1 + i, 2, 0, 0));
      rows.push(row(1000 + i, "AUTOMATIC", "CREATED", d.toISOString()));
    }
    rows.push(row(1, "MANUAL", "CREATED", "2024-01-01T00:00:00Z"));
    const plan = planAutomaticRetention(rows);
    assert.ok(plan.keepIds.has(1));
    assert.ok(plan.deleteIds.length > 0);
    for (const id of plan.deleteIds) {
      assert.ok(id >= 1000);
    }
    // At least the newest dailyN days should be kept
    const automaticOk = rows
      .filter((r) => r.backupType === "AUTOMATIC" && r.status === "CREATED")
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    for (let i = 0; i < DEFAULT_DAILY; i++) {
      assert.ok(plan.keepIds.has(automaticOk[i].id), `daily keep ${i}`);
    }
    assert.ok(DEFAULT_WEEKLY >= 1 && DEFAULT_MONTHLY >= 1);
  });
});
