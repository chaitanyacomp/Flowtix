const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { resolveScrapReportDateFilters } = require("../../src/services/scrapReportDateFilters");

describe("resolveScrapReportDateFilters", () => {
  it("omits blank From and To", () => {
    const r = resolveScrapReportDateFilters("", "");
    assert.equal(r.ok, true);
    assert.equal(r.from, undefined);
    assert.equal(r.to, undefined);
  });

  it("omits whitespace-only and missing params", () => {
    assert.deepEqual(resolveScrapReportDateFilters("   ", undefined), { ok: true });
    assert.deepEqual(resolveScrapReportDateFilters(null, null), { ok: true });
  });

  it("accepts valid single-sided From", () => {
    const r = resolveScrapReportDateFilters("2026-07-01", "");
    assert.equal(r.ok, true);
    assert.ok(r.from instanceof Date);
    assert.equal(Number.isNaN(r.from.getTime()), false);
    assert.equal(r.to, undefined);
  });

  it("accepts valid single-sided To", () => {
    const r = resolveScrapReportDateFilters("", "2026-07-15");
    assert.equal(r.ok, true);
    assert.equal(r.from, undefined);
    assert.ok(r.to instanceof Date);
    assert.equal(Number.isNaN(r.to.getTime()), false);
  });

  it("rejects invalid From/To with controlled message", () => {
    const badFrom = resolveScrapReportDateFilters("not-a-date", "2026-07-01");
    assert.equal(badFrom.ok, false);
    assert.match(badFrom.message, /Invalid from date/i);

    const badTo = resolveScrapReportDateFilters("2026-07-01", "bogus");
    assert.equal(badTo.ok, false);
    assert.match(badTo.message, /Invalid to date/i);
  });

  it("rejects From later than To with business-readable message", () => {
    const r = resolveScrapReportDateFilters("2026-07-20", "2026-07-01");
    assert.equal(r.ok, false);
    assert.equal(r.message, "From date must be on or before To date.");
  });

  it("never returns Invalid Date when ok", () => {
    const r = resolveScrapReportDateFilters("2026-01-01", "2026-01-31");
    assert.equal(r.ok, true);
    assert.equal(Number.isNaN(r.from.getTime()), false);
    assert.equal(Number.isNaN(r.to.getTime()), false);
    assert.ok(r.from.getTime() <= r.to.getTime());
  });
});
